import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"

import type { BaseMessage } from "@langchain/core/messages"

import type {
  ServerNotification as CodexAppServerNotification,
  ServerRequest as CodexAppServerRequest,
} from "@/lib/generated/codex-app-server"
import type {
  Thread as CodexAppServerThread,
  ThreadItem as CodexAppServerThreadItem,
  Turn as CodexAppServerTurn,
  UserInput,
} from "@/lib/generated/codex-app-server/v2"
import {
  MODELVERSE_OPENAI_BASE_URL,
  MODELVERSE_PROVIDER_ID,
  getRuntimeModelSetting,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import { AgentEventQueue } from "@/lib/agent/event-queue"
import type {
  AgentEvent,
  AgentTraceRef,
  AgentUserInputAnswer,
  AgentUserInputQuestion,
} from "@/lib/agent/events"
import type { PromptMention } from "@/lib/agent/composer-types"
import {
  cancelSessionPermissions,
  requestPermission,
  type PermissionOption,
} from "@/lib/agent/permission-broker"
import {
  cancelSessionUserInputs,
  requestUserInput,
} from "@/lib/agent/user-input-broker"
import {
  registerAgentRuntime,
  type AgentRunInput,
  type AgentRuntime,
  type AgentRuntimeInfo,
} from "@/lib/agent/runtime"
import type { ChatReasoningEffort } from "@/lib/chat-models"
import { getStudioModelverseApiKey } from "@/lib/studio-db"

export const CODEX_DIRECT_RUNTIME_ID = "codex-direct"

export type CodexDirectJsonValue =
  | null
  | boolean
  | number
  | string
  | CodexDirectJsonValue[]
  | { [key: string]: CodexDirectJsonValue | undefined }

export type CodexDirectJsonObject = Record<string, CodexDirectJsonValue>

export type CodexDirectThreadItem =
  | CodexAppServerThreadItem
  | (Record<string, unknown> & {
      id?: string
      type: string
    })

export type CodexDirectTurn =
  | CodexAppServerTurn
  | (Record<string, unknown> & {
      error?: {
        message?: string | null
        additionalDetails?: string | null
      } | null
      id: string
      items?: CodexDirectThreadItem[]
      status?: string
    })

export type CodexDirectThread =
  | CodexAppServerThread
  | (Record<string, unknown> & {
      id: string
      turns?: CodexDirectTurn[]
    })

export type CodexDirectServerNotification =
  | CodexAppServerNotification
  | {
      method: string
      params?: unknown
    }

type CodexDirectJsonRpcId = number | string

type CodexDirectJsonRpcRequest =
  | CodexAppServerRequest
  | {
      id: CodexDirectJsonRpcId
      method: string
      params?: unknown
    }

type CodexDirectJsonRpcResponse =
  | { id: CodexDirectJsonRpcId; result: unknown }
  | {
      id: CodexDirectJsonRpcId
      error: { code: number; message: string; data?: unknown }
    }

type CodexDirectJsonRpcNotification = {
  method: string
  params?: unknown
}

type CodexDirectJsonRpcMessage =
  | CodexDirectJsonRpcNotification
  | CodexDirectJsonRpcRequest
  | CodexDirectJsonRpcResponse

type PendingJsonRpcRequest = {
  reject: (error: Error) => void
  resolve: (result: unknown) => void
}

type CodexDirectModelverseConfig = {
  apiKey: string
  model: AgentModelDefinition
}

type CodexDirectResolvedModel = {
  modelProvider: string | null
  model: string
}

type CodexDirectItemPhase = "completed" | "snapshot" | "started"

type AgentTodo = Extract<AgentEvent, { type: "plan_update" }>["todos"][number]
type CodexDirectTraceRef = Pick<
  AgentTraceRef,
  "itemId" | "parentThreadId" | "providerSessionId" | "threadId" | "turnId"
>

const CODEX_DIRECT_RUNTIME_INFO: AgentRuntimeInfo = {
  id: CODEX_DIRECT_RUNTIME_ID,
  label: "Codex Direct",
  description: "OpenAI Codex app-server via direct JSON-RPC",
  capabilities: {
    hitl: true,
    resume: false,
    subagents: true,
    plan: true,
    sandbox: true,
    mcp: false,
    skills: false,
  },
  composer: {
    slashCommands: "static",
    fileMentions: "structured",
    sessionMentions: true,
  },
}

const CODEX_APP_SERVER_STARTUP_TIMEOUT_MS = 20_000
const CODEX_APP_SERVER_SHUTDOWN_TIMEOUT_MS = 2_000
const MAX_CAPTURED_STDERR_LENGTH = 4000
const codexRequire = createRequire(import.meta.url)

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function getString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function getNullableString(value: unknown) {
  return typeof value === "string" ? value : null
}

function codexTraceRef(trace?: CodexDirectTraceRef | null): AgentTraceRef {
  return {
    runtimeId: CODEX_DIRECT_RUNTIME_ID,
    provider: "codex-app-server",
    ...(trace?.providerSessionId
      ? { providerSessionId: trace.providerSessionId }
      : {}),
    ...(trace?.threadId ? { threadId: trace.threadId } : {}),
    ...(trace?.turnId ? { turnId: trace.turnId } : {}),
    ...(trace?.itemId ? { itemId: trace.itemId } : {}),
    ...(trace?.parentThreadId ? { parentThreadId: trace.parentThreadId } : {}),
  }
}

function withCodexTrace<T extends AgentEvent>(
  events: T[],
  trace?: CodexDirectTraceRef | null
): T[] {
  if (!trace) {
    return events
  }

  const resolvedTrace = codexTraceRef(trace)

  return events.map((event) => ({
    ...event,
    trace: {
      ...resolvedTrace,
      ...event.trace,
    },
  }))
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : []
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

function truncateStderr(stderr: string) {
  if (stderr.length <= MAX_CAPTURED_STDERR_LENGTH) {
    return stderr
  }

  return stderr.slice(stderr.length - MAX_CAPTURED_STDERR_LENGTH)
}

function createCodexConfig(model: AgentModelDefinition) {
  return {
    model: model.providerModel,
    model_provider: MODELVERSE_PROVIDER_ID,
    model_providers: {
      [MODELVERSE_PROVIDER_ID]: {
        name: "Modelverse",
        base_url: model.baseUrl ?? MODELVERSE_OPENAI_BASE_URL,
        env_key: "ASTRAFLOW_MODELVERSE_API_KEY",
        wire_api: "responses",
      },
    },
  }
}

function getCodexDirectModelverseConfig(
  input: AgentRunInput
): CodexDirectModelverseConfig | null {
  const runtimeSetting = getRuntimeModelSetting(CODEX_DIRECT_RUNTIME_ID)

  if (!runtimeSetting || runtimeSetting.useLocalSettings) {
    return null
  }

  const apiKey = getStudioModelverseApiKey()?.key

  if (!apiKey) {
    throw new Error("Modelverse API key is not configured locally.")
  }

  const model = resolveAgentModelForRuntime({
    modelId: input.model,
    runtimeId: CODEX_DIRECT_RUNTIME_ID,
  })

  if (!model) {
    throw new Error("No Modelverse model is configured for Codex.")
  }

  if (
    model.protocol !== "openai-chat" &&
    model.protocol !== "openai-responses"
  ) {
    throw new Error(
      `${model.label} does not support the Codex direct runtime protocol.`
    )
  }

  return { apiKey, model }
}

function resolveCodexDirectModel(
  input: AgentRunInput,
  config: CodexDirectModelverseConfig | null
): CodexDirectResolvedModel {
  if (config) {
    return {
      model: config.model.providerModel,
      modelProvider: MODELVERSE_PROVIDER_ID,
    }
  }

  return {
    model: input.model,
    modelProvider: null,
  }
}

function createCodexDirectEnv(
  config: CodexDirectModelverseConfig | null
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  }

  if (!config) {
    return env
  }

  return {
    ...env,
    ASTRAFLOW_MODELVERSE_API_KEY: config.apiKey,
    CODEX_API_KEY: config.apiKey,
    CODEX_CONFIG: JSON.stringify(createCodexConfig(config.model)),
    MODEL_PROVIDER: MODELVERSE_PROVIDER_ID,
    OPENAI_API_KEY: config.apiKey,
  }
}

function resolveBundledCodexScript() {
  return codexRequire.resolve("@openai/codex/bin/codex.js")
}

export function spawnCodexDirectAppServer(
  env: NodeJS.ProcessEnv
): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [resolveBundledCodexScript(), "app-server", "--stdio"],
    {
      cwd: process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  )
}

function isJsonRpcRequest(
  message: CodexDirectJsonRpcMessage
): message is CodexDirectJsonRpcRequest {
  return (
    "id" in message && "method" in message && typeof message.method === "string"
  )
}

function isJsonRpcResponse(
  message: CodexDirectJsonRpcMessage
): message is CodexDirectJsonRpcResponse {
  return "id" in message && ("result" in message || "error" in message)
}

function isJsonRpcNotification(
  message: CodexDirectJsonRpcMessage
): message is CodexDirectJsonRpcNotification {
  return !("id" in message) && "method" in message
}

class CodexDirectJsonRpcClient {
  private buffer = ""
  private closeHandlers: Array<(error: Error | null) => void> = []
  private closed = false
  private nextId = 1
  private notificationHandler:
    ((notification: CodexDirectJsonRpcNotification) => void) | null = null
  private pending = new Map<string, PendingJsonRpcRequest>()
  private requestHandler:
    ((request: CodexDirectJsonRpcRequest) => Promise<unknown>) | null = null
  private stderr = ""

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk))
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = truncateStderr(this.stderr + chunk.toString("utf8"))
    })
    child.on("error", (error) => this.close(error))
    child.on("exit", (code, signal) => {
      const reason =
        code === 0
          ? null
          : new Error(
              [
                `Codex app-server exited with code ${code ?? "null"}`,
                signal ? `signal ${signal}` : null,
                this.stderr.trim() ? this.stderr.trim() : null,
              ]
                .filter(Boolean)
                .join(": ")
            )

      this.close(reason)
    })
  }

  onNotification(
    handler: (notification: CodexDirectJsonRpcNotification) => void
  ) {
    this.notificationHandler = handler
  }

  onRequest(handler: (request: CodexDirectJsonRpcRequest) => Promise<unknown>) {
    this.requestHandler = handler
  }

  onClose(handler: (error: Error | null) => void) {
    this.closeHandlers.push(handler)
  }

  getCapturedStderr() {
    return this.stderr
  }

  sendNotification(method: string, params?: unknown) {
    this.writeMessage({ method, params })
  }

  sendRequest<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server connection is closed."))
    }

    const id = this.nextId++

    return new Promise<T>((resolve, reject) => {
      this.pending.set(String(id), {
        reject,
        resolve: (result) => resolve(result as T),
      })
      this.writeMessage({ id, method, params })
    })
  }

  dispose() {
    this.close(null)

    if (this.child.exitCode !== null || this.child.killed) {
      return
    }

    this.child.kill("SIGTERM")

    setTimeout(() => {
      if (this.child.exitCode === null && !this.child.killed) {
        this.child.kill("SIGKILL")
      }
    }, CODEX_APP_SERVER_SHUTDOWN_TIMEOUT_MS).unref()
  }

  private close(error: Error | null) {
    if (this.closed) {
      return
    }

    this.closed = true
    const pending = Array.from(this.pending.values())
    const closeHandlers = this.closeHandlers
    this.closeHandlers = []
    this.pending.clear()

    for (const request of pending) {
      request.reject(error ?? new Error("Codex app-server connection closed."))
    }

    for (const handler of closeHandlers) {
      handler(error)
    }
  }

  private handleStdout(chunk: Buffer) {
    this.buffer += chunk.toString("utf8")

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n")

      if (newlineIndex < 0) {
        return
      }

      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)

      if (!line) {
        continue
      }

      try {
        this.handleMessage(JSON.parse(line) as CodexDirectJsonRpcMessage)
      } catch {
        continue
      }
    }
  }

  private handleMessage(message: CodexDirectJsonRpcMessage) {
    if (isJsonRpcResponse(message)) {
      this.handleResponse(message)
      return
    }

    if (isJsonRpcRequest(message)) {
      void this.handleRequest(message)
      return
    }

    if (isJsonRpcNotification(message)) {
      this.notificationHandler?.(message)
    }
  }

  private handleResponse(message: CodexDirectJsonRpcResponse) {
    const pending = this.pending.get(String(message.id))

    if (!pending) {
      return
    }

    this.pending.delete(String(message.id))

    if ("error" in message) {
      pending.reject(new Error(message.error.message))
      return
    }

    pending.resolve(message.result)
  }

  private async handleRequest(request: CodexDirectJsonRpcRequest) {
    try {
      if (!this.requestHandler) {
        throw new Error(
          `Unsupported Codex app-server request: ${request.method}`
        )
      }

      const result = await this.requestHandler(request)
      this.writeMessage({ id: request.id, result })
    } catch (error) {
      this.writeMessage({
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  private writeMessage(message: Record<string, unknown>) {
    if (this.closed) {
      return
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }
}

function mapPlanStatus(status: unknown): AgentTodo["status"] {
  if (status === "inProgress") {
    return "in_progress"
  }

  if (status === "completed") {
    return "completed"
  }

  return "pending"
}

function createPlanUpdateEvent(plan: unknown): AgentEvent[] {
  const todos = getArray(plan)
    .map((entry) => {
      const record = getRecord(entry)
      const text = getString(record?.step).trim()

      if (!text) {
        return null
      }

      return {
        text,
        status: mapPlanStatus(record?.status),
      }
    })
    .filter((todo): todo is AgentTodo => Boolean(todo))

  return todos.length > 0 ? [{ type: "plan_update", todos }] : []
}

function toolResultStatus(status: unknown): "complete" | "error" {
  return status === "completed" ? "complete" : "error"
}

function fileChangeStatus(status: unknown): "complete" | "error" | undefined {
  if (status === "completed") {
    return "complete"
  }

  if (status === "failed" || status === "declined") {
    return "error"
  }

  return undefined
}

function mapPatchKind(kind: unknown): "create" | "delete" | "edit" {
  const kindRecord = getRecord(kind)

  if (kindRecord?.type === "add") {
    return "create"
  }

  if (kindRecord?.type === "delete") {
    return "delete"
  }

  return "edit"
}

function toolCallEvent(
  id: string,
  name: string,
  input: unknown
): Extract<AgentEvent, { type: "tool_call" }> {
  return {
    type: "tool_call",
    id,
    name,
    input: stringifyPayload(input),
  }
}

function toolResultEvent({
  error,
  id,
  name,
  output,
  status,
}: {
  error?: unknown
  id: string
  name: string
  output?: unknown
  status: unknown
}): Extract<AgentEvent, { type: "tool_result" }> {
  const resultStatus = toolResultStatus(status)

  return {
    type: "tool_result",
    id,
    name,
    status: resultStatus,
    ...(resultStatus === "error"
      ? { error: stringifyPayload(error ?? output) }
      : { output: stringifyPayload(output) }),
  }
}

function createCommandExecutionEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const id = getString(item.id) || "command"
  const name = "shell"
  const input = {
    command: getString(item.command),
    cwd: getNullableString(item.cwd),
  }
  const output = {
    output: getNullableString(item.aggregatedOutput) ?? "",
    exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
  }

  if (phase === "started") {
    return [toolCallEvent(id, name, input)]
  }

  if (phase === "completed") {
    return [
      toolResultEvent({
        error: output.output,
        id,
        name,
        output,
        status: item.status,
      }),
    ]
  }

  return [
    toolCallEvent(id, name, input),
    toolResultEvent({
      error: output.output,
      id,
      name,
      output,
      status: item.status,
    }),
  ]
}

function createFileChangeEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const status = phase === "started" ? undefined : fileChangeStatus(item.status)

  return getArray(item.changes)
    .map((change) => {
      const record = getRecord(change)
      const path = getString(record?.path)

      if (!path) {
        return null
      }

      return {
        type: "file_change" as const,
        path,
        kind: mapPatchKind(record?.kind),
        ...(status ? { status } : {}),
      }
    })
    .filter((event): event is Extract<AgentEvent, { type: "file_change" }> =>
      Boolean(event)
    )
}

function createMcpToolCallName(item: Record<string, unknown>) {
  const server = getString(item.server) || "mcp"
  const tool = getString(item.tool) || "tool"

  return `mcp__${server}__${tool}`
}

function createMcpToolCallEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const id = getString(item.id) || "mcp-tool"
  const name = createMcpToolCallName(item)
  const input = item.arguments ?? {}
  const error = getRecord(item.error)?.message ?? item.error
  const output = item.result ?? error

  if (phase === "started") {
    return [toolCallEvent(id, name, input)]
  }

  if (phase === "completed") {
    return [
      toolResultEvent({
        error,
        id,
        name,
        output,
        status: item.status,
      }),
    ]
  }

  return [
    toolCallEvent(id, name, input),
    toolResultEvent({
      error,
      id,
      name,
      output,
      status: item.status,
    }),
  ]
}

function createDynamicToolCallName(item: Record<string, unknown>) {
  const namespace = getNullableString(item.namespace)
  const tool = getString(item.tool) || "tool"

  return namespace ? `${namespace}.${tool}` : tool
}

function createDynamicToolCallEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const id = getString(item.id) || "dynamic-tool"
  const name = createDynamicToolCallName(item)
  const output = item.contentItems ?? { success: item.success ?? null }

  if (phase === "started") {
    return [toolCallEvent(id, name, item.arguments ?? {})]
  }

  if (phase === "completed") {
    return [
      toolResultEvent({
        error: output,
        id,
        name,
        output,
        status: item.status,
      }),
    ]
  }

  return [
    toolCallEvent(id, name, item.arguments ?? {}),
    toolResultEvent({
      error: output,
      id,
      name,
      output,
      status: item.status,
    }),
  ]
}

function createWebSearchEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const id = getString(item.id) || "web-search"
  const input = { query: getString(item.query), action: item.action ?? null }

  if (phase === "started") {
    return [toolCallEvent(id, "web_search", input)]
  }

  if (phase === "completed") {
    return [
      toolResultEvent({
        id,
        name: "web_search",
        output: input,
        status: "completed",
      }),
    ]
  }

  return [
    toolCallEvent(id, "web_search", input),
    toolResultEvent({
      id,
      name: "web_search",
      output: input,
      status: "completed",
    }),
  ]
}

function createImageGenerationEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const id = getString(item.id) || "image-generation"
  const output = {
    status: item.status,
    revisedPrompt: item.revisedPrompt ?? null,
    result: item.result ?? "",
    savedPath: item.savedPath ?? null,
  }

  if (phase === "started") {
    return [toolCallEvent(id, "image_generation", output)]
  }

  if (phase === "completed") {
    return [
      toolResultEvent({
        error: output,
        id,
        name: "image_generation",
        output,
        status: item.status,
      }),
    ]
  }

  return [
    toolCallEvent(id, "image_generation", output),
    toolResultEvent({
      error: output,
      id,
      name: "image_generation",
      output,
      status: item.status,
    }),
  ]
}

function createImageViewEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const id = getString(item.id) || "image-view"
  const input = { path: getString(item.path) }

  if (phase === "started") {
    return [toolCallEvent(id, "image_view", input)]
  }

  if (phase === "completed") {
    return [
      toolResultEvent({
        id,
        name: "image_view",
        output: input,
        status: "completed",
      }),
    ]
  }

  return [
    toolCallEvent(id, "image_view", input),
    toolResultEvent({
      id,
      name: "image_view",
      output: input,
      status: "completed",
    }),
  ]
}

function collabAgentStatus(
  status: unknown
): NonNullable<Extract<AgentEvent, { type: "subagent_update" }>["status"]> {
  if (status === "completed" || status === "shutdown") {
    return "complete"
  }

  if (status === "errored" || status === "notFound") {
    return "error"
  }

  return "running"
}

function createCollabSubagentEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const receiverThreadIds = getArray(item.receiverThreadIds).filter(
    (threadId): threadId is string =>
      typeof threadId === "string" && threadId.length > 0
  )
  const prompt = getNullableString(item.prompt) ?? undefined
  const agentStates = getRecord(item.agentsStates)

  if (!receiverThreadIds.length) {
    return []
  }

  return receiverThreadIds.flatMap((threadId) => {
    const state = getRecord(agentStates?.[threadId])
    const status = collabAgentStatus(state?.status)
    const message = getNullableString(state?.message) ?? undefined
    const events: AgentEvent[] = []

    if (phase !== "completed" || item.tool === "spawnAgent") {
      events.push({
        type: "subagent_start",
        taskId: threadId,
        name: "Codex subagent",
        ...(prompt ? { taskInput: prompt } : {}),
        parentTaskId: getNullableString(item.senderThreadId) ?? undefined,
      })
    }

    if (status === "complete" || status === "error") {
      events.push({
        type: "subagent_end",
        taskId: threadId,
        name: "Codex subagent",
        status,
        ...(status === "error" ? { error: message ?? "Subagent failed." } : {}),
        ...(status === "complete" && message ? { summary: message } : {}),
      })
      return events
    }

    if (message || phase !== "started") {
      events.push({
        type: "subagent_update",
        taskId: threadId,
        name: "Codex subagent",
        status,
        ...(message ? { contentDelta: message } : {}),
        parentTaskId: getNullableString(item.senderThreadId) ?? undefined,
      })
    }

    return events
  })
}

function createCollabAgentToolCallEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const id = getString(item.id) || "collab-agent"
  const name = getString(item.tool) || "collabAgent"
  const payload = {
    tool: name,
    senderThreadId: item.senderThreadId ?? null,
    receiverThreadIds: item.receiverThreadIds ?? [],
    prompt: item.prompt ?? null,
    model: item.model ?? null,
    reasoningEffort: item.reasoningEffort ?? null,
    agentsStates: item.agentsStates ?? {},
  }
  const subagentEvents = createCollabSubagentEvents(item, phase)

  if (phase === "started") {
    return [toolCallEvent(id, name, payload), ...subagentEvents]
  }

  if (phase === "completed") {
    return [
      toolResultEvent({
        error: payload,
        id,
        name,
        output: payload,
        status: item.status,
      }),
      ...subagentEvents,
    ]
  }

  return [
    toolCallEvent(id, name, payload),
    toolResultEvent({
      error: payload,
      id,
      name,
      output: payload,
      status: item.status,
    }),
    ...subagentEvents,
  ]
}

function createSubAgentActivityEvents(
  item: Record<string, unknown>
): AgentEvent[] {
  const taskId = getString(item.agentThreadId)

  if (!taskId) {
    return []
  }

  const name = getString(item.agentPath) || "Codex subagent"

  if (item.kind === "started") {
    return [
      {
        type: "subagent_start",
        taskId,
        name,
      },
    ]
  }

  return [
    {
      type: "subagent_update",
      taskId,
      name,
      status: "running",
      contentDelta:
        item.kind === "interrupted"
          ? "Subagent interrupted."
          : "Subagent activity updated.",
    },
  ]
}

function createReviewModeEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const id = getString(item.id) || "review-mode"
  const input = {
    action: item.type,
    review: getString(item.review),
  }

  if (phase === "started") {
    return [toolCallEvent(id, "codex_review_mode", input)]
  }

  if (phase === "completed") {
    return [
      toolResultEvent({
        id,
        name: "codex_review_mode",
        output: input,
        status: "completed",
      }),
    ]
  }

  return [
    toolCallEvent(id, "codex_review_mode", input),
    toolResultEvent({
      id,
      name: "codex_review_mode",
      output: input,
      status: "completed",
    }),
  ]
}

function createContextCompactionEvents(
  item: Record<string, unknown>,
  phase: CodexDirectItemPhase
): AgentEvent[] {
  const id = getString(item.id) || "context-compaction"
  const input = { itemId: id }

  if (phase === "started") {
    return [toolCallEvent(id, "context_compaction", input)]
  }

  if (phase === "completed") {
    return [
      toolResultEvent({
        id,
        name: "context_compaction",
        output: input,
        status: "completed",
      }),
    ]
  }

  return [
    toolCallEvent(id, "context_compaction", input),
    toolResultEvent({
      id,
      name: "context_compaction",
      output: input,
      status: "completed",
    }),
  ]
}

function createSnapshotMessageEvents(item: Record<string, unknown>) {
  if (item.type === "agentMessage") {
    const text = getString(item.text)

    return text
      ? ([{ type: "text_delta", delta: text }] satisfies AgentEvent[])
      : []
  }

  if (item.type === "reasoning") {
    const summary = getArray(item.summary).filter(
      (part): part is string => typeof part === "string" && part.length > 0
    )
    const content = getArray(item.content).filter(
      (part): part is string => typeof part === "string" && part.length > 0
    )
    const delta = (summary.length ? summary : content).join("\n\n")

    return delta
      ? ([{ type: "reasoning_delta", delta }] satisfies AgentEvent[])
      : []
  }

  return []
}

export function mapCodexDirectThreadItemToAgentEvents(
  item: CodexDirectThreadItem,
  phase: CodexDirectItemPhase = "snapshot",
  trace?: CodexDirectTraceRef | null
): AgentEvent[] {
  const record = getRecord(item)

  if (!record) {
    return []
  }

  const itemTrace = {
    ...trace,
    itemId: trace?.itemId ?? getNullableString(record.id) ?? undefined,
  }
  let events: AgentEvent[]

  switch (record.type) {
    case "agentMessage":
    case "reasoning":
      events = phase === "snapshot" ? createSnapshotMessageEvents(record) : []
      break
    case "commandExecution":
      events = createCommandExecutionEvents(record, phase)
      break
    case "fileChange":
      events = createFileChangeEvents(record, phase)
      break
    case "mcpToolCall":
      events = createMcpToolCallEvents(record, phase)
      break
    case "dynamicToolCall":
      events = createDynamicToolCallEvents(record, phase)
      break
    case "webSearch":
      events = createWebSearchEvents(record, phase)
      break
    case "imageGeneration":
      events = createImageGenerationEvents(record, phase)
      break
    case "imageView":
      events = createImageViewEvents(record, phase)
      break
    case "collabAgentToolCall":
      events = createCollabAgentToolCallEvents(record, phase)
      break
    case "subAgentActivity":
      events = createSubAgentActivityEvents(record)
      break
    case "enteredReviewMode":
    case "exitedReviewMode":
      events = createReviewModeEvents(record, phase)
      break
    case "contextCompaction":
      events = createContextCompactionEvents(record, phase)
      break
    default:
      return []
  }

  return withCodexTrace(events, itemTrace)
}

export function mapCodexDirectTurnToAgentEvents(
  turn: CodexDirectTurn,
  phase: CodexDirectItemPhase = "snapshot",
  trace?: CodexDirectTraceRef | null
): AgentEvent[] {
  const turnTrace = {
    ...trace,
    turnId: trace?.turnId ?? turn.id,
  }
  const events = getArray(turn.items).flatMap((item) => {
    const record = getRecord(item)

    return record?.type
      ? mapCodexDirectThreadItemToAgentEvents(
          record as CodexDirectThreadItem,
          phase,
          turnTrace
        )
      : []
  })
  const error = getRecord(turn.error)
  const message =
    getNullableString(error?.additionalDetails) ??
    getNullableString(error?.message)

  if (message) {
    events.push(...withCodexTrace([{ type: "error", message }], turnTrace))
  }

  return events
}

export function mapCodexDirectThreadToAgentEvents(
  thread: CodexDirectThread
): AgentEvent[] {
  const threadRecord = getRecord(thread)
  const threadTrace = {
    providerSessionId: getNullableString(threadRecord?.sessionId) ?? undefined,
    parentThreadId:
      getNullableString(threadRecord?.parentThreadId) ?? undefined,
    threadId: thread.id,
  }

  return getArray(thread.turns).flatMap((turn) => {
    const record = getRecord(turn)

    return record?.id
      ? mapCodexDirectTurnToAgentEvents(
          record as CodexDirectTurn,
          "snapshot",
          threadTrace
        )
      : []
  })
}

export function mapCodexDirectNotificationToAgentEvents(
  notification: CodexDirectServerNotification
): AgentEvent[] {
  const params = getRecord(notification.params)
  const notificationTrace = {
    threadId: getNullableString(params?.threadId) ?? undefined,
    turnId: getNullableString(params?.turnId) ?? undefined,
    itemId: getNullableString(params?.itemId) ?? undefined,
  }

  switch (notification.method) {
    case "item/agentMessage/delta": {
      const delta = getString(params?.delta)

      return delta
        ? withCodexTrace([{ type: "text_delta", delta }], notificationTrace)
        : []
    }
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      const delta = getString(params?.delta)

      return delta
        ? withCodexTrace(
            [{ type: "reasoning_delta", delta }],
            notificationTrace
          )
        : []
    }
    case "turn/plan/updated":
      return withCodexTrace(
        createPlanUpdateEvent(params?.plan),
        notificationTrace
      )
    case "item/started": {
      const item = getRecord(params?.item)

      return item?.type
        ? mapCodexDirectThreadItemToAgentEvents(
            item as CodexDirectThreadItem,
            "started",
            notificationTrace
          )
        : []
    }
    case "item/completed": {
      const item = getRecord(params?.item)

      return item?.type
        ? mapCodexDirectThreadItemToAgentEvents(
            item as CodexDirectThreadItem,
            "completed",
            notificationTrace
          )
        : []
    }
    case "thread/tokenUsage/updated":
      return withCodexTrace(
        [{ type: "run_meta", usage: params?.tokenUsage }],
        notificationTrace
      )
    case "turn/completed": {
      const turn = getRecord(params?.turn)
      const error = getRecord(turn?.error)
      const trace = {
        ...notificationTrace,
        turnId:
          notificationTrace.turnId ?? getNullableString(turn?.id) ?? undefined,
      }
      const message =
        getNullableString(error?.additionalDetails) ??
        getNullableString(error?.message)

      return message ? withCodexTrace([{ type: "error", message }], trace) : []
    }
    case "error": {
      const error = getRecord(params?.error)
      const message =
        getNullableString(error?.additionalDetails) ??
        getNullableString(error?.message) ??
        "Codex app-server error."

      return withCodexTrace([{ type: "error", message }], notificationTrace)
    }
    case "warning": {
      const message = getString(params?.message)

      return message
        ? withCodexTrace(
            [{ type: "text_delta", delta: `Warning: ${message}\n\n` }],
            notificationTrace
          )
        : []
    }
    case "configWarning": {
      const summary = getString(params?.summary)
      const details = getNullableString(params?.details)
      const message = [summary, details].filter(Boolean).join("\n\n")

      return message
        ? withCodexTrace(
            [
              {
                type: "text_delta",
                delta: `Config warning: ${message}\n\n`,
              },
            ],
            notificationTrace
          )
        : []
    }
    default:
      return []
  }
}

export function mapCodexDirectNotificationsToAgentEvents(
  notifications: CodexDirectServerNotification[]
): AgentEvent[] {
  return notifications.flatMap(mapCodexDirectNotificationToAgentEvents)
}

function contentBlockToText(block: unknown) {
  const record = getRecord(block)

  if (!record) {
    return stringifyPayload(block)
  }

  if (typeof record.text === "string") {
    return record.text
  }

  if (typeof record.image_url === "string") {
    return `[image: ${record.image_url}]`
  }

  const imageUrl = getRecord(record.image_url)

  if (typeof imageUrl?.url === "string") {
    return `[image: ${imageUrl.url}]`
  }

  return stringifyPayload(record)
}

function messageType(message: BaseMessage) {
  const maybeTypedMessage = message as BaseMessage & {
    _getType?: () => string
    getType?: () => string
    type?: string
  }

  if (typeof maybeTypedMessage._getType === "function") {
    return maybeTypedMessage._getType()
  }

  if (typeof maybeTypedMessage.getType === "function") {
    return maybeTypedMessage.getType()
  }

  return maybeTypedMessage.type ?? "message"
}

function messageContentToText(content: BaseMessage["content"]) {
  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content.map(contentBlockToText).join("\n")
  }

  return stringifyPayload(content)
}

function formatMessagesForCodexPrompt(messages: BaseMessage[]) {
  const formatted = messages
    .map((message) => {
      const content = messageContentToText(message.content).trim()

      if (!content) {
        return null
      }

      return `[${messageType(message)}]\n${content}`
    })
    .filter((message): message is string => Boolean(message))

  return formatted.join("\n\n")
}

function getLatestUserMessage(messages: BaseMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messageType(messages[index]) === "human") {
      return messages[index]
    }
  }

  return messages.at(-1) ?? null
}

function getFilePromptMentions(messages: BaseMessage[]) {
  const latestUserMessage = getLatestUserMessage(messages)
  const mentions = (
    latestUserMessage as { additional_kwargs?: { mentions?: unknown } } | null
  )?.additional_kwargs?.mentions

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

function createCodexUserInput(prompt: string, messages: BaseMessage[]) {
  const inputItems: UserInput[] = [
    {
      type: "text",
      text: prompt,
      text_elements: [],
    },
  ]

  for (const mention of getFilePromptMentions(messages)) {
    inputItems.push({
      type: "mention",
      name: mention.name,
      path: mention.path,
    })
  }

  return inputItems
}

function codexReasoningEffort(effort: ChatReasoningEffort | undefined) {
  return effort && effort !== "none" ? effort : null
}

function createThreadStartParams(
  input: AgentRunInput,
  resolvedModel: CodexDirectResolvedModel
) {
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    cwd: input.projectPath ?? process.cwd(),
    ephemeral: true,
    model: resolvedModel.model,
    modelProvider: resolvedModel.modelProvider,
    sandbox: "workspace-write",
    serviceName: "AstraFlow Desktop",
  }
}

function createTurnStartParams({
  input,
  prompt,
  resolvedModel,
  threadId,
}: {
  input: AgentRunInput
  prompt: string
  resolvedModel: CodexDirectResolvedModel
  threadId: string
}) {
  return {
    effort: codexReasoningEffort(input.reasoningEffort),
    input: createCodexUserInput(prompt, input.messages),
    model: resolvedModel.model,
    threadId,
  }
}

function permissionRequestEvent({
  input,
  options,
  requestId,
  selectedOptionId,
  status,
  toolName,
}: {
  input: string
  options: PermissionOption[]
  requestId: string
  selectedOptionId: string | null
  status: "pending" | "resolved"
  toolName: string
}): Extract<AgentEvent, { type: "permission_request" }> {
  const selectedOption = selectedOptionId
    ? options.find((option) => option.optionId === selectedOptionId)
    : null

  return {
    type: "permission_request",
    requestId,
    toolName,
    input,
    options,
    status,
    selectedOptionId,
    decisions:
      status === "resolved"
        ? [selectedOption?.name ?? selectedOptionId ?? "cancelled"]
        : [],
  }
}

async function requestCodexDirectPermission({
  input,
  options,
  queue,
  requestId,
  sessionId,
  signal,
  toolName,
}: {
  input: string
  options: PermissionOption[]
  queue: AgentEventQueue
  requestId: string
  sessionId: string
  signal: AbortSignal
  toolName: string
}) {
  queue.push(
    permissionRequestEvent({
      input,
      options,
      requestId,
      selectedOptionId: null,
      status: "pending",
      toolName,
    })
  )

  const decision = await requestPermission({
    inputPreview: input,
    options,
    requestId,
    sessionId,
    signal,
    toolName,
  })

  const selectedOptionId = "cancelled" in decision ? null : decision.optionId

  queue.push(
    permissionRequestEvent({
      input,
      options,
      requestId,
      selectedOptionId,
      status: "resolved",
      toolName,
    })
  )

  return selectedOptionId
}

function normalizeCodexUserInputOptionId(label: string, index: number) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)

  return slug || `option_${index + 1}`
}

function normalizeCodexUserInputQuestions(
  value: unknown
): AgentUserInputQuestion[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, questionIndex) => {
      const record = getRecord(item)

      if (!record) {
        return null
      }

      const rawOptions = Array.isArray(record.options) ? record.options : []
      const seen = new Set<string>()
      const options = rawOptions
        .map((option, optionIndex) => {
          const optionRecord = getRecord(option)
          const label =
            getString(optionRecord?.label) || `Option ${optionIndex + 1}`
          const baseId = normalizeCodexUserInputOptionId(label, optionIndex)
          let optionId = baseId
          let suffix = 2

          while (seen.has(optionId)) {
            optionId = `${baseId}_${suffix}`
            suffix += 1
          }

          seen.add(optionId)

          return {
            optionId,
            label,
            description: getString(optionRecord?.description) ?? "",
          }
        })
        .filter((option) => option.label.trim())

      return {
        id: getString(record.id) || `question_${questionIndex + 1}`,
        header: getString(record.header) || `Q${questionIndex + 1}`,
        question: getString(record.question) || "Answer the question",
        options,
        allowOther: options.length === 0 ? true : record.isOther !== false,
        isSecret: record.isSecret === true,
      } satisfies AgentUserInputQuestion
    })
    .filter((question): question is AgentUserInputQuestion => Boolean(question))
}

function userInputRequestEvent({
  answers,
  autoResolutionMs,
  questions,
  requestId,
  status,
  trace,
}: {
  answers?: AgentUserInputAnswer[]
  autoResolutionMs?: number | null
  questions: AgentUserInputQuestion[]
  requestId: string
  status: "pending" | "resolved"
  trace?: AgentTraceRef
}): Extract<AgentEvent, { type: "user_input_request" }> {
  return {
    type: "user_input_request",
    requestId,
    questions,
    answers,
    autoResolutionMs,
    status,
    ...(trace ? { trace } : {}),
  }
}

function codexUserInputResponse(answers: AgentUserInputAnswer[]) {
  return {
    answers: Object.fromEntries(
      answers.map((answer) => [
        answer.questionId,
        { answers: [answer.text || answer.label || ""].filter(Boolean) },
      ])
    ),
  }
}

function commandApprovalOptions(params: Record<string, unknown>) {
  const options: PermissionOption[] = [
    { optionId: "accept", name: "Allow Once", kind: "allow_once" },
    {
      optionId: "acceptForSession",
      name: "Allow for Session",
      kind: "allow_always",
    },
    { optionId: "decline", name: "Reject", kind: "reject_once" },
  ]

  if (Array.isArray(params.proposedExecpolicyAmendment)) {
    options.splice(1, 0, {
      optionId: "acceptWithExecpolicyAmendment",
      name: "Allow Similar Commands",
      kind: "allow_always",
    })
  }

  if (Array.isArray(params.proposedNetworkPolicyAmendments)) {
    options.splice(1, 0, {
      optionId: "applyNetworkPolicyAmendment",
      name: "Apply Network Rule",
      kind: "allow_always",
    })
  }

  return options
}

function commandDecisionForOption(
  optionId: string | null,
  params: Record<string, unknown>
) {
  if (optionId === "accept") {
    return "accept"
  }

  if (optionId === "acceptForSession") {
    return "acceptForSession"
  }

  if (
    optionId === "acceptWithExecpolicyAmendment" &&
    Array.isArray(params.proposedExecpolicyAmendment)
  ) {
    return {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: params.proposedExecpolicyAmendment,
      },
    }
  }

  if (
    optionId === "applyNetworkPolicyAmendment" &&
    Array.isArray(params.proposedNetworkPolicyAmendments)
  ) {
    const [networkPolicyAmendment] = params.proposedNetworkPolicyAmendments

    if (networkPolicyAmendment) {
      return {
        applyNetworkPolicyAmendment: {
          network_policy_amendment: networkPolicyAmendment,
        },
      }
    }
  }

  return optionId === "decline" ? "decline" : "cancel"
}

function fileChangeApprovalOptions(): PermissionOption[] {
  return [
    { optionId: "accept", name: "Allow Once", kind: "allow_once" },
    {
      optionId: "acceptForSession",
      name: "Allow for Session",
      kind: "allow_always",
    },
    { optionId: "decline", name: "Reject", kind: "reject_once" },
  ]
}

function fileChangeDecisionForOption(optionId: string | null) {
  if (optionId === "accept") {
    return "accept"
  }

  if (optionId === "acceptForSession") {
    return "acceptForSession"
  }

  return optionId === "decline" ? "decline" : "cancel"
}

function legacyReviewDecisionForOption(optionId: string | null) {
  if (optionId === "accept") {
    return "approved"
  }

  if (optionId === "acceptForSession") {
    return "approved_for_session"
  }

  return optionId === "decline" ? "denied" : "abort"
}

function grantedPermissionsFromRequest(permissions: unknown) {
  const record = getRecord(permissions)
  const granted: Record<string, unknown> = {}

  if (record?.network) {
    granted.network = record.network
  }

  if (record?.fileSystem) {
    granted.fileSystem = record.fileSystem
  }

  return granted
}

export class CodexDirectRuntime implements AgentRuntime {
  readonly info = CODEX_DIRECT_RUNTIME_INFO

  getInfo() {
    return this.info
  }

  startRun(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const queue = new AgentEventQueue()

    void this.run(input, queue)

    return queue
  }

  private async run(input: AgentRunInput, queue: AgentEventQueue) {
    const modelverseConfig = getCodexDirectModelverseConfig(input)
    const resolvedModel = resolveCodexDirectModel(input, modelverseConfig)
    const child = spawnCodexDirectAppServer(
      createCodexDirectEnv(modelverseConfig)
    )
    const client = new CodexDirectJsonRpcClient(child)
    let completed = false
    let threadId: string | null = null
    let turnId: string | null = null
    let startupTimer: NodeJS.Timeout | null = null

    const completion = new Promise<void>((resolve, reject) => {
      client.onNotification((notification) => {
        for (const event of mapCodexDirectNotificationToAgentEvents(
          notification
        )) {
          queue.push(event)
        }

        if (notification.method === "turn/started") {
          const turn = getRecord(getRecord(notification.params)?.turn)
          turnId = getNullableString(turn?.id) ?? turnId
        }

        if (notification.method === "turn/completed") {
          completed = true
          resolve()
        }
      })
      client.onClose((error) => {
        if (!completed) {
          reject(
            error ??
              new Error("Codex app-server closed before turn completion.")
          )
        }
      })
    })
    void completion.catch(() => undefined)

    const abort = () => {
      if (threadId && turnId) {
        void client
          .sendRequest("turn/interrupt", { threadId, turnId })
          .catch(() => undefined)
      }

      client.dispose()
    }

    input.signal.addEventListener("abort", abort, { once: true })
    client.onRequest((request) =>
      this.handleServerRequest({
        input,
        queue,
        request,
      })
    )

    try {
      startupTimer = setTimeout(() => {
        client.dispose()
      }, CODEX_APP_SERVER_STARTUP_TIMEOUT_MS)

      const initializeResponse = await client.sendRequest<{
        userAgent?: string
      }>("initialize", {
        capabilities: null,
        clientInfo: {
          name: "astraflow-desktop",
          title: "AstraFlow Desktop",
          version: "0.0.0",
        },
      })

      if (startupTimer) {
        clearTimeout(startupTimer)
        startupTimer = null
      }

      client.sendNotification("initialized")

      const threadStartResponse = await client.sendRequest<{
        thread?: { id?: string }
      }>("thread/start", createThreadStartParams(input, resolvedModel))
      threadId = getNullableString(threadStartResponse.thread?.id)

      if (!threadId) {
        throw new Error("Codex app-server did not return a thread id.")
      }

      queue.push({
        type: "run_meta",
        sessionRef: threadId,
        usage: initializeResponse,
        trace: codexTraceRef({ threadId }),
      })

      const prompt = formatMessagesForCodexPrompt(input.messages).trim()

      if (!prompt) {
        throw new Error("Codex direct runtime received an empty prompt.")
      }

      const turnStartResponse = await client.sendRequest<{
        turn?: { id?: string }
      }>(
        "turn/start",
        createTurnStartParams({
          input,
          prompt,
          resolvedModel,
          threadId,
        })
      )
      turnId = getNullableString(turnStartResponse.turn?.id) ?? turnId

      await completion

      if (!completed) {
        throw new Error("Codex app-server stopped before completing the turn.")
      }

      queue.close()
    } catch (error) {
      if (input.signal.aborted) {
        queue.close()
      } else {
        const stderr = client.getCapturedStderr().trim()
        const message = error instanceof Error ? error.message : String(error)
        queue.push({
          type: "error",
          message: stderr ? `${message}\n${stderr}` : message,
        })
        queue.close()
      }
    } finally {
      if (startupTimer) {
        clearTimeout(startupTimer)
      }

      input.signal.removeEventListener("abort", abort)
      cancelSessionPermissions(input.sessionId)
      cancelSessionUserInputs(input.sessionId)
      client.dispose()
    }
  }

  private async handleServerRequest({
    input,
    queue,
    request,
  }: {
    input: AgentRunInput
    queue: AgentEventQueue
    request: CodexDirectJsonRpcRequest
  }): Promise<unknown> {
    const params = getRecord(request.params) ?? {}

    switch (request.method) {
      case "item/tool/requestUserInput":
        return this.handleUserInputRequest(input, queue, params)
      case "item/commandExecution/requestApproval":
        return this.handleCommandApproval(input, queue, params)
      case "item/fileChange/requestApproval":
        return this.handleFileChangeApproval(input, queue, params)
      case "item/permissions/requestApproval":
        return this.handlePermissionsApproval(input, queue, params)
      case "execCommandApproval":
        return this.handleLegacyCommandApproval(input, queue, params)
      case "applyPatchApproval":
        return this.handleLegacyPatchApproval(input, queue, params)
      default:
        throw new Error(
          `Unsupported Codex app-server request: ${request.method}`
        )
    }
  }

  private async handleUserInputRequest(
    input: AgentRunInput,
    queue: AgentEventQueue,
    params: Record<string, unknown>
  ) {
    const questions = normalizeCodexUserInputQuestions(params.questions)
    const requestId = randomUUID()
    const autoResolutionMs =
      typeof params.autoResolutionMs === "number"
        ? params.autoResolutionMs
        : null
    const trace: AgentTraceRef = {
      runtimeId: CODEX_DIRECT_RUNTIME_ID,
      provider: "codex-app-server",
      threadId: getNullableString(params.threadId) ?? undefined,
      turnId: getNullableString(params.turnId) ?? undefined,
      itemId: getNullableString(params.itemId) ?? undefined,
    }

    if (questions.length === 0) {
      return { answers: {} }
    }

    queue.push(
      userInputRequestEvent({
        autoResolutionMs,
        questions,
        requestId,
        status: "pending",
        trace,
      })
    )

    const decision = await requestUserInput({
      autoResolutionMs,
      questions,
      requestId,
      sessionId: input.sessionId,
      signal: input.signal,
    })

    const answers = "cancelled" in decision ? [] : decision.answers

    queue.push(
      userInputRequestEvent({
        answers,
        autoResolutionMs,
        questions,
        requestId,
        status: "resolved",
        trace,
      })
    )

    return codexUserInputResponse(answers)
  }

  private async handleCommandApproval(
    input: AgentRunInput,
    queue: AgentEventQueue,
    params: Record<string, unknown>
  ) {
    const options = commandApprovalOptions(params)
    const selectedOptionId = await requestCodexDirectPermission({
      input: stringifyPayload({
        command: params.command ?? null,
        cwd: params.cwd ?? null,
        reason: params.reason ?? null,
      }),
      options,
      queue,
      requestId: randomUUID(),
      sessionId: input.sessionId,
      signal: input.signal,
      toolName: "execute",
    })

    return { decision: commandDecisionForOption(selectedOptionId, params) }
  }

  private async handleFileChangeApproval(
    input: AgentRunInput,
    queue: AgentEventQueue,
    params: Record<string, unknown>
  ) {
    const options = fileChangeApprovalOptions()
    const selectedOptionId = await requestCodexDirectPermission({
      input: stringifyPayload({
        itemId: params.itemId ?? null,
        reason: params.reason ?? null,
        grantRoot: params.grantRoot ?? null,
      }),
      options,
      queue,
      requestId: randomUUID(),
      sessionId: input.sessionId,
      signal: input.signal,
      toolName: "edit",
    })

    return { decision: fileChangeDecisionForOption(selectedOptionId) }
  }

  private async handlePermissionsApproval(
    input: AgentRunInput,
    queue: AgentEventQueue,
    params: Record<string, unknown>
  ) {
    const options: PermissionOption[] = [
      {
        optionId: "allow_session",
        name: "Allow for Session",
        kind: "allow_always",
      },
      { optionId: "allow_turn", name: "Allow Once", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ]
    const selectedOptionId = await requestCodexDirectPermission({
      input: stringifyPayload({
        cwd: params.cwd ?? null,
        permissions: params.permissions ?? null,
        reason: params.reason ?? null,
      }),
      options,
      queue,
      requestId: randomUUID(),
      sessionId: input.sessionId,
      signal: input.signal,
      toolName: "permissions",
    })

    if (
      selectedOptionId === "allow_session" ||
      selectedOptionId === "allow_turn"
    ) {
      return {
        permissions: grantedPermissionsFromRequest(params.permissions),
        scope: selectedOptionId === "allow_session" ? "session" : "turn",
        strictAutoReview: false,
      }
    }

    return {
      permissions: {},
      scope: "turn",
      strictAutoReview: true,
    }
  }

  private async handleLegacyCommandApproval(
    input: AgentRunInput,
    queue: AgentEventQueue,
    params: Record<string, unknown>
  ) {
    const options = fileChangeApprovalOptions()
    const selectedOptionId = await requestCodexDirectPermission({
      input: stringifyPayload({
        command: params.command ?? null,
        cwd: params.cwd ?? null,
        reason: params.reason ?? null,
      }),
      options,
      queue,
      requestId: randomUUID(),
      sessionId: input.sessionId,
      signal: input.signal,
      toolName: "execute",
    })

    return { decision: legacyReviewDecisionForOption(selectedOptionId) }
  }

  private async handleLegacyPatchApproval(
    input: AgentRunInput,
    queue: AgentEventQueue,
    params: Record<string, unknown>
  ) {
    const options = fileChangeApprovalOptions()
    const selectedOptionId = await requestCodexDirectPermission({
      input: stringifyPayload({
        fileChanges: params.fileChanges ?? null,
        grantRoot: params.grantRoot ?? null,
        reason: params.reason ?? null,
      }),
      options,
      queue,
      requestId: randomUUID(),
      sessionId: input.sessionId,
      signal: input.signal,
      toolName: "edit",
    })

    return { decision: legacyReviewDecisionForOption(selectedOptionId) }
  }
}

export function createCodexDirectRuntime() {
  return new CodexDirectRuntime()
}

export function registerCodexDirectRuntime() {
  registerAgentRuntime(createCodexDirectRuntime())
}

registerCodexDirectRuntime()
