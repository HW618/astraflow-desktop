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
import { createModelverseChatModel } from "@/lib/modelverse-langchain"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/modelverse-openai"
import { getStudioSession, listStudioMessages } from "@/lib/studio-db"

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

function getToolCallId(call: { callId?: unknown }) {
  if (typeof call.callId === "string") {
    return call.callId
  }

  return crypto.randomUUID()
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
        parts.push({
          type: "image_url",
          image_url: { url: attachment.dataUrl },
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

function getAgentSystemPrompt(hasWebSearch: boolean) {
  if (!hasWebSearch) {
    return DEFAULT_SYSTEM_PROMPT
  }

  return `${DEFAULT_SYSTEM_PROMPT}

You have access to a web_search tool backed by Exa. Use it when the user asks for web search, latest/current information, source-backed facts, or details that may have changed recently. When using web_search, cite source URLs in the final answer.`
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
    const tools = createStudioAgentTools()
    const agent = createAgent({
      model,
      tools,
      systemPrompt: getAgentSystemPrompt(tools.length > 0),
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
        recursionLimit: tools.length > 0 ? 8 : 2,
      }
    )

    const encoder = new TextEncoder()

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            const enqueue = (event: ChatStreamEvent) => {
              controller.enqueue(encodeStreamEvent(encoder, event))
            }

            const messagesTask = (async () => {
              for await (const message of run.messages) {
                for await (const event of message) {
                  if (event.event !== "content-block-delta") {
                    continue
                  }

                  if (event.delta.type === "reasoning-delta") {
                    enqueue({
                      type: "reasoning",
                      delta: event.delta.reasoning,
                    })
                  }

                  if (event.delta.type === "text-delta") {
                    enqueue({
                      type: "content",
                      delta: event.delta.text,
                    })
                  }
                }
              }
            })()

            const toolCallsTask = (async () => {
              for await (const call of run.toolCalls) {
                if (call.name !== "web_search") {
                  continue
                }

                const toolCallId = getToolCallId(call)

                enqueue({
                  type: "tool_call",
                  toolCallId,
                  toolName: call.name,
                  input: stringifyToolPayload(call.input),
                })

                const status = await call.status

                if (status === "finished") {
                  enqueue({
                    type: "tool_result",
                    toolCallId,
                    toolName: call.name,
                    status: "complete",
                    output: stringifyToolPayload(await call.output),
                  })
                } else if (status === "error") {
                  enqueue({
                    type: "tool_result",
                    toolCallId,
                    toolName: call.name,
                    status: "error",
                    error: stringifyToolPayload(await call.error),
                  })
                }
              }
            })()

            await Promise.all([messagesTask, toolCallsTask])

            await run.output
          } catch (error) {
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
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Chat request failed.",
      },
      { status: 500 }
    )
  }
}
