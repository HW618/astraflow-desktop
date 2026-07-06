import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { accessSync, constants, realpathSync } from "node:fs"
import { delimiter, join } from "node:path"

import { AgentEventQueue } from "@/lib/agent/event-queue"
import type { AgentEvent } from "@/lib/agent/events"
import type { PromptMention } from "@/lib/agent/composer-types"
import type {
  AgentRunInput,
  AgentRuntime,
  AgentRuntimeInfo,
} from "@/lib/agent/runtime"
import { registerAgentRuntime } from "@/lib/agent/runtime"

type JsonRecord = Record<string, unknown>
type AgentTodo = Extract<AgentEvent, { type: "plan_update" }>["todos"][number]

export type OpenCodeNativeTodo = {
  content: string
  status: string
  priority?: string
}

export type OpenCodeNativeModelRef = {
  providerID: string
  modelID: string
  variant?: string
}

export type OpenCodeNativeEvent = {
  id?: string
  type: string
  properties?: JsonRecord
  data?: JsonRecord
  durable?: {
    aggregateID: string
    seq: number
    version: number
  }
}

export type OpenCodeNativeMapperOptions = {
  emitUserText?: boolean
  parentSessionId?: string
  sessionId?: string
}

export type OpenCodeNativeMapperState = {
  emittedSubagents: Set<string>
  emittedToolCalls: Set<string>
  emittedToolResults: Set<string>
  messageRoles: Map<string, "assistant" | "user">
  partText: Map<string, string>
  partTypes: Map<string, string>
  reasoningText: Map<string, string>
  textText: Map<string, string>
  toolInputs: Map<string, unknown>
  toolNames: Map<string, string>
}

type OpenCodeNativeServerHandle = {
  baseUrl: string
  dispose: () => Promise<void>
}

export type OpenCodeNativeRuntimeOptions = {
  agent?: string | ((input: AgentRunInput) => string | null | undefined)
  baseUrl?: string
  commandEnv?: NodeJS.ProcessEnv
  executablePath?: string
  hostname?: string
  model?:
    | OpenCodeNativeModelRef
    | ((input: AgentRunInput) => OpenCodeNativeModelRef | null | undefined)
  port?: number
  pure?: boolean
  startupTimeoutMs?: number
}

export const OPENCODE_NATIVE_RUNTIME_ID = "opencode-native"

const OPENCODE_NATIVE_RUNTIME_INFO: AgentRuntimeInfo = {
  id: OPENCODE_NATIVE_RUNTIME_ID,
  label: "OpenCode Native",
  description: "OpenCode native HTTP/SSE server adapter",
  capabilities: {
    hitl: false,
    resume: true,
    subagents: true,
    plan: true,
    sandbox: false,
    mcp: true,
    skills: false,
  },
  composer: {
    slashCommands: "none",
    fileMentions: "text",
    sessionMentions: true,
  },
}

const DEFAULT_HOSTNAME = "127.0.0.1"
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000
const PERMISSION_OPTIONS = [
  { optionId: "once", name: "Allow once", kind: "allow" },
  { optionId: "always", name: "Always allow", kind: "allow" },
  { optionId: "reject", name: "Reject", kind: "reject" },
]

function getRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null
    ? (value as JsonRecord)
    : null
}

function getString(value: unknown) {
  return typeof value === "string" ? value : null
}

function getNumber(value: unknown) {
  return typeof value === "number" ? value : null
}

function getOpenCodeEventPayload(event: OpenCodeNativeEvent) {
  return getRecord(event.properties) ?? getRecord(event.data) ?? {}
}

function normalizeOpenCodeEvent(event: unknown): OpenCodeNativeEvent | null {
  const record = getRecord(event)

  if (!record) {
    return null
  }

  const type = getString(record?.type)

  if (!type) {
    return null
  }

  return {
    ...(getString(record.id) ? { id: getString(record.id) ?? undefined } : {}),
    type,
    ...(getRecord(record.properties)
      ? { properties: getRecord(record.properties) ?? undefined }
      : {}),
    ...(getRecord(record.data)
      ? { data: getRecord(record.data) ?? undefined }
      : {}),
  }
}

function stringifyOpenCodePayload(value: unknown) {
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

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return getRecord(parsed) ?? value
  } catch {
    return value
  }
}

function extractErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error
  }

  const record = getRecord(error)
  const message =
    getString(record?.message) ??
    getString(record?.error) ??
    getString(record?.name)

  return message ?? stringifyOpenCodePayload(error)
}

function normalizeTodo(todo: unknown): AgentTodo | null {
  const record = getRecord(todo)
  const text = getString(record?.content)?.trim() ?? ""
  const status = getString(record?.status)

  if (!text) {
    return null
  }

  if (
    status !== "pending" &&
    status !== "in_progress" &&
    status !== "completed"
  ) {
    return null
  }

  return { text, status }
}

function isAgentTodo(todo: AgentTodo | null): todo is AgentTodo {
  return todo !== null
}

function mapDiffStatus(status: unknown): "create" | "delete" | "edit" {
  if (status === "added") {
    return "create"
  }

  if (status === "deleted") {
    return "delete"
  }

  return "edit"
}

function inferFileChangeKind(toolName: string): "create" | "delete" | "edit" {
  const normalized = toolName.toLowerCase()

  if (normalized.includes("delete") || normalized.includes("remove")) {
    return "delete"
  }

  if (normalized.includes("write") || normalized.includes("create")) {
    return "create"
  }

  return "edit"
}

function isFileMutationTool(toolName: string) {
  const normalized = toolName.toLowerCase()

  return (
    normalized.includes("create") ||
    normalized.includes("delete") ||
    normalized.includes("edit") ||
    normalized.includes("patch") ||
    normalized.includes("remove") ||
    normalized.includes("write")
  )
}

function getToolInputPath(input: unknown) {
  const record = getRecord(input)

  if (!record) {
    return typeof input === "string" ? input.trim() : ""
  }

  const candidate =
    record.file ??
    record.filePath ??
    record.file_path ??
    record.path ??
    record.absolute_path

  return typeof candidate === "string" ? candidate.trim() : ""
}

function getFileChangeFromTool(
  toolName: string,
  input: unknown,
  outputPaths: unknown
) {
  if (!isFileMutationTool(toolName)) {
    return []
  }

  const paths = Array.isArray(outputPaths)
    ? outputPaths.filter((path): path is string => typeof path === "string")
    : []
  const inputPath = getToolInputPath(input)
  const candidates = paths.length ? paths : inputPath ? [inputPath] : []

  return candidates.map(
    (path) =>
      ({
        type: "file_change",
        path,
        kind: inferFileChangeKind(toolName),
      }) satisfies Extract<AgentEvent, { type: "file_change" }>
  )
}

function getContentText(content: unknown) {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return stringifyOpenCodePayload(content)
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part
      }

      const record = getRecord(part)
      const text = getString(record?.text)

      if (text) {
        return text
      }

      return stringifyOpenCodePayload(part)
    })
    .filter(Boolean)
    .join("\n")
}

function getFilePromptMentions(message: AgentRunInput["messages"][number]) {
  const mentions = (message as { additional_kwargs?: { mentions?: unknown } })
    .additional_kwargs?.mentions

  if (!Array.isArray(mentions)) {
    return []
  }

  return mentions.filter(
    (mention): mention is Extract<PromptMention, { kind: "file" | "folder" }> =>
      typeof mention === "object" &&
      mention !== null &&
      (mention.kind === "file" || mention.kind === "folder") &&
      typeof mention.path === "string" &&
      mention.path.length > 0 &&
      typeof mention.name === "string" &&
      mention.name.length > 0
  )
}

function appendReferencedFiles(
  text: string,
  message: AgentRunInput["messages"][number]
) {
  const paths = getFilePromptMentions(message)
    .map((mention) => mention.path)
    .filter((path) => !text.includes(path))

  if (!paths.length) {
    return text
  }

  return [text, ["Referenced files:", ...paths].join("\n")]
    .filter((part) => part.trim().length > 0)
    .join("\n\n")
}

function getLatestPromptText(messages: AgentRunInput["messages"]) {
  const latestHuman =
    [...messages].reverse().find((message) => message._getType() === "human") ??
    messages.at(-1)

  return latestHuman
    ? appendReferencedFiles(
        getContentText(latestHuman.content),
        latestHuman
      ).trim()
    : ""
}

function eventMatchesSession(
  event: OpenCodeNativeEvent,
  options: OpenCodeNativeMapperOptions
) {
  if (!options.sessionId) {
    return true
  }

  const payload = getOpenCodeEventPayload(event)
  const info = getRecord(payload.info)
  const part = getRecord(payload.part)
  const eventSessionId =
    getString(payload.sessionID) ??
    getString(info?.sessionID) ??
    getString(info?.id) ??
    getString(part?.sessionID)
  const parentID = getString(info?.parentID)

  return eventSessionId === options.sessionId || parentID === options.sessionId
}

function getPermissionInput(payload: JsonRecord) {
  const input: JsonRecord = {}

  for (const key of [
    "permission",
    "action",
    "resources",
    "patterns",
    "metadata",
    "always",
    "source",
    "tool",
  ]) {
    if (payload[key] !== undefined) {
      input[key] = payload[key]
    }
  }

  return stringifyOpenCodePayload(input)
}

function createPermissionRequestEvent(
  requestId: string,
  toolName: string,
  input: string
): Extract<AgentEvent, { type: "permission_request" }> {
  return {
    type: "permission_request",
    requestId,
    toolName,
    input,
    decisions: ["once", "always", "reject"],
    options: PERMISSION_OPTIONS,
    selectedOptionId: null,
    status: "pending",
  }
}

function mapQuestionAsked(
  payload: JsonRecord
): Extract<AgentEvent, { type: "permission_request" }> | null {
  const requestId = getString(payload.id)
  const questions = Array.isArray(payload.questions) ? payload.questions : []

  if (!requestId || !questions.length) {
    return null
  }

  const firstQuestion = getRecord(questions[0])
  const options = Array.isArray(firstQuestion?.options)
    ? firstQuestion.options
        .map((option) => {
          const record = getRecord(option)
          const label = getString(record?.label)

          return label
            ? {
                optionId: label,
                name: label,
                kind: "choice",
              }
            : null
        })
        .filter((option): option is NonNullable<typeof option> =>
          Boolean(option)
        )
    : []

  return {
    type: "permission_request",
    requestId,
    toolName: "question",
    input: stringifyOpenCodePayload({
      questions,
      tool: payload.tool,
    }),
    decisions: options.map((option) => option.optionId),
    options,
    selectedOptionId: null,
    status: "pending",
  }
}

function getToolResultOutput(payload: JsonRecord) {
  if (Array.isArray(payload.content)) {
    const content = payload.content
      .map((part) => {
        const record = getRecord(part)

        return getString(record?.text) ?? stringifyOpenCodePayload(part)
      })
      .join("\n")

    if (content) {
      return content
    }
  }

  if (payload.result !== undefined) {
    return stringifyOpenCodePayload(payload.result)
  }

  if (payload.structured !== undefined) {
    return stringifyOpenCodePayload(payload.structured)
  }

  return ""
}

function emitToolCall(
  state: OpenCodeNativeMapperState,
  callID: string,
  toolName: string,
  input: unknown
): AgentEvent[] {
  state.toolNames.set(callID, toolName)
  state.toolInputs.set(callID, input)

  if (state.emittedToolCalls.has(callID)) {
    return []
  }

  state.emittedToolCalls.add(callID)

  return [
    {
      type: "tool_call",
      id: callID,
      name: toolName,
      input: stringifyOpenCodePayload(input),
    },
  ]
}

function emitToolResult({
  callID,
  output,
  state,
  status,
  toolName,
}: {
  callID: string
  output?: string
  state: OpenCodeNativeMapperState
  status: "complete" | "error"
  toolName: string
}): AgentEvent[] {
  if (state.emittedToolResults.has(callID)) {
    return []
  }

  state.emittedToolResults.add(callID)

  if (status === "error") {
    return [
      {
        type: "tool_result",
        id: callID,
        name: toolName,
        status: "error",
        error: output || "Tool call failed.",
      },
    ]
  }

  return [
    {
      type: "tool_result",
      id: callID,
      name: toolName,
      status: "complete",
      output,
    },
  ]
}

function mapToolPart(
  part: JsonRecord,
  state: OpenCodeNativeMapperState
): AgentEvent[] {
  const callID = getString(part.callID)
  const toolName = getString(part.tool)
  const toolState = getRecord(part.state)
  const status = getString(toolState?.status)

  if (!callID || !toolName || !toolState) {
    return []
  }

  const input =
    toolState.input ??
    (typeof toolState.raw === "string" ? parseJsonObject(toolState.raw) : {})
  const events: AgentEvent[] = []

  events.push(...emitToolCall(state, callID, toolName, input))

  if (status === "completed") {
    events.push(
      ...emitToolResult({
        callID,
        output: getString(toolState.output) ?? "",
        state,
        status: "complete",
        toolName,
      }),
      ...getFileChangeFromTool(toolName, input, undefined)
    )
  }

  if (status === "error") {
    events.push(
      ...emitToolResult({
        callID,
        output: extractErrorMessage(toolState.error),
        state,
        status: "error",
        toolName,
      })
    )
  }

  return events
}

function mapPartUpdated(
  payload: JsonRecord,
  state: OpenCodeNativeMapperState,
  options: OpenCodeNativeMapperOptions
): AgentEvent[] {
  const part = getRecord(payload.part)
  const partID = getString(part?.id)
  const partType = getString(part?.type)

  if (!part || !partID || !partType) {
    return []
  }

  state.partTypes.set(partID, partType)

  const messageID = getString(part.messageID)
  const messageRole = messageID ? state.messageRoles.get(messageID) : undefined

  if (messageRole === "user" && !options.emitUserText) {
    return []
  }

  if (partType === "text" || partType === "reasoning") {
    const text = getString(part.text) ?? ""
    const previous = state.partText.get(partID) ?? ""
    const delta = text.startsWith(previous) ? text.slice(previous.length) : text

    state.partText.set(partID, text)

    if (!delta) {
      return []
    }

    return [
      partType === "reasoning"
        ? { type: "reasoning_delta", delta }
        : { type: "text_delta", delta },
    ]
  }

  if (partType === "tool") {
    return mapToolPart(part, state)
  }

  if (partType === "patch") {
    const files = Array.isArray(part.files) ? part.files : []

    return files
      .filter((path): path is string => typeof path === "string")
      .map((path) => ({
        type: "file_change",
        path,
        kind: "edit",
      }))
  }

  if (partType === "subtask") {
    const taskId = partID

    if (state.emittedSubagents.has(taskId)) {
      return []
    }

    state.emittedSubagents.add(taskId)

    return [
      {
        type: "subagent_start",
        taskId,
        name: getString(part.agent) ?? "subagent",
        taskInput:
          getString(part.prompt) ??
          getString(part.description) ??
          stringifyOpenCodePayload(part),
      },
    ]
  }

  return []
}

function mapSessionInfoEvent(
  payload: JsonRecord,
  state: OpenCodeNativeMapperState,
  options: OpenCodeNativeMapperOptions
): AgentEvent[] {
  const info = getRecord(payload.info)
  const sessionID = getString(info?.id) ?? getString(payload.sessionID)
  const parentID = getString(info?.parentID)

  if (
    !sessionID ||
    !parentID ||
    (options.sessionId && parentID !== options.sessionId) ||
    state.emittedSubagents.has(sessionID)
  ) {
    return []
  }

  state.emittedSubagents.add(sessionID)

  return [
    {
      type: "subagent_start",
      taskId: sessionID,
      name: getString(info?.agent) ?? "subagent",
      taskInput: getString(info?.title) ?? undefined,
      ...(options.parentSessionId
        ? { parentTaskId: options.parentSessionId }
        : {}),
    },
  ]
}

function mapUsageEvent(payload: JsonRecord): AgentEvent[] {
  const info = getRecord(payload.info) ?? payload
  const role = getString(info.role)
  const cost = getNumber(info.cost)
  const tokens = getRecord(info.tokens)

  if (role && role !== "assistant") {
    return []
  }

  if (cost === null && !tokens) {
    return []
  }

  return [
    {
      type: "run_meta",
      usage: {
        ...(cost !== null ? { cost } : {}),
        ...(tokens ? { tokens } : {}),
      },
    },
  ]
}

export function createOpenCodeNativeMapperState(): OpenCodeNativeMapperState {
  return {
    emittedSubagents: new Set(),
    emittedToolCalls: new Set(),
    emittedToolResults: new Set(),
    messageRoles: new Map(),
    partText: new Map(),
    partTypes: new Map(),
    reasoningText: new Map(),
    textText: new Map(),
    toolInputs: new Map(),
    toolNames: new Map(),
  }
}

export function mapOpenCodeNativeEventToAgentEvents(
  rawEvent: unknown,
  state: OpenCodeNativeMapperState = createOpenCodeNativeMapperState(),
  options: OpenCodeNativeMapperOptions = {}
): AgentEvent[] {
  const event = normalizeOpenCodeEvent(rawEvent)

  if (!event || !eventMatchesSession(event, options)) {
    return []
  }

  const payload = getOpenCodeEventPayload(event)

  switch (event.type) {
    case "message.updated": {
      const info = getRecord(payload.info)
      const messageID = getString(info?.id)
      const role = getString(info?.role)

      if (messageID && (role === "assistant" || role === "user")) {
        state.messageRoles.set(messageID, role)
      }

      return [
        ...(info?.error
          ? [
              {
                type: "error",
                message: extractErrorMessage(info.error),
              } as const,
            ]
          : []),
        ...mapUsageEvent(payload),
      ]
    }
    case "message.part.delta": {
      const partID = getString(payload.partID)
      const delta = getString(payload.delta) ?? ""
      const field = getString(payload.field)
      const partType = partID ? state.partTypes.get(partID) : null

      if (!partID || field !== "text" || !delta) {
        return []
      }

      state.partText.set(partID, `${state.partText.get(partID) ?? ""}${delta}`)

      return [
        partType === "reasoning"
          ? { type: "reasoning_delta", delta }
          : { type: "text_delta", delta },
      ]
    }
    case "message.part.updated":
      return mapPartUpdated(payload, state, options)
    case "session.next.text.delta": {
      const textID = getString(payload.textID)
      const delta = getString(payload.delta) ?? ""

      if (textID) {
        state.textText.set(
          textID,
          `${state.textText.get(textID) ?? ""}${delta}`
        )
      }

      return delta ? [{ type: "text_delta", delta }] : []
    }
    case "session.next.text.ended": {
      const textID = getString(payload.textID)
      const text = getString(payload.text) ?? ""

      if (!textID || state.textText.has(textID) || !text) {
        return []
      }

      state.textText.set(textID, text)

      return [{ type: "text_delta", delta: text }]
    }
    case "session.next.reasoning.delta": {
      const reasoningID = getString(payload.reasoningID)
      const delta = getString(payload.delta) ?? ""

      if (reasoningID) {
        state.reasoningText.set(
          reasoningID,
          `${state.reasoningText.get(reasoningID) ?? ""}${delta}`
        )
      }

      return delta ? [{ type: "reasoning_delta", delta }] : []
    }
    case "session.next.reasoning.ended": {
      const reasoningID = getString(payload.reasoningID)
      const text = getString(payload.text) ?? ""

      if (!reasoningID || state.reasoningText.has(reasoningID) || !text) {
        return []
      }

      state.reasoningText.set(reasoningID, text)

      return [{ type: "reasoning_delta", delta: text }]
    }
    case "session.next.tool.input.started": {
      const callID = getString(payload.callID)
      const toolName = getString(payload.name)

      if (callID && toolName) {
        state.toolNames.set(callID, toolName)
      }

      return []
    }
    case "session.next.tool.input.ended": {
      const callID = getString(payload.callID)
      const input = getString(payload.text)

      if (callID && input) {
        state.toolInputs.set(callID, parseJsonObject(input))
      }

      return []
    }
    case "session.next.tool.called": {
      const callID = getString(payload.callID)
      const toolName = getString(payload.tool)

      if (!callID || !toolName) {
        return []
      }

      return emitToolCall(state, callID, toolName, payload.input ?? {})
    }
    case "session.next.tool.success": {
      const callID = getString(payload.callID)
      const toolName = callID ? state.toolNames.get(callID) : null

      if (!callID || !toolName) {
        return []
      }

      const input = state.toolInputs.get(callID) ?? {}

      return [
        ...emitToolResult({
          callID,
          output: getToolResultOutput(payload),
          state,
          status: "complete",
          toolName,
        }),
        ...getFileChangeFromTool(toolName, input, payload.outputPaths),
      ]
    }
    case "session.next.tool.failed": {
      const callID = getString(payload.callID)
      const toolName = callID ? state.toolNames.get(callID) : null

      if (!callID || !toolName) {
        return []
      }

      return emitToolResult({
        callID,
        output: extractErrorMessage(payload.error),
        state,
        status: "error",
        toolName,
      })
    }
    case "session.next.shell.started": {
      const callID = getString(payload.callID)
      const command = getString(payload.command)

      if (!callID) {
        return []
      }

      return emitToolCall(state, callID, "bash", command ?? "")
    }
    case "session.next.shell.ended": {
      const callID = getString(payload.callID)

      if (!callID) {
        return []
      }

      return emitToolResult({
        callID,
        output: getString(payload.output) ?? "",
        state,
        status: "complete",
        toolName: state.toolNames.get(callID) ?? "bash",
      })
    }
    case "todo.updated": {
      const todos = Array.isArray(payload.todos)
        ? payload.todos.map(normalizeTodo).filter(isAgentTodo)
        : []

      return todos.length
        ? [
            {
              type: "plan_update",
              todos,
            },
          ]
        : []
    }
    case "permission.asked":
    case "permission.v2.asked": {
      const requestId = getString(payload.id)

      if (!requestId) {
        return []
      }

      return [
        createPermissionRequestEvent(
          requestId,
          getString(payload.action) ??
            getString(payload.permission) ??
            "permission",
          getPermissionInput(payload)
        ),
      ]
    }
    case "permission.replied":
    case "permission.v2.replied": {
      const requestId = getString(payload.requestID)
      const reply = getString(payload.reply)

      return requestId
        ? [
            {
              type: "permission_request",
              requestId,
              toolName: "",
              input: "",
              selectedOptionId: reply,
              status: "resolved",
            },
          ]
        : []
    }
    case "question.asked":
    case "question.v2.asked": {
      const event = mapQuestionAsked(payload)
      return event ? [event] : []
    }
    case "question.replied":
    case "question.v2.replied": {
      const requestId = getString(payload.requestID)
      const answers = Array.isArray(payload.answers) ? payload.answers : []
      const firstAnswer = Array.isArray(answers[0])
        ? getString(answers[0][0])
        : undefined

      return requestId
        ? [
            {
              type: "permission_request",
              requestId,
              toolName: "",
              input: "",
              selectedOptionId: firstAnswer ?? null,
              status: "resolved",
            },
          ]
        : []
    }
    case "session.diff": {
      const diff = Array.isArray(payload.diff) ? payload.diff : []

      return diff
        .map((entry) => {
          const record = getRecord(entry)
          const path = getString(record?.file)

          return path
            ? ({
                type: "file_change",
                path,
                kind: mapDiffStatus(record?.status),
              } satisfies Extract<AgentEvent, { type: "file_change" }>)
            : null
        })
        .filter(
          (entry): entry is Extract<AgentEvent, { type: "file_change" }> =>
            entry !== null
        )
    }
    case "file.edited": {
      const path = getString(payload.file)

      return path
        ? [
            {
              type: "file_change",
              path,
              kind: "edit",
            } satisfies Extract<AgentEvent, { type: "file_change" }>,
          ]
        : []
    }
    case "session.created":
    case "session.updated":
      return [
        ...mapSessionInfoEvent(payload, state, options),
        ...mapUsageEvent(payload),
      ]
    case "session.next.step.ended":
      return [
        ...mapUsageEvent(payload),
        ...(Array.isArray(payload.files)
          ? payload.files
              .filter((path): path is string => typeof path === "string")
              .map(
                (path) =>
                  ({
                    type: "file_change",
                    path,
                    kind: "edit",
                  }) satisfies Extract<AgentEvent, { type: "file_change" }>
              )
          : []),
      ]
    case "session.next.step.failed":
    case "session.error":
      return [{ type: "error", message: extractErrorMessage(payload.error) }]
    default:
      return []
  }
}

export function createOpenCodeNativeEventMapper(
  options: OpenCodeNativeMapperOptions = {}
) {
  const state = createOpenCodeNativeMapperState()

  return (event: unknown) =>
    mapOpenCodeNativeEventToAgentEvents(event, state, options)
}

export function mapOpenCodeNativeEvents(
  events: unknown[],
  options: OpenCodeNativeMapperOptions = {}
) {
  const mapper = createOpenCodeNativeEventMapper(options)

  return events.flatMap((event) => mapper(event))
}

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function executableNames(name: string) {
  return process.platform === "win32"
    ? [`${name}.cmd`, `${name}.exe`, name]
    : [name]
}

function findExecutableOnPath(name: string) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) {
      continue
    }

    for (const executableName of executableNames(name)) {
      const candidate = join(directory, executableName)

      if (isExecutable(candidate)) {
        return realpathSync(candidate)
      }
    }
  }

  return null
}

function resolveNodePackageExecutable(
  packageName: string,
  relativeExecutablePath: string
) {
  const executablePath = join(
    process.cwd(),
    "node_modules",
    ...packageName.split("/"),
    relativeExecutablePath
  )

  return isExecutable(executablePath) ? realpathSync(executablePath) : null
}

export function resolveOpenCodeNativeExecutable() {
  const homeOpenCode = `${process.env.HOME ?? ""}/.opencode/bin/opencode`

  return (
    (isExecutable(homeOpenCode) ? realpathSync(homeOpenCode) : null) ??
    findExecutableOnPath("opencode") ??
    resolveNodePackageExecutable("opencode-ai", "bin/opencode.exe")
  )
}

export function probeOpenCodeNativeRuntime() {
  const executablePath = resolveOpenCodeNativeExecutable()

  return executablePath
    ? {
        available: true as const,
        executablePath,
        detail: `using OpenCode executable at ${executablePath}`,
      }
    : {
        available: false as const,
        detail: "OpenCode executable was not found",
      }
}

function resolveOption<T>(
  option: T | ((input: AgentRunInput) => T | null | undefined) | undefined,
  input: AgentRunInput
) {
  return typeof option === "function"
    ? (option as (input: AgentRunInput) => T | null | undefined)(input)
    : option
}

function waitForOpenCodeServer(child: ChildProcess, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const stdout = child.stdout
    const stderr = child.stderr

    if (!stdout || !stderr) {
      reject(new Error("OpenCode native server stdio was not captured."))
      return
    }

    const stdoutStream = stdout
    const stderrStream = stderr
    let output = ""
    let settled = false
    const timer = setTimeout(() => {
      finish(new Error("Timed out waiting for OpenCode native server startup."))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      stdoutStream.off("data", onData)
      stderrStream.off("data", onData)
      child.off("error", finish)
      child.off("exit", onExit)
    }

    function finish(error: unknown, url?: string) {
      if (settled) {
        return
      }

      settled = true
      cleanup()

      if (url) {
        resolve(url)
      } else {
        reject(error)
      }
    }

    function onData(chunk: Buffer) {
      output += chunk.toString("utf8")

      const match = output.match(
        /opencode server listening on (https?:\/\/[^\s]+)/i
      )

      if (match?.[1]) {
        finish(null, match[1])
      }
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      finish(
        new Error(
          `OpenCode native server exited before startup: code=${code ?? "null"} signal=${signal ?? "null"}`
        )
      )
    }

    stdoutStream.on("data", onData)
    stderrStream.on("data", onData)
    child.once("error", finish)
    child.once("exit", onExit)
  })
}

async function startOpenCodeNativeServer(
  options: OpenCodeNativeRuntimeOptions
): Promise<OpenCodeNativeServerHandle> {
  if (options.baseUrl) {
    return {
      baseUrl: options.baseUrl,
      dispose: async () => {},
    }
  }

  const executablePath =
    options.executablePath ?? resolveOpenCodeNativeExecutable()

  if (!executablePath) {
    throw new Error("OpenCode executable was not found.")
  }

  const child = spawn(
    executablePath,
    [
      "serve",
      "--hostname",
      options.hostname ?? DEFAULT_HOSTNAME,
      "--port",
      String(options.port ?? 0),
      ...(options.pure ? ["--pure"] : []),
    ],
    {
      env: {
        ...process.env,
        ...(options.commandEnv ?? {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    }
  )
  const baseUrl = await waitForOpenCodeServer(
    child,
    options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
  )

  return {
    baseUrl,
    dispose: async () => {
      if (child.exitCode !== null || child.killed) {
        return
      }

      child.kill()
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            child.kill("SIGKILL")
          }

          resolve()
        }, 1_000)

        child.once("exit", () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}

function createOpenCodeUrl(
  baseUrl: string,
  path: string,
  directory?: string | null
) {
  const url = new URL(path, baseUrl)

  if (directory) {
    url.searchParams.set("directory", directory)
  }

  return url
}

async function requestOpenCode<T>({
  baseUrl,
  body,
  directory,
  method = "GET",
  path,
  signal,
}: {
  baseUrl: string
  body?: unknown
  directory?: string | null
  method?: string
  path: string
  signal: AbortSignal
}) {
  const response = await fetch(createOpenCodeUrl(baseUrl, path, directory), {
    method,
    signal,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(
      `OpenCode native request failed: ${method} ${path} ${response.status} ${text}`
    )
  }

  if (response.status === 204) {
    return null as T
  }

  return (await response.json()) as T
}

type SseFrame = {
  data: string
  event?: string
  id?: string
}

function parseSseFrame(block: string): SseFrame | null {
  const frame: SseFrame = { data: "" }

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue
    }

    const separatorIndex = line.indexOf(":")
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line
    const rawValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : ""
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue

    if (field === "data") {
      frame.data = frame.data ? `${frame.data}\n${value}` : value
    } else if (field === "event") {
      frame.event = value
    } else if (field === "id") {
      frame.id = value
    }
  }

  return frame.data ? frame : null
}

async function* readSseFrames(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader()

  if (!reader) {
    return
  }

  const decoder = new TextDecoder()
  let buffer = ""

  const abortReader = () => {
    void reader.cancel().catch(() => {})
  }

  signal.addEventListener("abort", abortReader, { once: true })

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })

      while (true) {
        const match = buffer.match(/\r?\n\r?\n/)

        if (!match?.index && match?.index !== 0) {
          break
        }

        const endIndex = match.index
        const separatorLength = match[0].length
        const block = buffer.slice(0, endIndex)

        buffer = buffer.slice(endIndex + separatorLength)

        const frame = parseSseFrame(block)

        if (frame) {
          yield frame
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", abortReader)
    reader.releaseLock()
  }
}

async function* subscribeOpenCodeEvents({
  baseUrl,
  directory,
  onReady,
  signal,
}: {
  baseUrl: string
  directory?: string | null
  onReady?: () => void
  signal: AbortSignal
}) {
  const response = await fetch(
    createOpenCodeUrl(baseUrl, "/event", directory),
    {
      headers: { accept: "text/event-stream" },
      signal,
    }
  )

  if (!response.ok) {
    throw new Error(
      `OpenCode native event stream failed: ${response.status} ${await response
        .text()
        .catch(() => "")}`
    )
  }

  onReady?.()

  for await (const frame of readSseFrames(response, signal)) {
    try {
      yield JSON.parse(frame.data) as unknown
    } catch {
      yield {
        id: frame.id,
        type: frame.event ?? "unknown",
        properties: { data: frame.data },
      }
    }
  }
}

function isCompletionEvent(event: unknown, sessionId: string) {
  const normalized = normalizeOpenCodeEvent(event)

  if (!normalized) {
    return false
  }

  const payload = getOpenCodeEventPayload(normalized)
  const eventSessionId = getString(payload.sessionID)

  if (eventSessionId !== sessionId) {
    return false
  }

  if (
    normalized.type === "session.idle" ||
    normalized.type === "session.error" ||
    normalized.type === "session.next.step.ended" ||
    normalized.type === "session.next.step.failed"
  ) {
    return true
  }

  const status = getRecord(payload.status)

  return normalized.type === "session.status" && status?.type === "idle"
}

async function consumeOpenCodeRunEvents({
  baseUrl,
  directory,
  onReady,
  queue,
  sessionId,
  signal,
}: {
  baseUrl: string
  directory?: string | null
  onReady?: () => void
  queue: AgentEventQueue
  sessionId: string
  signal: AbortSignal
}) {
  const mapper = createOpenCodeNativeEventMapper({ sessionId })

  for await (const event of subscribeOpenCodeEvents({
    baseUrl,
    directory,
    onReady,
    signal,
  })) {
    for (const agentEvent of mapper(event)) {
      queue.push(agentEvent)
    }

    if (isCompletionEvent(event, sessionId)) {
      return
    }
  }
}

type OpenCodeSession = {
  id: string
}

async function createOpenCodeSession({
  baseUrl,
  directory,
  input,
  options,
  signal,
}: {
  baseUrl: string
  directory?: string | null
  input: AgentRunInput
  options: OpenCodeNativeRuntimeOptions
  signal: AbortSignal
}) {
  const agent = resolveOption(options.agent, input)
  const model = resolveOption(options.model, input)

  return requestOpenCode<OpenCodeSession>({
    baseUrl,
    directory,
    method: "POST",
    path: "/session",
    signal,
    body: {
      title:
        getLatestPromptText(input.messages).slice(0, 80) || "AstraFlow run",
      ...(agent ? { agent } : {}),
      ...(model
        ? {
            model: {
              id: model.modelID,
              providerID: model.providerID,
              ...(model.variant ? { variant: model.variant } : {}),
            },
          }
        : {}),
    },
  })
}

async function sendOpenCodePrompt({
  baseUrl,
  directory,
  input,
  options,
  sessionId,
  signal,
}: {
  baseUrl: string
  directory?: string | null
  input: AgentRunInput
  options: OpenCodeNativeRuntimeOptions
  sessionId: string
  signal: AbortSignal
}) {
  const prompt = getLatestPromptText(input.messages)
  const agent = resolveOption(options.agent, input)
  const model = resolveOption(options.model, input)

  if (!prompt) {
    throw new Error("OpenCode native runtime received an empty prompt.")
  }

  await requestOpenCode<null>({
    baseUrl,
    directory,
    method: "POST",
    path: `/session/${sessionId}/prompt_async`,
    signal,
    body: {
      messageID: `msg_${randomUUID().replace(/-/g, "")}`,
      parts: [{ type: "text", text: prompt }],
      ...(agent ? { agent } : {}),
      ...(model
        ? {
            model: {
              providerID: model.providerID,
              modelID: model.modelID,
            },
            ...(model.variant ? { variant: model.variant } : {}),
          }
        : {}),
    },
  })
}

async function abortOpenCodeSession({
  baseUrl,
  directory,
  sessionId,
  signal,
}: {
  baseUrl: string
  directory?: string | null
  sessionId: string
  signal: AbortSignal
}) {
  await requestOpenCode<null>({
    baseUrl,
    directory,
    method: "POST",
    path: `/session/${sessionId}/abort`,
    signal,
  }).catch(() => null)
}

async function* streamOpenCodeNativeRun(
  input: AgentRunInput,
  options: OpenCodeNativeRuntimeOptions
): AsyncGenerator<AgentEvent> {
  const queue = new AgentEventQueue()
  const runAbort = new AbortController()
  let server: OpenCodeNativeServerHandle | null = null
  let sessionId: string | null = null

  const abortRun = () => runAbort.abort(input.signal.reason)
  input.signal.addEventListener("abort", abortRun, { once: true })

  void (async () => {
    try {
      const directory = input.projectPath?.trim() || null

      server = await startOpenCodeNativeServer(options)

      const session = await createOpenCodeSession({
        baseUrl: server.baseUrl,
        directory,
        input,
        options,
        signal: runAbort.signal,
      })

      sessionId = session.id
      queue.push({ type: "run_meta", sessionRef: sessionId })

      let markEventsReady = () => {}
      const eventsReady = new Promise<void>((resolve) => {
        markEventsReady = resolve
      })
      const events = consumeOpenCodeRunEvents({
        baseUrl: server.baseUrl,
        directory,
        onReady: markEventsReady,
        queue,
        sessionId,
        signal: runAbort.signal,
      })

      await Promise.race([eventsReady, events])

      await sendOpenCodePrompt({
        baseUrl: server.baseUrl,
        directory,
        input,
        options,
        sessionId,
        signal: runAbort.signal,
      })

      await events
      queue.close()
    } catch (error) {
      if (runAbort.signal.aborted || input.signal.aborted) {
        queue.close()
      } else {
        queue.fail(error)
      }
    } finally {
      if (sessionId && server && runAbort.signal.aborted) {
        await abortOpenCodeSession({
          baseUrl: server.baseUrl,
          directory: input.projectPath?.trim() || null,
          sessionId,
          signal: new AbortController().signal,
        })
      }

      await server?.dispose()
    }
  })()

  try {
    for await (const event of queue) {
      yield event
    }
  } finally {
    runAbort.abort()
    input.signal.removeEventListener("abort", abortRun)
  }
}

export class OpenCodeNativeRuntime implements AgentRuntime {
  readonly info = OPENCODE_NATIVE_RUNTIME_INFO

  constructor(private readonly options: OpenCodeNativeRuntimeOptions = {}) {}

  getInfo() {
    return this.info
  }

  startRun(input: AgentRunInput): AsyncIterable<AgentEvent> {
    return streamOpenCodeNativeRun(input, this.options)
  }
}

export function createOpenCodeNativeRuntime(
  options: OpenCodeNativeRuntimeOptions = {}
) {
  return new OpenCodeNativeRuntime(options)
}

export function registerOpenCodeNativeRuntime() {
  registerAgentRuntime(createOpenCodeNativeRuntime())
}

registerOpenCodeNativeRuntime()
