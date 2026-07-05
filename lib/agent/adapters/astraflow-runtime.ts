import { randomUUID } from "node:crypto"
import { homedir } from "node:os"

import type { StructuredToolInterface } from "@langchain/core/tools"
import { createDeepAgent } from "deepagents"

import { createStudioSkillsMiddleware } from "@/lib/ai/skills/studio-skills"
import {
  createGetStudioMediaGenerationTool,
  createListStudioImageModelsTool,
  createListStudioMediaGenerationModelsTool,
  createListStudioMediaGenerationsTool,
  createListStudioVideoModelsTool,
  createStudioGenerateImageTool,
  createStudioGenerateVideoTool,
} from "@/lib/ai/tools/media-generation"
import {
  createSessionSandboxGetter,
  createSandboxGetHostTool,
  createSandboxStartServiceTool,
} from "@/lib/ai/tools/astraflow-sandbox"
import {
  createListInstalledMcpServersTool,
  createStudioMcpToolClient,
} from "@/lib/ai/tools/mcp"
import {
  createExaWebSearchTool,
  createWebFetchTool,
  getStoredExaApiKey,
} from "@/lib/ai/tools/web"
import { createRequestUserInputTool } from "@/lib/ai/tools/user-input"
import { DeepAgentsE2BBackend } from "@/lib/agent/deepagents-e2b-backend"
import { DeepAgentsLocalBackend } from "@/lib/agent/deepagents-local-backend"
import { AgentEventQueue } from "@/lib/agent/event-queue"
import type { AgentEvent } from "@/lib/agent/events"
import {
  type PermissionGatewayContext,
  wrapToolsWithPermissionGateway,
} from "@/lib/agent/permission-gateway"
import { cancelSessionUserInputs } from "@/lib/agent/user-input-broker"
import {
  registerAgentRuntime,
  type AgentRunEnvironment,
  type AgentRunInput,
  type AgentRuntime,
} from "@/lib/agent/runtime"
import { DEFAULT_CHAT_REASONING_EFFORT } from "@/lib/chat-models"
import { isMcpToolName } from "@/lib/mcp"
import { createModelverseChatModel } from "@/lib/modelverse-langchain"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/modelverse-openai"
import {
  getStudioModelverseApiKey,
  getStudioSession,
  listStudioSessionFiles,
} from "@/lib/studio-db"

const STUDIO_CHAT_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"
const DEEPAGENTS_RECURSION_LIMIT = 200
const SUBAGENT_SUMMARY_MAX_CHARS = 4_000
const DEEPAGENTS_BUILTIN_TOOL_NAMES = new Set([
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "task",
  "write_todos",
  "execute",
])

type AgentTodo = Extract<AgentEvent, { type: "plan_update" }>["todos"][number]
type DeepAgentsToolCallStream = {
  callId?: string
  error: Promise<string | undefined>
  input: unknown
  name: string
  output: Promise<unknown>
  status: Promise<string>
}
type DeepAgentsSubagentStream = {
  cause?: unknown
  messages?: AsyncIterable<AsyncIterable<unknown>>
  name: string
  output: Promise<unknown>
  subagents?: AsyncIterable<unknown>
  toolCalls?: AsyncIterable<DeepAgentsToolCallStream>
  values?: AsyncIterable<unknown>
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
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

function debugDeepAgents(label: string, payload: Record<string, unknown>) {
  if (!STUDIO_CHAT_DEBUG) {
    return
  }

  console.info(`[studio-chat:deepagents] ${label}`, payload)
}

function createDeepAgentsSystemPrompt({
  environment,
  hasSandboxBackend,
  hasMcpTools,
  hasSandboxGetHost,
  hasSandboxStartService,
  hasWebFetch,
  hasWebSearch,
  hasMediaGeneration,
  hasUserInputRequest,
  localRootDir,
  sessionFilesManifest,
}: {
  environment: AgentRunEnvironment
  hasSandboxBackend: boolean
  hasMcpTools: boolean
  hasSandboxGetHost: boolean
  hasSandboxStartService: boolean
  hasWebFetch: boolean
  hasWebSearch: boolean
  hasMediaGeneration: boolean
  hasUserInputRequest: boolean
  localRootDir: string | null
  sessionFilesManifest: string
}) {
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

  if (environment === "local") {
    toolInstructions.push(
      [
        `You are running directly on the user's machine. The built-in filesystem tools (ls, read_file, write_file, edit_file, glob, grep) and execute operate on the local filesystem, with the working directory at ${localRootDir}.`,
        "Shell commands run with the user's own permissions and are NOT sandboxed, so be conservative: never run destructive or irreversible commands unless the user explicitly asked for them.",
      ].join(" ")
    )
  } else if (hasSandboxBackend) {
    toolInstructions.push(
      "Use the Deep Agent built-in filesystem tools for sandbox files: ls, read_file, write_file, edit_file, glob, and grep. Use execute for short shell commands in the persistent per-chat AstraFlow Sandbox."
    )
  } else {
    toolInstructions.push(
      "Use the Deep Agent built-in filesystem tools for temporary in-memory files: ls, read_file, write_file, edit_file, glob, and grep. Do not claim access to a persistent AstraFlow Sandbox unless a sandbox backend is configured; execute may be unavailable."
    )
  }

  if (hasSandboxStartService) {
    toolInstructions.push(
      "When serving previews from the sandbox, use sandbox_start_service with the foreground server command. Do not run preview servers directly in execute, and do not combine nohup/background operators with curl health checks in one execute call. The service must bind to 0.0.0.0:<port>; use the returned public URL for the user."
    )
  } else if (hasSandboxGetHost) {
    toolInstructions.push(
      "When serving previews from the sandbox, start long-lived services in a detached tmux session, bind to 0.0.0.0:<port>, verify with 127.0.0.1 inside the sandbox, then call sandbox_get_host for the public URL. Never present localhost, 127.0.0.1, or 0.0.0.0 as the user-facing URL."
    )
  }

  if (hasMcpTools) {
    toolInstructions.push(
      "You may also have tools whose names begin with mcp_ and include a server prefix. These are user-enabled MCP tools. Use them only when they are relevant to the user's request, and treat their outputs as external tool results."
    )
  }

  if (hasMediaGeneration) {
    toolInstructions.push(
      "You can create and edit Studio images and submit Studio video generations directly in chat with studio_list_image_models, studio_list_video_models, studio_list_media_generation_models, studio_generate_image, studio_generate_video, and the Studio media status tools. If the user asks what AstraFlow can do, or asks for images, image edits, videos, Seedream, Seedance, or media model choices, tell them this is available and use these tools. When the user asks for image or video generation and did not explicitly choose a model, list the available media models if needed, then use request_user_input to ask which model they want instead of silently guessing. Generated media appears as chat media cards, can be downloaded, can be saved to the Files library, and can be referenced in later prompts. Use media generation only when relevant to the user's request."
    )
  }

  if (hasUserInputRequest) {
    toolInstructions.push(
      "You can ask the user a structured question with request_user_input. Use it proactively when a choice materially affects the result and guessing would be poor, especially when choosing between chat, image, video, or media models. Keep questions short, put the recommended option first for multiple-choice questions, and set options to [] with isOther true for short free-form questions."
    )
  }

  toolInstructions.push(
    "Use list_installed_mcp_servers when the user asks what MCP servers/plugins are installed, enabled, available, or why an MCP is not callable."
  )

  return `${DEFAULT_SYSTEM_PROMPT}

${toolInstructions.join("\n")}
${sessionFilesManifest ? `\n${sessionFilesManifest}` : ""}`
}

function createDeepAgentsSessionFilesManifest(sessionId: string) {
  const files = listStudioSessionFiles(sessionId)

  if (!files.length) {
    return ""
  }

  return [
    "Session files available in AstraFlow:",
    ...files.map((file) =>
      [
        `- ${file.originalName}`,
        `file_id: ${file.id}`,
        file.sandboxPath ? `sandbox_path: ${file.sandboxPath}` : null,
        file.kind ? `kind: ${file.kind}` : null,
        file.mimeType ? `mime: ${file.mimeType}` : null,
        typeof file.size === "number" ? `bytes: ${file.size}` : null,
      ]
        .filter(Boolean)
        .join(" | ")
    ),
    "When a file has sandbox_path, use that path directly with the built-in filesystem tools or execute.",
  ].join("\n")
}

function filterDeepAgentsTools(tools: StructuredToolInterface[]) {
  return tools.filter((agentTool) => {
    if (!DEEPAGENTS_BUILTIN_TOOL_NAMES.has(agentTool.name)) {
      return true
    }

    console.warn("[studio-chat:deepagents] tool_name_collision_skipped", {
      toolName: agentTool.name,
    })

    return false
  })
}

function createNativeTools({
  environment,
  modelverseApiKey,
  sessionId,
}: {
  environment: AgentRunEnvironment
  modelverseApiKey: string | null
  sessionId: string
}) {
  const exaApiKey = getStoredExaApiKey()
  const tools: StructuredToolInterface[] = [
    createWebFetchTool(),
    createListInstalledMcpServersTool(),
    createListStudioImageModelsTool(),
    createListStudioVideoModelsTool(),
    createListStudioMediaGenerationModelsTool(),
    createListStudioMediaGenerationsTool({
      sessionId,
      apiKey: modelverseApiKey,
    }),
    createGetStudioMediaGenerationTool({
      sessionId,
      apiKey: modelverseApiKey,
    }),
  ]

  if (exaApiKey) {
    tools.push(createExaWebSearchTool(exaApiKey))
  }

  if (modelverseApiKey) {
    tools.push(
      createStudioGenerateImageTool({
        sessionId,
        apiKey: modelverseApiKey,
      }),
      createStudioGenerateVideoTool({
        sessionId,
        apiKey: modelverseApiKey,
      })
    )
  }

  if (environment === "remote" && modelverseApiKey) {
    const getSandboxContext = createSessionSandboxGetter({
      apiKey: modelverseApiKey,
      sessionId,
    })

    tools.push(
      createSandboxStartServiceTool({
        getSandboxContext,
        sessionId,
      }),
      createSandboxGetHostTool({
        getSandboxContext,
        sessionId,
      })
    )
  }

  return tools
}

function parsePlanUpdate(
  input: unknown
): Extract<AgentEvent, { type: "plan_update" }> | null {
  const parsedInput =
    typeof input === "string"
      ? (() => {
          try {
            return JSON.parse(input) as unknown
          } catch {
            return input
          }
        })()
      : input
  const record = getRecord(parsedInput)
  const todos = Array.isArray(record?.todos) ? record.todos : null

  if (!todos) {
    return null
  }

  const normalizedTodos: AgentTodo[] = todos
    .map((todo) => {
      const item = getRecord(todo)
      const text =
        typeof item?.content === "string"
          ? item.content
          : typeof item?.text === "string"
            ? item.text
            : ""
      const status = item?.status
      const priority = item?.priority

      if (
        status !== "pending" &&
        status !== "in_progress" &&
        status !== "completed"
      ) {
        return null
      }

      return {
        text,
        status,
        ...(typeof priority === "string" || priority === null
          ? { priority }
          : {}),
      }
    })
    .filter((todo): todo is AgentTodo => Boolean(todo && todo.text.trim()))

  return {
    type: "plan_update",
    todos: normalizedTodos,
  }
}

function getTaskInputSummary(input: unknown) {
  const record = getRecord(input)

  if (!record) {
    return {
      name: "subagent",
      taskInput: stringifyToolPayload(input),
    }
  }

  const description =
    typeof record.description === "string" ? record.description : ""
  const subagentType =
    typeof record.subagent_type === "string" ? record.subagent_type : ""

  return {
    name: subagentType || "subagent",
    taskInput: description || stringifyToolPayload(input),
  }
}

function getToolInputPath(input: unknown) {
  const record = getRecord(input)

  if (!record) {
    return typeof input === "string" ? input.trim() : ""
  }

  const candidate =
    record.file_path ?? record.filePath ?? record.path ?? record.absolute_path

  return typeof candidate === "string" ? candidate.trim() : ""
}

function getFileChangeEvent({
  input,
  parentTaskId,
  toolName,
}: {
  input: unknown
  parentTaskId?: string
  toolName: string
}): Extract<AgentEvent, { type: "file_change" }> | null {
  const path = getToolInputPath(input)

  if (!path) {
    return null
  }

  if (toolName === "write_file") {
    return {
      type: "file_change",
      path,
      kind: "create",
      ...(parentTaskId ? { parentTaskId } : {}),
    }
  }

  if (toolName === "edit_file") {
    return {
      type: "file_change",
      path,
      kind: "edit",
      ...(parentTaskId ? { parentTaskId } : {}),
    }
  }

  return null
}

function getContentBlockDelta(rawEvent: unknown) {
  const event = getRecord(rawEvent)

  if (event?.event !== "content-block-delta") {
    return null
  }

  return getRecord(event.delta)
}

async function pumpMessageDeltas(
  messages: AsyncIterable<AsyncIterable<unknown>>,
  queue: AgentEventQueue
) {
  for await (const message of messages) {
    for await (const rawEvent of message) {
      const delta = getContentBlockDelta(rawEvent)

      if (!delta) {
        continue
      }

      if (delta?.type === "reasoning-delta") {
        queue.push({
          type: "reasoning_delta",
          delta: typeof delta.reasoning === "string" ? delta.reasoning : "",
        })
      }

      if (delta?.type === "text-delta") {
        queue.push({
          type: "text_delta",
          delta: typeof delta.text === "string" ? delta.text : "",
        })
      }
    }
  }
}

async function pumpSubagentMessageDeltas(
  messages: AsyncIterable<AsyncIterable<unknown>> | undefined,
  queue: AgentEventQueue,
  taskId: string
) {
  if (!messages) {
    return
  }

  for await (const message of messages) {
    for await (const rawEvent of message) {
      const delta = getContentBlockDelta(rawEvent)

      if (delta?.type !== "text-delta") {
        continue
      }

      const contentDelta = typeof delta.text === "string" ? delta.text : ""

      if (contentDelta) {
        queue.push({
          type: "subagent_update",
          taskId,
          contentDelta,
        })
      }
    }
  }
}

async function pumpToolCall(
  call: {
    callId?: string
    error: Promise<string | undefined>
    input: unknown
    name: string
    output: Promise<unknown>
    status: Promise<string>
  },
  queue: AgentEventQueue,
  parentTaskId?: string
) {
  const toolCallId = call.callId || randomUUID()

  if (call.name === "write_todos") {
    const planEvent = parsePlanUpdate(call.input)

    if (planEvent) {
      if (parentTaskId) {
        queue.push({
          type: "subagent_update",
          taskId: parentTaskId,
          todos: planEvent.todos,
        })
      } else {
        queue.push(planEvent)
      }
    }

    await call.status.catch(() => "error")
    return
  }

  if (call.name === "task") {
    const { name, taskInput } = getTaskInputSummary(call.input)

    queue.push({
      type: "subagent_start",
      taskId: toolCallId,
      name,
      taskInput,
      ...(parentTaskId ? { parentTaskId } : {}),
    })

    const status = await call.status.catch(() => "error")

    if (status === "error") {
      const error = await call.error.catch((cause) =>
        cause instanceof Error ? cause.message : String(cause)
      )

      queue.push({
        type: "subagent_end",
        taskId: toolCallId,
        name,
        status: "error",
        error: error ?? "Subagent dispatch failed.",
      })
    }

    return
  }

  queue.push({
    type: "tool_call",
    id: toolCallId,
    name: call.name,
    input: stringifyToolPayload(call.input),
    ...(parentTaskId ? { parentTaskId } : {}),
  })

  const status = await call.status.catch(() => "error")

  if (status === "error") {
    const error = await call.error.catch((cause) =>
      cause instanceof Error ? cause.message : String(cause)
    )

    queue.push({
      type: "tool_result",
      id: toolCallId,
      name: call.name,
      status: "error",
      error: error ?? "Tool call failed.",
      ...(parentTaskId ? { parentTaskId } : {}),
    })
    return
  }

  const output = await call.output.catch((error) =>
    error instanceof Error ? error.message : String(error)
  )

  queue.push({
    type: "tool_result",
    id: toolCallId,
    name: call.name,
    status: "complete",
    output: stringifyToolPayload(output),
    ...(parentTaskId ? { parentTaskId } : {}),
  })

  const fileChange = getFileChangeEvent({
    input: call.input,
    parentTaskId,
    toolName: call.name,
  })

  if (fileChange) {
    queue.push(fileChange)
  }
}

async function pumpToolCalls(
  toolCalls: AsyncIterable<DeepAgentsToolCallStream> | undefined,
  queue: AgentEventQueue,
  parentTaskId?: string
) {
  if (!toolCalls) {
    return
  }

  const pending: Promise<void>[] = []

  for await (const call of toolCalls) {
    pending.push(pumpToolCall(call, queue, parentTaskId))
  }

  await Promise.all(pending)
}

function getSubagentTaskId(subagent: { cause?: unknown; name: string }) {
  const cause = getRecord(subagent.cause)
  const toolCallId =
    cause?.type === "toolCall" && typeof cause.tool_call_id === "string"
      ? cause.tool_call_id
      : null

  return toolCallId || `${subagent.name}:${randomUUID()}`
}

function truncateSubagentSummary(summary: string) {
  if (summary.length <= SUBAGENT_SUMMARY_MAX_CHARS) {
    return summary
  }

  return `${summary.slice(0, SUBAGENT_SUMMARY_MAX_CHARS)}\n...[truncated ${
    summary.length - SUBAGENT_SUMMARY_MAX_CHARS
  } chars]`
}

function extractContentText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim() || undefined
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part
        }

        const record = getRecord(part)

        if (typeof record?.text === "string") {
          return record.text
        }

        if (typeof record?.content === "string") {
          return record.content
        }

        return ""
      })
      .join("")
      .trim()

    return text || undefined
  }

  return undefined
}

function extractSubagentSummary(output: unknown) {
  if (typeof output === "string") {
    return truncateSubagentSummary(output.trim()) || undefined
  }

  const record = getRecord(output)
  const directSummary =
    typeof record?.summary === "string"
      ? record.summary
      : typeof record?.finalResponse === "string"
        ? record.finalResponse
        : typeof record?.final_response === "string"
          ? record.final_response
          : typeof record?.output === "string"
            ? record.output
            : typeof record?.result === "string"
              ? record.result
              : null

  if (directSummary) {
    return truncateSubagentSummary(directSummary.trim()) || undefined
  }

  const directContent = extractContentText(record?.content)

  if (directContent) {
    return truncateSubagentSummary(directContent)
  }

  const messages = Array.isArray(record?.messages) ? record.messages : []
  const last = messages.at(-1)
  const content = getRecord(last)?.content ?? last
  const messageContent = extractContentText(content)

  if (messageContent) {
    return truncateSubagentSummary(messageContent)
  }

  return undefined
}

function normalizeSubagentStatus(value: unknown) {
  if (value === "running" || value === "complete" || value === "error") {
    return value
  }

  if (value === "completed" || value === "success") {
    return "complete"
  }

  if (value === "failed") {
    return "error"
  }

  return null
}

export function mapDeepAgentsSubagentValueForReplay(
  value: unknown,
  taskId: string,
  parentTaskId?: string
): Extract<AgentEvent, { type: "subagent_update" }> | null {
  const record = getRecord(value)

  if (!record) {
    return null
  }

  const planEvent = parsePlanUpdate(record)
  const summary = extractSubagentSummary(record)
  const status = normalizeSubagentStatus(record.status)
  const event: Extract<AgentEvent, { type: "subagent_update" }> = {
    type: "subagent_update",
    taskId,
    ...(status ? { status } : {}),
    ...(summary ? { summary } : {}),
    ...(planEvent?.todos.length ? { todos: planEvent.todos } : {}),
    ...(parentTaskId ? { parentTaskId } : {}),
  }

  return event.status || event.summary || event.todos ? event : null
}

async function pumpSubagentValues(
  values: AsyncIterable<unknown> | undefined,
  queue: AgentEventQueue,
  taskId: string,
  parentTaskId?: string
) {
  if (!values) {
    return
  }

  let lastStatus: string | null = null
  let lastSummary: string | null = null
  let lastTodos: string | null = null

  for await (const value of values) {
    const update = mapDeepAgentsSubagentValueForReplay(
      value,
      taskId,
      parentTaskId
    )

    if (!update) {
      continue
    }

    const deduped: Extract<AgentEvent, { type: "subagent_update" }> = {
      type: "subagent_update",
      taskId,
      ...(parentTaskId ? { parentTaskId } : {}),
    }

    if (update.status && update.status !== lastStatus) {
      deduped.status = update.status
      lastStatus = update.status
    }

    if (update.summary && update.summary !== lastSummary) {
      deduped.summary = update.summary
      lastSummary = update.summary
    }

    if (update.todos) {
      const todosKey = JSON.stringify(update.todos)

      if (todosKey !== lastTodos) {
        deduped.todos = update.todos
        lastTodos = todosKey
      }
    }

    if (deduped.status || deduped.summary || deduped.todos) {
      queue.push(deduped)
    }
  }
}

async function pumpSubagent(
  subagent: DeepAgentsSubagentStream,
  queue: AgentEventQueue,
  parentTaskId?: string
) {
  const taskId = getSubagentTaskId(subagent)

  queue.push({
    type: "subagent_start",
    taskId,
    name: subagent.name,
    ...(parentTaskId ? { parentTaskId } : {}),
  })

  const toolCalls = pumpToolCalls(subagent.toolCalls, queue, taskId)
  const nestedSubagents = pumpSubagents(subagent.subagents, queue, taskId)
  const messages = pumpSubagentMessageDeltas(subagent.messages, queue, taskId)
  const values = pumpSubagentValues(
    subagent.values,
    queue,
    taskId,
    parentTaskId
  )
  let subagentError: unknown = null
  const output = await subagent.output.catch((error) => {
    subagentError = error
    return null
  })

  await Promise.all([toolCalls, nestedSubagents, messages, values])

  if (subagentError) {
    queue.push({
      type: "subagent_end",
      taskId,
      name: subagent.name,
      status: "error",
      error:
        subagentError instanceof Error
          ? subagentError.message
          : String(subagentError),
    })
    return
  }

  queue.push({
    type: "subagent_end",
    taskId,
    name: subagent.name,
    summary: extractSubagentSummary(output),
  })
}

async function pumpSubagents(
  subagents: AsyncIterable<unknown> | undefined,
  queue: AgentEventQueue,
  parentTaskId?: string
) {
  if (!subagents) {
    return
  }

  const pending: Promise<void>[] = []

  for await (const rawSubagent of subagents) {
    const subagent = rawSubagent as DeepAgentsSubagentStream
    pending.push(pumpSubagent(subagent, queue, parentTaskId))
  }

  await Promise.all(pending)
}

async function* streamDeepAgentsRun({
  environment: requestedEnvironment,
  messages,
  model,
  projectPath,
  reasoningEffort,
  sessionId,
  signal,
}: AgentRunInput): AsyncGenerator<AgentEvent> {
  let mcpToolClient: Awaited<
    ReturnType<typeof createStudioMcpToolClient>
  > | null = null

  try {
    const environment: AgentRunEnvironment = requestedEnvironment ?? "local"
    const session = getStudioSession(sessionId)
    const chatModel = createModelverseChatModel(
      model,
      reasoningEffort ?? DEFAULT_CHAT_REASONING_EFFORT
    )
    const modelverseApiKey = getStudioModelverseApiKey()?.key ?? null
    const queue = new AgentEventQueue()
    const nativeTools = createNativeTools({
      environment,
      modelverseApiKey,
      sessionId,
    })
    nativeTools.push(
      createRequestUserInputTool({
        emit: (event) => queue.push(event),
        sessionId,
        signal,
      })
    )
    const permissionContext: PermissionGatewayContext = {
      sessionId,
      permissionMode: session?.permissionMode ?? "ask",
      projectId: session?.projectId ?? null,
      signal,
      emit: (event) => queue.push(event),
    }

    mcpToolClient = await createStudioMcpToolClient()

    const tools = wrapToolsWithPermissionGateway(
      filterDeepAgentsTools([...nativeTools, ...mcpToolClient.tools]),
      permissionContext
    )
    const localRootDir =
      environment === "local" ? projectPath?.trim() || homedir() : null
    const backend =
      environment === "local" && localRootDir
        ? new DeepAgentsLocalBackend({
            permissionContext,
            rootDir: localRootDir,
            sessionId,
          })
        : environment === "remote" && modelverseApiKey
          ? new DeepAgentsE2BBackend({
              apiKey: modelverseApiKey,
              permissionContext,
              signal,
              sessionId,
            })
          : null
    const hasSandboxBackend = backend !== null
    const hasWebFetch = tools.some(
      (agentTool) => agentTool.name === "web_fetch"
    )
    const hasWebSearch = tools.some(
      (agentTool) => agentTool.name === "web_search"
    )
    const hasSandboxGetHost = tools.some(
      (agentTool) => agentTool.name === "sandbox_get_host"
    )
    const hasSandboxStartService = tools.some(
      (agentTool) => agentTool.name === "sandbox_start_service"
    )
    const hasMcpTools = tools.some(
      (agentTool) =>
        isMcpToolName(agentTool.name) ||
        agentTool.name === "list_installed_mcp_servers"
    )
    const hasMediaGeneration = tools.some(
      (agentTool) =>
        agentTool.name === "studio_generate_image" ||
        agentTool.name === "studio_generate_video"
    )
    const hasUserInputRequest = tools.some(
      (agentTool) => agentTool.name === "request_user_input"
    )
    const skillsMiddleware = createStudioSkillsMiddleware({
      sessionId,
      modelverseApiKey,
    })
    const agent = createDeepAgent({
      model: chatModel,
      tools,
      ...(skillsMiddleware ? { middleware: [skillsMiddleware] } : {}),
      ...(backend ? { backend } : {}),
      systemPrompt: createDeepAgentsSystemPrompt({
        environment,
        hasSandboxBackend,
        hasMcpTools,
        hasSandboxGetHost,
        hasSandboxStartService,
        hasWebFetch,
        hasWebSearch,
        hasMediaGeneration,
        hasUserInputRequest,
        localRootDir,
        sessionFilesManifest:
          environment === "remote"
            ? createDeepAgentsSessionFilesManifest(sessionId)
            : "",
      }),
    })
    const run = await agent.streamEvents(
      { messages },
      {
        version: "v3",
        signal,
        recursionLimit: DEEPAGENTS_RECURSION_LIMIT,
      }
    )
    const runOutput = run.output.catch((error) => {
      if (isAbortLikeError(error, signal)) {
        return null
      }

      throw error
    })
    const runCompletion = runOutput.then(() => {
      if (signal.aborted || !run.interrupted) {
        return
      }

      queue.push({
        type: "error",
        message:
          "Deep Agents run was interrupted before completion. Built-in HITL interrupts require a checkpointer and are disabled for this runtime path.",
      })
    })
    const pumps = [
      pumpMessageDeltas(run.messages, queue),
      pumpToolCalls(run.toolCalls, queue),
      pumpSubagents(run.subagents, queue),
      runCompletion,
    ]
    const done = Promise.all(pumps)
      .then(() => queue.close())
      .catch((error) => {
        if (isAbortLikeError(error, signal)) {
          queue.close()
          return
        }

        queue.fail(error)
      })

    try {
      for await (const event of queue) {
        yield event
      }

      await done
    } finally {
      if (signal.aborted) {
        run.abort(signal.reason)
      }
    }

    debugDeepAgents("run_complete", { sessionId })
  } catch (error) {
    if (isAbortLikeError(error, signal)) {
      return
    }

    throw error
  } finally {
    cancelSessionUserInputs(sessionId)
    await mcpToolClient?.close().catch((error) => {
      console.warn("[studio-mcp] close_failed", error)
    })
  }
}

function getAstraflowRuntimeInfo() {
  return {
    id: "astraflow",
    label: "AstraFlow Agent",
    description: "AstraFlow 智能体：规划、子智能体、远程沙箱与本地执行",
    capabilities: {
      hitl: true,
      resume: false,
      subagents: true,
      plan: true,
      sandbox: Boolean(getStudioModelverseApiKey()?.key),
      mcp: true,
      skills: true,
    },
  } satisfies AgentRuntime["info"]
}

export const astraflowAgentRuntime: AgentRuntime = {
  info: {
    id: "astraflow",
    label: "AstraFlow Agent",
    description: "AstraFlow 智能体：规划、子智能体、远程沙箱与本地执行",
    capabilities: {
      hitl: true,
      resume: false,
      subagents: true,
      plan: true,
      sandbox: false,
      mcp: true,
      skills: true,
    },
  },
  getInfo: getAstraflowRuntimeInfo,
  startRun(input) {
    return streamDeepAgentsRun(input)
  },
}

registerAgentRuntime(astraflowAgentRuntime)
