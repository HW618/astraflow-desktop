import { NextResponse } from "next/server"

import { getAppAuthState } from "@/lib/app-auth"
import { listAgentRuntimeInfos } from "@/lib/agent/runtime"
import "@/lib/studio-chat-runner"

export const runtime = "nodejs"

async function requireAuthenticatedRequest() {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  return null
}

export async function GET() {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  return NextResponse.json({
    ok: true,
    data: listAgentRuntimeInfos(),
  })
}
