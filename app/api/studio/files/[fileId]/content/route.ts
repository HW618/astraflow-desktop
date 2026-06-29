import { NextResponse } from "next/server"

import { getStudioSessionFile } from "@/lib/studio-db"
import {
  readStudioFile,
  storagePathToDownloadName,
} from "@/lib/studio-file-storage"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ fileId: string }>
}

function contentDispositionValue(disposition: "inline" | "attachment", name: string) {
  const safeName = name.replace(/["\r\n]/g, "_")

  return `${disposition}; filename="${safeName}"`
}

export async function GET(request: Request, context: RouteContext) {
  const { fileId } = await context.params
  const file = getStudioSessionFile(fileId)

  if (!file) {
    return NextResponse.json(
      { ok: false, error: "File not found." },
      { status: 404 }
    )
  }

  try {
    const buffer = readStudioFile(file.storagePath)
    const download = new URL(request.url).searchParams.get("download") === "1"
    const disposition = download ? "attachment" : "inline"
    const filename = file.originalName || storagePathToDownloadName(file.storagePath)

    return new Response(buffer, {
      headers: {
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": contentDispositionValue(disposition, filename),
        "Content-Length": String(buffer.length),
        "Content-Type": file.mimeType || "application/octet-stream",
      },
    })
  } catch {
    return NextResponse.json(
      { ok: false, error: "File data is unavailable." },
      { status: 404 }
    )
  }
}
