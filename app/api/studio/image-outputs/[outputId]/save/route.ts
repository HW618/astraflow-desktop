import { NextResponse } from "next/server"

import {
  getStudioImageOutput,
  saveStudioImageOutputData,
} from "@/lib/studio-db"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ outputId: string }>
}

async function downloadImageAsDataUrl(url: string) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`)
  }

  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png"
  const buffer = Buffer.from(await response.arrayBuffer())
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`

  return { dataUrl, mimeType }
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

  if (output.dataUrl) {
    const saved = saveStudioImageOutputData(
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
    const { dataUrl, mimeType } = await downloadImageAsDataUrl(output.url)
    const saved = saveStudioImageOutputData(outputId, dataUrl, mimeType)
    return NextResponse.json({ ok: true, data: saved })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save image."

    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 }
    )
  }
}
