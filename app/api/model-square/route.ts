import { createHash } from "node:crypto"
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

type SquareModelPricing = {
  Prompt?: number
  Completion?: number
  Image?: number
  Video?: number | string
  Currency?: string
  Unit?: string
  UnitEn?: string
  PayByResource?: boolean
}

type SquareModelPriceRate = {
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

type SquareModelPriceTier = {
  Rates?: SquareModelPriceRate[]
  Description?: string
  DescriptionEn?: string
  Condition?: string
}

type SquareModel = {
  Id?: string
  Name?: string
  ChineseName?: string
  Manufacturer?: string
  SimpleDescribe?: string
  SimpleDescribeEn?: string
  Describe?: string
  DescribeEn?: string
  Description?: string
  DescriptionEn?: string
  Language?: string[] | null
  MaxModelLen?: number | string | Array<number | string>
  MaxInputTokens?: number | string | Array<number | string>
  MaxOutputTokens?: number | string | Array<number | string>
  ModelType?: string
  ModalTypes?: string[] | null
  HfUpdateTime?: number
  CreateAt?: number
  UpdateAt?: number
  SupportedCapabilities?: string[] | null
  InputModalities?: string[] | null
  OutputModalities?: string[] | null
  Icon?: string
  CoverUrl?: string
  Pricing?: SquareModelPricing | null
  Tiers?: SquareModelPriceTier[] | null
}

type VendorFacet = {
  name: string
  icon?: string
  count: number
}

type ListUFSquareModelResponse = {
  TotalCount?: number | string
  SquareModels?: SquareModel[] | Record<string, SquareModel>
}

const LIST_PAGE_SIZE = 50
const MODEL_CATALOG_CACHE_TTL = 60_000
const MODEL_CATALOG_CACHE_MAX_ENTRIES = 12
const orderByOptions = new Set(["HfUpdateTime", "Name"])
const orderOptions = new Set(["Desc", "Asc"])
const outputTypeOptions = new Set(["text", "image", "video", "audio"])
const contextLengthOptions: Record<string, number> = {
  "4k": 4_096,
  "64k": 65_536,
  "1m": 1_048_576,
}
const contextLengthOptionValues = new Set([
  "all",
  ...Object.keys(contextLengthOptions),
])

type ModelCatalogCacheEntry = {
  expiresAt: number
  models: SquareModel[]
}

const modelCatalogCache = new Map<string, ModelCatalogCacheEntry>()
const pendingModelCatalogFetches = new Map<string, Promise<SquareModel[]>>()

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

function readLimit(value: string | null, fallback: number) {
  const normalized = readString(value)

  if (normalized === "all") {
    return Number.POSITIVE_INFINITY
  }

  return readInt(normalized, fallback, 10_000)
}

function readOption(
  value: string | null,
  options: Set<string>,
  fallback: string
) {
  const normalized = readString(value)

  return options.has(normalized) ? normalized : fallback
}

function normalizeListData(data: ListUFSquareModelResponse["SquareModels"]) {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object") {
    return Object.values(data)
  }

  return []
}

function normalizeTotalCount(
  totalCount: ListUFSquareModelResponse["TotalCount"],
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

function hasHotTag(model: SquareModel) {
  return (model.SupportedCapabilities ?? []).some(
    (tag) => tag.toLowerCase() === "hot"
  )
}

function hasPublisherModelReference(model: SquareModel) {
  return [model.Id, model.Name].some((value) =>
    value?.toLowerCase().includes("publisher")
  )
}

function searchableText(model: SquareModel) {
  return [
    model.Id,
    model.Name,
    model.ChineseName,
    model.Manufacturer,
    model.ModelType,
    model.SimpleDescribe,
    model.SimpleDescribeEn,
    model.Describe,
    model.DescribeEn,
    model.Description,
    model.DescriptionEn,
    ...(model.ModalTypes ?? []),
    ...(model.SupportedCapabilities ?? []),
    ...(model.InputModalities ?? []),
    ...(model.OutputModalities ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function matchesOutputType(model: SquareModel, outputType: string) {
  if (!outputType) {
    return true
  }

  return (model.OutputModalities ?? []).some(
    (modality) => modality.toLowerCase() === outputType
  )
}

function matchesVendor(model: SquareModel, vendor: string) {
  return !vendor || model.Manufacturer === vendor
}

function normalizeTokenValue(
  value: number | string | Array<number | string> | undefined
) {
  const values = Array.isArray(value) ? value : [value]

  return values
    .map((item) => {
      if (typeof item === "number") {
        return item
      }

      if (typeof item === "string") {
        const parsed = Number.parseInt(item, 10)

        return Number.isFinite(parsed) ? parsed : 0
      }

      return 0
    })
    .filter((item) => item > 0)
}

function getModelContextLength(model: SquareModel) {
  const values = [
    ...normalizeTokenValue(model.MaxModelLen),
    ...normalizeTokenValue(model.MaxInputTokens),
    ...normalizeTokenValue(model.MaxOutputTokens),
  ]

  return values.length > 0 ? Math.max(...values) : undefined
}

function matchesContextLength(model: SquareModel, contextLength: string) {
  const minimum = contextLengthOptions[contextLength]

  if (!minimum) {
    return true
  }

  return (getModelContextLength(model) ?? 0) >= minimum
}

function getVendors(models: SquareModel[]) {
  const vendorMap = new Map<string, VendorFacet>()

  for (const model of models) {
    const vendor = model.Manufacturer?.trim()

    if (!vendor) {
      continue
    }

    const existingVendor = vendorMap.get(vendor)

    if (existingVendor) {
      existingVendor.count += 1

      if (!existingVendor.icon && model.Icon) {
        existingVendor.icon = model.Icon
      }

      continue
    }

    vendorMap.set(vendor, { name: vendor, icon: model.Icon, count: 1 })
  }

  return Array.from(vendorMap.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  )
}

function compareModelName(
  left: SquareModel,
  right: SquareModel,
  order: string
) {
  const result = (left.Name ?? "").localeCompare(right.Name ?? "")

  return order === "Desc" ? -result : result
}

function compareModelTime(
  left: SquareModel,
  right: SquareModel,
  order: string
) {
  const leftTime = left.HfUpdateTime ?? left.UpdateAt ?? left.CreateAt ?? 0
  const rightTime = right.HfUpdateTime ?? right.UpdateAt ?? right.CreateAt ?? 0
  const result = leftTime - rightTime

  return order === "Asc" ? result : -result
}

function sortModels(models: SquareModel[], orderBy: string, order: string) {
  return models.toSorted((left, right) => {
    const hotRank = Number(hasHotTag(right)) - Number(hasHotTag(left))

    if (hotRank !== 0) {
      return hotRank
    }

    if (orderBy === "Name") {
      return compareModelName(left, right, order)
    }

    return compareModelTime(left, right, order)
  })
}

function hashCachePart(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function getCredentialsCacheKey(credentials: UCloudCredentials) {
  if (credentials.mode === "oauth") {
    return `oauth:${credentials.tokenType}:${hashCachePart(
      credentials.accessToken
    )}`
  }

  return `signature:${hashCachePart(credentials.accessKey)}`
}

function getModelCatalogCacheKey({
  credentials,
  projectId,
  orderBy,
  order,
  apiLanguage,
}: {
  credentials: UCloudCredentials
  projectId: string
  orderBy: string
  order: string
  apiLanguage?: string
}) {
  return [
    getCredentialsCacheKey(credentials),
    projectId,
    orderBy,
    order,
    apiLanguage ?? "",
  ].join("\u0000")
}

function readCachedModelCatalog(cacheKey: string) {
  const cached = modelCatalogCache.get(cacheKey)

  if (!cached) {
    return null
  }

  if (cached.expiresAt <= Date.now()) {
    modelCatalogCache.delete(cacheKey)
    return null
  }

  modelCatalogCache.delete(cacheKey)
  modelCatalogCache.set(cacheKey, cached)

  return cached.models.slice()
}

function writeCachedModelCatalog(cacheKey: string, models: SquareModel[]) {
  modelCatalogCache.set(cacheKey, {
    expiresAt: Date.now() + MODEL_CATALOG_CACHE_TTL,
    models: models.slice(),
  })

  while (modelCatalogCache.size > MODEL_CATALOG_CACHE_MAX_ENTRIES) {
    const oldestKey = modelCatalogCache.keys().next().value

    if (!oldestKey) {
      break
    }

    modelCatalogCache.delete(oldestKey)
  }
}

async function fetchAllModelsFromUCloud({
  credentials,
  projectId,
  orderBy,
  order,
  apiLanguage,
}: {
  credentials: UCloudCredentials
  projectId: string
  orderBy: string
  order: string
  apiLanguage?: string
}) {
  const fetchPage = (offset: number) =>
    callUCloudAction<ListUFSquareModelResponse>({
      credentials,
      headers: apiLanguage ? { "x-api-lang": apiLanguage } : undefined,
      params: {
        Action: "ListUFSquareModel",
        ...(projectId ? { ProjectId: projectId } : {}),
        Offset: offset,
        Limit: LIST_PAGE_SIZE,
        OrderBy: orderBy,
        Order: order,
      },
    })

  const firstPage = await fetchPage(0)
  const models = normalizeListData(firstPage.SquareModels)
  const totalCount = normalizeTotalCount(firstPage.TotalCount, models.length)

  for (
    let offset = LIST_PAGE_SIZE;
    offset < totalCount;
    offset += LIST_PAGE_SIZE
  ) {
    const page = await fetchPage(offset)
    models.push(...normalizeListData(page.SquareModels))
  }

  return models
}

async function fetchAllModels({
  credentials,
  projectId,
  orderBy,
  order,
  apiLanguage,
}: {
  credentials: UCloudCredentials
  projectId: string
  orderBy: string
  order: string
  apiLanguage?: string
}) {
  const cacheKey = getModelCatalogCacheKey({
    credentials,
    projectId,
    orderBy,
    order,
    apiLanguage,
  })
  const cached = readCachedModelCatalog(cacheKey)

  if (cached) {
    return cached
  }

  let pending = pendingModelCatalogFetches.get(cacheKey)

  if (!pending) {
    pending = fetchAllModelsFromUCloud({
      credentials,
      projectId,
      orderBy,
      order,
      apiLanguage,
    })
      .then((models) => {
        writeCachedModelCatalog(cacheKey, models)
        return models
      })
      .finally(() => {
        pendingModelCatalogFetches.delete(cacheKey)
      })
    pendingModelCatalogFetches.set(cacheKey, pending)
  }

  const models = await pending

  return models.slice()
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
    { ok: false, message: "Unexpected model square request failure." },
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
    const outputType = readOption(
      searchParams.get("outputType"),
      outputTypeOptions,
      ""
    )
    const contextLength = readOption(
      searchParams.get("contextLength"),
      contextLengthOptionValues,
      "all"
    )
    const vendor = readString(searchParams.get("vendor"))
    const offset = readInt(searchParams.get("offset"), 0, 10_000)
    const limit = readLimit(searchParams.get("limit"), 20)
    const orderBy = readOption(
      searchParams.get("orderBy"),
      orderByOptions,
      "HfUpdateTime"
    )
    const order = readOption(searchParams.get("order"), orderOptions, "Desc")
    const keywordForSearch = keyword.toLowerCase()

    const allModels = await fetchAllModels({
      credentials,
      projectId,
      orderBy,
      order,
      apiLanguage,
    })
    const visibleModels = allModels.filter(
      (model) => !hasPublisherModelReference(model)
    )
    const searchedModels = keywordForSearch
      ? visibleModels.filter((model) =>
          searchableText(model).includes(keywordForSearch)
        )
      : visibleModels
    const outputModels = searchedModels.filter((model) =>
      matchesOutputType(model, outputType)
    )
    const contextModels = outputModels.filter((model) =>
      matchesContextLength(model, contextLength)
    )
    const vendors = getVendors(contextModels)
    const vendorModels = contextModels.filter((model) =>
      matchesVendor(model, vendor)
    )
    const sortedModels = sortModels(vendorModels, orderBy, order)
    const pageModels = sortedModels.slice(offset, offset + limit)

    return NextResponse.json({
      ok: true,
      data: pageModels,
      totalCount: sortedModels.length,
      vendors,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
