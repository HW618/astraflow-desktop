import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import { startUCloudOAuthFlow } from "@/lib/ucloud-oauth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)

  if (originError) {
    return originError
  }

  try {
    return NextResponse.json({
      ok: true,
      data: await startUCloudOAuthFlow(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to start UCloud OAuth.",
      },
      { status: 500 }
    )
  }
}
