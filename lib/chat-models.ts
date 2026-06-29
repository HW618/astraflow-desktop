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

export const SUPPORTED_CHAT_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "enabled",
] as const

export type ChatReasoningEffort =
  (typeof SUPPORTED_CHAT_REASONING_EFFORTS)[number]

export const DEFAULT_CHAT_REASONING_EFFORT: ChatReasoningEffort = "medium"

export type ChatModelProvider =
  | "langchain_openai"
  | "langchain_anthropic"

export type ChatReasoningMode =
  | "openai_reasoning_effort"
  | "anthropic_output_effort"
  | "glm_reasoning_effort"
  | "kimi_thinking"

export type ChatModelConfig = {
  value: SupportedChatModel
  label: string
  provider: ChatModelProvider
  providerModel: string
  reasoningMode: ChatReasoningMode
  reasoningEfforts: readonly ChatReasoningEffort[]
  defaultReasoningEffort: ChatReasoningEffort
}

const OPENAI_REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
] as const

const CLAUDE_STANDARD_REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
  "max",
] as const

const CLAUDE_XHIGH_REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const

const GLM_REASONING_EFFORTS = [
  "none",
  "xhigh",
  "max",
] as const

const KIMI_REASONING_EFFORTS = ["none", "enabled"] as const

export const CHAT_MODEL_OPTIONS: ReadonlyArray<ChatModelConfig> = [
  {
    value: "gpt-5.5",
    label: "GPT 5.5",
    provider: "langchain_openai",
    providerModel: "gpt-5.5",
    reasoningMode: "openai_reasoning_effort",
    reasoningEfforts: OPENAI_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    value: "gpt-5.4",
    label: "GPT 5.4",
    provider: "langchain_openai",
    providerModel: "gpt-5.4",
    reasoningMode: "openai_reasoning_effort",
    reasoningEfforts: OPENAI_REASONING_EFFORTS,
    defaultReasoningEffort: "none",
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT 5.4 Mini",
    provider: "langchain_openai",
    providerModel: "gpt-5.4-mini",
    reasoningMode: "openai_reasoning_effort",
    reasoningEfforts: OPENAI_REASONING_EFFORTS,
    defaultReasoningEffort: "none",
  },
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "langchain_anthropic",
    providerModel: "claude-sonnet-4-6",
    reasoningMode: "anthropic_output_effort",
    reasoningEfforts: CLAUDE_STANDARD_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    value: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    provider: "langchain_anthropic",
    providerModel: "claude-opus-4-6",
    reasoningMode: "anthropic_output_effort",
    reasoningEfforts: CLAUDE_STANDARD_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    value: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    provider: "langchain_anthropic",
    providerModel: "claude-opus-4-7",
    reasoningMode: "anthropic_output_effort",
    reasoningEfforts: CLAUDE_XHIGH_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    value: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "langchain_anthropic",
    providerModel: "claude-opus-4-8",
    reasoningMode: "anthropic_output_effort",
    reasoningEfforts: CLAUDE_XHIGH_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
  },
  {
    value: "glm-5.2",
    label: "GLM 5.2",
    provider: "langchain_openai",
    providerModel: "glm-5.2",
    reasoningMode: "glm_reasoning_effort",
    reasoningEfforts: GLM_REASONING_EFFORTS,
    defaultReasoningEffort: "max",
  },
  {
    value: "kimi-k2.6",
    label: "Kimi K2.6",
    provider: "langchain_openai",
    providerModel: "kimi-k2.6",
    reasoningMode: "kimi_thinking",
    reasoningEfforts: KIMI_REASONING_EFFORTS,
    defaultReasoningEffort: "enabled",
  },
]

export function getChatModelConfig(model: SupportedChatModel) {
  return (
    CHAT_MODEL_OPTIONS.find((option) => option.value === model) ??
    CHAT_MODEL_OPTIONS[0]
  )
}

export function isChatReasoningEffort(
  value: string
): value is ChatReasoningEffort {
  return SUPPORTED_CHAT_REASONING_EFFORTS.some((effort) => effort === value)
}

export function getChatReasoningEfforts(model: SupportedChatModel) {
  return getChatModelConfig(model).reasoningEfforts
}

export function getDefaultChatReasoningEffort(model: SupportedChatModel) {
  return getChatModelConfig(model).defaultReasoningEffort
}

export function isChatReasoningEffortSupported(
  model: SupportedChatModel,
  effort: ChatReasoningEffort
) {
  return getChatReasoningEfforts(model).some((option) => option === effort)
}

export function resolveChatReasoningEffort(
  model: SupportedChatModel,
  effort: ChatReasoningEffort | undefined
) {
  if (effort && isChatReasoningEffortSupported(model, effort)) {
    return effort
  }

  return getDefaultChatReasoningEffort(model)
}
