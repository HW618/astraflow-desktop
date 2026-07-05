import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  createStudioImageGeneration,
  createStudioImageOutput,
  getStudioSession,
} from "@/lib/studio-db"
import { downloadUrlToStudioMediaFile } from "@/lib/studio-media-storage"

export const runtime = "nodejs"

const saveMediaUrlSchema = z.object({
  filename: z.string().trim().min(1).max(255).optional(),
  kind: z.literal("image"),
  sessionId: z.string().trim().min(1),
  url: z.string().trim().url().max(8_000),
})

function getImageExtension(mimeType: string | null) {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/gif") return "gif"
  if (mimeType === "image/avif") return "avif"
  if (mimeType === "image/svg+xml") return "svg"

  return "png"
}

function sanitizeFilename(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}

function getPromptFromUrl(url: string, filename: string | undefined) {
  if (filename) {
    return sanitizeFilename(filename)
  }

  try {
    const parsed = new URL(url)
    const name = decodeURIComponent(
      parsed.pathname.split("/").filter(Boolean).at(-1) ?? ""
    )

    return sanitizeFilename(name) || "Markdown image"
  } catch {
    return "Markdown image"
  }
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = saveMediaUrlSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const session = getStudioSession(parsed.data.sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found." },
      { status: 404 }
    )
  }

  const temporaryGenerationId = randomUUID()
  const outputId = randomUUID()

  try {
    const stored = await downloadUrlToStudioMediaFile({
      kind: "image",
      generationId: temporaryGenerationId,
      outputId,
      url: parsed.data.url,
    })
    const prompt = getPromptFromUrl(parsed.data.url, parsed.data.filename)
    const generation = createStudioImageGeneration({
      sessionId: parsed.data.sessionId,
      modelSquareId: "markdown-image-url",
      modelName: "Markdown image",
      manufacturer: "AstraFlow",
      openapiFile: null,
      operationId: null,
      prompt,
      params: { sourceUrl: parsed.data.url },
      status: "complete",
      phase: "saved",
      progress: 1,
      rawStatus: "saved_from_markdown",
    })
    const output = createStudioImageOutput({
      id: outputId,
      generationId: generation.id,
      index: 0,
      url: parsed.data.url,
      storagePath: stored.storagePath,
      mimeType: stored.mimeType,
      metadata: {
        filename:
          parsed.data.filename ??
          `${prompt}.${getImageExtension(stored.mimeType)}`,
        source: "markdown",
      },
      autoSave: true,
    })

    return NextResponse.json({
      ok: true,
      data: {
        output,
        contentUrl: `/api/studio/image-outputs/${encodeURIComponent(
          output.id
        )}/content`,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save image."

    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}
