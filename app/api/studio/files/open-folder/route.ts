import { NextResponse } from "next/server"
import { statSync } from "node:fs"
import { dirname } from "node:path"
import { z } from "zod"

import { openFolder } from "@/lib/open-folder"
import { getAppAuthState } from "@/lib/app-auth"
import { getStudioAudioOutput } from "@/lib/studio-audio-db"
import { getStudioImageOutput, getStudioSessionFile } from "@/lib/studio-db"
import { resolveStudioStoragePath } from "@/lib/studio-file-storage"
import { getStudioVideoOutput } from "@/lib/studio-video-db"

export const runtime = "nodejs"

const openFolderSchema = z.object({
  kind: z.enum(["image", "video", "audio", "file"]),
  id: z.string().trim().min(1).max(200),
})

function getStoragePath(
  kind: z.infer<typeof openFolderSchema>["kind"],
  id: string
) {
  if (kind === "image") {
    return getStudioImageOutput(id)?.storagePath ?? null
  }

  if (kind === "video") {
    return getStudioVideoOutput(id)?.storagePath ?? null
  }

  if (kind === "audio") {
    return getStudioAudioOutput(id)?.storagePath ?? null
  }

  return getStudioSessionFile(id)?.storagePath ?? null
}

function getContainingFolder(storagePath: string) {
  const absolutePath = resolveStudioStoragePath(storagePath)

  try {
    const stats = statSync(/* turbopackIgnore: true */ absolutePath)

    if (stats.isDirectory()) {
      return absolutePath
    }
  } catch {
    // If the file disappeared, opening the parent still helps the user recover.
  }

  return dirname(absolutePath)
}

export async function POST(request: Request) {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  const parsed = openFolderSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const storagePath = getStoragePath(parsed.data.kind, parsed.data.id)

  if (!storagePath) {
    return NextResponse.json(
      { ok: false, error: "No local folder is available for this file." },
      { status: 404 }
    )
  }

  try {
    await openFolder(getContainingFolder(storagePath))

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to open folder."

    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
