import { NextResponse } from "next/server"

import {
  getSelectedUCloudProjectId,
  getStudioModelverseApiKey,
} from "@/lib/studio-db"
import { resolveModelverseProjectId } from "@/lib/modelverse-api-keys"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"
import {
  callUCloudAction,
  type UCloudCredentials,
  UCloudApiError,
} from "@/lib/ucloud"

export const runtime = "nodejs"

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
const PRICE_PAGE_CONCURRENCY = 6

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

async function fetchInBatches<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<GetUFSquareModelPricesResponse>
) {
  const results: GetUFSquareModelPricesResponse[] = []

  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency)
    const batchResults = await Promise.all(batch.map(handler))

    results.push(...batchResults)
  }

  return results
}

async function fetchAllPriceGroups({
  credentials,
  projectId,
  keyword,
  apiLanguage,
}: {
  credentials: UCloudCredentials
  projectId: string
  keyword: string
  apiLanguage?: string
}) {
  const fetchPage = (offset: number) =>
    callUCloudAction<GetUFSquareModelPricesResponse>({
      credentials,
      headers: apiLanguage ? { "x-api-lang": apiLanguage } : undefined,
      params: {
        Action: "GetUFSquareModelPrices",
        ...(projectId ? { ProjectId: projectId } : {}),
        ...(keyword ? { Keyword: keyword } : {}),
        Offset: offset,
        Limit: PRICE_PAGE_SIZE,
      },
    })

  const firstPage = await fetchPage(0)
  const firstGroups = normalizeListData(firstPage.Models)
  const totalCount = normalizeTotalCount(firstPage.TotalCount, firstGroups.length)

  const remainingOffsets: number[] = []

  for (
    let offset = PRICE_PAGE_SIZE;
    offset < totalCount;
    offset += PRICE_PAGE_SIZE
  ) {
    remainingOffsets.push(offset)
  }

  const remainingPages = await fetchInBatches(
    remainingOffsets,
    PRICE_PAGE_CONCURRENCY,
    fetchPage
  )

  const priceGroups = [
    ...firstGroups,
    ...remainingPages.flatMap((page) => normalizeListData(page.Models)),
  ]

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
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      {
        ok: false,
        message: "UCloud OAuth is not configured locally.",
      },
      { status: 403 }
    )
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const apiLanguage =
      request.headers.get("x-api-lang") === "en_US" ? "en_US" : undefined
    const projectId = await resolveModelverseProjectId({
      credentials,
      preferredProjectId:
        readString(searchParams.get("projectId")) ||
        getSelectedUCloudProjectId() ||
        getStudioModelverseApiKey()?.projectId ||
        credentials.projectId,
    })
    const keyword = readString(searchParams.get("keyword"))

    const data = await fetchAllPriceGroups({
      credentials,
      projectId,
      keyword,
      apiLanguage,
    })

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
