import { NextResponse } from "next/server"

import { getStudioImageOutput } from "@/lib/studio-db"

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

function getImageExtension(mimeType: string) {
  const extension = mimeType.split("/")[1]?.split("+")[0]?.trim()

  if (!extension) {
    return "png"
  }

  return extension === "jpeg" ? "jpg" : extension
}

export async function GET(request: Request, context: RouteContext) {
  const { outputId } = await context.params
  const output = getStudioImageOutput(outputId)

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
      { ok: false, error: "Output has no image data." },
      { status: 404 }
    )
  }

  const parsed = parseDataUrl(output.dataUrl)

  if (!parsed) {
    return NextResponse.json(
      { ok: false, error: "Output image data is invalid." },
      { status: 422 }
    )
  }

  const download =
    new URL(request.url).searchParams.get("download") === "1"
  const filename = `image-${output.id}.${getImageExtension(parsed.mimeType)}`
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
