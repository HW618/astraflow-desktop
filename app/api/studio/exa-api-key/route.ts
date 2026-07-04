import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  clearStudioExaApiKey,
  getStudioExaApiKey,
  getStudioOAuthTokens,
  saveStudioExaApiKey,
} from "@/lib/studio-db"

export const runtime = "nodejs"

const saveExaApiKeySchema = z.object({
  apiKey: z.string().trim().max(512).optional().default(""),
})

function requireOAuth() {
  return Boolean(getStudioOAuthTokens()?.accessToken)
}

function exaApiKeyPayload() {
  const saved = getStudioExaApiKey()

  return {
    configured: Boolean(saved?.key),
    updatedAt: saved?.updatedAt ?? null,
  }
}

export async function GET() {
  if (!requireOAuth()) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is required." },
      { status: 401 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: exaApiKeyPayload(),
  })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = saveExaApiKeySchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  if (parsed.data.apiKey) {
    saveStudioExaApiKey(parsed.data.apiKey)
  } else {
    clearStudioExaApiKey()
  }

  return NextResponse.json({
    ok: true,
    data: exaApiKeyPayload(),
  })
}
