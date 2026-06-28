import { NextResponse } from "next/server"

import {
  getStudioAudioOutput,
  saveStudioAudioOutputData,
} from "@/lib/studio-audio-db"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ outputId: string }>
}

async function downloadAudioAsDataUrl(url: string) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch audio (${response.status})`)
  }

  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ?? "audio/mpeg"
  const buffer = Buffer.from(await response.arrayBuffer())
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`

  return { dataUrl, mimeType }
}

export async function POST(_request: Request, context: RouteContext) {
  const { outputId } = await context.params
  const output = getStudioAudioOutput(outputId)

  if (!output) {
    return NextResponse.json(
      { ok: false, error: "Output not found." },
      { status: 404 }
    )
  }

  if (output.dataUrl) {
    const saved = saveStudioAudioOutputData(
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
    const { dataUrl, mimeType } = await downloadAudioAsDataUrl(output.url)
    const saved = saveStudioAudioOutputData(outputId, dataUrl, mimeType)
    return NextResponse.json({ ok: true, data: saved })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save audio."

    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 }
    )
  }
}
