import { NextResponse } from "next/server"
import { z } from "zod"

import {
  deleteStudioSession,
  getStudioLocalProject,
  getStudioSession,
  updateStudioSessionPermissionMode,
  updateStudioSessionProject,
  updateStudioSessionTitle,
} from "@/lib/studio-db"
import { studioPermissionModes } from "@/lib/studio-types"

export const runtime = "nodejs"

const updateSessionSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    projectId: z.string().trim().min(1).nullable().optional(),
    permissionMode: z.enum(studioPermissionModes).optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.projectId !== undefined ||
      value.permissionMode !== undefined
  )

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

  if (parsed.data.projectId && !getStudioLocalProject(parsed.data.projectId)) {
    return NextResponse.json(
      { ok: false, error: "Project not found" },
      { status: 404 }
    )
  }

  let session = getStudioSession(sessionId)

  if (parsed.data.title !== undefined) {
    session = updateStudioSessionTitle(sessionId, parsed.data.title)
  }

  if (parsed.data.projectId !== undefined) {
    session = updateStudioSessionProject(sessionId, parsed.data.projectId)
  }

  if (parsed.data.permissionMode !== undefined) {
    session = updateStudioSessionPermissionMode(
      sessionId,
      parsed.data.permissionMode
    )
  }

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
