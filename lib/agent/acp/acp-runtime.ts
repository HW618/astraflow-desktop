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
import { createHttpStream } from "@agentclientprotocol/sdk/experimental/http-client"
import type { BaseMessage } from "@langchain/core/messages"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { Readable, Writable } from "node:stream"

import type { AgentEvent } from "@/lib/agent/events"
import {
  cancelSessionPermissions,
  requestPermission,
  type PermissionOption,
} from "@/lib/agent/permission-broker"
import type {
  AgentRunInput,
  AgentRuntime,
  AgentRuntimeInfo,
} from "@/lib/agent/runtime"
import { ensureAcpWorkspace } from "@/lib/agent/acp/workspace"

export type AcpStdioCommandSpec = {
  transport?: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string | undefined>
}

export type AcpHttpCommandSpec = {
  transport: "http"
  url: string
  headers?: Record<string, string>
}

export type AcpCommandSpec = AcpStdioCommandSpec | AcpHttpCommandSpec

export type AcpAuthenticationSpec = {
  methodId: string
  _meta?: Record<string, unknown>
}

export type AcpMcpKeyValue = {
  name: string
  value: string
  _meta?: Record<string, unknown> | null
}

export type AcpMcpServer =
  | {
      name: string
      command: string
      args: string[]
      env: AcpMcpKeyValue[]
      _meta?: Record<string, unknown> | null
    }
  | {
      name: string
      type: "http" | "sse"
      url: string
      headers: AcpMcpKeyValue[]
      _meta?: Record<string, unknown> | null
    }

export type AcpSessionPlugins = {
  mcpServers: AcpMcpServer[]
  promptPreamble: string | null
}

export type AcpRuntimeOptions = {
  info: AgentRuntimeInfo
  resolveAuthentication?: (input: AgentRunInput) => AcpAuthenticationSpec | null
  resolveCommand: (input: AgentRunInput) => AcpCommandSpec | null
  resolveSessionPlugins?: (input: AgentRunInput) => AcpSessionPlugins | null
  resolveSessionMeta?: (input: AgentRunInput) => Record<string, unknown> | null
  resolveSessionKey?: (input: AgentRunInput) => string | null
}

type AcpSessionState = {
  acpSessionId: string
  activeSession: ActiveSession
  child: ChildProcessWithoutNullStreams | null
  command: AcpCommandSpec
  connection: ClientConnection
  disposed: boolean
  idleTimer: NodeJS.Timeout | null
  key: string
  mcpServers: AcpMcpServer[]
  queue: AgentEventQueue | null
  runTail: Promise<void>
  runSignal: AbortSignal | null
  stderr: string
  sessionKey: string
  sessionMeta: Record<string, unknown> | null
  toolCallIds: Set<string>
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
const ACP_TERMINATE_KILL_TIMEOUT_MS = 2 * 1000
const MAX_CAPTURED_STDERR_LENGTH = 4000
const ASTRAFLOW_ACP_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"
const ACP_SESSION_KEY_SEPARATOR = "\u0000"
const ACP_SAFE_WRITE_FLAGS =
  fsConstants.O_WRONLY |
  fsConstants.O_CREAT |
  fsConstants.O_TRUNC |
  (fsConstants.O_NOFOLLOW ?? 0)

type AcpRuntimeGlobalState = {
  children: Set<ChildProcessWithoutNullStreams>
  cleanupHooksInstalled: boolean
  sessions: Map<string, AcpSessionState>
  startups: Map<string, Promise<AcpSessionState>>
}

const ACP_GLOBAL_STATE_KEY = Symbol.for("astraflow.acp.runtimeState")
const acpRuntimeGlobal = globalThis as typeof globalThis &
  Record<symbol, AcpRuntimeGlobalState | undefined>
const acpGlobalState =
  acpRuntimeGlobal[ACP_GLOBAL_STATE_KEY] ??
  (acpRuntimeGlobal[ACP_GLOBAL_STATE_KEY] = {
    children: new Set(),
    cleanupHooksInstalled: false,
    sessions: new Map(),
    startups: new Map(),
  })

const acpChildren = acpGlobalState.children
const acpSessions = acpGlobalState.sessions
const acpSessionStartups = acpGlobalState.startups

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

function fingerprintSessionPlugins(plugins: AcpSessionPlugins) {
  if (!plugins.mcpServers.length && !plugins.promptPreamble) {
    return null
  }

  return createHash("sha256")
    .update(JSON.stringify(plugins))
    .digest("hex")
    .slice(0, 16)
}

function getSessionKey(
  runtimeId: string,
  sessionId: string,
  workspace: string,
  modelKey: string | null,
  pluginKey: string | null
) {
  return [runtimeId, sessionId, workspace, modelKey ?? "", pluginKey ?? ""].join(
    ACP_SESSION_KEY_SEPARATOR
  )
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
  if (command.transport === "http") {
    return command.url
  }

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
  const message = error instanceof Error ? error.message : String(error)
  const record = getRecord(error)
  const data = getRecord(record?.data)
  const detail =
    typeof data?.details === "string"
      ? data.details.trim()
      : typeof record?.details === "string"
        ? record.details.trim()
        : ""

  return detail && detail !== message ? `${message}: ${detail}` : message
}

function createAbortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"

  return error
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

function isNotFoundError(error: unknown) {
  return getRecord(error)?.code === "ENOENT"
}

async function findExistingAncestor(path: string) {
  let candidate = path
  let lastError: unknown = null

  for (;;) {
    try {
      await lstat(candidate)

      return candidate
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error
      }

      lastError = error
    }

    const parent = dirname(candidate)

    if (parent === candidate) {
      throw lastError ?? new Error("No existing path ancestor found.")
    }

    candidate = parent
  }
}

async function resolveSafeWriteParent(
  workspaceRealPath: string,
  parentPath: string
) {
  assertPathInsideWorkspace(workspaceRealPath, parentPath)

  const existingAncestor = await findExistingAncestor(parentPath)
  const existingAncestorRealPath = await realpath(
    /* turbopackIgnore: true */ existingAncestor
  )

  assertPathInsideWorkspace(workspaceRealPath, existingAncestorRealPath)

  await mkdir(parentPath, { recursive: true })

  const parentRealPath = await realpath(parentPath)

  assertPathInsideWorkspace(workspaceRealPath, parentRealPath)

  return parentRealPath
}

async function assertSafeExistingWriteTarget(
  workspaceRealPath: string,
  targetPath: string
) {
  try {
    await lstat(targetPath)
  } catch (error) {
    if (isNotFoundError(error)) {
      return
    }

    throw error
  }

  const targetRealPath = await realpath(targetPath)

  assertPathInsideWorkspace(workspaceRealPath, targetRealPath)
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
  const parentRealPath = await resolveSafeWriteParent(
    workspaceRealPath,
    parentPath
  )
  const safePath = resolve(parentRealPath, basename(targetPath))

  await assertSafeExistingWriteTarget(workspaceRealPath, safePath)

  return safePath
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

async function getSafeWriteChange(
  workspace: string,
  safePath: string,
  nextContent: string
): Promise<Extract<AgentEvent, { type: "file_change" }> | null> {
  let previousContent: string | null = null

  try {
    previousContent = await readFile(safePath, "utf8")
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  if (previousContent === nextContent) {
    return null
  }

  const workspaceRealPath = await realpath(workspace)
  const pathFromWorkspace = relative(workspaceRealPath, safePath)
  const displayPath =
    pathFromWorkspace &&
    !pathFromWorkspace.startsWith("..") &&
    !isAbsolute(pathFromWorkspace)
      ? pathFromWorkspace
      : safePath

  return {
    type: "file_change",
    path: displayPath,
    kind: previousContent === null ? "create" : "edit",
  }
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
      const fileChange = await getSafeWriteChange(
        workspace,
        safePath,
        params.content
      )

      await writeFile(safePath, params.content, {
        encoding: "utf8",
        flag: ACP_SAFE_WRITE_FLAGS,
      })

      if (fileChange) {
        emitEvent?.(fileChange)
        debugAcp("fs_write_text_file", {
          debugLabel,
          kind: fileChange.kind,
          path: fileChange.path,
          sessionId: params.sessionId,
        })
      }
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
          decisions: [decision.feedback || option?.name || decision.optionId],
        })

        return {
          outcome: {
            outcome: "selected" as const,
            optionId: decision.optionId,
            ...(decision.feedback
              ? { _meta: { astraflowFeedback: decision.feedback } }
              : {}),
          },
        }
      }
    )
}

export function spawnAcpChild(
  command: AcpStdioCommandSpec,
  cwd: string
): ChildProcessWithoutNullStreams {
  const child = spawn(command.command, command.args ?? [], {
    cwd,
    env: {
      ...process.env,
      ...(command.env ?? {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  })

  acpChildren.add(child)
  child.once("exit", () => {
    acpChildren.delete(child)
  })

  return child
}

export function createAcpProcessStream(child: ChildProcessWithoutNullStreams) {
  return ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  )
}

function createAcpCommandStream(
  command: AcpCommandSpec,
  cwd: string
): {
  child: ChildProcessWithoutNullStreams | null
  spawnError: Promise<never>
  stream: ReturnType<typeof ndJsonStream>
} {
  if (command.transport === "http") {
    return {
      child: null,
      spawnError: new Promise<never>(() => undefined),
      stream: createHttpStream(command.url, {
        headers: command.headers,
      }) as ReturnType<typeof ndJsonStream>,
    }
  }

  const child = spawnAcpChild(command, cwd)

  return {
    child,
    spawnError: new Promise<never>((_, reject) => {
      child.once("error", reject)
    }),
    stream: createAcpProcessStream(child),
  }
}

export async function initializeAcpConnection(
  connection: ClientConnection
): Promise<InitializeResponse> {
  return connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      auth: {
        terminal: false,
        _meta: {
          gateway: true,
        },
      },
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
  shouldIncludeRecap: boolean,
  promptPreamble: string | null
) {
  const latestUserMessage = getLatestUserMessage(messages)
  const preambleBlocks = promptPreamble
    ? [{ type: "text", text: promptPreamble } satisfies ContentBlock]
    : []

  if (!latestUserMessage) {
    return preambleBlocks.length
      ? preambleBlocks
      : [{ type: "text", text: "" } satisfies ContentBlock]
  }

  const blocks = messageContentToBlocks(latestUserMessage.message.content)
  const latestBlocks = blocks.length
    ? blocks
    : [{ type: "text", text: "" } satisfies ContentBlock]

  if (!shouldIncludeRecap) {
    return [...preambleBlocks, ...latestBlocks]
  }

  const recap = createConversationRecap(messages, latestUserMessage.index)

  if (!recap) {
    return [...preambleBlocks, ...latestBlocks]
  }

  return [
    ...preambleBlocks,
    {
      type: "text",
      text: `${recap}\n\nLatest user message:`,
    } satisfies ContentBlock,
    ...latestBlocks,
  ]
}

function getContentText(content: unknown) {
  const record = getRecord(content)

  return record?.type === "text" && typeof record.text === "string"
    ? record.text
    : null
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

function getToolName(
  update: {
    kind?: string | null
    title?: string | null
    toolCallId: string
  },
  state: AcpSessionState
) {
  const existing = state.toolNames.get(update.toolCallId)

  if (existing && existing !== "tool") {
    return existing
  }

  const candidate =
    update.kind && update.kind !== "other"
      ? update.kind
      : update.title?.trim() || update.kind || existing || "tool"

  state.toolNames.set(update.toolCallId, candidate)

  return candidate
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

function toolInputToString(update: {
  content?: unknown
  kind?: string | null
  locations?: unknown
  rawInput?: unknown
  status?: string | null
  title?: string | null
}) {
  if (update.rawInput !== undefined) {
    return stringifyPayload(update.rawInput)
  }

  return stringifyPayload(
    compactObject([
      ["kind", update.kind],
      ["title", update.title],
      ["status", update.status],
      ["locations", update.locations],
      ["content", update.content],
    ])
  )
}

function synthesizeToolCallFromUpdate(
  update: {
    content?: unknown
    kind?: string | null
    locations?: unknown
    rawInput?: unknown
    status?: string | null
    title?: string | null
    toolCallId: string
  },
  name: string
): AgentEvent {
  return {
    type: "tool_call",
    id: update.toolCallId,
    name,
    input: toolInputToString(update),
  }
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

    state.toolCallIds.add(update.toolCallId)

    return [
      {
        type: "tool_call",
        id: update.toolCallId,
        name,
        input: toolInputToString(update),
      },
    ]
  }

  if (update.sessionUpdate === "tool_call_update") {
    const name = getToolName(update, state)
    const hasToolCall = state.toolCallIds.has(update.toolCallId)

    if (update.status === "completed") {
      const result = {
        type: "tool_result",
        id: update.toolCallId,
        name,
        status: "complete",
        output: toolOutputToString(update),
      } satisfies AgentEvent

      if (hasToolCall) {
        return [result]
      }

      state.toolCallIds.add(update.toolCallId)

      return [
        synthesizeToolCallFromUpdate(update, name),
        result,
      ]
    }

    if (update.status === "failed") {
      const result = {
        type: "tool_result",
        id: update.toolCallId,
        name,
        status: "error",
        error: toolOutputToString(update) || "Tool call failed.",
      } satisfies AgentEvent

      if (hasToolCall) {
        return [result]
      }

      state.toolCallIds.add(update.toolCallId)

      return [
        synthesizeToolCallFromUpdate(update, name),
        result,
      ]
    }

    if (!hasToolCall && (update.rawInput !== undefined || update.status)) {
      state.toolCallIds.add(update.toolCallId)

      return [synthesizeToolCallFromUpdate(update, name)]
    }

    debugAcp("tool_call_update_ignored", {
      hasContent: Array.isArray(update.content)
        ? update.content.length > 0
        : Boolean(update.content),
      hasRawInput: update.rawInput !== undefined,
      hasRawOutput: update.rawOutput !== undefined,
      status: update.status ?? null,
      toolCallId: update.toolCallId,
    })

    return []
  }

  if (update.sessionUpdate === "usage_update") {
    return [{ type: "run_meta", usage: update }]
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
    keys: Object.keys(update).sort(),
    sessionUpdate: update.sessionUpdate,
  })

  return []
}

function disposeAcpSession(
  key: string,
  state: AcpSessionState,
  reason: string
) {
  const isCurrentSession = acpSessions.get(key) === state

  if (isCurrentSession) {
    acpSessions.delete(key)
  }

  if (state.disposed) {
    terminateAcpChild(state)
    return
  }

  state.disposed = true
  cancelSessionPermissions(state.key.split(ACP_SESSION_KEY_SEPARATOR)[1] ?? "")

  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
    state.idleTimer = null
  }

  debugAcp("session_dispose", {
    key,
    reason,
    acpSessionId: state.acpSessionId,
    stale: !isCurrentSession,
  })

  state.activeSession.dispose()
  state.connection.close(new Error(reason))

  terminateAcpChild(state)
}

function terminateAcpChild(
  state: AcpSessionState,
  timeoutMs = ACP_TERMINATE_KILL_TIMEOUT_MS
) {
  if (!state.child) {
    return
  }

  terminateChild(state.child, timeoutMs)
}

function terminateChild(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = ACP_TERMINATE_KILL_TIMEOUT_MS
) {
  if (child.exitCode !== null || child.killed) {
    return
  }

  child.kill("SIGTERM")

  if (timeoutMs <= 0) {
    return
  }

  const killTimer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGKILL")
    }
  }, timeoutMs)

  killTimer.unref()
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

function disposeAllAcpSessions(reason: string) {
  for (const [key, state] of [...acpSessions]) {
    disposeAcpSession(key, state, reason)
  }

  for (const child of [...acpChildren]) {
    terminateChild(child)
  }
}

function exitCodeForSignal(signal: NodeJS.Signals) {
  return signal === "SIGINT" ? 130 : 143
}

function installAcpProcessCleanupHooks() {
  if (acpGlobalState.cleanupHooksInstalled) {
    return
  }

  acpGlobalState.cleanupHooksInstalled = true

  process.once("exit", () => {
    disposeAllAcpSessions("process exit")
  })

  const shutdown = (signal: NodeJS.Signals) => {
    disposeAllAcpSessions(`process ${signal}`)
    process.exit(exitCodeForSignal(signal))
  }

  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

installAcpProcessCleanupHooks()

async function createAcpSession({
  authentication,
  command,
  info,
  key,
  mcpServers,
  sessionId,
  sessionKey,
  sessionMeta,
  workspace,
}: {
  authentication: AcpAuthenticationSpec | null
  command: AcpCommandSpec
  info: AgentRuntimeInfo
  key: string
  mcpServers: AcpMcpServer[]
  sessionId: string
  sessionKey: string | null
  sessionMeta: Record<string, unknown> | null
  workspace: string
}) {
  const { child, spawnError, stream } = createAcpCommandStream(
    command,
    workspace
  )
  let state: AcpSessionState | null = null
  let capturedStderr = ""
  const fallbackAbortController = new AbortController()
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

  child?.stderr.on("data", (chunk: Buffer) => {
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

    if (authentication) {
      await withTimeout(
        Promise.race([
          connection.agent.request(methods.agent.authenticate, authentication),
          spawnError,
        ]),
        ACP_STARTUP_TIMEOUT_MS,
        `${info.label} ACP authenticate`
      )
    }

    const activeSession = await withTimeout(
      Promise.race([
        connection.agent
          .buildSession({
            cwd: workspace,
            mcpServers,
            ...(sessionMeta ? { _meta: sessionMeta } : {}),
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
      disposed: false,
      idleTimer: null,
      key,
      mcpServers,
      queue: null,
      runTail: Promise.resolve(),
      runSignal: null,
      sessionKey: sessionKey ?? "",
      sessionMeta,
      stderr: capturedStderr,
      toolCallIds: new Set(),
      toolNames: new Map(),
      workspace,
    }

    child?.once("exit", (code, signal) => {
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

    if (child) {
      terminateChild(child)
    }

    throw new AcpStartupError(error, capturedStderr)
  }
}

async function getOrCreateAcpSession({
  authentication,
  command,
  info,
  mcpServers,
  modelKey,
  pluginKey,
  sessionId,
  sessionMeta,
  workspace,
}: {
  authentication: AcpAuthenticationSpec | null
  command: AcpCommandSpec
  info: AgentRuntimeInfo
  mcpServers: AcpMcpServer[]
  modelKey: string | null
  pluginKey: string | null
  sessionId: string
  sessionMeta: Record<string, unknown> | null
  workspace: string
}) {
  const key = getSessionKey(info.id, sessionId, workspace, modelKey, pluginKey)
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

  const pendingStartup = acpSessionStartups.get(key)

  if (pendingStartup) {
    const state = await pendingStartup

    if (!state.connection.signal.aborted) {
      clearAcpSessionIdleCleanup(state)

      return {
        state,
        shouldIncludeRecap: false,
      }
    }

    disposeAcpSession(key, state, "ACP session stale")
  }

  const startup = createAcpSession({
    authentication,
    command,
    info,
    key,
    mcpServers,
    sessionId,
    sessionKey: [modelKey ?? "", pluginKey ?? ""].join(":"),
    sessionMeta,
    workspace,
  })

  acpSessionStartups.set(key, startup)

  try {
    const state = await startup

    return {
      state,
      shouldIncludeRecap: true,
    }
  } finally {
    if (acpSessionStartups.get(key) === startup) {
      acpSessionStartups.delete(key)
    }
  }
}

function resetAcpRunState(state: AcpSessionState) {
  state.toolCallIds.clear()
  state.toolNames.clear()
}

async function acquireAcpRunSlot(state: AcpSessionState, signal: AbortSignal) {
  const previousRun = state.runTail.catch(() => undefined)
  let releaseCurrent = () => {}
  let acquired = false
  let released = false
  const currentRun = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  const tail = previousRun.then(() => currentRun)

  state.runTail = tail

  let abortListener: (() => void) | null = null
  const abortWait = new Promise<"aborted">((resolve) => {
    if (signal.aborted) {
      resolve("aborted")
      return
    }

    abortListener = () => resolve("aborted")
    signal.addEventListener("abort", abortListener, { once: true })
  })
  const result = await Promise.race([
    previousRun.then(() => "ready" as const),
    abortWait,
  ])

  if (abortListener) {
    signal.removeEventListener("abort", abortListener)
  }

  if (result === "aborted" || signal.aborted) {
    released = true
    releaseCurrent()
    throw createAbortError("ACP run aborted before acquiring the session.")
  }

  acquired = true

  return () => {
    if (released) {
      return
    }

    released = true
    releaseCurrent()

    if (acquired && state.runTail === tail) {
      state.runTail = Promise.resolve()
    }
  }
}

function cleanupAbortHandler({
  clearAbortTimeout,
  killTimer,
  signal,
  abort,
}: {
  clearAbortTimeout: boolean
  killTimer: NodeJS.Timeout | null
  signal: AbortSignal
  abort: () => void
}) {
  signal.removeEventListener("abort", abort)

  if (clearAbortTimeout && killTimer) {
    clearTimeout(killTimer)
  }
}

function scheduleAbortKill(state: AcpSessionState) {
  const killTimer = setTimeout(() => {
    disposeAcpSession(state.key, state, "ACP abort timeout")
  }, ACP_ABORT_KILL_TIMEOUT_MS)

  killTimer.unref()

  return killTimer
}

function notifyAcpCancel(state: AcpSessionState) {
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
    if (killTimer) {
      return
    }

    notifyAcpCancel(state)
    killTimer = scheduleAbortKill(state)
  }

  if (signal.aborted) {
    abort()
  } else {
    signal.addEventListener("abort", abort, { once: true })
  }

  return {
    cleanup: (clearAbortTimeout: boolean) => {
      cleanupAbortHandler({
        clearAbortTimeout,
        killTimer,
        signal,
        abort,
      })
    },
    hasAbortTimeout: () => Boolean(killTimer),
  }
}

async function pumpAcpPrompt({
  input,
  promptPreamble,
  queue,
  shouldIncludeRecap,
  state,
}: {
  input: AgentRunInput
  promptPreamble: string | null
  queue: AgentEventQueue
  shouldIncludeRecap: boolean
  state: AcpSessionState
}) {
  resetAcpRunState(state)
  state.runSignal = input.signal
  const abortHandler = installAbortHandler({
    signal: input.signal,
    state,
  })
  let completedNormally = false

  try {
    const promptResponse = state.activeSession.prompt(
      createPromptBlocks(input.messages, shouldIncludeRecap, promptPreamble)
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
    completedNormally = true
  } catch (error) {
    if (!isAbortLikeError(error, input.signal)) {
      queue.push({
        type: "error",
        message: errorMessage(error),
      })
    }
  } finally {
    abortHandler.cleanup(completedNormally || !abortHandler.hasAbortTimeout())
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
  let command: AcpCommandSpec | null = null
  let authentication: AcpAuthenticationSpec | null = null
  let modelKey: string | null = null
  let pluginKey: string | null = null
  let sessionPlugins: AcpSessionPlugins = {
    mcpServers: [],
    promptPreamble: null,
  }
  let sessionMeta: Record<string, unknown> | null = null

  try {
    command = options.resolveCommand(input)
    authentication = options.resolveAuthentication?.(input) ?? null
    modelKey = options.resolveSessionKey?.(input) ?? null
    sessionPlugins = options.resolveSessionPlugins?.(input) ?? sessionPlugins
    pluginKey = fingerprintSessionPlugins(sessionPlugins)
    sessionMeta = options.resolveSessionMeta?.(input) ?? null
  } catch (error) {
    yield {
      type: "error",
      message: errorMessage(error),
    }
    return
  }

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
      authentication,
      command,
      info: options.info,
      mcpServers: sessionPlugins.mcpServers,
      modelKey,
      pluginKey,
      sessionId: input.sessionId,
      sessionMeta,
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

  let releaseRunSlot: (() => void) | null = null

  try {
    releaseRunSlot = await acquireAcpRunSlot(state, input.signal)
    clearAcpSessionIdleCleanup(state)
  } catch (error) {
    if (!isAbortLikeError(error, input.signal)) {
      yield {
        type: "error",
        message: errorMessage(error),
      }
    }
    return
  }

  if (state.connection.signal.aborted || acpSessions.get(state.key) !== state) {
    releaseRunSlot()
    yield {
      type: "error",
      message: `${options.info.label} ACP session ended before this run could start.`,
    }
    return
  }

  const queue = new AgentEventQueue()

  state.queue = queue

  const pump = pumpAcpPrompt({
    input,
    promptPreamble: sessionPlugins.promptPreamble,
    queue,
    shouldIncludeRecap,
    state,
  }).finally(() => {
    if (state.queue === queue) {
      state.queue = null
    }

    releaseRunSlot?.()

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
  private readonly options: AcpRuntimeOptions

  constructor(options: AcpRuntimeOptions) {
    this.info = options.info
    this.options = options
  }

  startRun(input: AgentRunInput): AsyncIterable<AgentEvent> {
    return streamAcpRun(
      {
        info: this.info,
        resolveAuthentication: this.options.resolveAuthentication,
        resolveCommand: this.options.resolveCommand,
        resolveSessionPlugins: this.options.resolveSessionPlugins,
        resolveSessionKey: this.options.resolveSessionKey,
        resolveSessionMeta: this.options.resolveSessionMeta,
      },
      input
    )
  }
}
