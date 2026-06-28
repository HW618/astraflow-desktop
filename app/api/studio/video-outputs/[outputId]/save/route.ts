import { NextResponse } from "next/server"

import {
  getStudioVideoOutput,
  saveStudioVideoOutputData,
} from "@/lib/studio-video-db"
import { downloadVideoAsDataUrl } from "@/lib/studio-video-storage"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ outputId: string }>
}

export async function POST(_request: Request, context: RouteContext) {
  const { outputId } = await context.params
  const output = getStudioVideoOutput(outputId)

  if (!output) {
    return NextResponse.json(
      { ok: false, error: "Output not found." },
      { status: 404 }
    )
  }

  if (output.dataUrl) {
    const saved = saveStudioVideoOutputData(
      outputId,
      output.dataUrl,
      output.mimeType ?? null
    )
    return NextResponse.json({ ok: true, data: saved })
  }

  if (!output.url) {
    return NextResponse.json(
      { ok: false, error: "Output has no URL to save." },
      { status: 400 }
    )
  }

  try {
    const { dataUrl, mimeType } = await downloadVideoAsDataUrl(output.url)
    const saved = saveStudioVideoOutputData(outputId, dataUrl, mimeType)
    return NextResponse.json({ ok: true, data: saved })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save video."

    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 }
    )
  }
}
