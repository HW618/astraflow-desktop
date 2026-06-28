import { NextResponse } from "next/server"
import { z } from "zod"

import {
  createStudioMessage,
  getStudioSession,
  listStudioMessages,
} from "@/lib/studio-db"

export const runtime = "nodejs"

const createMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(80_000),
  status: z.enum(["complete", "streaming", "error"]).default("complete"),
})

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: listStudioMessages(sessionId),
  })
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  const parsed = createMessageSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const message = createStudioMessage({
    sessionId,
    ...parsed.data,
  })

  return NextResponse.json({ ok: true, data: message }, { status: 201 })
}
