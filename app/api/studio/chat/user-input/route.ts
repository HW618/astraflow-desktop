import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { resolveUserInput } from "@/lib/agent/user-input-broker"

export const runtime = "nodejs"

const userInputAnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(120),
  optionId: z.string().trim().min(1).max(120).nullable(),
  label: z.string().trim().max(200).nullable(),
  text: z.string().trim().max(2_000),
})

const userInputDecisionSchema = z.object({
  sessionId: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
  answers: z.array(userInputAnswerSchema).max(3).default([]),
  cancelled: z.boolean().optional().default(false),
})

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = userInputDecisionSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const resolved = resolveUserInput(
    parsed.data.sessionId,
    parsed.data.requestId,
    parsed.data.answers,
    parsed.data.cancelled
  )

  if (!resolved) {
    return NextResponse.json(
      { ok: false, error: "User input request not found" },
      { status: 404 }
    )
  }

  return NextResponse.json({ ok: true, data: { resolved: true } })
}
