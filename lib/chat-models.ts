export const SUPPORTED_CHAT_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "glm-5.2",
  "kimi-k2.6",
] as const

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number]

export const DEFAULT_CHAT_MODEL: SupportedChatModel = "gpt-5.5"

export const CHAT_MODEL_OPTIONS: ReadonlyArray<{
  value: SupportedChatModel
  label: string
}> = [
  { value: "gpt-5.5", label: "GPT 5.5" },
  { value: "gpt-5.4", label: "GPT 5.4" },
  { value: "gpt-5.4-mini", label: "GPT 5.4 Mini" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "glm-5.2", label: "GLM 5.2" },
  { value: "kimi-k2.6", label: "Kimi K2.6" },
]
