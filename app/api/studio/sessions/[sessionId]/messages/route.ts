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
import { syncStudioMessageMediaParts } from "@/lib/studio-message-media-sync"
import type { PromptMention } from "@/lib/agent/composer-types"
import type { StudioAttachment } from "@/lib/studio-types"

export const runtime = "nodejs"

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const MAX_MENTIONS = 100

function normalizePromptMentions(value: unknown): PromptMention[] {
  if (!Array.isArray(value)) {
    return []
  }

  const mentions: PromptMention[] = []

  for (const item of value.slice(0, MAX_MENTIONS)) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue
    }

    const record = item as Record<string, unknown>

    if (record.kind === "file" || record.kind === "folder") {
      const path = typeof record.path === "string" ? record.path.trim() : ""
      const name = typeof record.name === "string" ? record.name.trim() : ""

      if (!path || !name || path.length > 4_000 || name.length > 255) {
        continue
      }

      if (record.kind === "file") {
        const mention: PromptMention = { kind: "file", path, name }
        const mimeType =
          typeof record.mimeType === "string" ? record.mimeType.trim() : ""

        if (mimeType && mimeType.length <= 255) {
          mention.mimeType = mimeType
        }

        mentions.push(mention)
        continue
      }

      mentions.push({ kind: "folder", path, name })
      continue
    }

    if (record.kind === "session") {
      const sessionId =
        typeof record.sessionId === "string" ? record.sessionId.trim() : ""
      const title = typeof record.title === "string" ? record.title.trim() : ""

      if (
        sessionId &&
        title &&
        sessionId.length <= 120 &&
        title.length <= 255
      ) {
        mentions.push({ kind: "session", sessionId, title })
      }
    }
  }

  return mentions
}

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
  parentTaskId: z.string().trim().min(1).max(120).nullable().optional(),
})

const permissionOptionSchema = z.object({
  optionId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(80),
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
})

const userInputOptionSchema = z.object({
  optionId: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).default(""),
})

const userInputQuestionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  header: z.string().trim().min(1).max(80),
  question: z.string().trim().min(1).max(1_000),
  options: z.array(userInputOptionSchema).max(8).default([]),
  allowOther: z.boolean().default(true),
  isSecret: z.boolean().default(false),
})

const userInputAnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(120),
  optionId: z.string().trim().min(1).max(120).nullable(),
  label: z.string().trim().max(200).nullable(),
  text: z.string().trim().max(2_000),
})

const mediaGenerationOutputSchema = z.object({
  id: z.string().trim().min(1).max(160),
  index: z.number().int().nonnegative().max(1_000),
  sessionFileId: z.string().trim().min(1).max(160).nullable().optional(),
  contentUrl: z.string().trim().min(1).max(4_000),
  url: z.string().trim().max(4_000).nullable().default(null),
  storagePath: z.string().trim().max(4_000).nullable().default(null),
  mimeType: z.string().trim().max(255).nullable().default(null),
  width: z.number().int().positive().max(100_000).nullable().default(null),
  height: z.number().int().positive().max(100_000).nullable().default(null),
  durationSeconds: z.number().nonnegative().nullable().optional(),
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
          priority: z.string().trim().max(120).nullable().optional(),
        })
      )
      .max(120),
  }),
  z.object({
    id: z.string().trim().min(1).max(160),
    type: z.literal("subagent"),
    taskId: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(160),
    status: z.enum(["running", "complete", "error", "cancelled"]),
    taskInput: z.string().max(20_000).default(""),
    content: z.string().max(160_000).default(""),
    summary: z.string().max(80_000).nullable().default(null),
    error: z.string().max(10_000).nullable().default(null),
    todos: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(2_000),
          status: z.enum(["completed", "in_progress", "pending"]),
          priority: z.string().trim().max(120).nullable().optional(),
        })
      )
      .max(120)
      .default([]),
    activities: z.array(activitySchema).max(120).default([]),
    parentTaskId: z.string().trim().min(1).max(120).nullable().optional(),
  }),
  z.object({
    id: z.string().trim().min(1).max(160),
    type: z.literal("file"),
    path: z.string().trim().min(1).max(2_000),
    kind: z.enum(["create", "edit", "delete"]),
    status: z.enum(["complete", "error"]),
    error: z.string().max(10_000).nullable().default(null),
    content: z.string().max(4_000).default(""),
    parentTaskId: z.string().trim().min(1).max(120).nullable().optional(),
  }),
  z.object({
    id: z.string().trim().min(1).max(160),
    type: z.literal("media_generation"),
    kind: z.enum(["image", "video"]),
    generationId: z.string().trim().min(1).max(160),
    status: z.enum([
      "queued",
      "running",
      "polling",
      "complete",
      "partial",
      "error",
      "cancelled",
    ]),
    modelName: z.string().trim().min(1).max(255),
    prompt: z.string().max(8_000),
    phase: z.string().trim().max(120).nullable().optional(),
    progress: z.number().min(0).max(1).nullable().optional(),
    rawStatus: z.string().trim().max(255).nullable().optional(),
    outputs: z.array(mediaGenerationOutputSchema).max(20).default([]),
    errorMessage: z.string().max(10_000).nullable().default(null),
    providerTaskId: z.string().trim().min(1).max(255).nullable().optional(),
    providerRequestId: z.string().trim().min(1).max(255).nullable().optional(),
    parentTaskId: z.string().trim().min(1).max(120).nullable().optional(),
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
  z.object({
    id: z.string().trim().min(1).max(120),
    type: z.literal("user_input"),
    status: z.enum(["pending", "answered", "cancelled"]),
    questions: z.array(userInputQuestionSchema).min(1).max(3),
    answers: z.array(userInputAnswerSchema).max(3).default([]),
    autoResolutionMs: z.number().int().positive().nullable().default(null),
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
    mentions: z.unknown().optional().transform(normalizePromptMentions),
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

  const messages = versionGroupId
    ? listStudioMessageVersions(sessionId, versionGroupId)
    : listStudioMessages(sessionId)

  return NextResponse.json({
    ok: true,
    data: syncStudioMessageMediaParts(sessionId, messages),
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
