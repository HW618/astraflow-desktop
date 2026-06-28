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
