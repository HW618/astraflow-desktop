import { NextResponse } from "next/server"

import { getUCloudCredentials } from "@/lib/ucloud-credentials"
import { callUCloudAction, UCloudApiError } from "@/lib/ucloud"

type PriceRate = {
  ChargeItem?: string
  ChargeItemDescription?: string
  ChargeItemDescriptionEn?: string
  Currency?: string
  Unit?: string
  UnitEn?: string
  Price?: string | number
  PricingSku?: string
  PricingSkuId?: string | number
}

type PriceTier = {
  Rates?: PriceRate[]
  Description?: string
  DescriptionEn?: string
  Condition?: string
}

type ModelPriceGroup = {
  Manufacturer?: string
  ModelName?: string
  ModelId?: string
  Tiers?: PriceTier[]
}

type GetUFSquareModelPricesResponse = {
  TotalCount?: number | string
  RequestId?: string
  Models?: ModelPriceGroup[] | Record<string, ModelPriceGroup>
}

const PRICE_PAGE_SIZE = 50

function readString(value: string | null) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeTotalCount(
  totalCount: GetUFSquareModelPricesResponse["TotalCount"],
  fallback: number
) {
  if (typeof totalCount === "number") {
    return totalCount
  }

  if (typeof totalCount === "string") {
    const parsed = Number.parseInt(totalCount, 10)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

function normalizeListData(data: GetUFSquareModelPricesResponse["Models"]) {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object") {
    return Object.values(data)
  }

  return []
}

async function fetchAllPriceGroups({
  credentials,
  projectId,
  keyword,
}: {
  credentials: NonNullable<ReturnType<typeof getUCloudCredentials>>
  projectId: string
  keyword: string
}) {
  const fetchPage = (offset: number) =>
    callUCloudAction<GetUFSquareModelPricesResponse>({
      credentials,
      params: {
        Action: "GetUFSquareModelPrices",
        ...(projectId ? { ProjectId: projectId } : {}),
        Keyword: keyword,
        Offset: offset,
        Limit: PRICE_PAGE_SIZE,
      },
    })

  const firstPage = await fetchPage(0)
  const priceGroups = normalizeListData(firstPage.Models)
  const totalCount = normalizeTotalCount(
    firstPage.TotalCount,
    priceGroups.length
  )

  for (
    let offset = PRICE_PAGE_SIZE;
    offset < totalCount;
    offset += PRICE_PAGE_SIZE
  ) {
    const page = await fetchPage(offset)
    priceGroups.push(...normalizeListData(page.Models))
  }

  return { priceGroups, totalCount, requestId: firstPage.RequestId }
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
    { ok: false, message: "Unexpected model price request failure." },
    { status: 500 }
  )
}

export async function GET(request: Request) {
  const credentials = getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      {
        ok: false,
        message: "UCloud credentials are not configured on the server.",
      },
      { status: 500 }
    )
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const projectId =
      readString(searchParams.get("projectId")) || credentials.projectId
    const keyword = readString(searchParams.get("keyword"))

    if (!keyword) {
      return NextResponse.json(
        { ok: false, message: "Keyword is required." },
        { status: 400 }
      )
    }

    const data = await fetchAllPriceGroups({ credentials, projectId, keyword })

    return NextResponse.json({
      ok: true,
      data: data.priceGroups,
      totalCount: data.totalCount,
      requestId: data.requestId,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
