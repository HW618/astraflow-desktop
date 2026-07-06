import { NextResponse } from "next/server"

import { getAppAuthState } from "@/lib/app-auth"
import {
  PUBLIC_AGENT_RUNTIME_IDS,
  isPublicAgentRuntimeId,
} from "@/lib/agent-model-settings-shared"
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

function publicRuntimeOrder(runtimeId: string) {
  const index = PUBLIC_AGENT_RUNTIME_IDS.findIndex(
    (publicRuntimeId) => publicRuntimeId === runtimeId
  )

  return index >= 0 ? index : PUBLIC_AGENT_RUNTIME_IDS.length
}

export async function GET() {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  return NextResponse.json({
    ok: true,
    data: listAgentRuntimeInfos()
      .filter((runtime) => isPublicAgentRuntimeId(runtime.id))
      .sort(
        (left, right) =>
          publicRuntimeOrder(left.id) - publicRuntimeOrder(right.id)
      ),
  })
}
