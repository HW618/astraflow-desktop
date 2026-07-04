import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  createStudioSessionFile,
  createStudioMessage,
  getStudioSession,
  listStudioMessageVersions,
  listStudioMessages,
} from "@/lib/studio-db"
import {
  createAttachmentStoragePath,
  parseDataUrl,
  writeStudioFile,
} from "@/lib/studio-file-storage"
import type { StudioAttachment } from "@/lib/studio-types"

export const runtime = "nodejs"

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

const attachmentSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  type: z.enum(["image", "file"]),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES).optional(),
  dataUrl: z
    .string()
    .trim()
    .regex(/^data:/i, "Attachment must be a data URL.")
    .max(Math.ceil(MAX_ATTACHMENT_BYTES * 1.4)),
})

const activitySchema = z.object({
  id: z.string().trim().min(1).max(120),
  toolName: z.string().trim().min(1).max(120),
  status: z.enum(["running", "complete", "error"]),
  input: z.string().trim().max(20_000).default(""),
  output: z.string().trim().max(120_000).default(""),
  error: z.string().trim().max(10_000).nullable().default(null),
})

const permissionOptionSchema = z.object({
  optionId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(80),
})

const messagePartSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().trim().min(1).max(120),
    type: z.literal("text"),
    content: z.string().max(80_000),
  }),
  z.object({
    id: z.string().trim().min(1).max(120),
    type: z.literal("reasoning"),
    content: z.string().max(160_000),
    durationMs: z
      .number()
      .int()
      .nonnegative()
      .max(86_400_000)
      .nullable()
      .default(null),
  }),
  z.object({
    id: z.string().trim().min(1).max(120),
    type: z.literal("tool"),
    activity: activitySchema,
  }),
  z.object({
    id: z.string().trim().min(1).max(120),
    type: z.literal("plan"),
    content: z.string().max(80_000).default(""),
    todos: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(2_000),
          status: z.enum(["completed", "in_progress", "pending"]),
        })
      )
      .max(120),
  }),
  z.object({
    id: z.string().trim().min(1).max(120),
    type: z.literal("permission"),
    toolName: z.string().trim().min(1).max(120),
    input: z.string().max(20_000),
    status: z.enum(["pending", "approved", "denied", "cancelled"]),
    options: z.array(permissionOptionSchema).max(12),
    selectedOptionId: z.string().trim().min(1).max(120).nullable(),
  }),
])

const createMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().max(80_000).default(""),
    model: z.string().trim().min(1).max(120).nullable().default(null),
    versionGroupId: z.string().trim().min(1).max(120).nullable().default(null),
    replacesMessageId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
    activities: z.array(activitySchema).max(20).default([]),
    parts: z.array(messagePartSchema).max(120).default([]),
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
      value.attachments.length > 0 ||
      value.activities.length > 0 ||
      value.parts.length > 0,
    { message: "Message must include text, an attachment, or activity." }
  )

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

type PendingSessionFileRecord = {
  id: string
  originalName: string
  mimeType: string
  size: number
  storagePath: string
}

function processAttachments({
  sessionId,
  messageId,
  attachments,
}: {
  sessionId: string
  messageId: string
  attachments: z.infer<typeof attachmentSchema>[]
}): {
  attachments: StudioAttachment[]
  files: PendingSessionFileRecord[]
} {
  const files: PendingSessionFileRecord[] = []
  const processedAttachments = attachments.map((attachment) => {
    const attachmentId = attachment.id || randomUUID()
    const parsed = parseDataUrl(attachment.dataUrl)

    if (parsed.buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment ${attachment.name} is larger than 50 MB.`)
    }

    const mimeType = parsed.mimeType || attachment.mimeType
    const type: StudioAttachment["type"] = mimeType.startsWith("image/")
      ? "image"
      : "file"
    const storagePath = createAttachmentStoragePath({
      sessionId,
      messageId,
      attachmentId,
      name: attachment.name,
    })

    writeStudioFile(storagePath, parsed.buffer)
    files.push({
      id: attachmentId,
      originalName: attachment.name,
      mimeType,
      size: parsed.buffer.byteLength,
      storagePath,
    })

    return {
      id: attachmentId,
      type,
      name: attachment.name,
      mimeType,
      size: parsed.buffer.byteLength,
      dataUrl: type === "image" ? attachment.dataUrl : null,
      storagePath,
      sandboxPath: null,
    }
  })

  return { attachments: processedAttachments, files }
}

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params
  const url = new URL(request.url)
  const versionGroupId = url.searchParams.get("versionGroupId")?.trim()

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: versionGroupId
      ? listStudioMessageVersions(sessionId, versionGroupId)
      : listStudioMessages(sessionId),
  })
}

export async function POST(request: Request, context: RouteContext) {
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

  const parsed = createMessageSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const messageId = randomUUID()

  try {
    const processed = processAttachments({
      sessionId,
      messageId,
      attachments: parsed.data.attachments,
    })
    const message = createStudioMessage({
      id: messageId,
      sessionId,
      ...parsed.data,
      attachments: processed.attachments,
    })

    for (const file of processed.files) {
      createStudioSessionFile({
        id: file.id,
        sessionId,
        messageId,
        kind: "attachment",
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        storagePath: file.storagePath,
      })
    }

    return NextResponse.json({ ok: true, data: message }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to save attachment.",
      },
      { status: 400 }
    )
  }
}
