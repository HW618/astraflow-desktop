import { NextResponse } from "next/server"
import type OpenAI from "openai"
import { z } from "zod"

import { getAppAuthState } from "@/lib/app-auth"
import { DEFAULT_CHAT_MODEL, SUPPORTED_CHAT_MODELS } from "@/lib/chat-models"
import { createModelverseClient } from "@/lib/modelverse-openai"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/modelverse-openai"
import { getStudioSession, listStudioMessages } from "@/lib/studio-db"

export const runtime = "nodejs"

const chatRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  model: z.enum(SUPPORTED_CHAT_MODELS).default(DEFAULT_CHAT_MODEL),
})

type ChatCompletionDeltaWithReasoning =
  OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
    reasoning_content?: string | null
  }

type ChatStreamEvent = {
  type: "content" | "reasoning"
  delta: string
}

function encodeStreamEvent(encoder: TextEncoder, event: ChatStreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`)
}

function toChatMessages(
  sessionId: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const history = listStudioMessages(sessionId)

  const messages = history.map((message) => {
    if (message.role === "user" && message.attachments.length > 0) {
      const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = []

      if (message.content) {
        parts.push({ type: "text", text: message.content })
      }

      for (const attachment of message.attachments) {
        parts.push({
          type: "image_url",
          image_url: { url: attachment.dataUrl },
        })
      }

      return { role: "user" as const, content: parts }
    }

    return { role: message.role, content: message.content }
  })

  return [
    {
      role: "system" as const,
      content: DEFAULT_SYSTEM_PROMPT,
    },
    ...messages,
  ]
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
    const client = createModelverseClient()
    const stream = await client.chat.completions.create({
      model: parsed.data.model,
      stream: true,
      messages: toChatMessages(parsed.data.sessionId),
    })

    const encoder = new TextEncoder()

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta as
                | ChatCompletionDeltaWithReasoning
                | undefined
              const reasoningContent = delta?.reasoning_content
              const content = delta?.content

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
