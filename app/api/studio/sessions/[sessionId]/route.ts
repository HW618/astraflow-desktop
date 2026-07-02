import { NextResponse } from "next/server"
import { z } from "zod"

import {
  deleteStudioSession,
  getStudioModelverseApiKey,
  getStudioSession,
  getStudioSessionSandbox,
  updateStudioSessionTitle,
} from "@/lib/studio-db"
import { cleanupSessionSandboxVolumeData } from "@/lib/astraflow-session-sandbox"

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

  const sandbox = getStudioSessionSandbox(sessionId)

  if (sandbox?.volumePath) {
    const apiKey = getStudioModelverseApiKey()

    if (!apiKey?.key) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Modelverse API key is required to remove this session's sandbox volume data.",
        },
        { status: 400 }
      )
    }

    try {
      await cleanupSessionSandboxVolumeData({
        sessionId,
        apiKey: apiKey.key,
      })
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to remove session sandbox volume data.",
        },
        { status: 502 }
      )
    }
  }

  deleteStudioSession(sessionId)

  return NextResponse.json({ ok: true, data: { id: sessionId } })
}
