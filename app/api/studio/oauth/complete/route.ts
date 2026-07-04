import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import { getStudioOAuthStatus } from "@/lib/studio-db"
import { completeUCloudOAuthFlowFromCallbackUrl } from "@/lib/ucloud-oauth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)

  if (originError) {
    return originError
  }

  try {
    const body = (await request.json()) as { callbackUrl?: unknown }
    const callbackUrl =
      typeof body.callbackUrl === "string" ? body.callbackUrl.trim() : ""

    if (!callbackUrl) {
      return NextResponse.json(
        { ok: false, message: "Paste the full browser callback URL." },
        { status: 400 }
      )
    }

    const completion = await completeUCloudOAuthFlowFromCallbackUrl(callbackUrl)

    if (!completion.ok) {
      return NextResponse.json(
        { ok: false, message: completion.message, data: completion },
        { status: completion.status }
      )
    }

    return NextResponse.json({
      ok: true,
      data: {
        auth: getStudioOAuthStatus(),
        flow: completion.flow,
        message: completion.message,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to complete UCloud OAuth.",
      },
      { status: 500 }
    )
  }
}
