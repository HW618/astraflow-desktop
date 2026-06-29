import { NextResponse } from "next/server"
import { z } from "zod"

import {
  createStudioMessage,
  getStudioSession,
  listStudioMessages,
} from "@/lib/studio-db"

export const runtime = "nodejs"

const attachmentSchema = z.object({
  type: z.literal("image"),
  name: z.string().trim().min(1).max(255),
  mimeType: z
    .string()
    .trim()
    .regex(/^image\/[a-z0-9.+-]+$/i, "Only image attachments are supported."),
  dataUrl: z
    .string()
    .trim()
    .regex(/^data:image\//i, "Attachment must be a base64 data URL.")
    .max(12_000_000),
})

const createMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().max(80_000).default(""),
    reasoningContent: z.string().trim().max(160_000).default(""),
    reasoningDurationMs: z
      .number()
      .int()
      .nonnegative()
      .max(86_400_000)
      .nullable()
      .default(null),
    status: z.enum(["complete", "streaming", "error"]).default("complete"),
    attachments: z.array(attachmentSchema).max(6).default([]),
  })
  .refine(
    (value) =>
      value.content.length > 0 ||
      value.reasoningContent.length > 0 ||
      value.attachments.length > 0,
    { message: "Message must include text or an attachment." }
  )

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
