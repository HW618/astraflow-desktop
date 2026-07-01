import { NextResponse } from "next/server"

import {
  getStudioImageOutput,
  saveStudioImageOutputStorage,
} from "@/lib/studio-db"
import {
  downloadUrlToStudioMediaFile,
  writeDataUrlToStudioMediaFile,
} from "@/lib/studio-media-storage"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ outputId: string }>
}

export async function POST(_request: Request, context: RouteContext) {
  const { outputId } = await context.params
  const output = getStudioImageOutput(outputId)

  if (!output) {
    return NextResponse.json(
      { ok: false, error: "Output not found." },
      { status: 404 }
    )
  }

  if (output.storagePath) {
    const saved = saveStudioImageOutputStorage(
      outputId,
      output.storagePath,
      output.mimeType ?? null
    )
    return NextResponse.json({ ok: true, data: saved })
  }

  if (output.dataUrl) {
    try {
      const stored = writeDataUrlToStudioMediaFile({
        kind: "image",
        generationId: output.generationId,
        outputId,
        dataUrl: output.dataUrl,
        fallbackMimeType: output.mimeType,
      })
      const saved = saveStudioImageOutputStorage(
        outputId,
        stored.storagePath,
        stored.mimeType
      )
      return NextResponse.json({ ok: true, data: saved })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save image."

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
      kind: "image",
      generationId: output.generationId,
      outputId,
      url: output.url,
      fallbackMimeType: output.mimeType,
    })
    const saved = saveStudioImageOutputStorage(
      outputId,
      stored.storagePath,
      stored.mimeType
    )
    return NextResponse.json({ ok: true, data: saved })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save image."

    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}
