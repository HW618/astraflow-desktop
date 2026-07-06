import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

import { HumanMessage, type BaseMessage } from "@langchain/core/messages"
import type { StructuredToolInterface } from "@langchain/core/tools"
import { InMemoryStore, MemorySaver } from "@langchain/langgraph-checkpoint"
import { createDeepAgent } from "deepagents"

import { createStudioSkillsMiddleware } from "@/lib/ai/skills/studio-skills"
import {
  createGetStudioMediaModelSchemaTool,
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
import type { PromptMention } from "@/lib/agent/composer-types"
import { DEFAULT_CHAT_REASONING_EFFORT } from "@/lib/chat-models"
import { isMcpToolName } from "@/lib/mcp"
import { createModelverseChatModel } from "@/lib/modelverse-langchain"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/modelverse-openai"
import {
  createSessionSandboxUploadPath,
  uploadSessionFileToSandbox,
} from "@/lib/astraflow-session-sandbox"
import { resolveStudioStoragePath } from "@/lib/studio-file-storage"
import {
  getStudioModelverseApiKey,
  getStudioSession,
  listStudioSessionFiles,
} from "@/lib/studio-db"
import type { StudioSessionFile } from "@/lib/studio-types"

const STUDIO_CHAT_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"
const DEEPAGENTS_RECURSION_LIMIT = 200
const SUBAGENT_SUMMARY_MAX_CHARS = 4_000
const PROJECT_MEMORY_FILE_NAME = "AGENTS.md"
const PROJECT_CONTEXT_MAX_CHARS = 16_000
const PROJECT_MEMORY_FILE_MAX_CHARS = 10_000
const PROJECT_README_MAX_CHARS = 2_500
const PROJECT_PACKAGE_SCRIPT_NAMES = [
  "lint",
  "typecheck",
  "test",
  "format",
  "dev",
  "build",
]
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
type PreparedSessionFile = StudioSessionFile & {
  agentPath: string
  agentEnvironment: AgentRunEnvironment
}

const sessionCheckpointers = new Map<string, MemorySaver>()
const sessionStores = new Map<string, InMemoryStore>()

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function messageContentToText(content: BaseMessage["content"]) {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return stringifyToolPayload(content)
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part
      }

      const record = getRecord(part)

      return typeof record?.text === "string"
        ? record.text
        : stringifyToolPayload(part)
    })
    .filter(Boolean)
    .join("\n")
}

function getFilePromptMentions(message: BaseMessage) {
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

function appendTextToMessageContent(
  content: BaseMessage["content"],
  text: string
) {
  if (typeof content === "string") {
    return [content, text].filter((part) => part.trim().length > 0).join("\n\n")
  }

  if (Array.isArray(content)) {
    return [...content, { type: "text", text }] as BaseMessage["content"]
  }

  return [stringifyToolPayload(content), text]
    .filter((part) => part.trim().length > 0)
    .join("\n\n")
}

function appendLatestUserMentionPaths(messages: BaseMessage[]) {
  const latestUserIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]._getType() === "human") {
        return index
      }
    }

    return -1
  })()

  if (latestUserIndex < 0) {
    return messages
  }

  const latestUserMessage = messages[latestUserIndex]
  const latestText = messageContentToText(latestUserMessage.content)
  const paths = getFilePromptMentions(latestUserMessage)
    .map((mention) => mention.path)
    .filter((path) => !latestText.includes(path))

  if (!paths.length) {
    return messages
  }

  const mentionText = ["Referenced files:", ...paths].join("\n")
  const nextMessages = [...messages]

  nextMessages[latestUserIndex] = new HumanMessage({
    content: appendTextToMessageContent(latestUserMessage.content, mentionText),
    additional_kwargs: latestUserMessage.additional_kwargs,
  })

  return nextMessages
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

function getSessionPersistence(sessionId: string) {
  let checkpointer = sessionCheckpointers.get(sessionId)
  let store = sessionStores.get(sessionId)

  if (!checkpointer) {
    checkpointer = new MemorySaver()
    sessionCheckpointers.set(sessionId, checkpointer)
  }

  if (!store) {
    store = new InMemoryStore()
    sessionStores.set(sessionId, store)
  }

  return { checkpointer, store }
}

function isDirectory(path: string) {
  try {
    return statSync(/* turbopackIgnore: true */ path).isDirectory()
  } catch {
    return false
  }
}

function findGitRoot(startDir: string) {
  let current = resolve(startDir)

  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current
    }

    const parent = dirname(current)

    if (parent === current) {
      return null
    }

    current = parent
  }
}

function ancestorDirectories(fromDir: string, toDir: string) {
  const from = resolve(fromDir)
  const to = resolve(toDir)
  const directories: string[] = []
  let current = to

  while (true) {
    directories.push(current)

    if (current === from) {
      return directories.reverse()
    }

    const parent = dirname(current)

    if (parent === current || !relative(from, current).startsWith("..")) {
      current = parent
      continue
    }

    return directories.reverse()
  }
}

function discoverProjectMemorySources(projectPath: string | null) {
  if (!projectPath || !isDirectory(projectPath)) {
    return []
  }

  const root = resolve(projectPath)
  const gitRoot = findGitRoot(root) ?? root
  const rootRelativeToGit = relative(gitRoot, root)
  const isInsideGitRoot =
    rootRelativeToGit === "" ||
    (!rootRelativeToGit.startsWith("..") && !rootRelativeToGit.startsWith("/"))
  const directories = isInsideGitRoot
    ? ancestorDirectories(gitRoot, root)
    : [root]

  return directories
    .map((directory) => join(directory, PROJECT_MEMORY_FILE_NAME))
    .filter((path) => existsSync(path))
}

function readTextExcerpt(path: string, maxChars: number) {
  try {
    const content = readFileSync(/* turbopackIgnore: true */ path, "utf8")

    if (content.length <= maxChars) {
      return content
    }

    return `${content.slice(0, maxChars)}\n...[truncated ${
      content.length - maxChars
    } chars]`
  } catch {
    return null
  }
}

function readProjectPackageScripts(projectPath: string | null) {
  if (!projectPath) {
    return ""
  }

  const packageJsonPath = join(projectPath, "package.json")
  const raw = readTextExcerpt(packageJsonPath, 80_000)

  if (!raw) {
    return ""
  }

  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> }
    const scripts = parsed.scripts ?? {}
    const selected = PROJECT_PACKAGE_SCRIPT_NAMES.flatMap((name) =>
      typeof scripts[name] === "string" ? [`- ${name}: ${scripts[name]}`] : []
    )

    return selected.length ? selected.join("\n") : ""
  } catch {
    return ""
  }
}

function findProjectReadme(projectPath: string | null) {
  if (!projectPath) {
    return null
  }

  return (
    ["README.md", "README.mdx", "readme.md"]
      .map((name) => join(projectPath, name))
      .find((path) => existsSync(path)) ?? null
  )
}

function createProjectGuidance({
  memoryLoadedByDeepAgents,
  memorySources,
  projectPath,
}: {
  memoryLoadedByDeepAgents: boolean
  memorySources: string[]
  projectPath: string | null
}) {
  if (!projectPath) {
    return ""
  }

  const sections = [
    "<project_context>",
    `Project root: ${projectPath}`,
    "Use this as a compact project index. Inspect relevant files just-in-time before changing code.",
  ]
  const scripts = readProjectPackageScripts(projectPath)

  if (scripts) {
    sections.push(`Common package scripts:\n${scripts}`)
  }

  if (memorySources.length > 0) {
    if (memoryLoadedByDeepAgents) {
      sections.push(
        [
          "Project memory files loaded by Deep Agents memory middleware:",
          ...memorySources.map((source) => `- ${source}`),
        ].join("\n")
      )
    } else {
      sections.push(
        [
          "Project AGENTS.md instructions:",
          ...memorySources.map((source) => {
            const content =
              readTextExcerpt(source, PROJECT_MEMORY_FILE_MAX_CHARS) ?? ""

            return `--- ${source} ---\n${content}`
          }),
        ].join("\n\n")
      )
    }
  }

  const readmePath = findProjectReadme(projectPath)
  const readme = readmePath
    ? readTextExcerpt(readmePath, PROJECT_README_MAX_CHARS)
    : null

  if (readme) {
    sections.push(`README excerpt (${readmePath}):\n${readme}`)
  }

  sections.push("</project_context>")

  const guidance = sections.join("\n\n")

  if (guidance.length <= PROJECT_CONTEXT_MAX_CHARS) {
    return guidance
  }

  return `${guidance.slice(0, PROJECT_CONTEXT_MAX_CHARS)}\n...[project context truncated]`
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
  projectGuidance,
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
  projectGuidance: string
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
      [
        "You can create and edit Studio images and submit Studio video generations directly in chat with studio_list_image_models, studio_list_video_models, studio_list_media_generation_models, studio_get_media_model_schema, studio_generate_image, studio_generate_video, and the Studio media status tools.",
        "If the user asks what AstraFlow can do, or asks for images, image edits, videos, Seedream, Seedance, or media model choices, tell them this is available and use these tools.",
        "For media generation, use list tools with detail: summary to choose a model, then call studio_get_media_model_schema or use detail: schema when you need full provider params. Actively set useful params such as size, aspectRatio, imageSize, ratio, resolution, duration, quality, output_format, response_format, n, seed, watermark, first-frame, or last-frame based on the user's intent.",
        "If the user did not name a model, choose a reasonable available default for the requested medium and explain the choice briefly; use request_user_input only when the choice materially changes the result or the user explicitly asks to compare options.",
        "Prefer media references to embedding data URLs. Generated media appears as chat media cards, can be downloaded, can be saved to the Files library, and can be referenced in later prompts. Use media generation only when relevant to the user's request.",
      ].join(" ")
    )
  }

  if (hasUserInputRequest) {
    toolInstructions.push(
      "You can ask the user a structured question with request_user_input. Use it proactively when a choice materially affects the result and guessing would be poor, especially when choosing between chat, image, video, or media models. Keep questions short, put the recommended option first for multiple-choice questions, and set options to [] with isOther true for short free-form questions."
    )
  }

  toolInstructions.push(
    "Use write_todos for multi-step work, especially research, debugging, code edits, or media workflows with several decisions. Use the task tool for independent exploration or review subtasks so the main context stays focused. Use just-in-time context: search or inspect small relevant slices first, then read more only when needed. Verify concrete work with the narrowest relevant check before finalizing whenever tools are available."
  )

  toolInstructions.push(
    "Use list_installed_mcp_servers when the user asks what MCP servers/plugins are installed, enabled, available, or why an MCP is not callable."
  )

  return `${DEFAULT_SYSTEM_PROMPT}

${toolInstructions.join("\n")}
${projectGuidance ? `\n${projectGuidance}` : ""}
${sessionFilesManifest ? `\n${sessionFilesManifest}` : ""}`
}

function createDeepAgentsSessionFilesManifest(files: PreparedSessionFile[]) {
  if (!files.length) {
    return ""
  }

  const isLocalManifest = files.every(
    (file) => file.agentEnvironment === "local"
  )

  return [
    "Session files already available to this Deep Agents filesystem backend:",
    ...files.map((file) =>
      [
        `- ${file.originalName}`,
        `file_id: ${file.id}`,
        `path: ${file.agentPath}`,
        `environment: ${file.agentEnvironment}`,
        file.kind ? `kind: ${file.kind}` : null,
        file.mimeType ? `mime: ${file.mimeType}` : null,
        typeof file.size === "number" ? `bytes: ${file.size}` : null,
      ]
        .filter(Boolean)
        .join(" | ")
    ),
    isLocalManifest
      ? "Attachments live in the app's data directory - use the absolute paths listed here directly; do not search for them inside the project directory."
      : "Use the listed path exactly with read_file, ls, grep, or execute. Prefer read_file over shell commands such as cat/head/tail, and do not invent ~/.astraflow/uploads paths.",
  ].join("\n")
}

async function prepareDeepAgentsSessionFiles({
  environment,
  modelverseApiKey,
  sessionId,
}: {
  environment: AgentRunEnvironment
  modelverseApiKey: string | null
  sessionId: string
}) {
  const files = listStudioSessionFiles(sessionId)

  if (!files.length) {
    return []
  }

  if (environment === "remote") {
    if (!modelverseApiKey) {
      return []
    }

    const prepared: PreparedSessionFile[] = []

    for (const file of files) {
      const result = await uploadSessionFileToSandbox({
        sessionId,
        apiKey: modelverseApiKey,
        fileId: file.id,
      })

      prepared.push({
        ...result.file,
        agentPath:
          result.file.sandboxPath ?? createSessionSandboxUploadPath(file),
        agentEnvironment: environment,
      })
    }

    return prepared
  }

  return files.map((file) => ({
    ...file,
    agentPath: resolveStudioStoragePath(file.storagePath),
    agentEnvironment: environment,
  }))
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
    createGetStudioMediaModelSchemaTool(),
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

function findLangChainUsage(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return null
  }

  const record = getRecord(value)

  if (!record) {
    return null
  }

  if (record.usage_metadata) {
    return record.usage_metadata
  }

  const responseMetadata = getRecord(record.response_metadata)
  const tokenUsage =
    responseMetadata?.tokenUsage ?? responseMetadata?.token_usage

  if (tokenUsage) {
    return tokenUsage
  }

  const llmOutput = getRecord(record.llmOutput)
  const llmTokenUsage = llmOutput?.tokenUsage ?? llmOutput?.token_usage

  if (llmTokenUsage) {
    return llmTokenUsage
  }

  for (const key of ["data", "chunk", "message", "output"]) {
    const nested = findLangChainUsage(record[key], depth + 1)

    if (nested) {
      return nested
    }
  }

  return null
}

async function pumpMessageDeltas(
  messages: AsyncIterable<AsyncIterable<unknown>>,
  queue: AgentEventQueue
) {
  for await (const message of messages) {
    for await (const rawEvent of message) {
      const usage = findLangChainUsage(rawEvent)

      if (usage) {
        queue.push({ type: "run_meta", usage })
      }

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
    const resolvedProjectPath = projectPath?.trim() || null
    const projectMemorySources =
      discoverProjectMemorySources(resolvedProjectPath)
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
    const memoryLoadedByDeepAgents =
      environment === "local" &&
      backend !== null &&
      projectMemorySources.length > 0
    const projectGuidance = createProjectGuidance({
      memoryLoadedByDeepAgents,
      memorySources: projectMemorySources,
      projectPath: resolvedProjectPath,
    })
    const sessionFilesManifest = createDeepAgentsSessionFilesManifest(
      await prepareDeepAgentsSessionFiles({
        environment,
        modelverseApiKey,
        sessionId,
      })
    )
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
    const { checkpointer, store } = getSessionPersistence(sessionId)
    const checkpointThreadId = `astraflow:${sessionId}:${randomUUID()}`
    const agent = createDeepAgent({
      model: chatModel,
      tools,
      ...(skillsMiddleware ? { middleware: [skillsMiddleware] } : {}),
      ...(backend ? { backend } : {}),
      checkpointer,
      store,
      ...(memoryLoadedByDeepAgents ? { memory: projectMemorySources } : {}),
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
        projectGuidance,
        sessionFilesManifest,
      }),
    })
    const run = await agent.streamEvents(
      { messages: appendLatestUserMentionPaths(messages) },
      {
        version: "v3",
        signal,
        configurable: {
          thread_id: checkpointThreadId,
        },
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
          "Deep Agents run was interrupted before completion. A checkpoint was saved for this run, but interactive resume is not wired in this runtime path yet.",
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
      compact: true,
    },
    composer: {
      slashCommands: "none",
      fileMentions: "text",
      sessionMentions: true,
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
      compact: true,
    },
    composer: {
      slashCommands: "none",
      fileMentions: "text",
      sessionMentions: true,
    },
  },
  getInfo: getAstraflowRuntimeInfo,
  startRun(input) {
    return streamDeepAgentsRun(input)
  },
}

registerAgentRuntime(astraflowAgentRuntime)
