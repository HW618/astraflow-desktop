import type { BaseMessage } from "@langchain/core/messages"

import type { AgentRuntimeId } from "@/lib/agent-model-settings-shared"
import type { ChatReasoningEffort, SupportedChatModel } from "@/lib/chat-models"
import type { AgentEvent } from "@/lib/agent/events"
import type { ComposerCapabilities } from "@/lib/agent/composer-types"

export type RuntimeCapabilities = {
  hitl: boolean
  resume: boolean
  subagents: boolean
  plan: boolean
  sandbox: boolean
  mcp: boolean
  skills: boolean
}

// Runtime ids that older clients may still send (persisted in localStorage).
const LEGACY_AGENT_RUNTIME_ALIASES: Record<string, AgentRuntimeId> = {
  langchain: "astraflow",
  deepagents: "astraflow",
}

export type AgentRuntimeInfo = {
  id: AgentRuntimeId
  label: string
  description: string
  capabilities: RuntimeCapabilities
  composer?: ComposerCapabilities
}

export type AgentRunEnvironment = "remote" | "local"

export type AgentRunInput = {
  sessionId: string
  messages: BaseMessage[]
  model: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
  projectPath?: string | null
  environment?: AgentRunEnvironment
  signal: AbortSignal
}

export interface AgentRuntime {
  readonly info: AgentRuntimeInfo
  getInfo?: () => AgentRuntimeInfo
  startRun(input: AgentRunInput): AsyncIterable<AgentEvent>
}

export const DEFAULT_AGENT_RUNTIME_ID: AgentRuntimeId = "astraflow"

declare global {
  var astraflowAgentRuntimeRegistry:
    Map<AgentRuntimeId, AgentRuntime> | undefined
}

function getAgentRuntimeRegistry() {
  if (!globalThis.astraflowAgentRuntimeRegistry) {
    globalThis.astraflowAgentRuntimeRegistry = new Map()
  }

  return globalThis.astraflowAgentRuntimeRegistry
}

export function registerAgentRuntime(runtime: AgentRuntime): void {
  const registry = getAgentRuntimeRegistry()

  registry.set(runtime.info.id, runtime)

  // The registry lives on globalThis and survives dev hot reloads; drop any
  // legacy-id entries superseded by the runtime being registered.
  for (const [legacyId, targetId] of Object.entries(
    LEGACY_AGENT_RUNTIME_ALIASES
  )) {
    if (targetId === runtime.info.id) {
      registry.delete(legacyId as AgentRuntimeId)
    }
  }
}

export function getAgentRuntime(id: string): AgentRuntime | null {
  const resolvedId = LEGACY_AGENT_RUNTIME_ALIASES[id] ?? (id as AgentRuntimeId)

  return getAgentRuntimeRegistry().get(resolvedId) ?? null
}

export function listAgentRuntimeInfos(): AgentRuntimeInfo[] {
  return Array.from(getAgentRuntimeRegistry().values()).map(
    (runtime) => runtime.getInfo?.() ?? runtime.info
  )
}
