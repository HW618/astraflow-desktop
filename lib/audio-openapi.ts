import {
  AUDIO_OPENAPI_FIELDS,
  AUDIO_OPENAPI_MODELS,
} from "@/lib/generated/audio-openapi-fields"
import { MODELVERSE_BASE_URL } from "@/lib/modelverse-config"
import type {
  StudioAudioModelOption,
  StudioAudioModelOperation,
  StudioAudioOpenapiModelEntry,
  StudioAudioParameterField,
} from "@/lib/studio-audio-types"

const AUDIO_MODEL_DISPLAY_NAMES: Record<string, string> = {
  "IndexTeam/IndexTTS-2": "IndexTTS 2",
  "music-v1": "ElevenLabs Music",
  "qwen3-tts-flash": "Qwen TTS Flash",
  "speech-2.8-hd": "MiniMax Speech 2.8 HD",
  "speech-2.8-turbo": "MiniMax Speech 2.8 Turbo",
  "speech-2.6-hd": "MiniMax Speech 2.6 HD",
  "speech-2.6-turbo": "MiniMax Speech 2.6 Turbo",
  "suno/chirp-bluejay": "Suno Chirp Bluejay",
  "suno-v4": "Suno v4",
  "suno-v4.5": "Suno v4.5",
  "suno-v4.5+": "Suno v4.5+",
  "suno-v4.5-all": "Suno v4.5 All",
  "suno-v5": "Suno v5",
  "suno-v5.5": "Suno v5.5",
  "text-to-sound-v2": "Text to Sound v2",
}

const generatedFields = AUDIO_OPENAPI_FIELDS as Record<
  string,
  StudioAudioParameterField[]
>

function normalizeModelKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^publishers\/[^/]+\/models\//, "")
    .replace(/接口文档$/, "")
    .replace(/[^a-z0-9]+/g, "")
}

function getAudioModelDisplayName(value: string, fallback = value) {
  const trimmed = value.trim()
  const publisherFallback = trimmed.replace(/^publishers\/[^/]+\/models\//, "")
  const normalized = normalizeModelKey(trimmed)

  return (
    AUDIO_MODEL_DISPLAY_NAMES[trimmed] ??
    AUDIO_MODEL_DISPLAY_NAMES[publisherFallback] ??
    Object.entries(AUDIO_MODEL_DISPLAY_NAMES).find(
      ([key]) => normalizeModelKey(key) === normalized
    )?.[1] ??
    fallback.trim() ??
    value
  )
}

function cloneFields(fields: StudioAudioParameterField[]) {
  return fields.map((field) => ({
    ...field,
    payloadPath: [...field.payloadPath],
    options: field.options?.map((option) => ({
      ...option,
      label:
        field.name === "model"
          ? getAudioModelDisplayName(option.value, option.label)
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
  entry: StudioAudioOpenapiModelEntry
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

function operationRank(entry: StudioAudioOpenapiModelEntry) {
  if (entry.operationId === "submitSunoMusicTask") return 0
  if (entry.operationId === "createElevenLabsMusicGeneration") return 0
  if (entry.operationId.includes("Speech")) return 0
  if (entry.operationId.includes("SoundGeneration")) return 0
  if (entry.operationId.includes("Detailed")) return 1
  if (entry.operationId.includes("Cover")) return 2
  if (entry.operationId.includes("Infer")) return 3
  return 5
}

function getAudioOperationId(entry: StudioAudioOpenapiModelEntry) {
  return `${entry.file}#${entry.operationId}`
}

function getAudioOperationLabel(entry: StudioAudioOpenapiModelEntry) {
  if (entry.operationId === "submitSunoMusicTask") return "Music"
  if (entry.operationId === "submitSunoCoverTask") return "Cover"
  if (entry.operationId === "createElevenLabsMusicGeneration") {
    return "Generate"
  }
  if (entry.operationId === "createElevenLabsMusicDetailedGeneration") {
    return "Detailed"
  }
  if (entry.operationId === "createTttsInferAudio") {
    return "Reference audio"
  }
  if (entry.operationId === "createTttsSpeechAudio") {
    return "Speech"
  }
  if (entry.operationId === "createIndexTeamIndexTTSExtendSpeech") {
    return "Speech extended"
  }
  if (entry.operationId.includes("Speech")) return "Speech"
  if (entry.operationId.includes("SoundGeneration")) return "Sound"
  return entry.title
}

function findAudioOpenapiEntries({
  modelId,
  modelName,
}: {
  modelId: string
  modelName: string
}) {
  return AUDIO_OPENAPI_MODELS.map((entry) => ({
    entry,
    score: scoreEntry({ entry, modelId, modelName }),
  }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      const score = right.score - left.score
      const rank = operationRank(left.entry) - operationRank(right.entry)
      return (
        score ||
        rank ||
        getAudioOperationId(left.entry).localeCompare(
          getAudioOperationId(right.entry)
        )
      )
    })
    .map((candidate) => candidate.entry)
}

function selectModelConstant(
  entry: StudioAudioOpenapiModelEntry,
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

function getGeneratedFieldsKey(entry: StudioAudioOpenapiModelEntry) {
  return `${entry.file}#${entry.operationId}`
}

export function loadAudioModelFields(
  entry: StudioAudioOpenapiModelEntry
): StudioAudioParameterField[] {
  return cloneFields(generatedFields[getGeneratedFieldsKey(entry)] ?? [])
}

function buildAudioModelOperation({
  entry,
  modelId,
  modelName,
}: {
  entry: StudioAudioOpenapiModelEntry
  modelId: string
  modelName: string
}): StudioAudioModelOperation {
  return {
    id: getAudioOperationId(entry),
    label: getAudioOperationLabel(entry),
    openapi: {
      ...entry,
      modelConstant: selectModelConstant(entry, modelId, modelName),
    },
    fields: loadAudioModelFields(entry),
  }
}

export function buildAudioModelOption({
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
}): StudioAudioModelOption {
  const fallbackDisplayLabel = getAudioModelDisplayName(
    name,
    getAudioModelDisplayName(id, label)
  )
  const entries = findAudioOpenapiEntries({
    modelId: id,
    modelName: name,
  })

  if (entries.length === 0) {
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

  const operations = entries.map((entry) =>
    buildAudioModelOperation({ entry, modelId: id, modelName: name })
  )
  const primaryOperation = operations[0]
  const displayLabel = getAudioModelDisplayName(
    name,
    getAudioModelDisplayName(
      id,
      getAudioModelDisplayName(
        primaryOperation.openapi.modelConstant,
        getAudioModelDisplayName(primaryOperation.openapi.title, label)
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
    openapi: primaryOperation.openapi,
    operations,
    fields: primaryOperation.fields,
  }
}

export function getAudioModelEndpoint(entry: StudioAudioOpenapiModelEntry) {
  return `${MODELVERSE_BASE_URL}${entry.path}`
}

export function getAudioTaskStatusEndpoint(entry: StudioAudioOpenapiModelEntry) {
  return entry.statusPath ? `${MODELVERSE_BASE_URL}${entry.statusPath}` : ""
}
