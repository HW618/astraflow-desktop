import { NextResponse } from "next/server"
import { z } from "zod"

import { getAppAuthState } from "@/lib/app-auth"
import { generateChatTitle } from "@/lib/modelverse-openai"
import { getStudioSession, updateStudioSessionTitle } from "@/lib/studio-db"

export const runtime = "nodejs"

const titleRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(8_000),
})

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  const parsed = titleRequestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  try {
    const title = await generateChatTitle(parsed.data.prompt)

    if (!title) {
      return NextResponse.json(
        { ok: false, error: "Empty title generated." },
        { status: 502 }
      )
    }

    const session = updateStudioSessionTitle(sessionId, title)

    return NextResponse.json({ ok: true, data: session })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Title generation failed.",
      },
      { status: 500 }
    )
  }
}
