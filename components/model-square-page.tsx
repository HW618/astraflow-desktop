"use client"

import * as React from "react"
import {
  RiAppsLine,
  RiCheckLine,
  RiFileCopyLine,
  RiFileTextLine,
  RiFireLine,
  RiImageLine,
  RiInformationLine,
  RiRefreshLine,
  RiSearchLine,
  RiVideoLine,
} from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

type OutputTypeFilter = "all" | "text" | "image" | "video"
type ContextLengthFilter = "all" | "4k" | "64k" | "1m"
type SortOption = "newest" | "nameAsc" | "nameDesc"

type SquareModelPricing = {
  Prompt?: number
  Completion?: number
  Image?: number
  Video?: number | string
  Currency?: string
  Unit?: string
  UnitEn?: string
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
  Describe?: string
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

type ModelSquareResponse = {
  ok: boolean
  message?: string
  data?: SquareModel[]
  totalCount?: number
  vendors?: VendorFacet[]
}

type ModelPriceGroup = {
  Manufacturer?: string
  ModelName?: string
  ModelId?: string
  Tiers?: SquareModelPriceTier[]
}

type ModelPriceResponse = {
  ok: boolean
  message?: string
  data?: ModelPriceGroup[]
  totalCount?: number
}

type CachedModelPrice = {
  expiresAt: number
  data: ModelPriceGroup | null
}

type PriceDisplayRate = {
  key: string
  label: string
  value: string
  amount?: number
}

type PriceDisplaySection = {
  key: string
  labels: string[]
  rates: PriceDisplayRate[]
}

const PAGE_SIZE = 24
const MODEL_PRICE_CACHE_PREFIX = "astraflow:model-square-price"
const MODEL_PRICE_CACHE_TTL = 1000 * 60 * 30
const PRICE_SUMMARY_TIER_COUNT = 2

const outputTypeOptions = [
  { value: "all", icon: RiAppsLine, labelKey: "allTypes" },
  { value: "text", icon: RiFileTextLine, labelKey: "textModels" },
  { value: "image", icon: RiImageLine, labelKey: "imageModels" },
  { value: "video", icon: RiVideoLine, labelKey: "videoModels" },
] as const

const contextOptions = [
  { value: "all", label: "Any" },
  { value: "4k", label: "4K+" },
  { value: "64k", label: "64K+" },
  { value: "1m", label: "1M+" },
] as const

const sortOptions = [
  { value: "newest", orderBy: "HfUpdateTime", order: "Desc" },
  { value: "nameAsc", orderBy: "Name", order: "Asc" },
  { value: "nameDesc", orderBy: "Name", order: "Desc" },
] as const

function getContextSliderIndex(value: ContextLengthFilter) {
  return contextOptions.findIndex((option) => option.value === value)
}

function getContextFromSlider(index: number): ContextLengthFilter {
  return contextOptions[Math.round(index)]?.value ?? "all"
}

function formatTokenCount(value?: number) {
  if (!value || value <= 0) {
    return "-"
  }

  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}M`
  }

  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(1))}K`
  }

  return value.toLocaleString()
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

function matchesContextLength(
  model: SquareModel,
  contextLength: ContextLengthFilter
) {
  const minimum = contextOptions.find(
    (option) => option.value === contextLength
  )

  if (!minimum || minimum.value === "all") {
    return true
  }

  const thresholds: Record<Exclude<ContextLengthFilter, "all">, number> = {
    "4k": 4_096,
    "64k": 65_536,
    "1m": 1_048_576,
  }

  return (getModelContextLength(model) ?? 0) >= thresholds[minimum.value]
}

function formatDate(timestamp?: number) {
  if (!timestamp) {
    return "-"
  }

  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000
  const date = new Date(milliseconds)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date)
}

function hasHotTag(model: SquareModel) {
  return (model.SupportedCapabilities ?? []).some(
    (capability) => capability.toLowerCase() === "hot"
  )
}

function isHiddenCapability(capability: string) {
  const normalized = capability.trim().toLowerCase()
  const compact = normalized.replace(/[\s_-]+/g, "")

  return (
    normalized === "hot" ||
    normalized === "doc" ||
    normalized === "experience" ||
    compact === "superrecommended"
  )
}

function getPrimaryDescription(model: SquareModel, fallback: string) {
  return model.SimpleDescribe || model.Describe || fallback
}

function modalityLabel(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function parsePriceAmount(value: SquareModelPriceRate["Price"]) {
  const amount =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""))

  return Number.isFinite(amount) ? amount : undefined
}

function formatPrice(
  price: SquareModelPriceRate["Price"],
  currency: string | undefined,
  unit: string | undefined,
  locale: string
) {
  if (price === undefined || price === null || price === "") {
    return ""
  }

  const value = typeof price === "number" ? String(price) : price
  const displayCurrency =
    locale === "zh" && currency === "CNY" ? "元" : currency
  const currencySuffix = displayCurrency ? ` ${displayCurrency}` : ""
  const unitSuffix = unit ? ` / ${unit}` : ""

  return `${value}${currencySuffix}${unitSuffix}`
}

function getPriceRateLabel(rate: SquareModelPriceRate, locale: string) {
  return locale === "zh"
    ? rate.ChargeItemDescription || rate.ChargeItemDescriptionEn
    : rate.ChargeItemDescriptionEn || rate.ChargeItemDescription
}

function formatBareConditionValue(value: string) {
  const normalized = value.trim()

  if (/^\d+p$/i.test(normalized) || normalized.toLowerCase() === "4k") {
    return normalized.toUpperCase()
  }

  return modalityLabel(normalized)
}

function formatConditionPart(part: string, locale: string) {
  const [rawKey, rawValue] = part.split("=")
  const key = rawKey?.trim()
  const value = rawValue?.trim()

  if (!key || !value) {
    return formatBareConditionValue(part)
  }

  const isZh = locale === "zh"
  const normalizedValue = value.toLowerCase()

  if (key === "video_input") {
    if (normalizedValue === "no_video") {
      return isZh ? "无视频输入" : "No video input"
    }

    if (normalizedValue === "with_video") {
      return isZh ? "含视频输入" : "With video input"
    }
  }

  if (key === "reference") {
    if (normalizedValue === "noref") {
      return isZh ? "无参考" : "No reference"
    }

    if (normalizedValue === "ref") {
      return isZh ? "有参考" : "With reference"
    }
  }

  if (key === "sound" || key === "generate_audio") {
    if (normalizedValue === "offsound" || normalizedValue === "false") {
      return isZh ? "无音频" : "No audio"
    }

    if (normalizedValue === "onsound" || normalizedValue === "true") {
      return isZh ? "含音频" : "With audio"
    }
  }

  if (key === "voice_list") {
    if (normalizedValue === "withoutvoice") {
      return isZh ? "未指定音色" : "No voice preset"
    }

    if (normalizedValue === "withvoice") {
      return isZh ? "指定音色" : "Voice preset"
    }
  }

  if (key === "duration") {
    return `${value}s`
  }

  if (key === "mode") {
    return formatBareConditionValue(value)
  }

  if (key === "service_tier") {
    if (normalizedValue === "flex") {
      return isZh ? "Flex 档" : "Flex tier"
    }

    return isZh ? "默认档" : "Default tier"
  }

  if (key === "variant") {
    const variantLabels: Record<string, string> = {
      i2v: isZh ? "图生视频" : "Image to video",
      t2v: isZh ? "文生视频" : "Text to video",
      mc: isZh ? "运动控制" : "Motion control",
    }

    return variantLabels[normalizedValue] ?? formatBareConditionValue(value)
  }

  if (key === "video") {
    if (normalizedValue === "withvideo") {
      return isZh ? "含参考视频" : "With reference video"
    }

    return isZh ? "无参考视频" : "No reference video"
  }

  return `${modalityLabel(key)} ${formatBareConditionValue(value)}`
}

function getPriceTierLabels(tier: SquareModelPriceTier, locale: string) {
  const label =
    locale === "zh"
      ? tier.Description || tier.Condition || tier.DescriptionEn
      : tier.DescriptionEn || tier.Condition || tier.Description

  if (!label || label.toLowerCase() === "default" || label === "默认") {
    return []
  }

  return label
    .split(/\s+and\s+|\s*且\s*/)
    .map((part) => formatConditionPart(part, locale))
    .filter(Boolean)
}

function getPriceSections(
  priceGroup: ModelPriceGroup | null,
  locale: string
): PriceDisplaySection[] {
  return (
    priceGroup?.Tiers?.map((tier, tierIndex) => {
      const rates =
        tier.Rates?.map((rate, rateIndex) => {
          const label = getPriceRateLabel(rate, locale) || rate.ChargeItem || ""
          const value = formatPrice(
            rate.Price,
            rate.Currency,
            locale === "zh" ? rate.Unit : rate.UnitEn || rate.Unit,
            locale
          )

          return {
            key: [
              tier.Condition,
              rate.PricingSku,
              rate.PricingSkuId,
              rate.ChargeItem,
              rateIndex,
            ]
              .filter(Boolean)
              .join(":"),
            label,
            value,
            amount: parsePriceAmount(rate.Price),
          }
        }).filter((rate) => rate.label && rate.value) ?? []

      return {
        key: [tier.Condition, tier.Description, tier.DescriptionEn, tierIndex]
          .filter(Boolean)
          .join(":"),
        labels: getPriceTierLabels(tier, locale),
        rates,
      }
    }).filter((section) => section.rates.length > 0) ?? []
  )
}

function getPrimaryRate(section: PriceDisplaySection) {
  const positiveRates = section.rates.filter((rate) => (rate.amount ?? 0) > 0)

  return positiveRates[0] ?? section.rates[0]
}

function getInlinePriceSections(priceSections: PriceDisplaySection[]) {
  if (priceSections.length === 1) {
    return priceSections
  }

  return priceSections.slice(0, PRICE_SUMMARY_TIER_COUNT).map((section) => {
    const primaryRate = getPrimaryRate(section)

    return {
      ...section,
      rates: primaryRate ? [primaryRate] : [],
    }
  })
}

function normalizeModelName(value: string | undefined) {
  return (value ?? "").trim().toLowerCase()
}

function getPriceCacheKey(projectId: string | undefined, modelName: string) {
  return `${MODEL_PRICE_CACHE_PREFIX}:${projectId ?? ""}:${modelName}`
}

function readCachedModelPrice(cacheKey: string) {
  try {
    const rawCache = window.localStorage.getItem(cacheKey)

    if (!rawCache) {
      return undefined
    }

    const parsed = JSON.parse(rawCache) as Partial<CachedModelPrice>

    if (!parsed.expiresAt || parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(cacheKey)
      return undefined
    }

    return parsed.data ?? null
  } catch {
    window.localStorage.removeItem(cacheKey)
    return undefined
  }
}

function writeCachedModelPrice(cacheKey: string, data: ModelPriceGroup | null) {
  const cache: CachedModelPrice = {
    expiresAt: Date.now() + MODEL_PRICE_CACHE_TTL,
    data,
  }

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(cache))
  } catch {
    // Storage failures should not block model browsing.
  }
}

function findPriceGroup(model: SquareModel, groups?: ModelPriceGroup[]) {
  const modelName = normalizeModelName(model.Name)
  const modelId = normalizeModelName(model.Id)

  return (
    groups?.find((group) => {
      const priceModelName = normalizeModelName(group.ModelName)
      const priceModelId = normalizeModelName(group.ModelId)

      return (
        priceModelName === modelName ||
        priceModelId === modelName ||
        priceModelId === modelId
      )
    }) ??
    groups?.[0] ??
    null
  )
}

function getModelTitle(model: SquareModel, locale: string) {
  return locale === "zh"
    ? model.ChineseName || model.Name || "Model"
    : model.Name || model.ChineseName || "Model"
}

function buildModelSquareUrl({
  keyword,
  outputType,
  contextLength,
  vendor,
  sort,
  projectId,
}: {
  keyword: string
  outputType: OutputTypeFilter
  contextLength: ContextLengthFilter
  vendor: string
  sort: SortOption
  projectId?: string
}) {
  const sortConfig =
    sortOptions.find((option) => option.value === sort) ?? sortOptions[0]
  const params = new URLSearchParams({
    limit: "all",
    orderBy: sortConfig.orderBy,
    order: sortConfig.order,
    contextLength,
  })

  if (keyword.trim()) {
    params.set("keyword", keyword.trim())
  }

  if (outputType !== "all") {
    params.set("outputType", outputType)
  }

  if (vendor) {
    params.set("vendor", vendor)
  }

  if (projectId) {
    params.set("projectId", projectId)
  }

  return `/api/model-square?${params.toString()}`
}

function ModelSquarePage({ projectId }: { projectId?: string }) {
  const { locale, t } = useI18n()
  const [keyword, setKeyword] = React.useState("")
  const [outputType, setOutputType] = React.useState<OutputTypeFilter>("all")
  const [contextLength, setContextLength] =
    React.useState<ContextLengthFilter>("all")
  const [vendor, setVendor] = React.useState("")
  const [sort, setSort] = React.useState<SortOption>("newest")
  const [visibleLimit, setVisibleLimit] = React.useState(PAGE_SIZE)
  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const [response, setResponse] = React.useState<ModelSquareResponse>({
    ok: true,
    data: [],
    totalCount: 0,
    vendors: [],
  })
  const [status, setStatus] = React.useState<"loading" | "success" | "error">(
    "loading"
  )

  const queryUrl = React.useMemo(
    () =>
      buildModelSquareUrl({
        keyword,
        outputType,
        contextLength,
        vendor,
        sort,
        projectId,
      }),
    [keyword, outputType, contextLength, vendor, sort, projectId]
  )

  React.useEffect(() => {
    const controller = new AbortController()

    async function fetchModels() {
      try {
        const nextResponse = await fetch(queryUrl, {
          cache: "no-store",
          signal: controller.signal,
        })
        const json = (await nextResponse.json()) as ModelSquareResponse

        if (!nextResponse.ok || !json.ok) {
          throw new Error(json.message || t.requestFailed)
        }

        setResponse(json)
        setStatus("success")
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setResponse({
          ok: false,
          message: error instanceof Error ? error.message : t.requestFailed,
          data: [],
          totalCount: 0,
          vendors: [],
        })
        setStatus("error")
      }
    }

    void fetchModels()

    return () => {
      controller.abort()
    }
  }, [queryUrl, refreshNonce, t.requestFailed])

  const models = React.useMemo(
    () =>
      (response.data ?? []).filter((model) =>
        matchesContextLength(model, contextLength)
      ),
    [response.data, contextLength]
  )
  const visibleModels = React.useMemo(
    () => models.slice(0, visibleLimit),
    [models, visibleLimit]
  )
  const totalCount = models.length
  const vendors = response.vendors ?? []
  const canShowMore = visibleModels.length < totalCount
  const isLoading = status === "loading"

  function resetLimit() {
    setVisibleLimit(PAGE_SIZE)
  }

  function updateKeyword(nextKeyword: string) {
    resetLimit()
    setKeyword(nextKeyword)
  }

  function updateOutputType(nextType: string) {
    resetLimit()
    setVendor("")
    setOutputType((nextType || "all") as OutputTypeFilter)
  }

  function updateContextLength(nextContextLength: ContextLengthFilter) {
    resetLimit()
    setVendor("")
    setContextLength(nextContextLength)
  }

  function updateVendor(nextVendor: string) {
    resetLimit()
    setVendor(nextVendor === "__all" ? "" : nextVendor)
  }

  function updateSort(nextSort: string) {
    resetLimit()
    setSort((nextSort || "newest") as SortOption)
  }

  function refresh() {
    setStatus("loading")
    setRefreshNonce((nonce) => nonce + 1)
  }

  return (
    <main className="h-[calc(100svh-4rem)] overflow-hidden bg-background">
      <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6">
        <section className="sticky top-0 z-20 flex shrink-0 flex-col gap-3 rounded-4xl border bg-background/95 p-3 shadow-sm backdrop-blur xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 sm:w-[320px]">
              <RiSearchLine className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(event) => updateKeyword(event.target.value)}
                placeholder={t.searchModels}
                className="pl-9"
              />
            </div>
            <Select value={sort} onValueChange={updateSort}>
              <SelectTrigger size="sm" aria-label={t.sortModels}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  <SelectItem value="newest">{t.newest}</SelectItem>
                  <SelectItem value="nameAsc">{t.nameAsc}</SelectItem>
                  <SelectItem value="nameDesc">{t.nameDesc}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t.modelsSummary(visibleModels.length, totalCount)}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={isLoading}
            >
              <RiRefreshLine
                data-icon="inline-start"
                className={cn(isLoading && "animate-spin")}
              />
              {t.refresh}
            </Button>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="sticky top-0 h-full min-h-0 overflow-auto rounded-4xl border bg-card p-3 shadow-sm">
            <div className="mb-3 pl-3 text-sm font-medium">{t.modelTypes}</div>
            <ToggleGroup
              type="single"
              value={outputType}
              onValueChange={updateOutputType}
              orientation="vertical"
              spacing={1}
              className="w-full items-stretch"
            >
              {outputTypeOptions.map((option) => {
                const Icon = option.icon

                return (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    className="w-full justify-start"
                    aria-label={t[option.labelKey]}
                  >
                    <Icon className="size-4" />
                    <span>{t[option.labelKey]}</span>
                  </ToggleGroupItem>
                )
              })}
            </ToggleGroup>

            <div className="mt-5">
              <div className="mb-3 pl-3 text-sm font-medium">
                {t.contextLength}
              </div>
              <div className="px-2">
                <Slider
                  value={[getContextSliderIndex(contextLength)]}
                  min={0}
                  max={contextOptions.length - 1}
                  step={1}
                  onValueChange={(value) => {
                    updateContextLength(getContextFromSlider(value[0] ?? 0))
                  }}
                  aria-label={t.contextLength}
                />
                <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                  {contextOptions.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={cn(
                        "rounded px-1 py-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        option.value === contextLength &&
                          "font-medium text-foreground"
                      )}
                      onClick={() => updateContextLength(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 pl-3 text-sm font-medium">{t.vendors}</div>
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant={!vendor ? "secondary" : "ghost"}
                  className="h-9 justify-start gap-2 px-2 font-normal"
                  onClick={() => updateVendor("__all")}
                >
                  <VendorIcon />
                  <span className="truncate">{t.allVendors}</span>
                </Button>
                {vendors.map((item) => (
                  <Button
                    key={item.name}
                    type="button"
                    variant={vendor === item.name ? "secondary" : "ghost"}
                    className="h-9 justify-start gap-2 px-2 font-normal"
                    onClick={() => updateVendor(item.name)}
                  >
                    <VendorIcon vendor={item} />
                    <span className="truncate">{item.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {item.count}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          </aside>

          <section className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <div className="flex min-w-0 flex-col gap-3 pb-4">
              {status === "error" ? (
                <Alert variant="destructive" className="shrink-0">
                  <RiInformationLine />
                  <AlertTitle>{t.requestFailed}</AlertTitle>
                  <AlertDescription>
                    {response.message || t.requestFailed}
                  </AlertDescription>
                </Alert>
              ) : null}

              {isLoading ? (
                <ModelGridSkeleton />
              ) : visibleModels.length > 0 ? (
                <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
                  {visibleModels.map((model) => (
                    <ModelCard
                      key={model.Id || model.Name}
                      model={model}
                      locale={locale}
                      projectId={projectId}
                    />
                  ))}
                </div>
              ) : (
                <Card className="flex min-h-72 items-center justify-center text-center">
                  <CardContent className="flex max-w-md flex-col items-center gap-3">
                    <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                      <RiSearchLine className="size-5 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="font-heading text-lg font-medium">
                        {t.noModelsFound}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {t.noModelsFound}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {canShowMore ? (
                <div className="flex justify-center pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setVisibleLimit((limit) => limit + PAGE_SIZE)
                    }
                  >
                    {t.showMore}
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function ModelGridSkeleton() {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
      {Array.from({ length: 4 }, (_, index) => (
        <Card key={index} size="sm" className="shrink-0 rounded-4xl">
          <CardHeader className="gap-3">
            <div className="flex gap-3">
              <Skeleton className="size-10 rounded-3xl" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-5 w-56 max-w-full" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

function VendorIcon({ vendor }: { vendor?: VendorFacet }) {
  const initials = vendor?.name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
      {vendor?.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={vendor.icon}
          alt=""
          className="size-full object-contain p-1"
          loading="lazy"
        />
      ) : initials ? (
        initials
      ) : (
        <RiAppsLine className="size-4" />
      )}
    </span>
  )
}

function ModelCard({
  model,
  locale,
  projectId,
}: {
  model: SquareModel
  locale: string
  projectId?: string
}) {
  const { t } = useI18n()
  const description = getPrimaryDescription(model, t.noModelDescription)
  const contextLength = getModelContextLength(model)
  const inputModalities = model.InputModalities ?? []
  const outputModalities = model.OutputModalities ?? []
  const capabilities = (model.SupportedCapabilities ?? []).filter(
    (capability) => !isHiddenCapability(capability)
  )

  return (
    <Card size="sm" className="group/card shrink-0 rounded-4xl">
      <CardHeader className="gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="flex min-w-0 gap-3">
          <ModelIcon model={model} />
          <div className="-mt-0.5 min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <CardTitle className="min-w-0 truncate text-lg leading-tight font-bold text-foreground">
                {getModelTitle(model, locale)}
              </CardTitle>
              <ModelCopyButton value={model.Name} />
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {model.Manufacturer ? <span>{model.Manufacturer}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 sm:justify-end">
          {hasHotTag(model) ? (
            <Badge variant="destructive" className="gap-1 bg-destructive/10">
              <RiFireLine className="size-3" />
              {t.hot}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>

        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <ModelField label={t.input} values={inputModalities} />
          <ModelField label={t.output} values={outputModalities} outline />
          <div>
            <div className="text-xs text-muted-foreground">
              {t.contextLength}
            </div>
            <div className="mt-1 font-medium">
              {formatTokenCount(contextLength)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t.updated}</div>
            <div className="mt-1 font-medium">
              {formatDate(
                model.HfUpdateTime ?? model.UpdateAt ?? model.CreateAt
              )}
            </div>
          </div>
        </div>

        {capabilities.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {capabilities.slice(0, 5).map((capability) => (
              <Badge key={capability} variant="secondary">
                {capability}
              </Badge>
            ))}
          </div>
        ) : null}

        <ModelPriceSummary
          model={model}
          projectId={projectId}
          locale={locale}
        />
      </CardContent>
    </Card>
  )
}

function ModelIcon({ model }: { model: SquareModel }) {
  const fallbackIcon = model.OutputModalities?.some(
    (item) => item.toLowerCase() === "image"
  )
    ? RiImageLine
    : model.OutputModalities?.some((item) => item.toLowerCase() === "video")
      ? RiVideoLine
      : RiFileTextLine
  const FallbackIcon = fallbackIcon

  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-muted text-muted-foreground">
      {model.Icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={model.Icon} alt="" className="size-full object-cover" />
      ) : (
        <FallbackIcon className="size-5" />
      )}
    </div>
  )
}

function ModelCopyButton({ value }: { value?: string }) {
  const { t } = useI18n()
  const [isCopied, setIsCopied] = React.useState(false)

  if (!value) {
    return null
  }

  const copyValue = value

  async function copyModelName() {
    try {
      await window.navigator.clipboard.writeText(copyValue)
      setIsCopied(true)
      window.setTimeout(() => setIsCopied(false), 1600)
    } catch {
      setIsCopied(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={isCopied ? "xs" : "icon-xs"}
      aria-label={isCopied ? t.copied : t.copyModelId}
      title={isCopied ? t.copied : t.copyModelId}
      onClick={() => void copyModelName()}
    >
      {isCopied ? (
        <RiCheckLine data-icon="inline-start" />
      ) : (
        <RiFileCopyLine data-icon="inline-start" />
      )}
      {isCopied ? t.copied : null}
    </Button>
  )
}

function ModelField({
  label,
  values,
  outline = false,
}: {
  label: string
  values: string[]
  outline?: boolean
}) {
  const { t } = useI18n()

  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {values.length > 0 ? (
          values.map((value) => (
            <Badge key={value} variant={outline ? "outline" : "secondary"}>
              {modalityLabel(value)}
            </Badge>
          ))
        ) : (
          <span className="text-muted-foreground">{t.none}</span>
        )}
      </div>
    </div>
  )
}

function ModelPriceSummary({
  model,
  projectId,
  locale,
}: {
  model: SquareModel
  projectId?: string
  locale: string
}) {
  const { t } = useI18n()
  const [priceGroup, setPriceGroup] = React.useState<ModelPriceGroup | null>(
    null
  )
  const [isLoading, setIsLoading] = React.useState(false)
  const modelName = model.Name ?? ""

  React.useEffect(() => {
    if (!modelName) {
      return
    }

    const cacheKey = getPriceCacheKey(projectId, modelName)
    const cachedPrice = readCachedModelPrice(cacheKey)

    if (cachedPrice !== undefined) {
      const timeout = window.setTimeout(() => {
        setPriceGroup(cachedPrice)
      }, 0)

      return () => window.clearTimeout(timeout)
    }

    let isCancelled = false

    async function loadPrice() {
      setIsLoading(true)

      try {
        const params = new URLSearchParams({ keyword: modelName })

        if (projectId) {
          params.set("projectId", projectId)
        }

        const response = await fetch(
          `/api/model-square/prices?${params.toString()}`,
          { cache: "no-store" }
        )
        const result = (await response.json()) as ModelPriceResponse
        const nextPriceGroup =
          response.ok && result.ok && Array.isArray(result.data)
            ? findPriceGroup(model, result.data)
            : null

        if (!isCancelled) {
          setPriceGroup(nextPriceGroup)
          writeCachedModelPrice(cacheKey, nextPriceGroup)
        }
      } catch {
        if (!isCancelled) {
          setPriceGroup(null)
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadPrice()

    return () => {
      isCancelled = true
    }
  }, [model, modelName, projectId])

  const effectivePriceGroup = modelName ? priceGroup : null
  const priceSections = getPriceSections(effectivePriceGroup, locale)
  const inlinePriceSections = getInlinePriceSections(priceSections)
  const isTieredPricing = priceSections.length > 1

  if (isLoading) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{t.pricing}</span>
        <Skeleton className="h-5 w-40" />
      </div>
    )
  }

  return (
    <div className="mt-4 flex min-w-0 items-center gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{t.pricing}</span>
      {priceSections.length > 0 ? (
        <div className="flex max-w-full min-w-0 items-center gap-1">
          <div className="flex min-w-0 items-center gap-x-4 overflow-hidden whitespace-nowrap">
            {inlinePriceSections.map((section) =>
              section.rates.map((rate) => (
                <span key={rate.key} className="shrink-0 font-medium">
                  <span className="text-muted-foreground">
                    {isTieredPricing && section.labels.length > 0
                      ? section.labels.join(" ")
                      : rate.label}
                  </span>{" "}
                  {rate.value}
                </span>
              ))
            )}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t.viewPricingDetails}
                className="shrink-0"
              >
                <RiInformationLine className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="bottom"
              className="max-h-[28rem] w-[40rem] max-w-[calc(100vw-2rem)] overflow-auto p-3"
            >
              <PopoverHeader className="sr-only">
                <PopoverTitle>{t.pricingDetails}</PopoverTitle>
              </PopoverHeader>
              <div className="grid gap-2 text-sm">
                {priceSections.map((section) => (
                  <div
                    key={section.key}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b pb-2 last:border-b-0 last:pb-0"
                  >
                    {section.labels.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {section.labels.map((label) => (
                          <Badge
                            key={label}
                            variant="outline"
                            className="h-6 px-2"
                          >
                            {label}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {section.rates.map((rate) => (
                      <span
                        key={rate.key}
                        className="inline-flex items-baseline gap-1.5 whitespace-nowrap"
                      >
                        <span className="text-muted-foreground">
                          {rate.label}
                        </span>
                        <span className="font-medium">{rate.value}</span>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      ) : (
        <span className="text-muted-foreground">{t.pricingUnavailable}</span>
      )}
    </div>
  )
}

export { ModelSquarePage }
