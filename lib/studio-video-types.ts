import type {
  StudioImageFieldOption,
  StudioImageParameterField,
} from "@/lib/studio-types"

export type StudioVideoAdapter = "async-task" | "openai-video"

export type StudioVideoDisabledReason =
  "missing-openapi" | "unsupported-endpoint"

export type StudioVideoParameterField = StudioImageParameterField & {
  payloadPath: string[]
  mediaKind?: "image" | "video" | "audio"
  mediaShape?:
    | "direct"
    | "content-item"
    | "array-object"
    | "object-base64"
    | "multipart-binary"
  mediaPayloadKey?: string
  mediaRoleKey?: string
  mediaRoleValues?: string[]
  minItems?: number
  maxItems?: number
}

export type StudioVideoOpenapiModelEntry = {
  file: string
  title: string
  operationId: string
  method: "POST"
  path: string
  statusPath: string
  contentType: "application/json" | "multipart/form-data"
  adapter: StudioVideoAdapter
  modelValues: string[]
}

export type StudioVideoModelOpenapi = StudioVideoOpenapiModelEntry & {
  modelConstant: string
}

export type StudioVideoModelOption = {
  id: string
  name: string
  label: string
  manufacturer: string
  inputModalities: string[]
  outputModalities: string[]
  coverUrl: string | null
  supported: boolean
  disabledReason?: StudioVideoDisabledReason
  openapi?: StudioVideoModelOpenapi
  fields: StudioVideoParameterField[]
}

export type StudioVideoStatus =
  "queued" | "running" | "complete" | "partial" | "error"

export type StudioVideoOutput = {
  id: string
  generationId: string
  index: number
  src: string
  url: string | null
  dataUrl: string | null
  storagePath: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  savedAt: string | null
  createdAt: string
}

export type StudioVideoGeneration = {
  id: string
  sessionId: string
  modelSquareId: string
  modelName: string
  manufacturer: string | null
  openapiFile: string | null
  operationId: string | null
  providerTaskId: string | null
  providerRequestId: string | null
  prompt: string
  params: Record<string, unknown>
  status: StudioVideoStatus
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  outputs: StudioVideoOutput[]
}

export type StudioSavedVideoOutput = {
  id: string
  generationId: string
  sessionId: string
  index: number
  prompt: string
  modelName: string
  manufacturer: string | null
  providerTaskId: string | null
  providerRequestId: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  storagePath: string | null
  savedAt: string
  createdAt: string
}

export type StudioVideoLibraryFile = StudioSavedVideoOutput & {
  kind: "video"
  src: string
  downloadUrl: string
  canOpenFolder: boolean
}

export type StudioVideoFieldOption = StudioImageFieldOption
