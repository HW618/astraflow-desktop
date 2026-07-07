import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { SUPPORTED_CHAT_REASONING_EFFORTS } from "@/lib/chat-models"
import {
  deleteStudioSession,
  getStudioLocalProject,
  getStudioSession,
  updateStudioSessionArchived,
  updateStudioSessionChatPreferences,
  updateStudioSessionPermissionMode,
  updateStudioSessionPinned,
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
    chatModel: z.string().trim().min(1).max(128).nullable().optional(),
    chatRuntimeId: z.string().trim().min(1).max(64).nullable().optional(),
    chatReasoningEffort: z
      .enum(SUPPORTED_CHAT_REASONING_EFFORTS)
      .nullable()
      .optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.projectId !== undefined ||
      value.permissionMode !== undefined ||
      value.chatModel !== undefined ||
      value.chatRuntimeId !== undefined ||
      value.chatReasoningEffort !== undefined ||
      value.pinned !== undefined ||
      value.archived !== undefined
  )

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

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

  if (parsed.data.pinned !== undefined) {
    session = updateStudioSessionPinned(sessionId, parsed.data.pinned)
  }

  if (parsed.data.archived !== undefined) {
    session = updateStudioSessionArchived(sessionId, parsed.data.archived)
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

  if (
    parsed.data.chatModel !== undefined ||
    parsed.data.chatRuntimeId !== undefined ||
    parsed.data.chatReasoningEffort !== undefined
  ) {
    session = updateStudioSessionChatPreferences(sessionId, {
      chatModel: parsed.data.chatModel,
      chatRuntimeId: parsed.data.chatRuntimeId,
      chatReasoningEffort: parsed.data.chatReasoningEffort,
    })
  }

  return NextResponse.json({ ok: true, data: session })
}

export async function DELETE(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

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
