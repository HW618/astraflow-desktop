import { readSelectedUCloudProjectId } from "@/lib/project-selection"

export type StudioGenerationMode = "image" | "video" | "audio"

type StudioModelOptionWithId = {
  id: string
}

type CachedStudioModels<T> = {
  expiresAt: number
  data: T
}

const STUDIO_MODEL_CACHE_TTL = 1000 * 60 * 30
const STUDIO_MODEL_CACHE_PREFIX = "astraflow:studio-models"

export const STUDIO_SELECTED_MODEL_STORAGE_KEYS = {
  image: "astraflow:image-model",
  video: "astraflow:video-model",
  audio: "astraflow:audio-model",
} as const satisfies Record<StudioGenerationMode, string>

function getModelCacheKey(mode: StudioGenerationMode) {
  const projectId = readSelectedUCloudProjectId()

  return `${STUDIO_MODEL_CACHE_PREFIX}:${projectId || "default"}:${mode}`
}

function readRequestedModelId() {
  if (typeof window === "undefined") {
    return ""
  }

  return new URLSearchParams(window.location.search).get("model") ?? ""
}

function readCachedStudioModels<T>(mode: StudioGenerationMode) {
  if (typeof window === "undefined") {
    return undefined
  }

  const cacheKey = getModelCacheKey(mode)

  try {
    const rawCache = window.localStorage.getItem(cacheKey)

    if (!rawCache) {
      return undefined
    }

    const parsed = JSON.parse(rawCache) as Partial<CachedStudioModels<T>>

    if (!parsed.expiresAt || parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(cacheKey)
      return undefined
    }

    return parsed.data
  } catch {
    window.localStorage.removeItem(cacheKey)
    return undefined
  }
}

function writeCachedStudioModels<T>(mode: StudioGenerationMode, data: T) {
  if (typeof window === "undefined") {
    return
  }

  const cache: CachedStudioModels<T> = {
    expiresAt: Date.now() + STUDIO_MODEL_CACHE_TTL,
    data,
  }

  try {
    window.localStorage.setItem(getModelCacheKey(mode), JSON.stringify(cache))
  } catch {
    // Cache writes are best-effort; model selection should still work.
  }
}

export async function fetchStudioModelsWithCache<T>(
  mode: StudioGenerationMode,
  fetcher: () => Promise<T>,
  options: { force?: boolean } = {}
) {
  if (!options.force) {
    const cached = readCachedStudioModels<T>(mode)

    if (cached !== undefined) {
      return cached
    }
  }

  const data = await fetcher()
  writeCachedStudioModels(mode, data)

  return data
}

export function saveSelectedStudioModel(
  mode: StudioGenerationMode,
  modelId: string
) {
  if (typeof window === "undefined" || !modelId) {
    return
  }

  window.localStorage.setItem(STUDIO_SELECTED_MODEL_STORAGE_KEYS[mode], modelId)
}

export function getPreferredStudioModelId<T extends StudioModelOptionWithId>(
  mode: StudioGenerationMode,
  supported: T[]
) {
  if (typeof window === "undefined") {
    return supported[0]?.id ?? ""
  }

  const requested = readRequestedModelId()

  if (requested && supported.some((option) => option.id === requested)) {
    return requested
  }

  const stored = window.localStorage.getItem(
    STUDIO_SELECTED_MODEL_STORAGE_KEYS[mode]
  )

  if (stored && supported.some((option) => option.id === stored)) {
    return stored
  }

  return supported[0]?.id ?? ""
}
