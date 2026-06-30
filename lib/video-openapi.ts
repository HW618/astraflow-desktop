import { VIDEO_OPENAPI_FIELDS, VIDEO_OPENAPI_MODELS } from "@/lib/generated/video-openapi-fields"
import type {
  StudioVideoModelOption,
  StudioVideoOpenapiModelEntry,
  StudioVideoParameterField,
} from "@/lib/studio-video-types"

const MODELVERSE_BASE_URL = "https://api.modelverse.cn"

const VIDEO_MODEL_DISPLAY_NAMES: Record<string, string> = {
  "doubao-seedance-1-5-pro-251215": "Doubao Seedance 1.5 Pro",
  "doubao-seedance-2-0-260128": "Doubao Seedance 2.0",
  "HappyHorse-1.0-I2V": "HappyHorse 1.0 I2V",
  "HappyHorse-1.0-R2V": "HappyHorse 1.0 R2V",
  "HappyHorse-1.0-T2V": "HappyHorse 1.0 T2V",
  "HappyHorse-1.0-Video-Edit": "HappyHorse 1.0 Video Edit",
  "happyhorse-1.0-i2v": "HappyHorse 1.0 I2V",
  "happyhorse-1.0-r2v": "HappyHorse 1.0 R2V",
  "happyhorse-1.0-t2v": "HappyHorse 1.0 T2V",
  "happyhorse-1.1-t2v": "HappyHorse 1.1 T2V",
  "happyhorse-1.0-video-edit": "HappyHorse 1.0 Video Edit",
  "Kling-O1": "Kling O1",
  "Kling-O3": "Kling O3",
  "Kling-v2.6-I2V": "Kling 2.6 I2V",
  "Kling-v2.6-T2V": "Kling 2.6 T2V",
  "Kling-v3": "Kling 3",
  "kling-video-o1": "Kling O1",
  "kling-v2-6": "Kling V2.6",
  "kling-v3": "Kling V3",
  "kling-v3-omni": "Kling 3 Omni",
  "MiniMax-Hailuo-02": "MiniMax Hailuo 02",
  "MiniMax-Hailuo-2.3": "MiniMax Hailuo 2.3",
  "MiniMax-Hailuo-2.3-Fast": "MiniMax Hailuo 2.3 Fast",
  "MiniMax-Hailuo-2.3-I2V": "MiniMax Hailuo 2.3 I2V",
  "MiniMax-Hailuo-2.3-T2V": "MiniMax Hailuo 2.3 T2V",
  "OpenAI-Sora2-I2V": "Sora 2 I2V",
  "OpenAI-Sora2-T2V": "Sora 2 T2V",
  "openai/sora-2/image-to-video": "Sora 2 Image to Video",
  "openai/sora-2/text-to-video": "Sora 2 Text to Video",
  "Pixverse-v6": "Pixverse V6",
  "pixverse-v6": "Pixverse V6",
  "Veo-3.1": "Veo 3.1",
  "veo-3.1-fast-generate-001": "Veo 3.1 Fast",
  "veo-3.1-generate-001": "Veo 3.1",
  "Vidu-Extend": "Vidu Extend",
  "Vidu-Img2Video": "Vidu Image to Video",
  "Vidu-LipSync": "Vidu Lip Sync",
  "Vidu-Mv": "Vidu MV",
  "Vidu-Reference2Video": "Vidu Reference to Video",
  "Vidu-StartEnd2Video": "Vidu Start-End to Video",
  "Vidu-Text2Video": "Vidu Text to Video",
  "vidu-lip-sync": "Vidu Lip Sync",
  "vidu-mv": "Vidu MV",
  "vidu-one-click-mv": "Vidu One-Click MV",
  "viduq2": "Vidu Q2",
  "viduq2-pro": "Vidu Q2 Pro",
  "viduq2-pro-fast": "Vidu Q2 Pro Fast",
  "viduq2-turbo": "Vidu Q2 Turbo",
  "viduq3-pro": "Vidu Q3 Pro",
  "Wan-AI/Wan2.2-I2V": "WAN 2.2 I2V",
  "Wan-AI/Wan2.2-T2V": "WAN 2.2 T2V",
  "Wan-AI/Wan2.5-I2V": "WAN 2.5 I2V",
  "Wan-AI/Wan2.5-T2V": "WAN 2.5 T2V",
  "Wan-AI/Wan2.6-I2V": "WAN 2.6 I2V",
  "Wan-AI/Wan2.6-R2V": "WAN 2.6 R2V",
  "Wan-AI/Wan2.6-R2V-Flash": "WAN 2.6 R2V Flash",
  "Wan-AI/Wan2.6-T2V": "WAN 2.6 T2V",
  "Wan-AI-Wan2.2-I2V": "WAN 2.2 I2V",
  "Wan-AI-Wan2.2-T2V": "WAN 2.2 T2V",
  "Wan-AI-Wan2.5-I2V": "WAN 2.5 I2V",
  "Wan-AI-Wan2.5-T2V": "WAN 2.5 T2V",
  "Wan-AI-Wan2.6-I2V": "WAN 2.6 I2V",
  "Wan-AI-Wan2.6-R2V": "WAN 2.6 R2V",
  "Wan-AI-Wan2.6-R2V-Flash": "WAN 2.6 R2V Flash",
  "Wan-AI-Wan2.6-T2V": "WAN 2.6 T2V",
  "wan2.6-r2v": "WAN 2.6 R2V",
  "wan2.6-r2v-flash": "WAN 2.6 R2V Flash",
}

const generatedFields = VIDEO_OPENAPI_FIELDS as Record<
  string,
  StudioVideoParameterField[]
>

function normalizeModelKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^publishers\/[^/]+\/models\//, "")
    .replace(/接口文档$/, "")
    .replace(/[^a-z0-9]+/g, "")
}

function getVideoModelDisplayName(value: string, fallback = value) {
  const trimmed = value.trim()
  const publisherFallback = trimmed.replace(/^publishers\/[^/]+\/models\//, "")
  const normalized = normalizeModelKey(trimmed)

  return (
    VIDEO_MODEL_DISPLAY_NAMES[trimmed] ??
    VIDEO_MODEL_DISPLAY_NAMES[publisherFallback] ??
    Object.entries(VIDEO_MODEL_DISPLAY_NAMES).find(
      ([key]) => normalizeModelKey(key) === normalized
    )?.[1] ??
    fallback.trim() ??
    value
  )
}

function cloneFields(fields: StudioVideoParameterField[]) {
  return fields.map((field) => ({
    ...field,
    payloadPath: [...field.payloadPath],
    options: field.options?.map((option) => ({
      ...option,
      label:
        field.name === "model"
          ? getVideoModelDisplayName(option.value, option.label)
          : option.label,
    })),
    suggestedValues: field.suggestedValues?.map((option) => ({ ...option })),
  }))
}

function scoreEntry({
  entry,
  modelId,
  modelName,
}: {
  entry: StudioVideoOpenapiModelEntry
  modelId: string
  modelName: string
}) {
  const candidates = [modelName, modelId].map(normalizeModelKey)
  const fileName = entry.file.split("/").at(-1)?.replace(/\.ya?ml$/, "") ?? ""
  const titleAliases = [entry.title, fileName].map(normalizeModelKey)
  const modelAliases = entry.modelValues
    .flatMap((value) => [value, value.split("/").at(-1) ?? value])
    .map(normalizeModelKey)
  const aliases = [...titleAliases, ...modelAliases]

  if (candidates.some((candidate) => aliases.includes(candidate))) {
    return 100
  }

  if (
    candidates.some((candidate) =>
      titleAliases.some(
        (alias) => candidate.includes(alias) || alias.includes(candidate)
      )
    )
  ) {
    return 80
  }

  return 0
}

function findVideoOpenapiEntry({
  modelId,
  modelName,
}: {
  modelId: string
  modelName: string
}) {
  let best: StudioVideoOpenapiModelEntry | null = null
  let bestScore = 0

  for (const entry of VIDEO_OPENAPI_MODELS) {
    const score = scoreEntry({ entry, modelId, modelName })

    if (score > bestScore) {
      best = entry
      bestScore = score
    }
  }

  return best
}

function selectModelConstant(
  entry: StudioVideoOpenapiModelEntry,
  modelId: string,
  modelName: string
) {
  const candidates = [modelName, modelId]
  const normalizedCandidates = candidates.map(normalizeModelKey)
  const exact = entry.modelValues.find((value) =>
    normalizedCandidates.includes(normalizeModelKey(value))
  )

  return exact ?? entry.modelValues[0] ?? modelName
}

function getGeneratedFieldsKey(entry: StudioVideoOpenapiModelEntry) {
  return `${entry.file}#${entry.operationId}`
}

export function loadVideoModelFields(
  entry: StudioVideoOpenapiModelEntry
): StudioVideoParameterField[] {
  return cloneFields(generatedFields[getGeneratedFieldsKey(entry)] ?? [])
}

export function buildVideoModelOption({
  id,
  name,
  label,
  manufacturer,
  inputModalities,
  outputModalities,
  coverUrl,
}: {
  id: string
  name: string
  label: string
  manufacturer: string
  inputModalities: string[]
  outputModalities: string[]
  coverUrl: string | null
}): StudioVideoModelOption {
  const fallbackDisplayLabel = getVideoModelDisplayName(
    name,
    getVideoModelDisplayName(id, label)
  )
  const entry = findVideoOpenapiEntry({
    modelId: id,
    modelName: name,
  })

  if (!entry) {
    return {
      id,
      name,
      label: fallbackDisplayLabel,
      manufacturer,
      inputModalities,
      outputModalities,
      coverUrl,
      supported: false,
      disabledReason: "missing-openapi",
      fields: [],
    }
  }

  const modelConstant = selectModelConstant(entry, id, name)
  const displayLabel = getVideoModelDisplayName(
    name,
    getVideoModelDisplayName(
      id,
      getVideoModelDisplayName(
        modelConstant,
        getVideoModelDisplayName(entry.title, label)
      )
    )
  )

  return {
    id,
    name,
    label: displayLabel,
    manufacturer,
    inputModalities,
    outputModalities,
    coverUrl,
    supported: true,
    openapi: {
      ...entry,
      modelConstant,
    },
    fields: loadVideoModelFields(entry),
  }
}

export function getVideoModelEndpoint(entry: StudioVideoOpenapiModelEntry) {
  return `${MODELVERSE_BASE_URL}${entry.path}`
}

export function getVideoTaskStatusEndpoint(entry: StudioVideoOpenapiModelEntry) {
  return `${MODELVERSE_BASE_URL}${entry.statusPath}`
}

export function getVideoOpenapiEntry(
  file: string | null | undefined,
  operationId: string | null | undefined
) {
  if (!file || !operationId) {
    return null
  }

  return (
    VIDEO_OPENAPI_MODELS.find(
      (entry) => entry.file === file && entry.operationId === operationId
    ) ?? null
  )
}
