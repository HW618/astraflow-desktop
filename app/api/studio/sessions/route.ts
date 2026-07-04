import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { createStudioSession, listStudioSessions } from "@/lib/studio-db"
import { studioModes } from "@/lib/studio-types"

export const runtime = "nodejs"

const createSessionSchema = z.object({
  mode: z.enum(studioModes).default("chat"),
  title: z.string().trim().max(120).optional(),
})

export async function GET() {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  return NextResponse.json({ ok: true, data: listStudioSessions() })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

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
