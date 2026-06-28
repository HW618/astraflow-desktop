import { NextResponse } from "next/server"

import { getStudioAudioOutput } from "@/lib/studio-audio-db"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ outputId: string }>
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)

  if (!match) {
    return null
  }

  const mimeType = match[1] || "application/octet-stream"
  const encoded = match[3]

  try {
    const buffer = match[2]
      ? Buffer.from(encoded, "base64")
      : Buffer.from(decodeURIComponent(encoded))

    return { buffer, mimeType }
  } catch {
    return null
  }
}

function getAudioExtension(mimeType: string) {
  const extension = mimeType.split("/")[1]?.split("+")[0]?.trim()

  if (!extension) {
    return "mp3"
  }

  return extension === "mpeg" ? "mp3" : extension
}

export async function GET(request: Request, context: RouteContext) {
  const { outputId } = await context.params
  const output = getStudioAudioOutput(outputId)

  if (!output) {
    return NextResponse.json(
      { ok: false, error: "Output not found." },
      { status: 404 }
    )
  }

  if (!output.dataUrl) {
    if (output.url) {
      return NextResponse.redirect(output.url)
    }

    return NextResponse.json(
      { ok: false, error: "Output has no audio data." },
      { status: 404 }
    )
  }

  const parsed = parseDataUrl(output.dataUrl)

  if (!parsed) {
    return NextResponse.json(
      { ok: false, error: "Output audio data is invalid." },
      { status: 422 }
    )
  }

  const download = new URL(request.url).searchParams.get("download") === "1"
  const filename = `audio-${output.id}.${getAudioExtension(parsed.mimeType)}`
  const disposition = download ? "attachment" : "inline"

  return new Response(parsed.buffer, {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Length": String(parsed.buffer.length),
      "Content-Type": parsed.mimeType,
    },
  })
}
