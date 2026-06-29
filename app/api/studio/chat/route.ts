import { NextResponse } from "next/server"
import { z } from "zod"
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages"

import { getAppAuthState } from "@/lib/app-auth"
import {
  DEFAULT_CHAT_MODEL,
  resolveChatReasoningEffort,
  SUPPORTED_CHAT_MODELS,
  SUPPORTED_CHAT_REASONING_EFFORTS,
} from "@/lib/chat-models"
import { createModelverseChatModel } from "@/lib/modelverse-langchain"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/modelverse-openai"
import { getStudioSession, listStudioMessages } from "@/lib/studio-db"

export const runtime = "nodejs"

const chatRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  model: z.enum(SUPPORTED_CHAT_MODELS).default(DEFAULT_CHAT_MODEL),
  reasoningEffort: z.enum(SUPPORTED_CHAT_REASONING_EFFORTS).optional(),
})

type ChatStreamEvent = {
  type: "content" | "reasoning"
  delta: string
}

function encodeStreamEvent(encoder: TextEncoder, event: ChatStreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`)
}

function toLangChainMessages(sessionId: string): BaseMessage[] {
  const history = listStudioMessages(sessionId)

  const messages = history.map((message) => {
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

  return [new SystemMessage(DEFAULT_SYSTEM_PROMPT), ...messages]
}

function extractTextDelta(content: MessageContent) {
  if (typeof content === "string") {
    return content
  }

  return content
    .map((part) =>
      part.type === "text" && "text" in part && typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("")
}

function extractReasoningDelta(chunk: BaseMessage) {
  const providerReasoning = chunk.additional_kwargs.reasoning_content

  if (typeof providerReasoning === "string") {
    return providerReasoning
  }

  if (Array.isArray(chunk.content)) {
    return chunk.content
      .map((part) =>
        part.type === "reasoning" &&
        "reasoning" in part &&
        typeof part.reasoning === "string"
          ? part.reasoning
          : ""
      )
      .join("")
  }

  return ""
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
    const stream = await model.stream(
      toLangChainMessages(parsed.data.sessionId)
    )

    const encoder = new TextEncoder()

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const reasoningContent = extractReasoningDelta(chunk)
              const content = extractTextDelta(chunk.content)

              if (reasoningContent) {
                controller.enqueue(
                  encodeStreamEvent(encoder, {
                    type: "reasoning",
                    delta: reasoningContent,
                  })
                )
              }

              if (content) {
                controller.enqueue(
                  encodeStreamEvent(encoder, {
                    type: "content",
                    delta: content,
                  })
                )
              }
            }
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
