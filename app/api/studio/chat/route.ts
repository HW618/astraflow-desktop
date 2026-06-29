import { NextResponse } from "next/server"
import { z } from "zod"
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages"
import { createAgent } from "langchain"

import { getAppAuthState } from "@/lib/app-auth"
import {
  DEFAULT_CHAT_MODEL,
  resolveChatReasoningEffort,
  SUPPORTED_CHAT_MODELS,
  SUPPORTED_CHAT_REASONING_EFFORTS,
} from "@/lib/chat-models"
import { createStudioAgentTools } from "@/lib/exa-tools"
import {
  createAvailableSessionFilesManifest,
  describeAttachmentForPrompt,
} from "@/lib/e2b-session-sandbox"
import { createModelverseChatModel } from "@/lib/modelverse-langchain"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/modelverse-openai"
import {
  getStudioModelverseApiKey,
  getStudioSession,
  listStudioMessages,
} from "@/lib/studio-db"

export const runtime = "nodejs"

const chatRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  model: z.enum(SUPPORTED_CHAT_MODELS).default(DEFAULT_CHAT_MODEL),
  reasoningEffort: z.enum(SUPPORTED_CHAT_REASONING_EFFORTS).optional(),
  retryMessageId: z.string().trim().min(1).optional(),
})

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

const STUDIO_CHAT_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"

function truncateDebugValue(value: unknown, maxLength = 260) {
  const text = stringifyToolPayload(value).replace(/\s+/g, " ").trim()

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function debugStudioChatTool(
  label: string,
  payload: Record<string, unknown>
) {
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

function closeStreamController(controller: ReadableStreamDefaultController) {
  try {
    controller.close()
  } catch {
    // The client may already have disconnected.
  }
}

function encodeStreamEvent(encoder: TextEncoder, event: ChatStreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`)
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

function isVisibleToolName(
  name: unknown
): name is
  | "web_search"
  | "web_fetch"
  | "run_code"
  | "run_command"
  | "upload_file"
  | "list_files"
  | "read_file"
  | "write_file"
  | "download_file" {
  return (
    name === "web_search" ||
    name === "web_fetch" ||
    name === "run_code" ||
    name === "run_command" ||
    name === "upload_file" ||
    name === "list_files" ||
    name === "read_file" ||
    name === "write_file" ||
    name === "download_file"
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

  return id ?? crypto.randomUUID()
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

  const messages = effectiveHistory.map((message) => {
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

  return messages
}

function getAgentSystemPrompt({
  hasWebFetch,
  hasWebSearch,
  hasRunCode,
  sandboxManifest,
}: {
  hasWebFetch: boolean
  hasWebSearch: boolean
  hasRunCode: boolean
  sandboxManifest: string
}) {
  if (!hasWebFetch && !hasWebSearch && !hasRunCode) {
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
      "You have access to a persistent per-chat E2B code-interpreter-v1 sandbox through run_code, run_command, and file tools: upload_file, list_files, read_file, write_file, and download_file. Use run_code for calculations, data processing, document analysis, and scripts in python, javascript, typescript, bash, r, or java. Use run_command for direct shell commands, bash pipelines, package/environment inspection, and filesystem operations; it runs through sandbox.commands.run with /bin/bash -l -c. For uploaded PDFs, Word documents, spreadsheets, CSVs, or other non-image files, call upload_file with the file_id first, then use the returned sandbox path inside run_code or run_command. Do not try to inline binary content. The sandbox auto-pauses after inactivity and auto-resumes on traffic with memory and filesystem preserved. Do not ask for a sandbox_id or auto_pause value; this chat session already owns one sandbox. Use download_file when generated output should be saved to the local file library for the user."
    )
  }

  return `${DEFAULT_SYSTEM_PROMPT}

${toolInstructions.join("\n")}
${sandboxManifest ? `\n${sandboxManifest}` : ""}`
}

export async function POST(request: Request) {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  const parsed = chatRequestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const session = getStudioSession(parsed.data.sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  try {
    const reasoningEffort = resolveChatReasoningEffort(
      parsed.data.model,
      parsed.data.reasoningEffort
    )
    const model = createModelverseChatModel(parsed.data.model, reasoningEffort)
    const modelverseApiKey = getStudioModelverseApiKey()?.key ?? null
    const sandboxManifest = modelverseApiKey
      ? createAvailableSessionFilesManifest(parsed.data.sessionId)
      : ""

    const tools = createStudioAgentTools({
      sessionId: parsed.data.sessionId,
      modelverseApiKey,
    })
    const hasWebFetch = tools.some((agentTool) => agentTool.name === "web_fetch")
    const hasWebSearch = tools.some(
      (agentTool) => agentTool.name === "web_search"
    )
    const hasRunCode = tools.some((agentTool) => agentTool.name === "run_code")
    const agent = createAgent({
      model,
      tools,
      systemPrompt: getAgentSystemPrompt({
        hasWebFetch,
        hasWebSearch,
        hasRunCode,
        sandboxManifest,
      }),
    })
    const run = await agent.streamEvents(
      {
        messages: toLangChainMessages(
          parsed.data.sessionId,
          parsed.data.retryMessageId
        ),
      },
      {
        version: "v3",
        signal: request.signal,
      }
    )
    const runOutput = run.output.catch((error) => {
      if (isAbortLikeError(error, request.signal)) {
        return null
      }

      throw error
    })

    const encoder = new TextEncoder()

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            const enqueue = (event: ChatStreamEvent) => {
              controller.enqueue(encodeStreamEvent(encoder, event))
            }

            const seenToolCalls = new Map<string, string>()
            let toolEventSeq = 0

            const enqueueToolCall = ({
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
              enqueue({
                type: "tool_call",
                toolCallId,
                toolName,
                input: stringifyToolPayload(getToolCallInput(input)),
              })
            }

            for await (const rawEvent of run) {
              const { method, data, event, name, runId } =
                getRawEventData(rawEvent)

              if (!data) {
                continue
              }

              if (method === "messages") {
                if (data.event === "content-block-delta") {
                  const delta = getRecord(data.delta)

                  if (delta?.type === "reasoning-delta") {
                    enqueue({
                      type: "reasoning",
                      delta:
                        typeof delta.reasoning === "string"
                          ? delta.reasoning
                          : "",
                    })
                  }

                  if (delta?.type === "text-delta") {
                    enqueue({
                      type: "content",
                      delta:
                        typeof delta.text === "string" ? delta.text : "",
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
                        typeof contentBlock.id === "string"
                          ? contentBlock.id
                          : null,
                      toolName: contentBlock.name,
                      dataKeys: Object.keys(data),
                    })
                    enqueueToolCall({
                      toolCallId:
                        typeof contentBlock.id === "string"
                          ? contentBlock.id
                          : crypto.randomUUID(),
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

                debugStudioChatTool("langchain_tool_event_resolved", {
                  seq: ++toolEventSeq,
                  event,
                  toolName,
                  toolCallId,
                  runId,
                  seenStartForId: seenToolCalls.has(toolCallId),
                  inputPreview:
                    event === "on_tool_start"
                      ? truncateDebugValue(getToolInput(data))
                      : undefined,
                  outputLength:
                    event === "on_tool_end"
                      ? stringifyToolPayload(getToolOutput(data.output)).length
                      : undefined,
                  errorPreview:
                    event === "on_tool_error"
                      ? truncateDebugValue(getToolOutput(data.error))
                      : undefined,
                })

                if (event === "on_tool_start") {
                  enqueueToolCall({
                    toolCallId,
                    toolName,
                    input: getToolInput(data),
                  })
                }

                if (event === "on_tool_end") {
                  enqueue({
                    type: "tool_result",
                    toolCallId,
                    toolName,
                    status: "complete",
                    output: stringifyToolPayload(getToolOutput(data.output)),
                  })
                }

                if (event === "on_tool_error") {
                  enqueue({
                    type: "tool_result",
                    toolCallId,
                    toolName,
                    status: "error",
                    error: stringifyToolPayload(
                      getToolOutput(data.error ?? data.output)
                    ),
                  })
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

                debugStudioChatTool("custom_tool_event_seen", {
                  seq: ++toolEventSeq,
                  event: data.event,
                  method,
                  name,
                  runId,
                  toolName,
                  dataKeys: Object.keys(data),
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

                debugStudioChatTool("custom_tool_event_resolved", {
                  seq: ++toolEventSeq,
                  event: data.event,
                  toolName,
                  toolCallId,
                  runId,
                  seenStartForId: seenToolCalls.has(toolCallId),
                  inputPreview:
                    data.event === "tool-started"
                      ? truncateDebugValue(getToolInput(data))
                      : undefined,
                  outputLength:
                    data.event === "tool-finished"
                      ? stringifyToolPayload(getToolOutput(data.output)).length
                      : undefined,
                  errorPreview:
                    data.event === "tool-error"
                      ? truncateDebugValue(data.message ?? data.error)
                      : undefined,
                })

                if (data.event === "tool-started") {
                  enqueueToolCall({
                    toolCallId,
                    toolName,
                    input: getToolInput(data),
                  })
                }

                if (data.event === "tool-finished") {
                  enqueue({
                    type: "tool_result",
                    toolCallId,
                    toolName,
                    status: "complete",
                    output: stringifyToolPayload(getToolOutput(data.output)),
                  })
                }

                if (data.event === "tool-error") {
                  enqueue({
                    type: "tool_result",
                    toolCallId,
                    toolName,
                    status: "error",
                    error: stringifyToolPayload(
                      getToolOutput(data.message ?? data.error)
                    ),
                  })
                }
              }
            }

            await runOutput
          } catch (error) {
            if (isAbortLikeError(error, request.signal)) {
              closeStreamController(controller)
              return
            }

            console.error("[studio-chat:tool] stream_failed", error)
            controller.error(error)
            return
          }

          controller.close()
        },
      }),
      {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }
    )
  } catch (error) {
    if (isAbortLikeError(error, request.signal)) {
      return new Response(null, { status: 499 })
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Chat request failed.",
      },
      { status: 500 }
    )
  }
}
