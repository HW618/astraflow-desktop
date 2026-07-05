import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  DEFAULT_CHAT_MODEL,
  SUPPORTED_CHAT_REASONING_EFFORTS,
} from "@/lib/chat-models"
import { getStudioSession } from "@/lib/studio-db"
import {
  cancelStudioChatRun,
  getStudioChatRun,
  startStudioChatRun,
} from "@/lib/studio-chat-runner"

export const runtime = "nodejs"

const chatRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  model: z.string().trim().min(1).max(128).default(DEFAULT_CHAT_MODEL),
  reasoningEffort: z.enum(SUPPORTED_CHAT_REASONING_EFFORTS).optional(),
  runtimeId: z.string().trim().min(1).optional(),
  environment: z.enum(["remote", "local"]).optional(),
  retryMessageId: z.string().trim().min(1).optional(),
})

const cancelChatRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
})

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = chatRequestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  if (!getStudioSession(parsed.data.sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  try {
    const run = startStudioChatRun(parsed.data)

    return NextResponse.json({ ok: true, data: run }, { status: 202 })
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

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim()

  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "sessionId is required." },
      { status: 400 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: getStudioChatRun(sessionId),
  })
}

export async function DELETE(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = cancelChatRequestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const run = cancelStudioChatRun(parsed.data.sessionId)

  return NextResponse.json({ ok: true, data: run })
}
