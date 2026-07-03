import { NextResponse } from "next/server"

import { getAppAuthState } from "@/lib/app-auth"
import { getStudioVideoOutput } from "@/lib/studio-video-db"
import { createStoredFileResponse } from "@/lib/studio-file-response"
import { bufferToArrayBuffer, parseDataUrl } from "@/lib/studio-file-storage"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ outputId: string }>
}

function getVideoExtension(mimeType: string) {
  const extension = mimeType.split("/")[1]?.split("+")[0]?.trim()

  if (!extension) {
    return "mp4"
  }

  return extension === "quicktime" ? "mov" : extension
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  const { outputId } = await context.params
  const output = getStudioVideoOutput(outputId)

  if (!output) {
    return NextResponse.json(
      { ok: false, error: "Output not found." },
      { status: 404 }
    )
  }

  if (!output.storagePath && !output.dataUrl) {
    if (output.url) {
      return NextResponse.redirect(output.url)
    }

    return NextResponse.json(
      { ok: false, error: "Output has no video data." },
      { status: 404 }
    )
  }

  const download = new URL(request.url).searchParams.get("download") === "1"

  if (output.storagePath) {
    const mimeType = output.mimeType || "video/mp4"
    const filename = `video-${output.id}.${getVideoExtension(mimeType)}`

    try {
      return createStoredFileResponse({
        request,
        storagePath: output.storagePath,
        mimeType,
        filename,
        download,
      })
    } catch {
      return NextResponse.json(
        { ok: false, error: "Output video data is unavailable." },
        { status: 404 }
      )
    }
  }

  let parsed: { buffer: Buffer; mimeType: string } | null = null

  if (output.dataUrl) {
    try {
      parsed = parseDataUrl(output.dataUrl)
    } catch {
      parsed = null
    }
  }

  if (!parsed) {
    return NextResponse.json(
      { ok: false, error: "Output video data is invalid." },
      { status: 422 }
    )
  }

  const filename = `video-${output.id}.${getVideoExtension(parsed.mimeType)}`
  const disposition = download ? "attachment" : "inline"

  return new Response(bufferToArrayBuffer(parsed.buffer), {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Length": String(parsed.buffer.length),
      "Content-Type": parsed.mimeType,
    },
  })
}
