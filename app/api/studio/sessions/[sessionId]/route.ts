import { NextResponse } from "next/server"
import { z } from "zod"

import {
  deleteStudioSession,
  getStudioSession,
  updateStudioSessionTitle,
} from "@/lib/studio-db"

export const runtime = "nodejs"

const updateSessionSchema = z.object({
  title: z.string().trim().min(1).max(120),
})

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  const parsed = updateSessionSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const session = updateStudioSessionTitle(sessionId, parsed.data.title)

  return NextResponse.json({ ok: true, data: session })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  deleteStudioSession(sessionId)

  return NextResponse.json({ ok: true, data: { id: sessionId } })
}
