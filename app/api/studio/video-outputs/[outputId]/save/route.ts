import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  getStudioVideoOutput,
  saveStudioVideoOutputStorage,
} from "@/lib/studio-video-db"
import {
  downloadUrlToStudioMediaFile,
  writeDataUrlToStudioMediaFile,
} from "@/lib/studio-media-storage"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ outputId: string }>
}

export async function POST(_request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(_request)

  if (authError) {
    return authError
  }

  const { outputId } = await context.params
  const output = getStudioVideoOutput(outputId)

  if (!output) {
    return NextResponse.json(
      { ok: false, error: "Output not found." },
      { status: 404 }
    )
  }

  if (output.storagePath) {
    const saved = saveStudioVideoOutputStorage(
      outputId,
      output.storagePath,
      output.mimeType ?? null
    )
    return NextResponse.json({ ok: true, data: saved })
  }

  if (output.dataUrl) {
    try {
      const stored = writeDataUrlToStudioMediaFile({
        kind: "video",
        generationId: output.generationId,
        outputId,
        dataUrl: output.dataUrl,
        fallbackMimeType: output.mimeType,
      })
      const saved = saveStudioVideoOutputStorage(
        outputId,
        stored.storagePath,
        stored.mimeType
      )
      return NextResponse.json({ ok: true, data: saved })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save video."

      return NextResponse.json({ ok: false, error: message }, { status: 502 })
    }
  }

  if (!output.url) {
    return NextResponse.json(
      { ok: false, error: "Output has no URL to save." },
      { status: 400 }
    )
  }

  try {
    const stored = await downloadUrlToStudioMediaFile({
      kind: "video",
      generationId: output.generationId,
      outputId,
      url: output.url,
      fallbackMimeType: output.mimeType,
    })
    const saved = saveStudioVideoOutputStorage(
      outputId,
      stored.storagePath,
      stored.mimeType
    )
    return NextResponse.json({ ok: true, data: saved })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save video."

    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}
