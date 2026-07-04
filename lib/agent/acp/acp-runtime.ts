import {
  client as createAcpClient,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ActiveSession,
  type ClientConnection,
  type ContentBlock,
  type InitializeResponse,
  type SessionUpdate,
} from "@agentclientprotocol/sdk"
import type { BaseMessage } from "@langchain/core/messages"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { Readable, Writable } from "node:stream"

import type { AgentEvent } from "@/lib/agent/events"
import {
  requestPermission,
  type PermissionOption,
} from "@/lib/agent/permission-broker"
import type {
  AgentRunInput,
  AgentRuntime,
  AgentRuntimeInfo,
} from "@/lib/agent/runtime"
import { ensureAcpWorkspace } from "@/lib/agent/acp/workspace"

export type AcpCommandSpec = {
  command: string
  args?: string[]
  env?: Record<string, string | undefined>
}

export type AcpRuntimeOptions = {
  info: AgentRuntimeInfo
  resolveCommand: () => AcpCommandSpec | null
}

type AcpSessionState = {
  acpSessionId: string
  activeSession: ActiveSession
  child: ChildProcessWithoutNullStreams
  command: AcpCommandSpec
  connection: ClientConnection
  idleTimer: NodeJS.Timeout | null
  key: string
  queue: AgentEventQueue | null
  runSignal: AbortSignal | null
  stderr: string
  toolNames: Map<string, string>
  workspace: string
}

class AcpStartupError extends Error {
  readonly stderr: string

  constructor(error: unknown, stderr: string) {
    super(errorMessage(error))
    this.name = "AcpStartupError"
    this.cause = error
    this.stderr = stderr
  }
}

const ACP_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const ACP_STARTUP_TIMEOUT_MS = 20 * 1000
const ACP_ABORT_KILL_TIMEOUT_MS = 5 * 1000
const MAX_CAPTURED_STDERR_LENGTH = 4000
const ASTRAFLOW_ACP_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"
const ACP_SESSION_KEY_SEPARATOR = "\u0000"

const acpSessions = new Map<string, AcpSessionState>()

class AgentEventQueue implements AsyncIterable<AgentEvent> {
  private events: AgentEvent[] = []
  private closed = false
  private waiters: Array<() => void> = []

  push(event: AgentEvent) {
    if (this.closed) {
      return
    }

    this.events.push(event)
    this.notify()
  }

  close() {
    if (this.closed) {
      return
    }

    this.closed = true
    this.notify()
  }

  private notify() {
    const waiters = this.waiters
    this.waiters = []

    for (const waiter of waiters) {
      waiter()
    }
  }

  private wait() {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const event = this.events.shift()

      if (event) {
        yield event
        continue
      }

      if (this.closed) {
        return
      }

      await this.wait()
    }
  }
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
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

function truncateForPrompt(text: string, maxLength = 500) {
  const cleaned = text.replace(/\s+/g, " ").trim()

  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}...`
    : cleaned
}

function debugAcp(label: string, payload: Record<string, unknown>) {
  if (!ASTRAFLOW_ACP_DEBUG) {
    return
  }

  console.debug(`[studio-chat:acp] ${label}`, payload)
}

function getSessionKey(
  runtimeId: string,
  sessionId: string,
  workspace: string
) {
  return [runtimeId, sessionId, workspace].join(ACP_SESSION_KEY_SEPARATOR)
}

function isRuntimeSessionKey(
  key: string,
  runtimeId: string,
  sessionId: string
) {
  return key.startsWith(
    [runtimeId, sessionId, ""].join(ACP_SESSION_KEY_SEPARATOR)
  )
}

function getAcpWorkspace(input: AgentRunInput) {
  const projectPath = input.projectPath?.trim()

  return projectPath
    ? resolve(projectPath)
    : ensureAcpWorkspace(input.sessionId)
}

function commandToString(command: AcpCommandSpec) {
  return [command.command, ...(command.args ?? [])].join(" ")
}

function isAbortLikeError(error: unknown, signal?: AbortSignal) {
  const record = getRecord(error)
  const name = typeof record?.name === "string" ? record.name : ""
  const message = error instanceof Error ? error.message : String(error)

  return (
    Boolean(signal?.aborted) ||
    name === "AbortError" ||
    message.includes("aborted") ||
    message.includes("cancelled") ||
    message.includes("Active session disposed") ||
    message.includes("ACP connection closed")
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function createStartupErrorMessage({
  command,
  error,
  info,
  stderr,
}: {
  command: AcpCommandSpec
  error: unknown
  info: AgentRuntimeInfo
  stderr?: string
}) {
  const capturedStderr =
    stderr ??
    (error instanceof AcpStartupError && error.stderr
      ? error.stderr
      : undefined)
  const stderrText = capturedStderr?.trim()

  return [
    `${info.label} ACP failed to start (${commandToString(command)}): ${errorMessage(error)}`,
    stderrText ? `stderr: ${stderrText}` : null,
    "Check that the ACP binary exists, is executable, and its package or local CLI installation is intact.",
  ]
    .filter(Boolean)
    .join("\n")
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: NodeJS.Timeout | null = null

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref()
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

async function resolveSafeReadPath(workspace: string, rawPath: string) {
  const workspaceRealPath = await realpath(workspace)
  const targetPath = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(workspaceRealPath, rawPath)
  const targetRealPath = await realpath(targetPath)

  assertPathInsideWorkspace(workspaceRealPath, targetRealPath)

  return targetRealPath
}

async function resolveSafeWritePath(workspace: string, rawPath: string) {
  const workspaceRealPath = await realpath(workspace)
  const targetPath = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(workspaceRealPath, rawPath)
  const parentPath = dirname(targetPath)

  await mkdir(parentPath, { recursive: true })

  const parentRealPath = await realpath(parentPath)

  assertPathInsideWorkspace(workspaceRealPath, parentRealPath)

  return resolve(parentRealPath, targetPath.split(/[\\/]/).at(-1) ?? "file")
}

function assertPathInsideWorkspace(workspace: string, target: string) {
  const pathFromWorkspace = relative(workspace, target)

  if (
    pathFromWorkspace === "" ||
    (!pathFromWorkspace.startsWith("..") && !isAbsolute(pathFromWorkspace))
  ) {
    return
  }

  throw new Error("ACP file access is limited to this session workspace.")
}

function applyLineWindow(
  content: string,
  line?: number | null,
  limit?: number | null
) {
  if (!line && !limit) {
    return content
  }

  const lines = content.split(/\r?\n/)
  const start = Math.max((line ?? 1) - 1, 0)
  const end = limit ? start + Math.max(limit, 0) : undefined

  return lines.slice(start, end).join("\n")
}

export function createAcpClientApp({
  debugLabel,
  emitEvent,
  getSignal,
  sessionId,
  workspace,
}: {
  debugLabel: string
  emitEvent?: (event: AgentEvent) => void
  getSignal: () => AbortSignal
  sessionId: string
  workspace: string
}) {
  return createAcpClient({ name: "AstraFlow Desktop" })
    .onRequest(methods.client.fs.readTextFile, async ({ params }) => {
      const safePath = await resolveSafeReadPath(workspace, params.path)
      const content = await readFile(safePath, "utf8")

      return {
        content: applyLineWindow(content, params.line, params.limit),
      }
    })
    .onRequest(methods.client.fs.writeTextFile, async ({ params }) => {
      const safePath = await resolveSafeWritePath(workspace, params.path)

      await writeFile(safePath, params.content, "utf8")
    })
    .onRequest(
      methods.client.session.requestPermission,
      async ({ params }) => {
        const permissionRequestId = randomUUID()
        const options: PermissionOption[] = params.options.map((option) => ({
          optionId: option.optionId,
          name: option.name,
          kind: option.kind,
        }))
        const toolCall = params.toolCall
        const toolName = toolCall.kind ?? toolCall.title ?? "tool"
        const input = stringifyPayload(toolCall.rawInput ?? toolCall)

        emitEvent?.({
          type: "permission_request",
          requestId: permissionRequestId,
          toolName,
          input,
          options,
          status: "pending",
          selectedOptionId: null,
          decisions: [],
        })

        const decision = await requestPermission({
          sessionId,
          requestId: permissionRequestId,
          toolName,
          inputPreview: input,
          options,
          signal: getSignal(),
        })

        if ("cancelled" in decision) {
          emitEvent?.({
            type: "permission_request",
            requestId: permissionRequestId,
            toolName,
            input,
            options,
            status: "resolved",
            selectedOptionId: null,
            decisions: ["cancelled"],
          })

          return {
            outcome: { outcome: "cancelled" as const },
          }
        }

        const option = options.find(
          (candidate) => candidate.optionId === decision.optionId
        )

        debugAcp("permission_auto_selected", {
          debugLabel,
          optionId: decision.optionId,
          optionKind: option?.kind,
          sessionId: params.sessionId,
        })

        emitEvent?.({
          type: "permission_request",
          requestId: permissionRequestId,
          toolName,
          input,
          options,
          status: "resolved",
          selectedOptionId: decision.optionId,
          decisions: [option?.name || decision.optionId],
        })

        return {
          outcome: {
            outcome: "selected" as const,
            optionId: decision.optionId,
          },
        }
      }
    )
}

export function spawnAcpChild(
  command: AcpCommandSpec,
  cwd: string
): ChildProcessWithoutNullStreams {
  return spawn(command.command, command.args ?? [], {
    cwd,
    env: {
      ...process.env,
      ...(command.env ?? {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
}

export function createAcpProcessStream(child: ChildProcessWithoutNullStreams) {
  return ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  )
}

export async function initializeAcpConnection(
  connection: ClientConnection
): Promise<InitializeResponse> {
  return connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
      plan: {},
      terminal: false,
    },
    clientInfo: {
      name: "AstraFlow Desktop",
      version: "0.0.11",
    },
  })
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

function parseImageDataUrl(url: string) {
  const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/)

  if (!match) {
    return null
  }

  return {
    mimeType: match[1] || "image/png",
    data: match[2] || "",
  }
}

function contentPartToBlocks(part: unknown): ContentBlock[] {
  if (typeof part === "string") {
    return part ? [{ type: "text", text: part }] : []
  }

  const record = getRecord(part)

  if (!record) {
    return []
  }

  if (record.type === "text" && typeof record.text === "string") {
    return record.text ? [{ type: "text", text: record.text }] : []
  }

  if (record.type === "image_url") {
    const imageUrl = getRecord(record.image_url)
    const url =
      typeof record.image_url === "string"
        ? record.image_url
        : typeof imageUrl?.url === "string"
          ? imageUrl.url
          : null

    if (!url) {
      return []
    }

    const image = parseImageDataUrl(url)

    if (image) {
      return [{ type: "image", data: image.data, mimeType: image.mimeType }]
    }

    return [
      {
        type: "resource_link",
        name: "image",
        uri: url,
      },
    ]
  }

  return [{ type: "text", text: stringifyPayload(record) }]
}

function messageContentToBlocks(content: BaseMessage["content"]) {
  if (typeof content === "string") {
    return content
      ? [{ type: "text", text: content } satisfies ContentBlock]
      : []
  }

  if (Array.isArray(content)) {
    return content.flatMap(contentPartToBlocks)
  }

  return [
    { type: "text", text: stringifyPayload(content) } satisfies ContentBlock,
  ]
}

function getMessageType(message: BaseMessage) {
  const typedMessage = message as { _getType?: () => string }

  return typedMessage._getType?.() ?? "message"
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

function createConversationRecap(
  messages: BaseMessage[],
  latestUserIndex: number
) {
  const priorMessages = messages
    .slice(Math.max(0, latestUserIndex - 6), latestUserIndex)
    .map((message) => {
      const text = truncateForPrompt(messageContentToText(message.content))

      return text ? `- ${roleLabelForMessage(message)}: ${text}` : null
    })
    .filter(Boolean)

  if (!priorMessages.length) {
    return null
  }

  return [
    "Conversation recap before reconnecting the external ACP agent:",
    ...priorMessages,
  ].join("\n")
}

function createPromptBlocks(
  messages: BaseMessage[],
  shouldIncludeRecap: boolean
) {
  const latestUserMessage = getLatestUserMessage(messages)

  if (!latestUserMessage) {
    return [{ type: "text", text: "" } satisfies ContentBlock]
  }

  const blocks = messageContentToBlocks(latestUserMessage.message.content)

  if (!shouldIncludeRecap) {
    return blocks.length
      ? blocks
      : [{ type: "text", text: "" } satisfies ContentBlock]
  }

  const recap = createConversationRecap(messages, latestUserMessage.index)

  if (!recap) {
    return blocks.length
      ? blocks
      : [{ type: "text", text: "" } satisfies ContentBlock]
  }

  return [
    {
      type: "text",
      text: `${recap}\n\nLatest user message:`,
    } satisfies ContentBlock,
    ...(blocks.length
      ? blocks
      : [{ type: "text", text: "" } satisfies ContentBlock]),
  ]
}

function getContentText(content: unknown) {
  const record = getRecord(content)

  return record?.type === "text" && typeof record.text === "string"
    ? record.text
    : null
}

function getToolName(
  update: {
    kind?: string | null
    title?: string | null
    toolCallId: string
  },
  state: AcpSessionState
) {
  return (
    update.kind ??
    update.title ??
    state.toolNames.get(update.toolCallId) ??
    "tool"
  )
}

function toolOutputToString(update: {
  content?: unknown
  rawOutput?: unknown
}) {
  if (update.rawOutput !== undefined) {
    return stringifyPayload(update.rawOutput)
  }

  return stringifyPayload(update.content)
}

function normalizePlanStatus(status: unknown) {
  return status === "in_progress" || status === "completed" ? status : "pending"
}

function planEntriesToEvent(entries: unknown): AgentEvent | null {
  if (!Array.isArray(entries)) {
    return null
  }

  return {
    type: "plan_update",
    todos: entries
      .map((entry) => {
        const record = getRecord(entry)
        const text = typeof record?.content === "string" ? record.content : ""

        return text
          ? {
              text,
              status: normalizePlanStatus(record?.status),
            }
          : null
      })
      .filter(
        (
          todo
        ): todo is Extract<
          AgentEvent,
          { type: "plan_update" }
        >["todos"][number] => Boolean(todo)
      ),
  }
}

function mapAcpSessionUpdate(
  update: SessionUpdate,
  state: AcpSessionState
): AgentEvent[] {
  if (update.sessionUpdate === "agent_message_chunk") {
    const delta = getContentText(update.content)

    return delta ? [{ type: "text_delta", delta }] : []
  }

  if (update.sessionUpdate === "agent_thought_chunk") {
    const delta = getContentText(update.content)

    return delta ? [{ type: "reasoning_delta", delta }] : []
  }

  if (update.sessionUpdate === "tool_call") {
    const name = getToolName(update, state)

    state.toolNames.set(update.toolCallId, name)

    return [
      {
        type: "tool_call",
        id: update.toolCallId,
        name,
        input: stringifyPayload(update.rawInput),
      },
    ]
  }

  if (update.sessionUpdate === "tool_call_update") {
    const name = getToolName(update, state)

    if (update.kind || update.title) {
      state.toolNames.set(update.toolCallId, name)
    }

    if (update.status === "completed") {
      return [
        {
          type: "tool_result",
          id: update.toolCallId,
          name,
          status: "complete",
          output: toolOutputToString(update),
        },
      ]
    }

    if (update.status === "failed") {
      return [
        {
          type: "tool_result",
          id: update.toolCallId,
          name,
          status: "error",
          error: toolOutputToString(update) || "Tool call failed.",
        },
      ]
    }

    return []
  }

  if (update.sessionUpdate === "plan") {
    const event = planEntriesToEvent(update.entries)

    return event ? [event] : []
  }

  if (update.sessionUpdate === "plan_update" && update.plan.type === "items") {
    const event = planEntriesToEvent(update.plan.entries)

    return event ? [event] : []
  }

  debugAcp("unknown_session_update_ignored", {
    sessionUpdate: update.sessionUpdate,
  })

  return []
}

function disposeAcpSession(
  key: string,
  state: AcpSessionState,
  reason: string
) {
  if (acpSessions.get(key) !== state) {
    return
  }

  acpSessions.delete(key)

  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
    state.idleTimer = null
  }

  debugAcp("session_dispose", {
    key,
    reason,
    acpSessionId: state.acpSessionId,
  })

  state.activeSession.dispose()
  state.connection.close(new Error(reason))

  if (state.child.exitCode === null && !state.child.killed) {
    state.child.kill("SIGTERM")

    const killTimer = setTimeout(() => {
      if (state.child.exitCode === null && !state.child.killed) {
        state.child.kill("SIGKILL")
      }
    }, 2000)

    killTimer.unref()
  }
}

function scheduleAcpSessionIdleCleanup(state: AcpSessionState) {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
  }

  state.idleTimer = setTimeout(() => {
    disposeAcpSession(state.key, state, "ACP session idle timeout")
  }, ACP_IDLE_TIMEOUT_MS)
  state.idleTimer.unref()
}

function clearAcpSessionIdleCleanup(state: AcpSessionState) {
  if (!state.idleTimer) {
    return
  }

  clearTimeout(state.idleTimer)
  state.idleTimer = null
}

async function createAcpSession({
  command,
  info,
  key,
  sessionId,
  workspace,
}: {
  command: AcpCommandSpec
  info: AgentRuntimeInfo
  key: string
  sessionId: string
  workspace: string
}) {
  const child = spawnAcpChild(command, workspace)
  let state: AcpSessionState | null = null
  let capturedStderr = ""
  const fallbackAbortController = new AbortController()
  const stream = createAcpProcessStream(child)
  const app = createAcpClientApp({
    debugLabel: info.id,
    getSignal: () => state?.runSignal ?? fallbackAbortController.signal,
    sessionId,
    workspace,
    emitEvent: (event) => {
      state?.queue?.push(event)
    },
  })
  const connection = app.connect(stream)
  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", reject)
  })

  child.stderr.on("data", (chunk: Buffer) => {
    capturedStderr = `${capturedStderr}${chunk.toString("utf8")}`

    if (capturedStderr.length > MAX_CAPTURED_STDERR_LENGTH) {
      capturedStderr = capturedStderr.slice(-MAX_CAPTURED_STDERR_LENGTH)
    }

    if (state) {
      state.stderr = capturedStderr
    }

    debugAcp("stderr", {
      runtimeId: info.id,
      text: chunk.toString("utf8").trim(),
    })
  })

  try {
    await withTimeout(
      Promise.race([initializeAcpConnection(connection), spawnError]),
      ACP_STARTUP_TIMEOUT_MS,
      `${info.label} ACP initialize`
    )

    const activeSession = await withTimeout(
      Promise.race([
        connection.agent
          .buildSession({
            cwd: workspace,
            mcpServers: [],
          })
          .start(),
        spawnError,
      ]),
      ACP_STARTUP_TIMEOUT_MS,
      `${info.label} ACP session/new`
    )

    state = {
      acpSessionId: activeSession.sessionId,
      activeSession,
      child,
      command,
      connection,
      idleTimer: null,
      key,
      queue: null,
      runSignal: null,
      stderr: capturedStderr,
      toolNames: new Map(),
      workspace,
    }

    child.once("exit", (code, signal) => {
      if (!state) {
        return
      }

      debugAcp("process_exit", {
        runtimeId: info.id,
        code,
        signal,
      })
      disposeAcpSession(key, state, "ACP process exited")
    })

    connection.closed
      .then(() => {
        if (state) {
          disposeAcpSession(key, state, "ACP connection closed")
        }
      })
      .catch(() => {
        if (state) {
          disposeAcpSession(key, state, "ACP connection closed")
        }
      })

    acpSessions.set(key, state)

    return state
  } catch (error) {
    connection.close(error)

    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM")
    }

    throw new AcpStartupError(error, capturedStderr)
  }
}

async function getOrCreateAcpSession({
  command,
  info,
  sessionId,
  workspace,
}: {
  command: AcpCommandSpec
  info: AgentRuntimeInfo
  sessionId: string
  workspace: string
}) {
  const key = getSessionKey(info.id, sessionId, workspace)
  const existing = acpSessions.get(key)

  for (const [candidateKey, candidate] of acpSessions) {
    if (
      candidateKey !== key &&
      isRuntimeSessionKey(candidateKey, info.id, sessionId)
    ) {
      disposeAcpSession(candidateKey, candidate, "ACP cwd changed")
    }
  }

  if (existing && !existing.connection.signal.aborted) {
    clearAcpSessionIdleCleanup(existing)

    return {
      state: existing,
      shouldIncludeRecap: false,
    }
  }

  if (existing) {
    disposeAcpSession(key, existing, "ACP session stale")
  }

  return {
    state: await createAcpSession({
      command,
      info,
      key,
      sessionId,
      workspace,
    }),
    shouldIncludeRecap: true,
  }
}

function installAbortHandler({
  signal,
  state,
}: {
  signal: AbortSignal
  state: AcpSessionState
}) {
  let killTimer: NodeJS.Timeout | null = null
  const abort = () => {
    void state.connection.agent
      .notify(methods.agent.session.cancel, {
        sessionId: state.acpSessionId,
      })
      .catch((error) => {
        debugAcp("cancel_failed", {
          acpSessionId: state.acpSessionId,
          error: errorMessage(error),
        })
      })

    killTimer = setTimeout(() => {
      disposeAcpSession(state.key, state, "ACP abort timeout")
    }, ACP_ABORT_KILL_TIMEOUT_MS)
    killTimer.unref()
  }

  if (signal.aborted) {
    abort()
  } else {
    signal.addEventListener("abort", abort, { once: true })
  }

  return () => {
    signal.removeEventListener("abort", abort)

    if (killTimer) {
      clearTimeout(killTimer)
    }
  }
}

async function pumpAcpPrompt({
  input,
  queue,
  shouldIncludeRecap,
  state,
}: {
  input: AgentRunInput
  queue: AgentEventQueue
  shouldIncludeRecap: boolean
    state: AcpSessionState
}) {
  state.runSignal = input.signal
  const cleanupAbortHandler = installAbortHandler({
    signal: input.signal,
    state,
  })

  try {
    const promptResponse = state.activeSession.prompt(
      createPromptBlocks(input.messages, shouldIncludeRecap)
    )

    promptResponse.catch(() => undefined)

    for (;;) {
      const message = await state.activeSession.nextUpdate()

      if (message.kind === "stop") {
        queue.push({
          type: "run_meta",
          sessionRef: state.acpSessionId,
          ...(message.response.usage ? { usage: message.response.usage } : {}),
        })
        break
      }

      for (const event of mapAcpSessionUpdate(message.update, state)) {
        queue.push(event)
      }
    }

    await promptResponse
  } catch (error) {
    if (!isAbortLikeError(error, input.signal)) {
      queue.push({
        type: "error",
        message: errorMessage(error),
      })
    }
  } finally {
    cleanupAbortHandler()
    if (state.runSignal === input.signal) {
      state.runSignal = null
    }
    queue.close()
  }
}

async function* streamAcpRun(
  options: AcpRuntimeOptions,
  input: AgentRunInput
): AsyncGenerator<AgentEvent> {
  const command = options.resolveCommand()

  if (!command) {
    yield {
      type: "error",
      message: `${options.info.label} ACP runtime is not available on this machine. Install the required ACP adapter or local CLI and restart AstraFlow.`,
    }
    return
  }

  let state: AcpSessionState
  let shouldIncludeRecap = false
  const workspace = getAcpWorkspace(input)

  try {
    const session = await getOrCreateAcpSession({
      command,
      info: options.info,
      sessionId: input.sessionId,
      workspace,
    })

    state = session.state
    shouldIncludeRecap = session.shouldIncludeRecap
  } catch (error) {
    yield {
      type: "error",
      message: createStartupErrorMessage({
        command,
        error,
        info: options.info,
      }),
    }
    return
  }

  const queue = new AgentEventQueue()

  state.queue = queue

  const pump = pumpAcpPrompt({
    input,
    queue,
    shouldIncludeRecap,
    state,
  }).finally(() => {
    if (state.queue === queue) {
      state.queue = null
    }

    if (
      acpSessions.get(state.key) === state &&
      !state.connection.signal.aborted
    ) {
      scheduleAcpSessionIdleCleanup(state)
    }
  })

  try {
    for await (const event of queue) {
      yield event
    }
  } finally {
    await pump
  }
}

export class AcpRuntime implements AgentRuntime {
  readonly info: AgentRuntimeInfo
  private readonly resolveCommand: () => AcpCommandSpec | null

  constructor(options: AcpRuntimeOptions) {
    this.info = options.info
    this.resolveCommand = options.resolveCommand
  }

  startRun(input: AgentRunInput): AsyncIterable<AgentEvent> {
    return streamAcpRun(
      {
        info: this.info,
        resolveCommand: this.resolveCommand,
      },
      input
    )
  }
}
