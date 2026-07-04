import type { BaseMessage } from "@langchain/core/messages"

import type { ChatReasoningEffort, SupportedChatModel } from "@/lib/chat-models"
import type { AgentEvent } from "@/lib/agent/events"

export type RuntimeCapabilities = {
  hitl: boolean
  resume: boolean
  subagents: boolean
  plan: boolean
  sandbox: boolean
  mcp: boolean
  skills: boolean
}

export type AgentRuntimeId =
  "langchain" | "deepagents" | "claude-code" | "codex" | "opencode"

export type AgentRuntimeInfo = {
  id: AgentRuntimeId
  label: string
  description: string
  capabilities: RuntimeCapabilities
}

export type AgentRunInput = {
  sessionId: string
  messages: BaseMessage[]
  model: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
  signal: AbortSignal
}

export interface AgentRuntime {
  readonly info: AgentRuntimeInfo
  startRun(input: AgentRunInput): AsyncIterable<AgentEvent>
}

export const DEFAULT_AGENT_RUNTIME_ID: AgentRuntimeId = "langchain"

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
  getAgentRuntimeRegistry().set(runtime.info.id, runtime)
}

export function getAgentRuntime(id: string): AgentRuntime | null {
  return getAgentRuntimeRegistry().get(id as AgentRuntimeId) ?? null
}

export function listAgentRuntimeInfos(): AgentRuntimeInfo[] {
  return Array.from(getAgentRuntimeRegistry().values()).map(
    (runtime) => runtime.info
  )
}
