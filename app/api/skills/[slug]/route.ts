import { NextResponse } from "next/server"

import type { DescribeSkillDetailResponse } from "@/lib/skill-market"
import { resolveModelverseProjectId } from "@/lib/modelverse-api-keys"
import { getStudioModelverseApiKey } from "@/lib/studio-db"
import { callUCloudAction, UCloudApiError } from "@/lib/ucloud"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"

export const runtime = "nodejs"

type SkillDetailRouteContext = {
  params: Promise<{
    slug: string
  }>
}

function readString(value: string | null) {
  return typeof value === "string" ? value.trim() : ""
}

function toErrorResponse(error: unknown) {
  if (error instanceof UCloudApiError) {
    return NextResponse.json(
      { ok: false, message: error.message, retCode: error.retCode },
      { status: error.status }
    )
  }

  if (error instanceof Error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Failed to load skill detail." },
    { status: 500 }
  )
}

export async function GET(request: Request, context: SkillDetailRouteContext) {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is not configured locally." },
      { status: 401 }
    )
  }

  try {
    const { slug } = await context.params
    const normalizedSlug = slug.trim()
    const searchParams = new URL(request.url).searchParams
    const version = readString(searchParams.get("version"))

    if (!normalizedSlug) {
      return NextResponse.json(
        { ok: false, message: "Skill slug is required." },
        { status: 400 }
      )
    }

    const projectId = await resolveModelverseProjectId({
      credentials,
      preferredProjectId:
        readString(searchParams.get("projectId")) ||
        getStudioModelverseApiKey()?.projectId ||
        credentials.projectId,
    })

    const response = await callUCloudAction<DescribeSkillDetailResponse>({
      credentials,
      params: {
        Action: "DescribeSkillDetail",
        Backend: "SkillLab",
        ProjectId: projectId,
        Slug: normalizedSlug,
        ...(version ? { Version: version } : {}),
      },
    })

    return NextResponse.json({
      ok: true,
      data: {
        skill: response.Skill ?? {},
        skillMd: response.SkillMd ?? "",
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
