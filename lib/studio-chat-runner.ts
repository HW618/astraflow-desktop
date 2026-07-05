import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages"
import { statSync } from "node:fs"

import "@/lib/agent/adapters/astraflow-runtime"
import "@/lib/agent/adapters/acp-runtimes"
import {
  cancelAgentRun,
  getAgentRun,
  getAgentRunLiveSnapshot,
  startAgentRun,
  subscribeAgentRun,
  type StudioChatRunListener,
} from "@/lib/agent/run-orchestrator"
import {
  DEFAULT_AGENT_RUNTIME_ID,
  getAgentRuntime,
  type AgentRunEnvironment,
} from "@/lib/agent/runtime"
import {
  getRuntimeModelSetting,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import {
  type ChatReasoningEffort,
  type SupportedChatModel,
} from "@/lib/chat-models"
import { describeAttachmentForPrompt } from "@/lib/astraflow-session-sandbox"
import {
  getStudioLocalProject,
  getStudioSession,
  listStudioMessages,
} from "@/lib/studio-db"

function toLangChainMessages(
  sessionId: string,
  retryMessageId?: string
): BaseMessage[] {
  const history = listStudioMessages(sessionId)
  const retryMessageIndex = retryMessageId
    ? history.findIndex((message) => message.id === retryMessageId)
    : -1
  const effectiveHistory =
    retryMessageIndex >= 0 ? history.slice(0, retryMessageIndex) : history

  return effectiveHistory.map((message) => {
    if (message.role === "user" && message.attachments.length > 0) {
      const parts: MessageContent = []

      if (message.content) {
        parts.push({ type: "text", text: message.content })
      }

      for (const attachment of message.attachments) {
        if (attachment.type === "image" && attachment.dataUrl) {
          parts.push({
            type: "image_url",
            image_url: { url: attachment.dataUrl },
          })
        }

        parts.push({
          type: "text",
          text: describeAttachmentForPrompt(attachment),
        })
      }

      return new HumanMessage({ content: parts })
    }

    if (message.role === "user") {
      return new HumanMessage(message.content)
    }

    return new AIMessage(message.content)
  })
}

export function getStudioChatRun(sessionId: string) {
  return getAgentRun(sessionId)
}

export function cancelStudioChatRun(sessionId: string) {
  return cancelAgentRun(sessionId)
}

export function getStudioChatRunLiveSnapshot(sessionId: string) {
  return getAgentRunLiveSnapshot(sessionId)
}

export function subscribeStudioChatRun(
  sessionId: string,
  listener: StudioChatRunListener
) {
  return subscribeAgentRun(sessionId, listener)
}

function resolveSessionProjectPath(sessionId: string) {
  const session = getStudioSession(sessionId)

  if (!session?.projectId) {
    return null
  }

  const project = getStudioLocalProject(session.projectId)

  if (!project) {
    return null
  }

  try {
    const stats = statSync(/* turbopackIgnore: true */ project.path)

    if (stats.isDirectory()) {
      return project.path
    }
  } catch (error) {
    console.warn("[studio-chat] project_path_unavailable", {
      sessionId,
      projectId: session.projectId,
      path: project.path,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return null
}

export function startStudioChatRun({
  environment,
  model,
  reasoningEffort,
  retryMessageId,
  runtimeId = DEFAULT_AGENT_RUNTIME_ID,
  sessionId,
}: {
  environment?: AgentRunEnvironment
  model: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
  retryMessageId?: string
  runtimeId?: string
  sessionId: string
}) {
  const runtime = getAgentRuntime(runtimeId)

  if (!runtime) {
    throw new Error(`Agent runtime not found: ${runtimeId}`)
  }

  const runtimeSetting = getRuntimeModelSetting(runtime.info.id)
  const resolvedModel =
    runtimeSetting?.useLocalSettings === false
      ? resolveAgentModelForRuntime({
          modelId: model,
          runtimeId: runtime.info.id,
        })
      : null
  const effectiveModel = resolvedModel?.id ?? model

  if (runtimeSetting?.useLocalSettings === false && !resolvedModel) {
    throw new Error(`No Modelverse model is configured for ${runtime.info.label}.`)
  }

  return startAgentRun({
    createMessages: () => toLangChainMessages(sessionId, retryMessageId),
    environment,
    model: effectiveModel,
    projectPath: resolveSessionProjectPath(sessionId),
    reasoningEffort,
    retryMessageId,
    runtime,
    sessionId,
  })
}
