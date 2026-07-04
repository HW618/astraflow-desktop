import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import {
  clearStudioExaApiKey,
  clearStudioModelverseApiKey,
  clearStudioOAuthTokens,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)

  if (originError) {
    return originError
  }

  clearStudioExaApiKey()
  clearStudioModelverseApiKey()
  clearStudioOAuthTokens()

  return NextResponse.json({
    ok: true,
  })
}
