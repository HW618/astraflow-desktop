export const studioModes = ["chat", "image", "video", "audio"] as const

export type StudioMode = (typeof studioModes)[number]

export type StudioMessageRole = "user" | "assistant"

export type StudioMessageStatus = "complete" | "streaming" | "error"

export type StudioAttachment = {
  type: "image"
  name: string
  mimeType: string
  dataUrl: string
}

export type StudioSession = {
  id: string
  mode: StudioMode
  title: string
  createdAt: string
  updatedAt: string
}

export type StudioMessage = {
  id: string
  sessionId: string
  role: StudioMessageRole
  content: string
  status: StudioMessageStatus
  attachments: StudioAttachment[]
  createdAt: string
}

export type StudioOAuthStatus = {
  configured: boolean
  email: string | null
  expiresAt: number | null
  updatedAt: string | null
}

export type StudioOAuthTokens = {
  accessToken: string
  refreshToken: string | null
  tokenType: string | null
  expiresAt: number | null
  email: string | null
  updatedAt: string
}

export type StudioOAuthFlowStatus = "pending" | "complete" | "error"

export type StudioOAuthFlowSnapshot = {
  state: string
  status: StudioOAuthFlowStatus
  authorizationUrl: string
  redirectUri: string
  port: number
  message: string | null
}

export type StudioModelverseApiKeyOption = {
  id: string
  name: string
}

export type StudioModelverseApiKey = StudioModelverseApiKeyOption & {
  key: string
  projectId: string
  updatedAt: string
}

export type StudioImageAdapter =
  | "openai-images"
  | "openai-images-edit"
  | "gemini-generate-content"
  | "custom-json"
  | "async-task"

export type StudioImageDisabledReason =
  | "missing-openapi"
  | "alias-unverified"
  | "follow-up-only"
  | "edit-only"

export type StudioImageFieldKind =
  | "prompt"
  | "text"
  | "textarea"
  | "select"
  | "boolean"
  | "number"
  | "slider"
  | "image"

export type StudioImageFieldOption = {
  value: string
  label: string
}

export type StudioImageParameterField = {
  name: string
  label: string
  description?: string
  kind: StudioImageFieldKind
  required: boolean
  advanced: boolean
  hidden: boolean
  constantValue?: string | number | boolean
  defaultValue?: string | number | boolean
  options?: StudioImageFieldOption[]
  suggestedValues?: StudioImageFieldOption[]
  min?: number
  max?: number
  step?: number
  multipleOf?: number
  acceptUrl?: boolean
  acceptMultiple?: boolean
  placeholder?: string
  arrayItemKey?: string
}

export type StudioImageModelOpenapi = {
  file: string
  operationId: string
  method: "POST" | "GET"
  path: string
  contentType: "application/json" | "multipart/form-data"
  adapter: StudioImageAdapter
}

export type StudioImageModelOption = {
  id: string
  name: string
  label: string
  manufacturer: string
  inputModalities: string[]
  outputModalities: string[]
  coverUrl: string | null
  supported: boolean
  disabledReason?: StudioImageDisabledReason
  openapi?: StudioImageModelOpenapi
  fields: StudioImageParameterField[]
}

export type StudioImageStatus =
  | "queued"
  | "running"
  | "complete"
  | "partial"
  | "error"

export type StudioImageOutput = {
  id: string
  generationId: string
  index: number
  src: string
  url: string | null
  dataUrl: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  savedAt: string | null
  createdAt: string
}

export type StudioImageGeneration = {
  id: string
  sessionId: string
  modelSquareId: string
  modelName: string
  manufacturer: string | null
  openapiFile: string | null
  operationId: string | null
  prompt: string
  params: Record<string, unknown>
  status: StudioImageStatus
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  outputs: StudioImageOutput[]
}
