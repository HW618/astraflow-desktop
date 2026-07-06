import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import {
  clearStudioAstraFlowApiKeySession,
  clearStudioExaApiKey,
  clearStudioModelverseApiKey,
  clearStudioOAuthTokens,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)

  clearStudioExaApiKey()
  clearStudioModelverseApiKey()
  clearStudioOAuthTokens()
  clearStudioAstraFlowApiKeySession()

  if (originError) {
    return NextResponse.json({
      ok: true,
      warning: "Invalid request origin was ignored for local logout.",
    })
  }

  return NextResponse.json({
    ok: true,
  })
}
