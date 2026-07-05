import {
  AGENT_MODEL_PROTOCOLS,
  AGENT_RUNTIME_IDS,
  type AgentModelDefinition,
  type AgentModelProtocol,
  type AgentModelSettings,
  type AgentRuntimeId,
  type CustomAgentModelInput,
} from "@/lib/agent-model-settings-shared"
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_REASONING_EFFORT,
  SUPPORTED_CHAT_REASONING_EFFORTS,
  type ChatReasoningEffort,
} from "@/lib/chat-models"
import {
  getStudioAgentModelSettingsRecord,
  saveStudioAgentModelSettingsRecord,
} from "@/lib/studio-db"

export const MODELVERSE_OPENAI_BASE_URL = "https://api.modelverse.cn/v1"
export const MODELVERSE_ANTHROPIC_BASE_URL = "https://api.modelverse.cn"
export const MODELVERSE_PROVIDER_ID = "modelverse"

const DEFAULT_RUNTIME_MODEL_SETTINGS: AgentModelSettings["runtimes"] = {
  astraflow: {
    useLocalSettings: false,
    defaultModel: DEFAULT_CHAT_MODEL,
  },
  codex: {
    useLocalSettings: false,
    defaultModel: "gpt-5.4",
  },
  "claude-code": {
    useLocalSettings: false,
    defaultModel: "claude-sonnet-4-6",
  },
  opencode: {
    useLocalSettings: false,
    defaultModel: DEFAULT_CHAT_MODEL,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRuntimeId(value: unknown): value is AgentRuntimeId {
  return (
    typeof value === "string" &&
    AGENT_RUNTIME_IDS.some((runtimeId) => runtimeId === value)
  )
}

function isProtocol(value: unknown): value is AgentModelProtocol {
  return (
    typeof value === "string" &&
    AGENT_MODEL_PROTOCOLS.some((protocol) => protocol === value)
  )
}

function isReasoningEffort(value: unknown): value is ChatReasoningEffort {
  return (
    typeof value === "string" &&
    SUPPORTED_CHAT_REASONING_EFFORTS.some((effort) => effort === value)
  )
}

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback
}

function normalizeReasoningEfforts(value: unknown): ChatReasoningEffort[] {
  const efforts = Array.isArray(value)
    ? value.filter(isReasoningEffort)
    : []

  return efforts.length > 0 ? Array.from(new Set(efforts)) : ["none"]
}

function normalizeSupportedRuntimeIds(value: unknown): AgentRuntimeId[] {
  const runtimeIds = Array.isArray(value)
    ? value.filter(isRuntimeId)
    : []

  return runtimeIds.length > 0
    ? Array.from(new Set(runtimeIds))
    : ["astraflow"]
}

function normalizeDefaultReasoningEffort(
  value: unknown,
  efforts: ChatReasoningEffort[]
) {
  return isReasoningEffort(value) && efforts.includes(value)
    ? value
    : efforts[0] ?? DEFAULT_CHAT_REASONING_EFFORT
}

function normalizeCustomModel(value: unknown): AgentModelDefinition | null {
  if (!isRecord(value)) {
    return null
  }

  const id = cleanString(value.id)
  const label = cleanString(value.label, id)
  const providerModel = cleanString(value.providerModel, id)
  const protocol = isProtocol(value.protocol) ? value.protocol : "openai-chat"

  if (!id || !providerModel) {
    return null
  }

  const reasoningEfforts = normalizeReasoningEfforts(value.reasoningEfforts)
  const supportedRuntimeIds = normalizeSupportedRuntimeIds(
    value.supportedRuntimeIds
  )

  return {
    id,
    label,
    providerModel,
    protocol,
    baseUrl: cleanString(value.baseUrl) || null,
    supportedRuntimeIds,
    reasoningEfforts,
    defaultReasoningEffort: normalizeDefaultReasoningEffort(
      value.defaultReasoningEffort,
      reasoningEfforts
    ),
    builtin: false,
    enabled: value.enabled !== false,
  }
}

function normalizeRuntimeSettings(value: unknown) {
  const record = isRecord(value) ? value : {}

  return AGENT_RUNTIME_IDS.reduce<AgentModelSettings["runtimes"]>(
    (settings, runtimeId) => {
      const runtimeRecord = isRecord(record[runtimeId])
        ? record[runtimeId]
        : {}
      const defaults = DEFAULT_RUNTIME_MODEL_SETTINGS[runtimeId]

      settings[runtimeId] = {
        useLocalSettings:
          typeof runtimeRecord.useLocalSettings === "boolean"
            ? runtimeRecord.useLocalSettings
            : defaults.useLocalSettings,
        defaultModel: cleanString(
          runtimeRecord.defaultModel,
          defaults.defaultModel
        ),
      }

      return settings
    },
    {} as AgentModelSettings["runtimes"]
  )
}

function normalizeSettingsPayload(value: unknown): Omit<
  AgentModelSettings,
  "updatedAt"
> {
  const record = isRecord(value) ? value : {}
  const customModels = Array.isArray(record.customModels)
    ? record.customModels
        .map(normalizeCustomModel)
        .filter((model): model is AgentModelDefinition => Boolean(model))
    : []

  return {
    runtimes: normalizeRuntimeSettings(record.runtimes),
    customModels,
  }
}

export function getBuiltInAgentModels(): AgentModelDefinition[] {
  return CHAT_MODEL_OPTIONS.map((option) => ({
    id: option.value,
    label: option.label,
    providerModel: option.providerModel,
    protocol: option.protocol,
    baseUrl:
      option.protocol === "anthropic-messages"
        ? MODELVERSE_ANTHROPIC_BASE_URL
        : MODELVERSE_OPENAI_BASE_URL,
    supportedRuntimeIds: [...option.supportedRuntimeIds],
    reasoningEfforts: [...option.reasoningEfforts],
    defaultReasoningEffort: option.defaultReasoningEffort,
    builtin: true,
    enabled: true,
  }))
}

export function getAgentModelSettings(): AgentModelSettings {
  const record = getStudioAgentModelSettingsRecord()
  const normalized = normalizeSettingsPayload(record?.value)

  return {
    ...normalized,
    updatedAt: record?.updatedAt ?? null,
  }
}

export function saveAgentModelSettings(
  input: Omit<AgentModelSettings, "updatedAt">
): AgentModelSettings {
  const normalized = normalizeSettingsPayload(input)
  const updatedAt = saveStudioAgentModelSettingsRecord(normalized)

  return {
    ...normalized,
    updatedAt,
  }
}

export function listAgentModels(settings = getAgentModelSettings()) {
  const builtinIds = new Set(getBuiltInAgentModels().map((model) => model.id))
  const customModels = settings.customModels.filter(
    (model) => !builtinIds.has(model.id)
  )

  return [...getBuiltInAgentModels(), ...customModels]
}

export function listAgentModelsForRuntime(
  runtimeId: string,
  settings = getAgentModelSettings()
) {
  return listAgentModels(settings).filter(
    (model) =>
      model.enabled &&
      model.supportedRuntimeIds.some((candidate) => candidate === runtimeId)
  )
}

export function getAgentModelById(
  modelId: string,
  settings = getAgentModelSettings()
) {
  return listAgentModels(settings).find((model) => model.id === modelId) ?? null
}

export function getRuntimeModelSetting(
  runtimeId: string,
  settings = getAgentModelSettings()
) {
  return isRuntimeId(runtimeId) ? settings.runtimes[runtimeId] : null
}

export function resolveAgentModelForRuntime({
  modelId,
  runtimeId,
  settings = getAgentModelSettings(),
}: {
  modelId?: string | null
  runtimeId: string
  settings?: AgentModelSettings
}) {
  const runtimeSetting = getRuntimeModelSetting(runtimeId, settings)

  if (!runtimeSetting) {
    return null
  }

  const models = listAgentModelsForRuntime(runtimeId, settings)
  const requestedModelId = modelId?.trim()

  return (
    models.find((model) => model.id === requestedModelId) ??
    models.find((model) => model.id === runtimeSetting.defaultModel) ??
    models[0] ??
    null
  )
}

export function upsertCustomAgentModel(input: CustomAgentModelInput) {
  const settings = getAgentModelSettings()
  const normalized = normalizeCustomModel({
    ...input,
    builtin: false,
    enabled: input.enabled ?? true,
  })

  if (!normalized) {
    throw new Error("Model id and provider model are required.")
  }

  if (getBuiltInAgentModels().some((model) => model.id === normalized.id)) {
    throw new Error("Built-in models cannot be overwritten.")
  }

  const nextCustomModels = [
    normalized,
    ...settings.customModels.filter((model) => model.id !== normalized.id),
  ]

  return saveAgentModelSettings({
    runtimes: settings.runtimes,
    customModels: nextCustomModels,
  })
}

export function deleteCustomAgentModel(modelId: string) {
  const settings = getAgentModelSettings()
  const nextCustomModels = settings.customModels.filter(
    (model) => model.id !== modelId
  )

  if (nextCustomModels.length === settings.customModels.length) {
    return null
  }

  return saveAgentModelSettings({
    runtimes: settings.runtimes,
    customModels: nextCustomModels,
  })
}
