import { NextResponse } from "next/server"

import { getAppAuthState } from "@/lib/app-auth"
import { getStudioSessionFile } from "@/lib/studio-db"
import { createStoredFileResponse } from "@/lib/studio-file-response"
import { storagePathToDownloadName } from "@/lib/studio-file-storage"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ fileId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  const { fileId } = await context.params
  const file = getStudioSessionFile(fileId)

  if (!file) {
    return NextResponse.json(
      { ok: false, error: "File not found." },
      { status: 404 }
    )
  }

  try {
    const download = new URL(request.url).searchParams.get("download") === "1"
    const filename =
      file.originalName || storagePathToDownloadName(file.storagePath)

    return createStoredFileResponse({
      request,
      storagePath: file.storagePath,
      mimeType: file.mimeType || "application/octet-stream",
      filename,
      download,
    })
  } catch {
    return NextResponse.json(
      { ok: false, error: "File data is unavailable." },
      { status: 404 }
    )
  }
}
