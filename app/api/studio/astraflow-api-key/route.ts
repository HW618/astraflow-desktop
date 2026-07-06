import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  generateStudioAstraFlowApiKey,
  getStudioAstraFlowApiKeyStatus,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  return NextResponse.json({
    ok: true,
    data: getStudioAstraFlowApiKeyStatus(),
  })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  return NextResponse.json({
    ok: true,
    data: generateStudioAstraFlowApiKey(),
  })
}
