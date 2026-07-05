import type { ChatReasoningEffort } from "@/lib/chat-models"

export const AGENT_RUNTIME_IDS = [
  "astraflow",
  "claude-native",
  "claude-code",
  "codex-direct",
  "codex",
  "opencode-native",
  "opencode",
] as const

export type AgentRuntimeId = (typeof AGENT_RUNTIME_IDS)[number]

export const AGENT_MODEL_PROTOCOLS = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
] as const

export type AgentModelProtocol = (typeof AGENT_MODEL_PROTOCOLS)[number]

export type AgentRuntimeModelSetting = {
  useLocalSettings: boolean
  defaultModel: string
}

export type AgentModelDefinition = {
  id: string
  label: string
  providerModel: string
  protocol: AgentModelProtocol
  baseUrl: string | null
  supportedRuntimeIds: AgentRuntimeId[]
  reasoningEfforts: ChatReasoningEffort[]
  defaultReasoningEffort: ChatReasoningEffort
  builtin: boolean
  enabled: boolean
}

export type CustomAgentModelInput = Omit<
  AgentModelDefinition,
  "builtin" | "enabled"
> & {
  enabled?: boolean
}

export type AgentModelSettings = {
  runtimes: Record<AgentRuntimeId, AgentRuntimeModelSetting>
  customModels: AgentModelDefinition[]
  updatedAt: string | null
}

export type AgentModelSettingsPayload = AgentModelSettings & {
  models: AgentModelDefinition[]
  hasModelverseApiKey: boolean
}
