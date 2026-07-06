import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages"
import { statSync } from "node:fs"

import "@/lib/agent/adapters/astraflow-runtime"
import "@/lib/agent/adapters/acp-runtimes"
import "@/lib/agent/adapters/claude-native-runtime"
import "@/lib/agent/adapters/codex-direct-runtime"
import "@/lib/agent/adapters/opencode-native-runtime"
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
import type { PromptMention } from "@/lib/agent/composer-types"
import type { StudioMessage, StudioMessagePart } from "@/lib/studio-types"

const REFERENCED_SESSION_CONTEXT_LIMIT = 8_000
const REFERENCED_SESSION_TRUNCATION_NOTICE = "[earlier messages truncated]"
const ASSISTANT_STRUCTURED_CONTEXT_LIMIT = 6_000
const ASSISTANT_STRUCTURED_TEXT_LIMIT = 1_000

type AdapterPromptMention = Extract<PromptMention, { kind: "file" | "folder" }>

function getAdapterPromptMentions(message: StudioMessage) {
  return (message.mentions ?? []).filter(
    (mention): mention is AdapterPromptMention =>
      mention.kind === "file" || mention.kind === "folder"
  )
}

function getSessionPromptMentions(message: StudioMessage) {
  return (message.mentions ?? []).filter(
    (mention): mention is Extract<PromptMention, { kind: "session" }> =>
      mention.kind === "session" &&
      mention.sessionId.length > 0 &&
      mention.title.length > 0
  )
}

function messageMentionKwargs(message: StudioMessage) {
  const mentions = getAdapterPromptMentions(message)

  return mentions.length ? { additional_kwargs: { mentions } } : {}
}

function transcriptTextForMessage(message: StudioMessage) {
  if (message.role === "assistant") {
    const textParts = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.content.trim())
      .filter(Boolean)

    if (textParts.length > 0) {
      return textParts.join("\n").trim()
    }
  }

  return message.content.trim()
}

function transcriptLineForMessage(message: StudioMessage) {
  const text = transcriptTextForMessage(message)

  if (!text) {
    return null
  }

  return `${message.role === "assistant" ? "Assistant" : "User"}: ${text}`
}

function truncateTranscriptLine(line: string, maxLength: number) {
  if (line.length <= maxLength) {
    return line
  }

  if (maxLength <= 3) {
    return line.slice(0, maxLength)
  }

  return `${line.slice(0, maxLength - 3)}...`
}

function formatReferencedSessionTranscript({
  maxLength,
  messages,
  title,
}: {
  maxLength: number
  messages: StudioMessage[]
  title: string
}) {
  const header = `--- Referenced conversation: ${title} ---`
  const lines = messages
    .map(transcriptLineForMessage)
    .filter((line): line is string => Boolean(line))

  if (lines.length === 0 || maxLength < header.length) {
    return ""
  }

  const fullTranscript = [header, ...lines].join("\n")

  if (fullTranscript.length <= maxLength) {
    return fullTranscript
  }

  const prefix = [header, REFERENCED_SESSION_TRUNCATION_NOTICE]
  const keptLines: string[] = []
  let usedLength = prefix.join("\n").length

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const available = maxLength - usedLength - 1

    if (available <= 0) {
      break
    }

    const line = lines[index]

    if (line.length <= available) {
      keptLines.unshift(line)
      usedLength += line.length + 1
      continue
    }

    if (keptLines.length === 0) {
      const truncatedLine = truncateTranscriptLine(line, available)

      if (truncatedLine) {
        keptLines.unshift(truncatedLine)
      }
    }

    break
  }

  return [header, REFERENCED_SESSION_TRUNCATION_NOTICE, ...keptLines]
    .join("\n")
    .slice(0, maxLength)
}

function buildReferencedSessionContext({
  currentSessionId,
  latestUserMessage,
}: {
  currentSessionId: string
  latestUserMessage: StudioMessage | null
}) {
  if (!latestUserMessage) {
    return ""
  }

  const mentions = getSessionPromptMentions(latestUserMessage)
  const seenSessionIds = new Set<string>()
  const blocks: string[] = []
  let usedLength = 0

  for (const mention of mentions) {
    if (
      mention.sessionId === currentSessionId ||
      seenSessionIds.has(mention.sessionId)
    ) {
      continue
    }

    seenSessionIds.add(mention.sessionId)

    // Studio sessions are local to the authenticated desktop profile. API
    // routes gate access with requireAuthenticatedRequest plus getStudioSession;
    // this runner is entered after that gate, so existence here is the same
    // ownership/access check available in this context.
    const referencedSession = getStudioSession(mention.sessionId)

    if (!referencedSession || referencedSession.mode !== "chat") {
      continue
    }

    const messages = listStudioMessages(mention.sessionId)

    if (messages.length === 0) {
      continue
    }

    const separatorLength = blocks.length > 0 ? 2 : 0
    const remaining =
      REFERENCED_SESSION_CONTEXT_LIMIT - usedLength - separatorLength

    if (remaining <= 0) {
      break
    }

    const block = formatReferencedSessionTranscript({
      maxLength: remaining,
      messages,
      title: referencedSession.title || mention.title,
    })

    if (!block) {
      continue
    }

    blocks.push(block)
    usedLength += separatorLength + block.length
  }

  return blocks.join("\n\n")
}

function prependContextToMessageContent(
  content: string,
  context: string
): string
function prependContextToMessageContent(
  content: MessageContent,
  context: string
): MessageContent
function prependContextToMessageContent(
  content: string | MessageContent,
  context: string
) {
  if (!context) {
    return content
  }

  if (typeof content === "string") {
    return [context, content]
      .filter((part) => part.trim().length > 0)
      .join("\n\n")
  }

  return [{ type: "text", text: context }, ...content] satisfies MessageContent
}

function truncateAssistantContext(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim()

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 3)}...`
}

function formatStructuredPartForPrompt(part: StudioMessagePart) {
  if (part.type === "plan") {
    return {
      type: "plan",
      todos: part.todos.map((todo) => ({
        text: todo.text,
        status: todo.status,
        ...(todo.priority ? { priority: todo.priority } : {}),
      })),
    }
  }

  if (part.type === "subagent") {
    return {
      type: "subagent",
      taskId: part.taskId,
      name: part.name,
      status: part.status,
      taskInput: truncateAssistantContext(
        part.taskInput,
        ASSISTANT_STRUCTURED_TEXT_LIMIT
      ),
      ...(part.summary
        ? {
            summary: truncateAssistantContext(
              part.summary,
              ASSISTANT_STRUCTURED_TEXT_LIMIT
            ),
          }
        : {}),
      ...(part.error ? { error: part.error } : {}),
      ...(part.todos.length
        ? {
            todos: part.todos.map((todo) => ({
              text: todo.text,
              status: todo.status,
            })),
          }
        : {}),
    }
  }

  if (part.type === "file") {
    return {
      type: "file_change",
      path: part.path,
      kind: part.kind,
      status: part.status,
      ...(part.error ? { error: part.error } : {}),
    }
  }

  if (part.type === "media_generation") {
    return {
      type: "media_generation",
      kind: part.kind,
      generationId: part.generationId,
      status: part.status,
      modelName: part.modelName,
      prompt: truncateAssistantContext(
        part.prompt,
        ASSISTANT_STRUCTURED_TEXT_LIMIT
      ),
      ...(part.phase ? { phase: part.phase } : {}),
      ...(typeof part.progress === "number" ? { progress: part.progress } : {}),
      ...(part.errorMessage ? { errorMessage: part.errorMessage } : {}),
      outputs: part.outputs.map((output) => ({
        id: output.id,
        index: output.index,
        sessionFileId: output.sessionFileId ?? null,
        contentUrl: output.contentUrl,
        url: output.url,
        storagePath: output.storagePath,
        mimeType: output.mimeType,
        width: output.width,
        height: output.height,
        ...(output.durationSeconds !== undefined
          ? { durationSeconds: output.durationSeconds }
          : {}),
      })),
    }
  }

  return null
}

function formatAssistantStructuredContext(message: StudioMessage) {
  const structured = message.parts
    .map(formatStructuredPartForPrompt)
    .filter((part): part is NonNullable<typeof part> => Boolean(part))

  if (!structured.length) {
    return ""
  }

  const content = JSON.stringify(
    {
      note: "Structured assistant context from previous turn. Use ids/paths here when the user references prior outputs.",
      parts: structured,
    },
    null,
    2
  )

  return `<assistant_structured_context>\n${truncateAssistantContext(
    content,
    ASSISTANT_STRUCTURED_CONTEXT_LIMIT
  )}\n</assistant_structured_context>`
}

function assistantContentForPrompt(message: StudioMessage) {
  return [
    transcriptTextForMessage(message),
    formatAssistantStructuredContext(message),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n")
}

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
  const latestUserMessage =
    [...effectiveHistory]
      .reverse()
      .find((message) => message.role === "user") ?? null
  const referencedSessionContext = buildReferencedSessionContext({
    currentSessionId: sessionId,
    latestUserMessage,
  })

  return effectiveHistory.map((message) => {
    const shouldPrependReferencedSessionContext =
      Boolean(referencedSessionContext) && message.id === latestUserMessage?.id

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

      return new HumanMessage({
        content: shouldPrependReferencedSessionContext
          ? prependContextToMessageContent(parts, referencedSessionContext)
          : parts,
        ...messageMentionKwargs(message),
      })
    }

    if (message.role === "user") {
      return new HumanMessage({
        content: shouldPrependReferencedSessionContext
          ? prependContextToMessageContent(
              message.content,
              referencedSessionContext
            )
          : message.content,
        ...messageMentionKwargs(message),
      })
    }

    return new AIMessage(assistantContentForPrompt(message))
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
    throw new Error(
      `No Modelverse model is configured for ${runtime.info.label}.`
    )
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
