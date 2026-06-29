import { NextResponse } from "next/server"

import {
  clearStudioExaApiKey,
  clearStudioModelverseApiKey,
  clearStudioOAuthTokens,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function POST() {
  clearStudioExaApiKey()
  clearStudioModelverseApiKey()
  clearStudioOAuthTokens()

  return NextResponse.json({
    ok: true,
  })
}
