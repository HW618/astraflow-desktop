import { randomUUID } from "node:crypto"

import type { StructuredToolInterface } from "@langchain/core/tools"
import { createDeepAgent } from "deepagents"

import { createStudioSkillsMiddleware } from "@/lib/ai/skills/studio-skills"
import {
  createSessionSandboxGetter,
  createSandboxGetHostTool,
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
import { DeepAgentsE2BBackend } from "@/lib/agent/deepagents-e2b-backend"
import { AgentEventQueue } from "@/lib/agent/event-queue"
import type { AgentEvent } from "@/lib/agent/events"
import {
  type PermissionGatewayContext,
  wrapToolsWithPermissionGateway,
} from "@/lib/agent/permission-gateway"
import {
  registerAgentRuntime,
  type AgentRunInput,
  type AgentRuntime,
} from "@/lib/agent/runtime"
import { resolveChatReasoningEffort } from "@/lib/chat-models"
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
  hasSandboxBackend,
  hasMcpTools,
  hasSandboxGetHost,
  hasWebFetch,
  hasWebSearch,
  sessionFilesManifest,
}: {
  hasSandboxBackend: boolean
  hasMcpTools: boolean
  hasSandboxGetHost: boolean
  hasWebFetch: boolean
  hasWebSearch: boolean
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

  if (hasSandboxBackend) {
    toolInstructions.push(
      "Use the Deep Agent built-in filesystem tools for sandbox files: ls, read_file, write_file, edit_file, glob, and grep. Use execute for shell commands in the persistent per-chat AstraFlow Sandbox."
    )
  } else {
    toolInstructions.push(
      "Use the Deep Agent built-in filesystem tools for temporary in-memory files: ls, read_file, write_file, edit_file, glob, and grep. Do not claim access to a persistent AstraFlow Sandbox unless a sandbox backend is configured; execute may be unavailable."
    )
  }

  if (hasSandboxGetHost) {
    toolInstructions.push(
      "When serving previews from the sandbox, start long-lived services in a detached tmux session, bind to 0.0.0.0:<port>, verify with 127.0.0.1 inside the sandbox, then call sandbox_get_host for the public URL. Never present localhost, 127.0.0.1, or 0.0.0.0 as the user-facing URL."
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
  modelverseApiKey,
  sessionId,
}: {
  modelverseApiKey: string | null
  sessionId: string
}) {
  const exaApiKey = getStoredExaApiKey()
  const tools: StructuredToolInterface[] = [
    createWebFetchTool(),
    createListInstalledMcpServersTool(),
  ]

  if (exaApiKey) {
    tools.push(createExaWebSearchTool(exaApiKey))
  }

  if (modelverseApiKey) {
    const getSandboxContext = createSessionSandboxGetter({
      apiKey: modelverseApiKey,
      sessionId,
    })

    tools.push(
      createSandboxGetHostTool({
        getSandboxContext,
        sessionId,
      })
    )
  }

  return tools
}

function parsePlanUpdate(input: unknown): AgentEvent | null {
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
      }
    })
    .filter((todo): todo is AgentTodo => Boolean(todo && todo.text.trim()))

  return {
    type: "plan_update",
    todos: normalizedTodos,
  }
}

async function pumpMessageDeltas(
  messages: AsyncIterable<AsyncIterable<unknown>>,
  queue: AgentEventQueue
) {
  for await (const message of messages) {
    for await (const rawEvent of message) {
      const event = getRecord(rawEvent)

      if (event?.event !== "content-block-delta") {
        continue
      }

      const delta = getRecord(event.delta)

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
    if (!parentTaskId) {
      const planEvent = parsePlanUpdate(call.input)

      if (planEvent) {
        queue.push(planEvent)
      }
    }

    await call.status.catch(() => "error")
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
  })
}

async function pumpToolCalls(
  toolCalls: AsyncIterable<{
    callId?: string
    error: Promise<string | undefined>
    input: unknown
    name: string
    output: Promise<unknown>
    status: Promise<string>
  }>,
  queue: AgentEventQueue,
  parentTaskId?: string
) {
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

function extractSubagentSummary(output: unknown) {
  const record = getRecord(output)
  const messages = Array.isArray(record?.messages) ? record.messages : []
  const last = messages.at(-1)
  const content = getRecord(last)?.content ?? last

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

        return typeof record?.text === "string" ? record.text : ""
      })
      .join("")
      .trim()

    return text || undefined
  }

  return undefined
}

async function pumpSubagent(
  subagent: {
    cause?: unknown
    name: string
    output: Promise<unknown>
    subagents: AsyncIterable<unknown>
    toolCalls: AsyncIterable<{
      callId?: string
      error: Promise<string | undefined>
      input: unknown
      name: string
      output: Promise<unknown>
      status: Promise<string>
    }>
  },
  queue: AgentEventQueue
) {
  const taskId = getSubagentTaskId(subagent)

  queue.push({
    type: "subagent_start",
    taskId,
    name: subagent.name,
  })

  const toolCalls = pumpToolCalls(subagent.toolCalls, queue, taskId)
  const nestedSubagents = pumpSubagents(subagent.subagents, queue)
  const output = await subagent.output.catch((error) => {
    throw error
  })

  await Promise.all([toolCalls, nestedSubagents])
  queue.push({
    type: "subagent_end",
    taskId,
    name: subagent.name,
    summary: extractSubagentSummary(output),
  })
}

async function pumpSubagents(
  subagents: AsyncIterable<unknown>,
  queue: AgentEventQueue
) {
  const pending: Promise<void>[] = []

  for await (const rawSubagent of subagents) {
    const subagent = rawSubagent as Parameters<typeof pumpSubagent>[0]
    pending.push(pumpSubagent(subagent, queue))
  }

  await Promise.all(pending)
}

async function* streamDeepAgentsRun({
  messages,
  model,
  reasoningEffort,
  sessionId,
  signal,
}: AgentRunInput): AsyncGenerator<AgentEvent> {
  let mcpToolClient: Awaited<
    ReturnType<typeof createStudioMcpToolClient>
  > | null = null

  try {
    const session = getStudioSession(sessionId)
    const resolvedReasoningEffort = resolveChatReasoningEffort(
      model,
      reasoningEffort
    )
    const chatModel = createModelverseChatModel(model, resolvedReasoningEffort)
    const modelverseApiKey = getStudioModelverseApiKey()?.key ?? null
    const nativeTools = createNativeTools({
      modelverseApiKey,
      sessionId,
    })
    const queue = new AgentEventQueue()
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
    const hasSandboxBackend = Boolean(modelverseApiKey)
    const hasWebFetch = tools.some(
      (agentTool) => agentTool.name === "web_fetch"
    )
    const hasWebSearch = tools.some(
      (agentTool) => agentTool.name === "web_search"
    )
    const hasSandboxGetHost = tools.some(
      (agentTool) => agentTool.name === "sandbox_get_host"
    )
    const hasMcpTools = tools.some(
      (agentTool) =>
        isMcpToolName(agentTool.name) ||
        agentTool.name === "list_installed_mcp_servers"
    )
    const skillsMiddleware = createStudioSkillsMiddleware({
      sessionId,
      modelverseApiKey,
    })
    const agent = createDeepAgent({
      model: chatModel,
      tools,
      ...(skillsMiddleware ? { middleware: [skillsMiddleware] } : {}),
      ...(modelverseApiKey
        ? {
            backend: new DeepAgentsE2BBackend({
              apiKey: modelverseApiKey,
              permissionContext,
              signal,
              sessionId,
            }),
          }
        : {}),
      systemPrompt: createDeepAgentsSystemPrompt({
        hasSandboxBackend,
        hasMcpTools,
        hasSandboxGetHost,
        hasWebFetch,
        hasWebSearch,
        sessionFilesManifest: createDeepAgentsSessionFilesManifest(sessionId),
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
    await mcpToolClient?.close().catch((error) => {
      console.warn("[studio-mcp] close_failed", error)
    })
  }
}

function getDeepAgentsRuntimeInfo() {
  return {
    id: "deepagents",
    label: "Deep Agent",
    description: "深度智能体：规划、子智能体、沙箱文件系统",
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

export const deepAgentsRuntime: AgentRuntime = {
  info: {
    id: "deepagents",
    label: "Deep Agent",
    description: "深度智能体：规划、子智能体、沙箱文件系统",
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
  getInfo: getDeepAgentsRuntimeInfo,
  startRun(input) {
    return streamDeepAgentsRun(input)
  },
}

registerAgentRuntime(deepAgentsRuntime)
