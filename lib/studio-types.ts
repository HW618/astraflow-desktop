export const studioModes = ["chat", "image", "video", "audio"] as const

export type StudioMode = (typeof studioModes)[number]

export type StudioMessageRole = "user" | "assistant"

export type StudioMessageStatus = "complete" | "streaming" | "error"

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
  createdAt: string
}
