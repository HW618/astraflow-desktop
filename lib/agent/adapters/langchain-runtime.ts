import { createAgent } from "langchain"
import { randomUUID } from "node:crypto"

import { createAvailableSessionFilesManifest } from "@/lib/astraflow-session-sandbox"
import { createStudioSkillsMiddleware } from "@/lib/ai/skills/studio-skills"
import { createStudioMcpToolClient } from "@/lib/ai/tools/mcp"
import { createStudioAgentTools } from "@/lib/ai/tools/studio"
import { resolveChatReasoningEffort } from "@/lib/chat-models"
import { isMcpToolName } from "@/lib/mcp"
import { createModelverseChatModel } from "@/lib/modelverse-langchain"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/modelverse-openai"
import { getStudioModelverseApiKey, getStudioSession } from "@/lib/studio-db"
import type { AgentEvent } from "@/lib/agent/events"
import { AgentEventQueue } from "@/lib/agent/event-queue"
import { wrapToolsWithPermissionGateway } from "@/lib/agent/permission-gateway"
import {
  registerAgentRuntime,
  type AgentRunInput,
  type AgentRuntime,
} from "@/lib/agent/runtime"

const STUDIO_CHAT_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"

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

function getExplicitToolCallId(data: Record<string, unknown>) {
  const toolCall = getRecord(data.tool_call) ?? getRecord(data.toolCall)

  return getStringValue(
    data.tool_call_id,
    data.toolCallId,
    toolCall?.id
  )
}

function getToolRunId(runId: unknown) {
  return getStringValue(runId)
}

function getFallbackToolCallId(data: Record<string, unknown>, runId: unknown) {
  const id = getExplicitToolCallId(data) ?? getToolRunId(runId)

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

function getSingleRunningToolCallId(
  runningToolCallsByName: Map<string, Set<string>>,
  toolName: string | null
) {
  if (!toolName) {
    return null
  }

  const runningIds = runningToolCallsByName.get(toolName)

  if (!runningIds || runningIds.size !== 1) {
    return null
  }

  return Array.from(runningIds)[0]
}

function markToolCallRunning(
  runningToolCallsByName: Map<string, Set<string>>,
  toolCallId: string,
  toolName: string
) {
  const runningIds = runningToolCallsByName.get(toolName) ?? new Set<string>()

  runningIds.add(toolCallId)
  runningToolCallsByName.set(toolName, runningIds)
}

function markToolCallFinished(
  runningToolCallsByName: Map<string, Set<string>>,
  toolCallId: string,
  toolName: string
) {
  const runningIds = runningToolCallsByName.get(toolName)

  if (!runningIds) {
    return
  }

  runningIds.delete(toolCallId)

  if (runningIds.size === 0) {
    runningToolCallsByName.delete(toolName)
  }
}

function resolveToolCallIdForEvent({
  data,
  runningToolCallsByName,
  toolName,
  toolRunIdAliases,
  runId,
}: {
  data: Record<string, unknown>
  runningToolCallsByName: Map<string, Set<string>>
  toolName: string | null
  toolRunIdAliases: Map<string, string>
  runId: unknown
}) {
  const explicitId = getExplicitToolCallId(data)

  if (explicitId) {
    return explicitId
  }

  const toolRunId = getToolRunId(runId)

  if (toolRunId) {
    const alias = toolRunIdAliases.get(toolRunId)

    if (alias) {
      return alias
    }

    const runningToolCallId = getSingleRunningToolCallId(
      runningToolCallsByName,
      toolName
    )
    const toolCallId = runningToolCallId ?? toolRunId

    toolRunIdAliases.set(toolRunId, toolCallId)
    return toolCallId
  }

  return (
    getSingleRunningToolCallId(runningToolCallsByName, toolName) ??
    randomUUID()
  )
}

function resolveToolNameForEvent({
  data,
  fallbackName,
  seenToolCalls,
  toolCallId,
}: {
  data: Record<string, unknown>
  fallbackName: unknown
  seenToolCalls: Map<string, string>
  toolCallId: string
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

function getAgentSystemPrompt({
  hasMcpTools,
  hasRunCode,
  hasWebFetch,
  hasWebSearch,
  sandboxManifest,
}: {
  hasMcpTools: boolean
  hasRunCode: boolean
  hasWebFetch: boolean
  hasWebSearch: boolean
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
      [
        "You have access to a persistent per-chat AstraFlow Sandbox through run_code, run_command, sandbox_get_host, and file tools: upload_file, list_files, read_file, write_file, and download_file. Use run_code for calculations, data processing, document analysis, and scripts in python, javascript, typescript, bash, r, or java. Use run_command for direct shell commands, bash pipelines, package/environment inspection, and filesystem operations; it runs through sandbox.commands.run with /bin/bash -l -c.",
        "When serving previews, use a general server workflow rather than a foreground command: write generated assets under /home/user/astraflow/outputs or the user's requested workspace, choose an appropriate free port, start the service in a detached tmux session with a task-specific session name, bind the service to 0.0.0.0:<port>, verify from inside the sandbox with http://127.0.0.1:<port>/<optional-path>, then call sandbox_get_host with that port and give the user only the returned public URL with the served path appended. 0.0.0.0 is only the listen address, never a health-check URL or user-facing URL. localhost and 127.0.0.1 are only for sandbox-internal checks, never user-facing URLs.",
        "For preview servers, the command should follow this shape, adapting the session name, directory, port, and server command to the task: mkdir -p <serve-dir>; tmux kill-session -t <session-name> 2>/dev/null || true; tmux new-session -d -s <session-name> 'cd <serve-dir> && <server-command-binding-0.0.0.0:port>'; sleep 1; curl -fsS http://127.0.0.1:<port>/<optional-path>. Then call sandbox_get_host with the same port and use its public URL in the final answer.",
        "Never run long-lived servers in the foreground, including simple static file servers. Never verify with http://0.0.0.0:<port>. Never present localhost, 127.0.0.1, or 0.0.0.0 as the user-facing URL. If a preview port or session is already in use, stop only the tmux session created for that preview and restart it; do not use broad process kills such as pkill -f http.server.",
        "For uploaded PDFs, Word documents, spreadsheets, CSVs, or other non-image files, call upload_file with the file_id first, then use the returned sandbox path inside run_code or run_command. Do not try to inline binary content. The sandbox auto-pauses after inactivity and auto-resumes on traffic with memory and filesystem preserved. Do not ask for a sandbox_id or auto_pause value; this chat session already owns one sandbox. Use download_file when generated output should be saved to the local file library for the user.",
      ].join(" ")
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

function createToolCallEvent({
  input,
  runningToolCallsByName,
  seenToolCalls,
  toolCallId,
  toolEventSeq,
  toolName,
}: {
  input: unknown
  runningToolCallsByName: Map<string, Set<string>>
  seenToolCalls: Map<string, string>
  toolCallId: string
  toolEventSeq: number
  toolName: string
}) {
  if (seenToolCalls.has(toolCallId)) {
    debugStudioChatTool("tool_call_duplicate_skipped", {
      seq: toolEventSeq,
      toolCallId,
      toolName,
      firstToolName: seenToolCalls.get(toolCallId),
    })
    return null
  }

  seenToolCalls.set(toolCallId, toolName)
  markToolCallRunning(runningToolCallsByName, toolCallId, toolName)
  debugStudioChatTool("tool_call_emit", {
    seq: toolEventSeq,
    toolCallId,
    toolName,
    inputPreview: truncateDebugValue(input),
  })

  return {
    type: "tool_call",
    id: toolCallId,
    name: toolName,
    input: stringifyToolPayload(getToolCallInput(input)),
  } satisfies AgentEvent
}

async function* streamLangChainRun({
  messages,
  model,
  reasoningEffort,
  sessionId,
  signal,
}: AgentRunInput): AsyncGenerator<AgentEvent> {
  const queue = new AgentEventQueue()
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
    const sandboxManifest = modelverseApiKey
      ? createAvailableSessionFilesManifest(sessionId)
      : ""
    const nativeTools = createStudioAgentTools({
      sessionId,
      modelverseApiKey,
    })
    mcpToolClient = await createStudioMcpToolClient()
    const tools = wrapToolsWithPermissionGateway(
      [...nativeTools, ...mcpToolClient.tools],
      {
        sessionId,
        permissionMode: session?.permissionMode ?? "ask",
        projectId: session?.projectId ?? null,
        signal,
        emit: (event) => queue.push(event),
      }
    )
    const hasWebFetch = tools.some(
      (agentTool) => agentTool.name === "web_fetch"
    )
    const hasWebSearch = tools.some(
      (agentTool) => agentTool.name === "web_search"
    )
    const hasRunCode = tools.some((agentTool) => agentTool.name === "run_code")
    const hasMcpTools = tools.some((agentTool) => isMcpToolName(agentTool.name))
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
      { messages },
      {
        version: "v3",
        signal,
      }
    )
    const runOutput = run.output.catch((error) => {
      if (isAbortLikeError(error, signal)) {
        return null
      }

      throw error
    })
    const seenToolCalls = new Map<string, string>()
    const runningToolCallsByName = new Map<string, Set<string>>()
    const toolRunIdAliases = new Map<string, string>()
    let toolEventSeq = 0

    const pumpEvents = (async () => {
      for await (const rawEvent of run) {
        const { method, data, event, name, runId } = getRawEventData(rawEvent)

        if (!data) {
          continue
        }

        if (method === "messages") {
          if (data.event === "content-block-delta") {
            const delta = getRecord(data.delta)

            if (delta?.type === "reasoning-delta") {
              queue.push({
                type: "reasoning_delta",
                delta:
                  typeof delta.reasoning === "string" ? delta.reasoning : "",
              })
            }

            if (delta?.type === "text-delta") {
              queue.push({
                type: "text_delta",
                delta: typeof delta.text === "string" ? delta.text : "",
              })
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
              const toolCallEvent = createToolCallEvent({
                toolCallId:
                  typeof contentBlock.id === "string"
                    ? contentBlock.id
                    : randomUUID(),
                toolName: contentBlock.name,
                input: contentBlock.args ?? contentBlock.input ?? "",
                runningToolCallsByName,
                seenToolCalls,
                toolEventSeq: ++toolEventSeq,
              })

              if (toolCallEvent) {
                queue.push(toolCallEvent)
              }
            }
          }
        }

        if (
          event === "on_tool_start" ||
          event === "on_tool_end" ||
          event === "on_tool_error"
        ) {
          const fallbackToolCallId = getFallbackToolCallId(data, runId)
          const fallbackToolName = resolveToolNameForEvent({
            data,
            fallbackName: name,
            toolCallId: fallbackToolCallId,
            seenToolCalls,
          })
          const toolCallId = resolveToolCallIdForEvent({
            data,
            runningToolCallsByName,
            toolName: fallbackToolName,
            toolRunIdAliases,
            runId,
          })
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
            const toolCallEvent = createToolCallEvent({
              toolCallId,
              toolName,
              input: getToolInput(data),
              runningToolCallsByName,
              seenToolCalls,
              toolEventSeq: ++toolEventSeq,
            })

            if (toolCallEvent) {
              queue.push(toolCallEvent)
            }
          }

          if (event === "on_tool_end") {
            queue.push({
              type: "tool_result",
              id: toolCallId,
              name: toolName,
              status: "complete",
              output: stringifyToolPayload(getToolOutput(data.output)),
            })
            markToolCallFinished(
              runningToolCallsByName,
              toolCallId,
              toolName
            )
          }

          if (event === "on_tool_error") {
            queue.push({
              type: "tool_result",
              id: toolCallId,
              name: toolName,
              status: "error",
              error: stringifyToolPayload(
                getToolOutput(data.error ?? data.output)
              ),
            })
            markToolCallFinished(
              runningToolCallsByName,
              toolCallId,
              toolName
            )
          }
        }

        if (method === "tools") {
          const fallbackToolCallId = getFallbackToolCallId(data, runId)
          const fallbackToolName = resolveToolNameForEvent({
            data,
            fallbackName: name,
            toolCallId: fallbackToolCallId,
            seenToolCalls,
          })
          const toolCallId = resolveToolCallIdForEvent({
            data,
            runningToolCallsByName,
            toolName: fallbackToolName,
            toolRunIdAliases,
            runId,
          })
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
            const toolCallEvent = createToolCallEvent({
              toolCallId,
              toolName,
              input: getToolInput(data),
              runningToolCallsByName,
              seenToolCalls,
              toolEventSeq: ++toolEventSeq,
            })

            if (toolCallEvent) {
              queue.push(toolCallEvent)
            }
          }

          if (data.event === "tool-finished") {
            queue.push({
              type: "tool_result",
              id: toolCallId,
              name: toolName,
              status: "complete",
              output: stringifyToolPayload(getToolOutput(data.output)),
            })
            markToolCallFinished(
              runningToolCallsByName,
              toolCallId,
              toolName
            )
          }

          if (data.event === "tool-error") {
            queue.push({
              type: "tool_result",
              id: toolCallId,
              name: toolName,
              status: "error",
              error: stringifyToolPayload(
                getToolOutput(data.message ?? data.error)
              ),
            })
            markToolCallFinished(
              runningToolCallsByName,
              toolCallId,
              toolName
            )
          }
        }
      }

      await runOutput
    })()
    const done = pumpEvents
      .then(() => queue.close())
      .catch((error) => {
        if (isAbortLikeError(error, signal)) {
          queue.close()
          return
        }

        queue.fail(error)
      })

    for await (const event of queue) {
      yield event
    }

    await done
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

export const langChainAgentRuntime: AgentRuntime = {
  info: {
    id: "langchain",
    label: "AstraFlow Agent",
    description: "内置 LangChain agent",
    capabilities: {
      hitl: true,
      resume: false,
      subagents: false,
      plan: false,
      sandbox: true,
      mcp: true,
      skills: true,
    },
  },
  startRun(input) {
    return streamLangChainRun(input)
  },
}

registerAgentRuntime(langChainAgentRuntime)
