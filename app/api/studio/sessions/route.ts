import { NextResponse } from "next/server"
import { z } from "zod"

import { createStudioSession, listStudioSessions } from "@/lib/studio-db"
import { studioModes } from "@/lib/studio-types"

export const runtime = "nodejs"

const createSessionSchema = z.object({
  mode: z.enum(studioModes).default("chat"),
  title: z.string().trim().max(120).optional(),
})

export async function GET() {
  return NextResponse.json({ ok: true, data: listStudioSessions() })
}

export async function POST(request: Request) {
  const parsed = createSessionSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const session = createStudioSession(parsed.data)

  return NextResponse.json({ ok: true, data: session }, { status: 201 })
}
