export const studioModes = ["chat", "image", "video", "audio"] as const

export type StudioMode = (typeof studioModes)[number]

export type StudioMessageRole = "user" | "assistant"

export type StudioMessageStatus = "complete" | "streaming" | "error"

export type StudioMessageActivity = {
  id: string
  toolName: string
  status: "running" | "complete" | "error"
  input: string
  output: string
  error: string | null
}

export type StudioMessagePart =
  | {
      id: string
      type: "text"
      content: string
    }
  | {
      id: string
      type: "reasoning"
      content: string
      durationMs: number | null
    }
  | {
      id: string
      type: "tool"
      activity: StudioMessageActivity
    }

export type StudioAttachmentKind = "image" | "file"

export type StudioAttachment = {
  id?: string
  type: StudioAttachmentKind
  name: string
  mimeType: string
  size?: number | null
  dataUrl?: string | null
  storagePath?: string | null
  sandboxPath?: string | null
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
  model: string | null
  versionGroupId: string | null
  versionIndex: number
  versionCount: number
  isActiveVersion: boolean
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
  reasoningContent: string
  reasoningDurationMs: number | null
  status: StudioMessageStatus
  attachments: StudioAttachment[]
  createdAt: string
}

export type StudioChatRunStatus =
  "queued" | "running" | "complete" | "error" | "cancelled"

export type StudioChatRunSnapshot = {
  runId: string
  sessionId: string
  assistantMessageId: string
  status: StudioChatRunStatus
  error: string | null
  startedAt: string
  updatedAt: string
}

export type StudioChatRunLiveSnapshot = StudioChatRunSnapshot & {
  message: StudioMessage | null
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

export type StudioExaApiKey = {
  key: string
  updatedAt: string
}

export type StudioApiKeyStatus = {
  configured: boolean
  updatedAt: string | null
}

export type StudioImageAdapter =
  | "openai-images"
  | "openai-images-edit"
  | "gemini-generate-content"
  | "custom-json"
  | "async-task"

export type StudioImageDisabledReason =
  "missing-openapi" | "alias-unverified" | "follow-up-only" | "edit-only"

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

export type StudioImageOperationKind = "generation" | "edit"

export type StudioImageModelOperation = {
  id: StudioImageOperationKind
  openapi: StudioImageModelOpenapi
  fields: StudioImageParameterField[]
  requiresReferenceImages: boolean
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
  operations?: StudioImageModelOperation[]
  fields: StudioImageParameterField[]
}

export type StudioImageStatus =
  "queued" | "running" | "complete" | "partial" | "error"

export type StudioImageOutput = {
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
  savedAt: string | null
  createdAt: string
}

export type StudioSavedImageOutput = {
  id: string
  generationId: string
  sessionId: string
  index: number
  prompt: string
  modelName: string
  manufacturer: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  storagePath: string | null
  savedAt: string
  createdAt: string
}

export type StudioLibraryImageFile = StudioSavedImageOutput & {
  kind: "image"
  src: string
  downloadUrl: string
  canOpenFolder: boolean
}

export type StudioImageLibraryFile = StudioLibraryImageFile
export type StudioLibraryVideoFile =
  import("@/lib/studio-video-types").StudioVideoLibraryFile
export type StudioLibraryAudioFile =
  import("@/lib/studio-audio-types").StudioAudioLibraryFile

export type StudioGenericLibraryFile = {
  id: string
  kind: "file"
  sessionId: string
  messageId: string | null
  name: string
  prompt: string
  modelName: string
  manufacturer: string | null
  mimeType: string | null
  size: number | null
  sandboxPath: string | null
  downloadUrl: string
  canOpenFolder: boolean
  savedAt: string
  createdAt: string
}

export type StudioLibraryFile =
  | StudioLibraryImageFile
  | StudioLibraryVideoFile
  | StudioLibraryAudioFile
  | StudioGenericLibraryFile

export type StudioSessionSandbox = {
  sessionId: string
  sandboxId: string
  sandboxDomain: string | null
  template: string
  status: "running" | "paused" | "unknown"
  autoPauseTimeoutSeconds: number
  volumeId: string | null
  volumeName: string | null
  volumePath: string | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string
}

export type StudioSessionFileKind = "attachment" | "generated"

export type StudioSessionFile = {
  id: string
  sessionId: string
  messageId: string | null
  kind: StudioSessionFileKind
  originalName: string
  mimeType: string | null
  size: number | null
  storagePath: string
  sandboxPath: string | null
  sourceToolCallId: string | null
  savedAt: string | null
  createdAt: string
  updatedAt: string
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
