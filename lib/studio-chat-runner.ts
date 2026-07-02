import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages"
import { createAgent } from "langchain"
import { randomUUID } from "node:crypto"

import {
  resolveChatReasoningEffort,
  type ChatReasoningEffort,
  type SupportedChatModel,
} from "@/lib/chat-models"
import {
  createAvailableSessionFilesManifest,
  describeAttachmentForPrompt,
} from "@/lib/astraflow-session-sandbox"
import { createStudioSkillsMiddleware } from "@/lib/ai/skills/studio-skills"
import { createStudioMcpToolClient } from "@/lib/ai/tools/mcp"
import { createStudioAgentTools } from "@/lib/ai/tools/studio"
import { createModelverseChatModel } from "@/lib/modelverse-langchain"
import { isMcpToolName } from "@/lib/mcp"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/modelverse-openai"
import {
  createStudioMessage,
  getStudioModelverseApiKey,
  getStudioMessage,
  getStudioSession,
  listStudioMessages,
  updateStudioMessageSnapshot,
} from "@/lib/studio-db"
import type {
  StudioChatRunLiveSnapshot,
  StudioChatRunSnapshot,
  StudioChatRunStatus,
  StudioMessageActivity,
  StudioMessagePart,
  StudioMessageStatus,
} from "@/lib/studio-types"

const STUDIO_CHAT_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"
const LIVE_SNAPSHOT_INTERVAL_MS = 50
const SNAPSHOT_PERSIST_INTERVAL_MS = 350
const COMPLETED_RUN_RETENTION_MS = 5 * 60_000

type ChatStreamEvent =
  | {
      type: "content" | "reasoning"
      delta: string
    }
  | {
      type: "tool_call"
      toolCallId: string
      toolName: string
      input: string
    }
  | {
      type: "tool_result"
      toolCallId: string
      toolName: string
      status: "complete" | "error"
      output?: string
      error?: string
    }

type ChatStreamSnapshot = {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
  reasoningContent: string
  reasoningDurationMs: number | null
}

type StudioChatRunRecord = StudioChatRunSnapshot & {
  abortController: AbortController
  cleanupTimer: ReturnType<typeof setTimeout> | null
  latestSnapshot: ChatStreamSnapshot
  livePublishTimer: ReturnType<typeof setTimeout> | null
  lastLivePublishedAt: number
  promise: Promise<void> | null
}

type StudioChatRunListener = (snapshot: StudioChatRunLiveSnapshot) => void

declare global {
  var astraflowStudioChatRuns: Map<string, StudioChatRunRecord> | undefined
  var astraflowStudioChatRunListeners:
    Map<string, Set<StudioChatRunListener>> | undefined
}

function getStudioChatRuns() {
  if (!globalThis.astraflowStudioChatRuns) {
    globalThis.astraflowStudioChatRuns = new Map()
  }

  return globalThis.astraflowStudioChatRuns
}

function getStudioChatRunListeners() {
  if (!globalThis.astraflowStudioChatRunListeners) {
    globalThis.astraflowStudioChatRunListeners = new Map()
  }

  return globalThis.astraflowStudioChatRunListeners
}

function nowIso() {
  return new Date().toISOString()
}

function toRunSnapshot(record: StudioChatRunRecord): StudioChatRunSnapshot {
  return {
    runId: record.runId,
    sessionId: record.sessionId,
    assistantMessageId: record.assistantMessageId,
    status: record.status,
    error: record.error,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  }
}

function getLiveMessageStatus(
  record: StudioChatRunRecord
): StudioMessageStatus {
  if (record.status === "error") {
    return "error"
  }

  if (record.status === "complete" || record.status === "cancelled") {
    return "complete"
  }

  return "streaming"
}

function toRunLiveSnapshot(
  record: StudioChatRunRecord
): StudioChatRunLiveSnapshot {
  const message = getStudioMessage(record.assistantMessageId)
  const latest = record.latestSnapshot

  return {
    ...toRunSnapshot(record),
    message: message
      ? {
          ...message,
          content: latest.content,
          activities: latest.activities,
          parts: latest.parts,
          reasoningContent: latest.reasoningContent,
          reasoningDurationMs: latest.reasoningDurationMs,
          status: getLiveMessageStatus(record),
        }
      : null,
  }
}

function emitRunLiveSnapshot(record: StudioChatRunRecord) {
  record.lastLivePublishedAt = Date.now()

  const listeners = getStudioChatRunListeners().get(record.sessionId)

  if (!listeners || listeners.size === 0) {
    return
  }

  const snapshot = toRunLiveSnapshot(record)

  for (const listener of listeners) {
    try {
      listener(snapshot)
    } catch (error) {
      console.error("[studio-chat] live_listener_failed", error)
    }
  }
}

function scheduleRunLiveSnapshot(record: StudioChatRunRecord, force = false) {
  if (force) {
    if (record.livePublishTimer) {
      clearTimeout(record.livePublishTimer)
      record.livePublishTimer = null
    }

    emitRunLiveSnapshot(record)
    return
  }

  const elapsed = Date.now() - record.lastLivePublishedAt

  if (elapsed >= LIVE_SNAPSHOT_INTERVAL_MS) {
    emitRunLiveSnapshot(record)
    return
  }

  if (record.livePublishTimer) {
    return
  }

  record.livePublishTimer = setTimeout(() => {
    record.livePublishTimer = null
    emitRunLiveSnapshot(record)
  }, LIVE_SNAPSHOT_INTERVAL_MS - elapsed)
}

function setRunStatus(
  record: StudioChatRunRecord,
  status: StudioChatRunStatus,
  error: string | null = record.error
) {
  record.status = status
  record.error = error
  record.updatedAt = nowIso()
}

function scheduleRunCleanup(record: StudioChatRunRecord) {
  if (record.cleanupTimer) {
    clearTimeout(record.cleanupTimer)
  }

  record.cleanupTimer = setTimeout(() => {
    if (record.livePublishTimer) {
      clearTimeout(record.livePublishTimer)
      record.livePublishTimer = null
    }

    const runs = getStudioChatRuns()

    if (runs.get(record.sessionId)?.runId === record.runId) {
      runs.delete(record.sessionId)
    }
  }, COMPLETED_RUN_RETENTION_MS)
}

function truncateDebugValue(value: unknown, maxLength = 260) {
  const text = stringifyToolPayload(value).replace(/\s+/g, " ").trim()

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function debugStudioChatTool(label: string, payload: Record<string, unknown>) {
  if (!STUDIO_CHAT_DEBUG) {
    return
  }

  console.info(`[studio-chat:tool] ${label}`, payload)
}

function isAbortLikeError(error: unknown, signal?: AbortSignal) {
  const record = getRecord(error)
  const name = typeof record?.name === "string" ? record.name : ""
  const message = error instanceof Error ? error.message : String(error)

  return (
    Boolean(signal?.aborted) ||
    name === "AbortError" ||
    name === "ResponseAborted" ||
    message.includes("ResponseAborted") ||
    message.includes("aborted")
  )
}

function stringifyToolPayload(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isVisibleToolName(name: unknown): name is string {
  return (
    name === "web_search" ||
    name === "web_fetch" ||
    name === "run_code" ||
    name === "run_command" ||
    name === "sandbox_get_host" ||
    name === "upload_file" ||
    name === "list_files" ||
    name === "read_file" ||
    name === "write_file" ||
    name === "download_file" ||
    name === "list_installed_skills" ||
    name === "load_skill" ||
    name === "list_installed_mcp_servers" ||
    isMcpToolName(name)
  )
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function getRawEventData(event: unknown) {
  const record = getRecord(event)
  const params = getRecord(record?.params)

  return {
    method: record?.method,
    event: record?.event,
    name: record?.name,
    runId: record?.run_id ?? record?.runId,
    data: getRecord(params?.data) ?? getRecord(record?.data),
  }
}

function getContentBlock(data: Record<string, unknown>) {
  return getRecord(data.contentBlock) ?? getRecord(data.content_block)
}

function getToolCallInput(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }

  return value
}

function getStringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value
    }
  }

  return null
}

function getToolCallId(data: Record<string, unknown>, runId: unknown) {
  const toolCall = getRecord(data.tool_call) ?? getRecord(data.toolCall)
  const id = getStringValue(
    data.tool_call_id,
    data.toolCallId,
    toolCall?.id,
    runId
  )

  return id ?? randomUUID()
}

function getToolName(data: Record<string, unknown>, fallbackName: unknown) {
  const toolCall = getRecord(data.tool_call) ?? getRecord(data.toolCall)

  return getStringValue(
    data.tool_name,
    data.toolName,
    toolCall?.name,
    fallbackName
  )
}

function inferToolNameFromToolCallId(toolCallId: string) {
  const [candidate] = toolCallId.split(":")

  return isVisibleToolName(candidate) ? candidate : null
}

function resolveToolNameForEvent({
  data,
  fallbackName,
  toolCallId,
  seenToolCalls,
}: {
  data: Record<string, unknown>
  fallbackName: unknown
  toolCallId: string
  seenToolCalls: Map<string, string>
}) {
  return (
    getToolName(data, fallbackName) ??
    seenToolCalls.get(toolCallId) ??
    inferToolNameFromToolCallId(toolCallId)
  )
}

function getToolInput(data: Record<string, unknown>) {
  const toolCall = getRecord(data.tool_call) ?? getRecord(data.toolCall)

  return data.input ?? toolCall?.args ?? toolCall?.input ?? ""
}

function getToolOutput(value: unknown) {
  const record = getRecord(value)
  const kwargs = getRecord(record?.kwargs)

  return record?.content ?? kwargs?.content ?? value
}

function toLangChainMessages(
  sessionId: string,
  retryMessageId?: string
): BaseMessage[] {
  const history = listStudioMessages(sessionId)
  const retryMessageIndex = retryMessageId
    ? history.findIndex((message) => message.id === retryMessageId)
    : -1
  const effectiveHistory =
    retryMessageIndex >= 0 ? history.slice(0, retryMessageIndex) : history

  return effectiveHistory.map((message) => {
    if (message.role === "user" && message.attachments.length > 0) {
      const parts: MessageContent = []

      if (message.content) {
        parts.push({ type: "text", text: message.content })
      }

      for (const attachment of message.attachments) {
        if (attachment.type === "image" && attachment.dataUrl) {
          parts.push({
            type: "image_url",
            image_url: { url: attachment.dataUrl },
          })
        }

        parts.push({
          type: "text",
          text: describeAttachmentForPrompt(attachment),
        })
      }

      return new HumanMessage({ content: parts })
    }

    if (message.role === "user") {
      return new HumanMessage(message.content)
    }

    return new AIMessage(message.content)
  })
}

function getAgentSystemPrompt({
  hasWebFetch,
  hasWebSearch,
  hasRunCode,
  hasMcpTools,
  sandboxManifest,
}: {
  hasWebFetch: boolean
  hasWebSearch: boolean
  hasRunCode: boolean
  hasMcpTools: boolean
  sandboxManifest: string
}) {
  if (!hasWebFetch && !hasWebSearch && !hasRunCode && !hasMcpTools) {
    return DEFAULT_SYSTEM_PROMPT
  }

  const toolInstructions: string[] = []

  if (hasWebFetch) {
    toolInstructions.push(
      "You have access to a web_fetch tool. Use it when the user gives a URL or asks to read, summarize, extract, or answer questions from a specific page."
    )
  }

  if (hasWebSearch) {
    toolInstructions.push(
      "You have access to a web_search tool backed by Exa. Use it when the user asks for web search, latest/current information, source-backed facts, or details that may have changed recently. When using web_search, cite source URLs in the final answer."
    )
  }

  if (hasRunCode) {
    toolInstructions.push(
      "You have access to a persistent per-chat AstraFlow Sandbox through run_code, run_command, sandbox_get_host, and file tools: upload_file, list_files, read_file, write_file, and download_file. Use run_code for calculations, data processing, document analysis, and scripts in python, javascript, typescript, bash, r, or java. Use run_command for direct shell commands, bash pipelines, package/environment inspection, and filesystem operations; it runs through sandbox.commands.run with /bin/bash -l -c. When starting a preview server inside the sandbox, bind it to 0.0.0.0:<port> because localhost or 127.0.0.1 listeners are not reachable through the sandbox proxy, start it in a detached tmux session, then call sandbox_get_host with that port to get the externally reachable host or URL. Do not run long-lived foreground servers such as python3 -m http.server 8080 directly in run_command, because they can block the tool call. For uploaded PDFs, Word documents, spreadsheets, CSVs, or other non-image files, call upload_file with the file_id first, then use the returned sandbox path inside run_code or run_command. Do not try to inline binary content. The sandbox auto-pauses after inactivity and auto-resumes on traffic with memory and filesystem preserved. Do not ask for a sandbox_id or auto_pause value; this chat session already owns one sandbox. Use download_file when generated output should be saved to the local file library for the user."
    )
  }

  if (hasMcpTools) {
    toolInstructions.push(
      "You may also have tools whose names begin with mcp_ and include a server prefix. These are user-enabled MCP tools. Use them only when they are relevant to the user's request, and treat their outputs as external tool results."
    )
  }

  toolInstructions.push(
    "Use list_installed_mcp_servers when the user asks what MCP servers/plugins are installed, enabled, available, or why an MCP is not callable."
  )

  return `${DEFAULT_SYSTEM_PROMPT}

${toolInstructions.join("\n")}
${sandboxManifest ? `\n${sandboxManifest}` : ""}`
}

function createInitialSnapshot(): ChatStreamSnapshot {
  return {
    content: "",
    activities: [],
    parts: [],
    reasoningContent: "",
    reasoningDurationMs: null,
  }
}

function createSnapshotAccumulator() {
  let snapshot = createInitialSnapshot()
  let activeReasoningPartId: string | null = null
  let activeReasoningStartedAt: number | null = null
  let totalReasoningDurationMs = 0

  function markReasoningDone() {
    if (!activeReasoningPartId || activeReasoningStartedAt === null) {
      return
    }

    const durationMs = Math.max(
      1000,
      Math.round(Date.now() - activeReasoningStartedAt)
    )
    totalReasoningDurationMs += durationMs
    snapshot = {
      ...snapshot,
      reasoningDurationMs: totalReasoningDurationMs,
      parts: snapshot.parts.map((part) =>
        part.type === "reasoning" && part.id === activeReasoningPartId
          ? { ...part, durationMs }
          : part
      ),
    }
    activeReasoningPartId = null
    activeReasoningStartedAt = null
  }

  function appendReasoningPart(delta: string) {
    if (!delta) {
      return
    }

    const lastPart = snapshot.parts.at(-1)

    if (lastPart?.type === "reasoning" && lastPart.durationMs === null) {
      if (!activeReasoningPartId) {
        activeReasoningPartId = lastPart.id
      }

      if (activeReasoningStartedAt === null) {
        activeReasoningStartedAt = Date.now()
      }

      snapshot = {
        ...snapshot,
        reasoningContent: snapshot.reasoningContent + delta,
        parts: [
          ...snapshot.parts.slice(0, -1),
          { ...lastPart, content: lastPart.content + delta },
        ],
      }
      return
    }

    const partId = randomUUID()
    activeReasoningPartId = partId
    activeReasoningStartedAt = Date.now()
    snapshot = {
      ...snapshot,
      reasoningContent: snapshot.reasoningContent + delta,
      parts: [
        ...snapshot.parts,
        {
          id: partId,
          type: "reasoning",
          content: delta,
          durationMs: null,
        },
      ],
    }
  }

  function appendTextPart(delta: string) {
    if (!delta) {
      return
    }

    const lastPart = snapshot.parts.at(-1)

    if (lastPart?.type === "text") {
      snapshot = {
        ...snapshot,
        content: snapshot.content + delta,
        parts: [
          ...snapshot.parts.slice(0, -1),
          { ...lastPart, content: lastPart.content + delta },
        ],
      }
      return
    }

    snapshot = {
      ...snapshot,
      content: snapshot.content + delta,
      parts: [
        ...snapshot.parts,
        {
          id: randomUUID(),
          type: "text",
          content: delta,
        },
      ],
    }
  }

  function upsertToolPart(activity: StudioMessageActivity) {
    const existingIndex = snapshot.parts.findIndex(
      (part) => part.type === "tool" && part.activity.id === activity.id
    )

    if (existingIndex < 0) {
      snapshot = {
        ...snapshot,
        parts: [
          ...snapshot.parts,
          {
            id: activity.id,
            type: "tool",
            activity,
          },
        ],
      }
      return
    }

    snapshot = {
      ...snapshot,
      parts: snapshot.parts.map((part, index) =>
        index === existingIndex && part.type === "tool"
          ? { ...part, activity }
          : part
      ),
    }
  }

  function handleEvent(event: ChatStreamEvent) {
    if (event.type === "reasoning") {
      appendReasoningPart(event.delta)
      return
    }

    if (event.type === "content") {
      markReasoningDone()
      appendTextPart(event.delta)
      return
    }

    if (event.type === "tool_call") {
      markReasoningDone()
      const existingById = snapshot.activities.find(
        (activity) => activity.id === event.toolCallId
      )
      const activity: StudioMessageActivity = existingById
        ? {
            ...existingById,
            input: existingById.input || event.input,
          }
        : {
            id: event.toolCallId,
            toolName: event.toolName,
            status: "running",
            input: event.input,
            output: "",
            error: null,
          }

      snapshot = {
        ...snapshot,
        activities: existingById
          ? snapshot.activities.map((candidate) =>
              candidate.id === event.toolCallId ? activity : candidate
            )
          : [
              ...snapshot.activities.filter(
                (candidate) => candidate.id !== event.toolCallId
              ),
              activity,
            ],
      }
      upsertToolPart(activity)
      return
    }

    if (event.type !== "tool_result") {
      return
    }

    markReasoningDone()
    let activityIndex = snapshot.activities.findIndex(
      (activity) => activity.id === event.toolCallId
    )

    if (activityIndex < 0) {
      for (let index = snapshot.activities.length - 1; index >= 0; index--) {
        const activity = snapshot.activities[index]

        if (
          activity.toolName === event.toolName &&
          activity.status === "running"
        ) {
          activityIndex = index
          break
        }
      }
    }

    const nextActivity: StudioMessageActivity =
      activityIndex >= 0
        ? {
            ...snapshot.activities[activityIndex],
            status: event.status,
            output: event.output ?? "",
            error: event.error ?? null,
          }
        : {
            id: event.toolCallId,
            toolName: event.toolName,
            status: event.status,
            input: "",
            output: event.output ?? "",
            error: event.error ?? null,
          }

    snapshot = {
      ...snapshot,
      activities:
        activityIndex >= 0
          ? snapshot.activities.map((activity, index) =>
              index === activityIndex ? nextActivity : activity
            )
          : [...snapshot.activities, nextActivity],
    }
    upsertToolPart(nextActivity)
  }

  function getSnapshot() {
    return snapshot
  }

  function completeReasoning() {
    markReasoningDone()
    return snapshot
  }

  function finalizeStopped() {
    markReasoningDone()
    const completedActivities = snapshot.activities.filter(
      (activity) => activity.status !== "running"
    )
    const completedActivityIds = new Set(
      completedActivities.map((activity) => activity.id)
    )

    snapshot = {
      ...snapshot,
      activities: completedActivities,
      parts: snapshot.parts.filter((part) => {
        if (part.type === "text" || part.type === "reasoning") {
          return true
        }

        return completedActivityIds.has(part.activity.id)
      }),
    }

    return snapshot
  }

  function finalizeFailed(message: string) {
    markReasoningDone()

    const activities = snapshot.activities.map((activity) =>
      activity.status === "running"
        ? {
            ...activity,
            status: "error" as const,
            error: message,
          }
        : activity
    )

    const parts = snapshot.parts.map((part) =>
      part.type === "tool"
        ? {
            ...part,
            activity:
              activities.find((activity) => activity.id === part.activity.id) ??
              part.activity,
          }
        : part
    )

    if (
      !snapshot.content.trim() &&
      !snapshot.reasoningContent.trim() &&
      activities.length === 0
    ) {
      snapshot = {
        ...snapshot,
        content: message,
        activities,
        parts: [
          ...parts,
          {
            id: randomUUID(),
            type: "text",
            content: message,
          },
        ],
      }
      return snapshot
    }

    snapshot = {
      ...snapshot,
      activities,
      parts,
    }

    return snapshot
  }

  return {
    completeReasoning,
    finalizeFailed,
    finalizeStopped,
    getSnapshot,
    handleEvent,
  }
}

function persistAssistantSnapshot({
  assistantMessageId,
  sessionId,
  snapshot,
  status,
}: {
  assistantMessageId: string
  sessionId: string
  snapshot: ChatStreamSnapshot
  status: StudioMessageStatus
}) {
  updateStudioMessageSnapshot({
    messageId: assistantMessageId,
    sessionId,
    content: snapshot.content,
    activities: snapshot.activities,
    parts: snapshot.parts,
    reasoningContent: snapshot.reasoningContent,
    reasoningDurationMs: snapshot.reasoningDurationMs,
    status,
  })
}

async function executeStudioChatRun({
  assistantMessageId,
  langChainMessages,
  model,
  reasoningEffort,
  record,
  sessionId,
}: {
  assistantMessageId: string
  langChainMessages: BaseMessage[]
  model: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
  record: StudioChatRunRecord
  sessionId: string
}) {
  const accumulator = createSnapshotAccumulator()
  let lastPersistAt = 0
  let mcpToolClient: Awaited<
    ReturnType<typeof createStudioMcpToolClient>
  > | null = null

  const persistSnapshot = (
    status: StudioMessageStatus = "streaming",
    force = false
  ) => {
    record.latestSnapshot = accumulator.getSnapshot()

    const timestamp = Date.now()

    if (!force && timestamp - lastPersistAt < SNAPSHOT_PERSIST_INTERVAL_MS) {
      scheduleRunLiveSnapshot(record, force)
      return
    }

    lastPersistAt = timestamp
    persistAssistantSnapshot({
      assistantMessageId,
      sessionId,
      snapshot: record.latestSnapshot,
      status,
    })
    scheduleRunLiveSnapshot(record, force)
  }

  try {
    setRunStatus(record, "running")
    persistSnapshot("streaming", true)

    const resolvedReasoningEffort = resolveChatReasoningEffort(
      model,
      reasoningEffort
    )
    const chatModel = createModelverseChatModel(model, resolvedReasoningEffort)
    const modelverseApiKey = getStudioModelverseApiKey()?.key ?? null
    const sandboxManifest = modelverseApiKey
      ? createAvailableSessionFilesManifest(sessionId)
      : ""
    const nativeTools = createStudioAgentTools({
      sessionId,
      modelverseApiKey,
    })
    mcpToolClient = await createStudioMcpToolClient()
    const tools = [...nativeTools, ...mcpToolClient.tools]
    const hasWebFetch = tools.some(
      (agentTool) => agentTool.name === "web_fetch"
    )
    const hasWebSearch = tools.some(
      (agentTool) => agentTool.name === "web_search"
    )
    const hasRunCode = tools.some((agentTool) => agentTool.name === "run_code")
    const hasMcpTools = tools.some((agentTool) =>
      isMcpToolName(agentTool.name)
    )
    const skillsMiddleware = createStudioSkillsMiddleware({
      sessionId,
      modelverseApiKey,
    })
    const agent = createAgent({
      model: chatModel,
      tools,
      ...(skillsMiddleware ? { middleware: [skillsMiddleware] } : {}),
      systemPrompt: getAgentSystemPrompt({
        hasWebFetch,
        hasWebSearch,
        hasRunCode,
        hasMcpTools,
        sandboxManifest,
      }),
    })
    const run = await agent.streamEvents(
      { messages: langChainMessages },
      {
        version: "v3",
        signal: record.abortController.signal,
      }
    )
    const runOutput = run.output.catch((error) => {
      if (isAbortLikeError(error, record.abortController.signal)) {
        return null
      }

      throw error
    })
    const seenToolCalls = new Map<string, string>()
    let toolEventSeq = 0

    const handleToolCall = ({
      toolCallId,
      toolName,
      input,
    }: {
      toolCallId: string
      toolName: string
      input: unknown
    }) => {
      if (seenToolCalls.has(toolCallId)) {
        debugStudioChatTool("tool_call_duplicate_skipped", {
          seq: ++toolEventSeq,
          toolCallId,
          toolName,
          firstToolName: seenToolCalls.get(toolCallId),
        })
        return
      }

      seenToolCalls.set(toolCallId, toolName)
      debugStudioChatTool("tool_call_emit", {
        seq: ++toolEventSeq,
        toolCallId,
        toolName,
        inputPreview: truncateDebugValue(input),
      })
      accumulator.handleEvent({
        type: "tool_call",
        toolCallId,
        toolName,
        input: stringifyToolPayload(getToolCallInput(input)),
      })
      persistSnapshot()
    }

    for await (const rawEvent of run) {
      const { method, data, event, name, runId } = getRawEventData(rawEvent)

      if (!data) {
        continue
      }

      if (method === "messages") {
        if (data.event === "content-block-delta") {
          const delta = getRecord(data.delta)

          if (delta?.type === "reasoning-delta") {
            accumulator.handleEvent({
              type: "reasoning",
              delta: typeof delta.reasoning === "string" ? delta.reasoning : "",
            })
            persistSnapshot()
          }

          if (delta?.type === "text-delta") {
            accumulator.handleEvent({
              type: "content",
              delta: typeof delta.text === "string" ? delta.text : "",
            })
            persistSnapshot()
          }
        }

        if (data.event === "content-block-finish") {
          const contentBlock = getContentBlock(data)

          if (
            contentBlock?.type === "tool_call" &&
            isVisibleToolName(contentBlock.name)
          ) {
            debugStudioChatTool("message_tool_call_block", {
              seq: ++toolEventSeq,
              toolCallId:
                typeof contentBlock.id === "string" ? contentBlock.id : null,
              toolName: contentBlock.name,
              dataKeys: Object.keys(data),
            })
            handleToolCall({
              toolCallId:
                typeof contentBlock.id === "string"
                  ? contentBlock.id
                  : randomUUID(),
              toolName: contentBlock.name,
              input: contentBlock.args ?? contentBlock.input ?? "",
            })
          }
        }
      }

      if (
        event === "on_tool_start" ||
        event === "on_tool_end" ||
        event === "on_tool_error"
      ) {
        const toolCallId = getToolCallId(data, runId)
        const toolName = resolveToolNameForEvent({
          data,
          fallbackName: name,
          toolCallId,
          seenToolCalls,
        })

        debugStudioChatTool("langchain_tool_event_seen", {
          seq: ++toolEventSeq,
          event,
          method,
          name,
          runId,
          toolName,
          dataKeys: Object.keys(data),
        })

        if (!isVisibleToolName(toolName)) {
          debugStudioChatTool("langchain_tool_event_skipped", {
            seq: ++toolEventSeq,
            event,
            toolCallId,
            rawToolName: getToolName(data, name),
            knownToolName: seenToolCalls.get(toolCallId),
          })
          continue
        }

        if (event === "on_tool_start") {
          handleToolCall({
            toolCallId,
            toolName,
            input: getToolInput(data),
          })
        }

        if (event === "on_tool_end") {
          accumulator.handleEvent({
            type: "tool_result",
            toolCallId,
            toolName,
            status: "complete",
            output: stringifyToolPayload(getToolOutput(data.output)),
          })
          persistSnapshot()
        }

        if (event === "on_tool_error") {
          accumulator.handleEvent({
            type: "tool_result",
            toolCallId,
            toolName,
            status: "error",
            error: stringifyToolPayload(
              getToolOutput(data.error ?? data.output)
            ),
          })
          persistSnapshot()
        }
      }

      if (method === "tools") {
        const toolCallId = getToolCallId(data, runId)
        const toolName = resolveToolNameForEvent({
          data,
          fallbackName: name,
          toolCallId,
          seenToolCalls,
        })

        if (!isVisibleToolName(toolName)) {
          debugStudioChatTool("custom_tool_event_skipped", {
            seq: ++toolEventSeq,
            event: data.event,
            toolCallId,
            rawToolName: getToolName(data, name),
            knownToolName: seenToolCalls.get(toolCallId),
          })
          continue
        }

        if (data.event === "tool-started") {
          handleToolCall({
            toolCallId,
            toolName,
            input: getToolInput(data),
          })
        }

        if (data.event === "tool-finished") {
          accumulator.handleEvent({
            type: "tool_result",
            toolCallId,
            toolName,
            status: "complete",
            output: stringifyToolPayload(getToolOutput(data.output)),
          })
          persistSnapshot()
        }

        if (data.event === "tool-error") {
          accumulator.handleEvent({
            type: "tool_result",
            toolCallId,
            toolName,
            status: "error",
            error: stringifyToolPayload(
              getToolOutput(data.message ?? data.error)
            ),
          })
          persistSnapshot()
        }
      }
    }

    await runOutput

    if (record.abortController.signal.aborted) {
      accumulator.finalizeStopped()
      setRunStatus(record, "cancelled")
      persistSnapshot("complete", true)
      return
    }

    accumulator.completeReasoning()
    setRunStatus(record, "complete")
    persistSnapshot("complete", true)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Chat request failed."

    if (isAbortLikeError(error, record.abortController.signal)) {
      accumulator.finalizeStopped()
      setRunStatus(record, "cancelled")
      persistSnapshot("complete", true)
      return
    }

    console.error("[studio-chat] run_failed", error)
    accumulator.finalizeFailed(message)
    setRunStatus(record, "error", message)
    persistSnapshot("error", true)
  } finally {
    await mcpToolClient?.close().catch((error) => {
      console.warn("[studio-mcp] close_failed", error)
    })
  }
}

export function getStudioChatRun(sessionId: string) {
  const record = getStudioChatRuns().get(sessionId)

  return record ? toRunSnapshot(record) : null
}

export function cancelStudioChatRun(sessionId: string) {
  const record = getStudioChatRuns().get(sessionId)

  if (!record || record.status === "complete" || record.status === "error") {
    return null
  }

  record.abortController.abort()
  setRunStatus(record, "cancelled")

  return toRunSnapshot(record)
}

export function getStudioChatRunLiveSnapshot(sessionId: string) {
  const record = getStudioChatRuns().get(sessionId)

  return record ? toRunLiveSnapshot(record) : null
}

export function subscribeStudioChatRun(
  sessionId: string,
  listener: StudioChatRunListener
) {
  const listenersBySession = getStudioChatRunListeners()
  const listeners =
    listenersBySession.get(sessionId) ?? new Set<StudioChatRunListener>()

  listeners.add(listener)
  listenersBySession.set(sessionId, listeners)

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0) {
      listenersBySession.delete(sessionId)
    }
  }
}

export function startStudioChatRun({
  model,
  reasoningEffort,
  retryMessageId,
  sessionId,
}: {
  model: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
  retryMessageId?: string
  sessionId: string
}) {
  const existing = getStudioChatRuns().get(sessionId)

  if (
    existing &&
    (existing.status === "queued" || existing.status === "running")
  ) {
    return toRunSnapshot(existing)
  }

  if (!getStudioSession(sessionId)) {
    throw new Error("Session not found")
  }

  const langChainMessages = toLangChainMessages(sessionId, retryMessageId)
  const assistantMessage = createStudioMessage({
    sessionId,
    role: "assistant",
    content: "",
    model,
    replacesMessageId: retryMessageId ?? null,
    status: "streaming",
  })
  const timestamp = nowIso()
  const record: StudioChatRunRecord = {
    runId: randomUUID(),
    sessionId,
    assistantMessageId: assistantMessage.id,
    status: "queued",
    error: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    abortController: new AbortController(),
    cleanupTimer: null,
    latestSnapshot: createInitialSnapshot(),
    livePublishTimer: null,
    lastLivePublishedAt: 0,
    promise: null,
  }

  getStudioChatRuns().set(sessionId, record)

  record.promise = executeStudioChatRun({
    assistantMessageId: assistantMessage.id,
    langChainMessages,
    model,
    reasoningEffort,
    record,
    sessionId,
  }).finally(() => {
    scheduleRunCleanup(record)
  })

  return toRunSnapshot(record)
}
