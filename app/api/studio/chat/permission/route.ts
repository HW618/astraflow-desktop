import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { resolvePermission } from "@/lib/agent/permission-broker"

export const runtime = "nodejs"

const permissionDecisionSchema = z.object({
  sessionId: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
  optionId: z.string().trim().min(1),
})

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = permissionDecisionSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const resolved = resolvePermission(
    parsed.data.sessionId,
    parsed.data.requestId,
    parsed.data.optionId
  )

  if (!resolved) {
    return NextResponse.json(
      { ok: false, error: "Permission request not found" },
      { status: 404 }
    )
  }

  return NextResponse.json({ ok: true, data: { resolved: true } })
}
