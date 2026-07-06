import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import {
  saveStudioAstraFlowApiKeySession,
  verifyStudioAstraFlowApiKey,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)

  if (originError) {
    return originError
  }

  try {
    const body = (await request.json()) as { apiKey?: unknown }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : ""

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, message: "Enter your AstraFlow API key." },
        { status: 400 }
      )
    }

    if (!verifyStudioAstraFlowApiKey(apiKey)) {
      return NextResponse.json(
        { ok: false, message: "The AstraFlow API key is invalid." },
        { status: 401 }
      )
    }

    saveStudioAstraFlowApiKeySession()

    return NextResponse.json({
      ok: true,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to complete AstraFlow API key login.",
      },
      { status: 500 }
    )
  }
}
