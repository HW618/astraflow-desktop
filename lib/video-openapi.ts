import { VIDEO_OPENAPI_FIELDS, VIDEO_OPENAPI_MODELS } from "@/lib/generated/video-openapi-fields"
import type {
  StudioVideoModelOption,
  StudioVideoOpenapiModelEntry,
  StudioVideoParameterField,
} from "@/lib/studio-video-types"

const MODELVERSE_BASE_URL = "https://api.modelverse.cn"

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

function cloneFields(fields: StudioVideoParameterField[]) {
  return fields.map((field) => ({
    ...field,
    payloadPath: [...field.payloadPath],
    options: field.options?.map((option) => ({ ...option })),
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
  const entry = findVideoOpenapiEntry({
    modelId: id,
    modelName: name,
  })

  if (!entry) {
    return {
      id,
      name,
      label,
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

  return {
    id,
    name,
    label,
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
