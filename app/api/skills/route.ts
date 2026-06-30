import { NextResponse } from "next/server"

import {
  type DescribeSkillMarketResponse,
  isSkillOrderBy,
} from "@/lib/skill-market"
import { resolveModelverseProjectId } from "@/lib/modelverse-api-keys"
import { getStudioModelverseApiKey } from "@/lib/studio-db"
import { callUCloudAction, UCloudApiError } from "@/lib/ucloud"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"

export const runtime = "nodejs"

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

function readString(value: string | null) {
  return typeof value === "string" ? value.trim() : ""
}

function readInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, 0), max)
}

function readLimit(value: string | null) {
  return readInt(value, DEFAULT_LIMIT, MAX_LIMIT)
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
    { ok: false, message: "Failed to load skills." },
    { status: 500 }
  )
}

export async function GET(request: Request) {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is not configured locally." },
      { status: 401 }
    )
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const keyword = readString(searchParams.get("keyword"))
    const category = readString(searchParams.get("category"))
    const orderBy = readString(searchParams.get("orderBy"))
    const offset = readInt(searchParams.get("offset"), 0, 100_000)
    const limit = readLimit(searchParams.get("limit"))
    const projectId = await resolveModelverseProjectId({
      credentials,
      preferredProjectId:
        readString(searchParams.get("projectId")) ||
        getStudioModelverseApiKey()?.projectId ||
        credentials.projectId,
    })

    const response = await callUCloudAction<DescribeSkillMarketResponse>({
      credentials,
      params: {
        Action: "DescribeSkillMarket",
        Backend: "SkillLab",
        ProjectId: projectId,
        ...(keyword ? { Keyword: keyword } : {}),
        ...(category ? { Category: category } : {}),
        ...(isSkillOrderBy(orderBy) ? { OrderBy: orderBy } : {}),
        Offset: offset,
        Limit: limit,
      },
    })

    return NextResponse.json({
      ok: true,
      data: Array.isArray(response.Skills) ? response.Skills : [],
      totalCount:
        typeof response.TotalCount === "number" ? response.TotalCount : 0,
      allCategories: Array.isArray(response.AllCategories)
        ? response.AllCategories
        : [],
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
