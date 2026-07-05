import { randomUUID } from "node:crypto"
import type { BaseMessage } from "@langchain/core/messages"
import type {
  CanUseTool,
  Options as ClaudeAgentOptions,
  PermissionResult,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk"

import { AgentEventQueue } from "@/lib/agent/event-queue"
import type { AgentEvent } from "@/lib/agent/events"
import {
  cancelSessionPermissions,
  requestPermission,
  type PermissionOption,
} from "@/lib/agent/permission-broker"
import { registerAgentRuntime } from "@/lib/agent/runtime"
import type {
  AgentRunInput,
  AgentRuntime,
  AgentRuntimeInfo,
} from "@/lib/agent/runtime"
import {
  MODELVERSE_ANTHROPIC_BASE_URL,
  getAgentModelById,
  getRuntimeModelSetting,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import type { ChatReasoningEffort } from "@/lib/chat-models"
import { getStudioModelverseApiKey } from "@/lib/studio-db"

type ClaudeAgentQuery =
  (typeof import("@anthropic-ai/claude-agent-sdk"))["query"]

type StreamedBlock = {
  index: number
  text: string
  type: "text" | "thinking"
}

export type ClaudeSdkMapperState = {
  emittedToolCallIds: Set<string>
  streamedBlocks: StreamedBlock[]
  taskIdByToolUseId: Map<string, string>
  taskNames: Map<string, string>
  toolNames: Map<string, string>
}

export type ClaudeSdkMappableMessage = SDKMessage | Record<string, unknown>

export type ClaudeNativeRuntimeOptions = {
  info?: AgentRuntimeInfo
  query?: ClaudeAgentQuery
}

type ClaudeNativeRunConfig = {
  env?: Record<string, string | undefined>
  model?: string
  settings?: NonNullable<ClaudeAgentOptions["settings"]>
}

const CLAUDE_NATIVE_RUNTIME_CAPABILITIES = {
  hitl: true,
  resume: false,
  subagents: true,
  plan: true,
  sandbox: false,
  mcp: true,
  skills: true,
}

export const CLAUDE_NATIVE_RUNTIME_ID = "claude-native"

export const CLAUDE_NATIVE_RUNTIME_INFO = {
  id: CLAUDE_NATIVE_RUNTIME_ID,
  label: "Claude Native",
  description: "Claude Code via the native Claude Agent SDK",
  capabilities: CLAUDE_NATIVE_RUNTIME_CAPABILITIES,
} satisfies AgentRuntimeInfo

export function createClaudeSdkMapperState(): ClaudeSdkMapperState {
  return {
    emittedToolCallIds: new Set(),
    streamedBlocks: [],
    taskIdByToolUseId: new Map(),
    taskNames: new Map(),
    toolNames: new Map(),
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function getString(value: unknown) {
  return typeof value === "string" ? value : null
}

function stringifyPayload(value: unknown) {
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

function compactObject(entries: Array<[string, unknown]>) {
  const result: Record<string, unknown> = {}

  for (const [key, value] of entries) {
    if (value === undefined || value === null) {
      continue
    }

    if (Array.isArray(value) && value.length === 0) {
      continue
    }

    result[key] = value
  }

  return Object.keys(result).length ? result : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAbortLikeError(error: unknown, signal?: AbortSignal) {
  const record = getRecord(error)
  const name = typeof record?.name === "string" ? record.name : ""
  const message = errorMessage(error).toLowerCase()

  return (
    Boolean(signal?.aborted) ||
    name === "AbortError" ||
    message.includes("aborted") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  )
}

function contentPartToText(part: unknown) {
  if (typeof part === "string") {
    return part
  }

  const record = getRecord(part)

  if (!record) {
    return ""
  }

  if (record.type === "text" && typeof record.text === "string") {
    return record.text
  }

  if (record.type === "image_url") {
    return "[image]"
  }

  return stringifyPayload(record)
}

function messageContentToText(content: BaseMessage["content"]) {
  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content.map(contentPartToText).filter(Boolean).join("\n")
  }

  return stringifyPayload(content)
}

function getMessageType(message: BaseMessage) {
  const typedMessage = message as { _getType?: () => string }

  return typedMessage._getType?.() ?? "message"
}

function roleLabelForMessage(message: BaseMessage) {
  const type = getMessageType(message)

  if (type === "human") {
    return "User"
  }

  if (type === "ai") {
    return "Assistant"
  }

  if (type === "system") {
    return "System"
  }

  return "Message"
}

function truncateForPrompt(text: string, maxLength = 600) {
  const cleaned = text.replace(/\s+/g, " ").trim()

  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}...`
    : cleaned
}

function createConversationRecap(
  messages: BaseMessage[],
  latestUserIndex: number
) {
  const priorMessages = messages
    .slice(Math.max(0, latestUserIndex - 8), latestUserIndex)
    .map((message) => {
      const text = truncateForPrompt(messageContentToText(message.content))

      return text ? `- ${roleLabelForMessage(message)}: ${text}` : null
    })
    .filter(Boolean)

  if (!priorMessages.length) {
    return null
  }

  return [
    "Conversation recap before this Claude Code turn:",
    ...priorMessages,
  ].join("\n")
}

function getLatestUserMessage(messages: BaseMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (getMessageType(messages[index]) === "human") {
      return { index, message: messages[index] }
    }
  }

  const index = messages.length - 1

  return index >= 0 ? { index, message: messages[index] } : null
}

function createClaudePrompt(messages: BaseMessage[]) {
  const latestUserMessage = getLatestUserMessage(messages)

  if (!latestUserMessage) {
    return ""
  }

  const latestText = messageContentToText(latestUserMessage.message.content)
  const recap = createConversationRecap(messages, latestUserMessage.index)

  return recap ? `${recap}\n\nLatest user message:\n${latestText}` : latestText
}

function getBlockText(block: Record<string, unknown>) {
  if (block.type === "text" && typeof block.text === "string") {
    return { text: block.text, type: "text" as const }
  }

  if (block.type === "thinking" && typeof block.thinking === "string") {
    return { text: block.thinking, type: "thinking" as const }
  }

  return null
}

function getToolUseBlock(block: Record<string, unknown>) {
  if (
    block.type !== "tool_use" &&
    block.type !== "server_tool_use" &&
    block.type !== "mcp_tool_use"
  ) {
    return null
  }

  const id = getString(block.id)
  const name = getString(block.name)

  if (!id || !name) {
    return null
  }

  return {
    id,
    input: block.input,
    name,
  }
}

function getToolResultBlock(block: Record<string, unknown>) {
  if (block.type !== "tool_result") {
    return null
  }

  const id = getString(block.tool_use_id)

  if (!id) {
    return null
  }

  return {
    content: block.content,
    id,
    isError: block.is_error === true,
  }
}

function resolveTaskIdForParentToolUse(
  parentToolUseId: unknown,
  state: ClaudeSdkMapperState
) {
  const toolUseId = getString(parentToolUseId)

  if (!toolUseId) {
    return undefined
  }

  return state.taskIdByToolUseId.get(toolUseId) ?? toolUseId
}

function rememberToolCall(
  state: ClaudeSdkMapperState,
  id: string,
  name: string
) {
  state.toolNames.set(id, name)
  state.emittedToolCallIds.add(id)
}

function createToolCallEvent({
  id,
  input,
  name,
  parentTaskId,
  state,
}: {
  id: string
  input: unknown
  name: string
  parentTaskId?: string
  state: ClaudeSdkMapperState
}): AgentEvent | null {
  if (state.emittedToolCallIds.has(id)) {
    return null
  }

  rememberToolCall(state, id, name)

  return {
    type: "tool_call",
    id,
    name,
    input: stringifyPayload(input),
    ...(parentTaskId ? { parentTaskId } : {}),
  }
}

function mapStreamEvent(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const event = getRecord(message.event)
  const parentTaskId = resolveTaskIdForParentToolUse(
    message.parent_tool_use_id,
    state
  )

  if (!event) {
    return []
  }

  if (event.type === "message_start" && !parentTaskId) {
    state.streamedBlocks = []
  }

  if (event.type !== "content_block_delta") {
    return []
  }

  const delta = getRecord(event.delta)
  const index = typeof event.index === "number" ? event.index : -1

  if (!delta) {
    return []
  }

  const chunk =
    delta.type === "text_delta" && typeof delta.text === "string"
      ? { text: delta.text, type: "text" as const }
      : delta.type === "thinking_delta" && typeof delta.thinking === "string"
        ? { text: delta.thinking, type: "thinking" as const }
        : null

  if (!chunk?.text) {
    return []
  }

  if (parentTaskId) {
    return [
      {
        type: "subagent_update",
        taskId: parentTaskId,
        status: "running",
        contentDelta: chunk.text,
      },
    ]
  }

  const last = state.streamedBlocks[state.streamedBlocks.length - 1]

  if (last && last.index === index && last.type === chunk.type) {
    last.text += chunk.text
  } else {
    state.streamedBlocks.push({ index, text: chunk.text, type: chunk.type })
  }

  return [
    chunk.type === "thinking"
      ? { type: "reasoning_delta", delta: chunk.text }
      : { type: "text_delta", delta: chunk.text },
  ]
}

function mapAssistantMessage(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const sdkMessage = getRecord(message.message)
  const content = Array.isArray(sdkMessage?.content) ? sdkMessage.content : []
  const parentTaskId = resolveTaskIdForParentToolUse(
    message.parent_tool_use_id,
    state
  )
  const events: AgentEvent[] = []
  let streamPos = 0

  for (const item of content) {
    const block = getRecord(item)

    if (!block) {
      continue
    }

    const blockText = getBlockText(block)

    if (blockText) {
      if (parentTaskId) {
        if (blockText.text) {
          events.push({
            type: "subagent_update",
            taskId: parentTaskId,
            name:
              getString(message.subagent_type) ??
              state.taskNames.get(parentTaskId),
            status: "running",
            contentDelta: blockText.text,
          })
        }
        continue
      }

      const streamed = state.streamedBlocks[streamPos]
      let text = blockText.text

      if (
        streamed &&
        streamed.type === blockText.type &&
        streamed.text.length > 0 &&
        blockText.text.startsWith(streamed.text)
      ) {
        streamPos += 1
        text = blockText.text.slice(streamed.text.length)
      }

      if (text) {
        events.push(
          blockText.type === "thinking"
            ? { type: "reasoning_delta", delta: text }
            : { type: "text_delta", delta: text }
        )
      }

      continue
    }

    const toolUse = getToolUseBlock(block)

    if (toolUse) {
      const event = createToolCallEvent({
        id: toolUse.id,
        input: toolUse.input,
        name: toolUse.name,
        parentTaskId,
        state,
      })

      if (event) {
        events.push(event)
      }
    }
  }

  if (!parentTaskId) {
    state.streamedBlocks = []
  }

  return events
}

function mapUserMessage(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const sdkMessage = getRecord(message.message)
  const content = Array.isArray(sdkMessage?.content) ? sdkMessage.content : []
  const parentTaskId = resolveTaskIdForParentToolUse(
    message.parent_tool_use_id,
    state
  )
  const events: AgentEvent[] = []

  for (const item of content) {
    const block = getRecord(item)
    const toolResult = block ? getToolResultBlock(block) : null

    if (!toolResult) {
      continue
    }

    const name = state.toolNames.get(toolResult.id) ?? "tool"

    events.push({
      type: "tool_result",
      id: toolResult.id,
      name,
      status: toolResult.isError ? "error" : "complete",
      ...(toolResult.isError
        ? { error: stringifyPayload(toolResult.content) }
        : { output: stringifyPayload(toolResult.content) }),
      ...(parentTaskId ? { parentTaskId } : {}),
    })
  }

  return events
}

function getTaskName(message: Record<string, unknown>) {
  return (
    getString(message.subagent_type) ??
    getString(message.workflow_name) ??
    getString(message.task_type) ??
    "Task"
  )
}

function getTaskInput(message: Record<string, unknown>) {
  return (
    getString(message.prompt) ?? getString(message.description) ?? undefined
  )
}

function mapTaskStarted(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  if (message.skip_transcript === true) {
    return []
  }

  const taskId = getString(message.task_id)

  if (!taskId) {
    return []
  }

  const name = getTaskName(message)
  const toolUseId = getString(message.tool_use_id)

  if (toolUseId) {
    state.taskIdByToolUseId.set(toolUseId, taskId)
  }

  state.taskNames.set(taskId, name)

  return [
    {
      type: "subagent_start",
      taskId,
      name,
      ...(getTaskInput(message) ? { taskInput: getTaskInput(message) } : {}),
    },
  ]
}

function mapTaskProgress(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const taskId = getString(message.task_id)

  if (!taskId) {
    return []
  }

  const name = getTaskName(message)
  const summary = getString(message.summary)
  const description = getString(message.description)

  state.taskNames.set(taskId, name)

  return [
    {
      type: "subagent_update",
      taskId,
      name,
      status: "running",
      ...(description ? { taskInput: description } : {}),
      ...(summary
        ? { summary, contentDelta: summary }
        : description
          ? { content: description }
          : {}),
    },
  ]
}

function normalizeTaskUpdateStatus(status: unknown) {
  if (status === "completed") {
    return "complete" as const
  }

  if (status === "failed" || status === "killed") {
    return "error" as const
  }

  if (status === "pending" || status === "running" || status === "paused") {
    return "running" as const
  }

  return undefined
}

function mapTaskUpdated(message: Record<string, unknown>): AgentEvent[] {
  const taskId = getString(message.task_id)
  const patch = getRecord(message.patch)
  const status = normalizeTaskUpdateStatus(patch?.status)

  if (!taskId || (!status && !patch?.description && !patch?.error)) {
    return []
  }

  return [
    {
      type: "subagent_update",
      taskId,
      ...(status ? { status } : {}),
      ...(typeof patch?.description === "string"
        ? { content: patch.description }
        : {}),
      ...(typeof patch?.error === "string" ? { error: patch.error } : {}),
    },
  ]
}

function mapTaskNotification(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  if (message.skip_transcript === true) {
    return []
  }

  const taskId = getString(message.task_id)

  if (!taskId) {
    return []
  }

  const status = message.status === "completed" ? "complete" : "error"
  const name = state.taskNames.get(taskId) ?? getTaskName(message)

  return [
    {
      type: "subagent_end",
      taskId,
      name,
      status,
      ...(typeof message.summary === "string"
        ? { summary: message.summary }
        : {}),
    },
  ]
}

function mapPermissionDenied(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const id = getString(message.tool_use_id)
  const name = getString(message.tool_name) ?? "tool"

  if (!id) {
    return []
  }

  if (!state.emittedToolCallIds.has(id)) {
    rememberToolCall(state, id, name)
  }

  return [
    {
      type: "tool_result",
      id,
      name,
      status: "error",
      error:
        getString(message.message) ??
        getString(message.decision_reason) ??
        "Tool use denied.",
    },
  ]
}

function mapResultMessage(message: Record<string, unknown>): AgentEvent[] {
  const usage = compactObject([
    ["duration_ms", message.duration_ms],
    ["duration_api_ms", message.duration_api_ms],
    ["num_turns", message.num_turns],
    ["stop_reason", message.stop_reason],
    ["total_cost_usd", message.total_cost_usd],
    ["usage", message.usage],
    ["modelUsage", message.modelUsage],
  ])
  const events: AgentEvent[] = []

  events.push({
    type: "run_meta",
    sessionRef: getString(message.session_id) ?? undefined,
    ...(usage ? { usage } : {}),
  })

  if (message.is_error === true) {
    const errors = Array.isArray(message.errors)
      ? message.errors.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : []

    events.push({
      type: "error",
      message:
        errors.join("\n") || getString(message.subtype) || "Claude run failed.",
    })
  }

  return events
}

function mapSystemInitMessage(message: Record<string, unknown>): AgentEvent[] {
  if (message.subtype !== "init") {
    return []
  }

  return [
    {
      type: "run_meta",
      sessionRef: getString(message.session_id) ?? undefined,
      usage: compactObject([
        ["claude_code_version", message.claude_code_version],
        ["model", message.model],
        ["permissionMode", message.permissionMode],
        ["tools", message.tools],
        ["mcp_servers", message.mcp_servers],
        ["skills", message.skills],
      ]),
    },
  ]
}

export function mapClaudeSdkMessageToAgentEvents(
  message: ClaudeSdkMappableMessage,
  state: ClaudeSdkMapperState = createClaudeSdkMapperState()
): AgentEvent[] {
  const record = getRecord(message)

  if (!record) {
    return []
  }

  if (record.type === "stream_event") {
    return mapStreamEvent(record, state)
  }

  if (record.type === "assistant") {
    return mapAssistantMessage(record, state)
  }

  if (record.type === "user") {
    return mapUserMessage(record, state)
  }

  if (record.type === "result") {
    return mapResultMessage(record)
  }

  if (record.type === "system") {
    if (record.subtype === "task_started") {
      return mapTaskStarted(record, state)
    }

    if (record.subtype === "task_progress") {
      return mapTaskProgress(record, state)
    }

    if (record.subtype === "task_updated") {
      return mapTaskUpdated(record)
    }

    if (record.subtype === "task_notification") {
      return mapTaskNotification(record, state)
    }

    if (record.subtype === "permission_denied") {
      return mapPermissionDenied(record, state)
    }

    return mapSystemInitMessage(record)
  }

  return []
}

export function mapClaudeSdkMessagesToAgentEvents(
  messages: ClaudeSdkMappableMessage[],
  state: ClaudeSdkMapperState = createClaudeSdkMapperState()
) {
  return messages.flatMap((message) =>
    mapClaudeSdkMessageToAgentEvents(message, state)
  )
}

function getModelBaseUrl(model: AgentModelDefinition) {
  return (model.baseUrl ?? MODELVERSE_ANTHROPIC_BASE_URL).replace(
    /\/v1\/?$/i,
    ""
  )
}

function resolveClaudeNativeRunConfig(
  input: AgentRunInput
): ClaudeNativeRunConfig {
  const runtimeSetting = getRuntimeModelSetting(CLAUDE_NATIVE_RUNTIME_ID)

  if (!runtimeSetting || runtimeSetting.useLocalSettings) {
    return {}
  }

  const apiKey = getStudioModelverseApiKey()?.key

  if (!apiKey) {
    throw new Error("Modelverse API key is not configured locally.")
  }

  const model =
    resolveAgentModelForRuntime({
      modelId: input.model,
      runtimeId: CLAUDE_NATIVE_RUNTIME_ID,
    }) ?? getAgentModelById(input.model)

  if (!model) {
    throw new Error("No Modelverse model is configured for Claude Code.")
  }

  if (model.protocol !== "anthropic-messages") {
    throw new Error(`${model.label} does not support the Claude Agent SDK.`)
  }

  return {
    env: {
      ...process.env,
      ANTHROPIC_AUTH_TOKEN: " ",
      ANTHROPIC_BASE_URL: getModelBaseUrl(model),
      ANTHROPIC_CUSTOM_HEADERS: `Authorization: Bearer ${apiKey}`,
      ASTRAFLOW_MODELVERSE_API_KEY: apiKey,
      CLAUDE_AGENT_SDK_CLIENT_APP: "astraflow-desktop/0.0.11",
    },
    model: model.providerModel,
    settings: {
      availableModels: [model.providerModel],
      enforceAvailableModels: true,
      model: model.providerModel,
    },
  }
}

function mapReasoningEffort(
  effort: ChatReasoningEffort | undefined
): Pick<ClaudeAgentOptions, "effort" | "thinking"> {
  if (effort === "none") {
    return {
      thinking: { type: "disabled" },
    }
  }

  if (
    effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "xhigh" ||
    effort === "max"
  ) {
    return {
      effort,
      thinking: { type: "adaptive" },
    }
  }

  return {}
}

function createPermissionOptions(): PermissionOption[] {
  return [
    { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
    { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
    { optionId: "reject_once", name: "Deny", kind: "reject_once" },
  ]
}

function createClaudeCanUseTool({
  queue,
  sessionId,
  signal,
  state,
}: {
  queue: AgentEventQueue
  sessionId: string
  signal: AbortSignal
  state: ClaudeSdkMapperState
}): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    const requestId = randomUUID()
    const permissionOptions = createPermissionOptions()
    const inputPreview = stringifyPayload(
      compactObject([
        ["title", options.title],
        ["description", options.description],
        ["input", input],
      ]) ?? input
    )
    const parentTaskId = getString(options.agentID) ?? undefined

    const toolCallEvent = createToolCallEvent({
      id: options.toolUseID,
      input,
      name: toolName,
      parentTaskId,
      state,
    })

    if (toolCallEvent) {
      queue.push(toolCallEvent)
    }

    queue.push({
      type: "permission_request",
      requestId,
      toolName: options.displayName ?? toolName,
      input: inputPreview,
      options: permissionOptions,
      status: "pending",
      selectedOptionId: null,
      decisions: [],
    })

    const decision = await requestPermission({
      sessionId,
      requestId,
      toolName,
      inputPreview,
      options: permissionOptions,
      signal,
    })

    if ("cancelled" in decision) {
      queue.push({
        type: "permission_request",
        requestId,
        toolName: options.displayName ?? toolName,
        input: inputPreview,
        options: permissionOptions,
        status: "resolved",
        selectedOptionId: null,
        decisions: ["cancelled"],
      })

      return {
        behavior: "deny",
        message: "Tool use cancelled.",
        toolUseID: options.toolUseID,
      }
    }

    const selectedOption = permissionOptions.find(
      (candidate) => candidate.optionId === decision.optionId
    )
    const isAllow = selectedOption?.kind.startsWith("allow") ?? false

    queue.push({
      type: "permission_request",
      requestId,
      toolName: options.displayName ?? toolName,
      input: inputPreview,
      options: permissionOptions,
      status: "resolved",
      selectedOptionId: decision.optionId,
      decisions: [
        decision.feedback || selectedOption?.name || decision.optionId,
      ],
    })

    if (!isAllow) {
      return {
        behavior: "deny",
        message: decision.feedback || "Tool use denied.",
        toolUseID: options.toolUseID,
      }
    }

    return {
      behavior: "allow",
      ...(decision.optionId === "allow_always" && options.suggestions
        ? { updatedPermissions: options.suggestions }
        : {}),
      toolUseID: options.toolUseID,
    }
  }
}

function createClaudeQueryOptions({
  abortController,
  input,
  queue,
  runConfig,
  state,
}: {
  abortController: AbortController
  input: AgentRunInput
  queue: AgentEventQueue
  runConfig: ClaudeNativeRunConfig
  state: ClaudeSdkMapperState
}): ClaudeAgentOptions {
  return {
    abortController,
    agentProgressSummaries: true,
    canUseTool: createClaudeCanUseTool({
      queue,
      sessionId: input.sessionId,
      signal: input.signal,
      state,
    }),
    cwd: input.projectPath ?? process.cwd(),
    env: runConfig.env,
    forwardSubagentText: true,
    includePartialMessages: true,
    permissionMode: "default",
    settings: runConfig.settings,
    tools: { type: "preset", preset: "claude_code" },
    ...(runConfig.model ? { model: runConfig.model } : {}),
    ...(process.env.CLAUDE_CODE_EXECUTABLE
      ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE }
      : {}),
    ...mapReasoningEffort(input.reasoningEffort),
  }
}

async function runClaudeNativeSdk({
  input,
  query,
  queue,
}: {
  input: AgentRunInput
  query?: ClaudeAgentQuery
  queue: AgentEventQueue
}) {
  const abortController = new AbortController()
  const abort = () => abortController.abort()
  const state = createClaudeSdkMapperState()
  const runConfig = resolveClaudeNativeRunConfig(input)
  const sdkQuery =
    query ?? (await import("@anthropic-ai/claude-agent-sdk")).query
  const sdkRun = sdkQuery({
    prompt: createClaudePrompt(input.messages),
    options: createClaudeQueryOptions({
      abortController,
      input,
      queue,
      runConfig,
      state,
    }),
  })

  input.signal.addEventListener("abort", abort, { once: true })

  try {
    for await (const message of sdkRun) {
      for (const event of mapClaudeSdkMessageToAgentEvents(message, state)) {
        queue.push(event)
      }

      if (input.signal.aborted) {
        break
      }
    }
  } finally {
    input.signal.removeEventListener("abort", abort)
    cancelSessionPermissions(input.sessionId)
    sdkRun.close()
  }
}

export class ClaudeNativeRuntime implements AgentRuntime {
  readonly info: AgentRuntimeInfo
  private readonly query?: ClaudeAgentQuery

  constructor(options: ClaudeNativeRuntimeOptions = {}) {
    this.info = options.info ?? CLAUDE_NATIVE_RUNTIME_INFO
    this.query = options.query
  }

  startRun(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const queue = new AgentEventQueue()

    runClaudeNativeSdk({
      input,
      query: this.query,
      queue,
    })
      .catch((error) => {
        if (!isAbortLikeError(error, input.signal)) {
          queue.push({ type: "error", message: errorMessage(error) })
        }
      })
      .finally(() => queue.close())

    return queue
  }
}

export function createClaudeNativeRuntime(
  options?: ClaudeNativeRuntimeOptions
) {
  return new ClaudeNativeRuntime(options)
}

export function registerClaudeNativeRuntime() {
  registerAgentRuntime(createClaudeNativeRuntime())
}

registerClaudeNativeRuntime()
