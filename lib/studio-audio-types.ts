import type {
  StudioImageFieldKind,
  StudioImageFieldOption,
  StudioImageParameterField,
} from "@/lib/studio-types"

export type StudioAudioAdapter =
  | "audio-json"
  | "audio-binary"
  | "audio-multipart"
  | "async-task"

export type StudioAudioDisabledReason =
  | "missing-openapi"
  | "unsupported-endpoint"

export type StudioAudioFieldKind = StudioImageFieldKind | "audio"

export type StudioAudioParameterField = Omit<
  StudioImageParameterField,
  "kind"
> & {
  kind: StudioAudioFieldKind
  payloadPath: string[]
  mediaKind?: "audio"
  mediaShape?: "multipart-binary"
  contentMediaType?: string
  contentPayloadPath?: string[]
}

export type StudioAudioOpenapiModelEntry = {
  file: string
  title: string
  operationId: string
  method: "POST"
  path: string
  statusPath?: string
  contentType: "application/json" | "multipart/form-data"
  adapter: StudioAudioAdapter
  responseKind: "binary" | "json" | "async"
  modelValues: string[]
}

export type StudioAudioModelOpenapi = StudioAudioOpenapiModelEntry & {
  modelConstant: string
}

export type StudioAudioModelOperation = {
  id: string
  label: string
  openapi: StudioAudioModelOpenapi
  fields: StudioAudioParameterField[]
}

export type StudioAudioModelOption = {
  id: string
  name: string
  label: string
  manufacturer: string
  inputModalities: string[]
  outputModalities: string[]
  coverUrl: string | null
  supported: boolean
  disabledReason?: StudioAudioDisabledReason
  openapi?: StudioAudioModelOpenapi
  operations?: StudioAudioModelOperation[]
  fields: StudioAudioParameterField[]
}

export type StudioAudioStatus =
  | "queued"
  | "running"
  | "complete"
  | "partial"
  | "error"

export type StudioAudioOutput = {
  id: string
  generationId: string
  index: number
  src: string
  url: string | null
  dataUrl: string | null
  mimeType: string | null
  durationSeconds: number | null
  savedAt: string | null
  createdAt: string
}

export type StudioAudioGeneration = {
  id: string
  sessionId: string
  modelSquareId: string
  modelName: string
  manufacturer: string | null
  openapiFile: string | null
  operationId: string | null
  prompt: string
  params: Record<string, unknown>
  status: StudioAudioStatus
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  outputs: StudioAudioOutput[]
}

export type StudioSavedAudioOutput = {
  id: string
  generationId: string
  sessionId: string
  index: number
  prompt: string
  modelName: string
  manufacturer: string | null
  mimeType: string | null
  durationSeconds: number | null
  savedAt: string
  createdAt: string
}

export type StudioAudioLibraryFile = StudioSavedAudioOutput & {
  kind: "audio"
  src: string
  downloadUrl: string
}

export type StudioAudioFieldOption = StudioImageFieldOption
