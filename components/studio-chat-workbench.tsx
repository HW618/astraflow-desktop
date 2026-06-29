"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiBrainLine,
  RiCheckLine,
  RiCloseLine,
  RiFileCopyLine,
  RiRefreshLine,
  RiSearchLine,
  RiStopFill,
  RiThumbDownLine,
  RiThumbUpLine,
} from "@remixicon/react"

import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ui/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/prompt-kit/reasoning"
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ChainOfThought,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from "@/components/ui/chain-of-thought"
import { TextShimmer } from "@/components/ui/text-shimmer"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL,
  getDefaultChatReasoningEffort,
  getChatReasoningEfforts,
  isChatReasoningEffort,
  isChatReasoningEffortSupported,
  resolveChatReasoningEffort,
  type ChatReasoningEffort,
  type SupportedChatModel,
} from "@/lib/chat-models"
import type {
  StudioAttachment,
  StudioMessageActivity,
  StudioMessage,
  StudioSession,
} from "@/lib/studio-types"
import { cn, createClientId } from "@/lib/utils"

type StudioChatWorkbenchProps = {
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

type PendingAttachment = StudioAttachment & { id: string }

const MAX_ATTACHMENTS = 6
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

type ApiResponse<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: unknown
    }

type ChatPhase = "idle" | "thinking" | "streaming"

type ActiveChatRun = {
  phase: Exclude<ChatPhase, "idle">
  content: string
  activities: StudioMessageActivity[]
  reasoningContent: string
  reasoningDurationMs: number | null
}

type ChatStreamEvent =
  | {
      type: "content" | "reasoning"
      delta: string
    }
  | {
      type: "tool_call"
      toolCallId: string
      toolName: string
      input: string
    }
  | {
      type: "tool_result"
      toolCallId: string
      toolName: string
      status: "complete" | "error"
      output?: string
      error?: string
    }

type ChatStreamSnapshot = {
  content: string
  activities: StudioMessageActivity[]
  reasoningContent: string
  reasoningDurationMs: number | null
}

const CHAT_MODEL_STORAGE_KEY = "astraflow:chat-model"
const CHAT_REASONING_EFFORT_STORAGE_KEY = "astraflow:chat-reasoning-effort"

const chatModelListeners = new Set<() => void>()
const chatReasoningEffortListeners = new Set<() => void>()

function getStoredChatModel(): SupportedChatModel {
  if (typeof window === "undefined") {
    return DEFAULT_CHAT_MODEL
  }

  const stored = window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY)

  if (stored && CHAT_MODEL_OPTIONS.some((option) => option.value === stored)) {
    return stored as SupportedChatModel
  }

  return DEFAULT_CHAT_MODEL
}

function setStoredChatModel(model: SupportedChatModel) {
  window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, model)
  chatModelListeners.forEach((listener) => listener())
}

function subscribeChatModel(listener: () => void) {
  chatModelListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    chatModelListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

// Read the persisted model through an external store so SSR and the first
// client render agree (DEFAULT), then sync to localStorage after hydration
// without a mismatch warning.
function useChatModel() {
  const model = React.useSyncExternalStore(
    subscribeChatModel,
    getStoredChatModel,
    () => DEFAULT_CHAT_MODEL
  )

  return [model, setStoredChatModel] as const
}

function getStoredChatReasoningEffort(
  model: SupportedChatModel
): ChatReasoningEffort {
  if (typeof window === "undefined") {
    return getDefaultChatReasoningEffort(model)
  }

  const stored = window.localStorage.getItem(
    CHAT_REASONING_EFFORT_STORAGE_KEY
  )

  if (
    stored &&
    isChatReasoningEffort(stored) &&
    isChatReasoningEffortSupported(model, stored)
  ) {
    return stored
  }

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<
        Record<SupportedChatModel, string>
      >
      const effort = parsed[model]

      if (
        effort &&
        isChatReasoningEffort(effort) &&
        isChatReasoningEffortSupported(model, effort)
      ) {
        return effort
      }
    } catch {
      // Ignore legacy or malformed storage and fall back to model defaults.
    }
  }

  return getDefaultChatReasoningEffort(model)
}

function getStoredChatReasoningEffortMap() {
  const stored = window.localStorage.getItem(
    CHAT_REASONING_EFFORT_STORAGE_KEY
  )

  if (!stored || isChatReasoningEffort(stored)) {
    return {}
  }

  try {
    return JSON.parse(stored) as Partial<
      Record<SupportedChatModel, ChatReasoningEffort>
    >
  } catch {
    return {}
  }
}

function setStoredChatReasoningEffort(
  model: SupportedChatModel,
  effort: ChatReasoningEffort
) {
  const nextEffort = resolveChatReasoningEffort(model, effort)
  const nextEfforts = {
    ...getStoredChatReasoningEffortMap(),
    [model]: nextEffort,
  }

  window.localStorage.setItem(
    CHAT_REASONING_EFFORT_STORAGE_KEY,
    JSON.stringify(nextEfforts)
  )
  chatReasoningEffortListeners.forEach((listener) => listener())
}

function subscribeChatReasoningEffort(listener: () => void) {
  chatReasoningEffortListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    chatReasoningEffortListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function useChatReasoningEffort(model: SupportedChatModel) {
  const getSnapshot = React.useCallback(
    () => getStoredChatReasoningEffort(model),
    [model]
  )
  const getServerSnapshot = React.useCallback(
    () => getDefaultChatReasoningEffort(model),
    [model]
  )
  const reasoningEffort = React.useSyncExternalStore(
    subscribeChatReasoningEffort,
    getSnapshot,
    getServerSnapshot
  )
  const setReasoningEffort = React.useCallback(
    (effort: ChatReasoningEffort) =>
      setStoredChatReasoningEffort(model, effort),
    [model]
  )

  return [reasoningEffort, setReasoningEffort] as const
}

function getChatModelLabel(model: SupportedChatModel) {
  return (
    CHAT_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model
  )
}

async function readJson<T>(response: Response) {
  const data = (await response.json()) as ApiResponse<T>

  if (!response.ok || !data.ok) {
    throw new Error("Request failed")
  }

  return data.data
}

async function createSession(title: string) {
  const response = await fetch("/api/studio/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "chat",
      title,
    }),
  })

  return readJson<StudioSession>(response)
}

async function listMessages(sessionId: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}/messages`)

  return readJson<StudioMessage[]>(response)
}

async function createMessage(
  input: {
    sessionId: string
    role: StudioMessage["role"]
    content: string
    attachments?: StudioAttachment[]
    activities?: StudioMessageActivity[]
    reasoningContent?: string
    reasoningDurationMs?: number | null
    model?: string | null
    versionGroupId?: string | null
    replacesMessageId?: string | null
  }
) {
  const response = await fetch(
    `/api/studio/sessions/${input.sessionId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: input.role,
        content: input.content,
        model: input.model ?? null,
        versionGroupId: input.versionGroupId ?? null,
        replacesMessageId: input.replacesMessageId ?? null,
        activities: input.activities ?? [],
        reasoningContent: input.reasoningContent ?? "",
        reasoningDurationMs: input.reasoningDurationMs ?? null,
        status: "complete",
        attachments: input.attachments ?? [],
      }),
    }
  )

  return readJson<StudioMessage>(response)
}

async function listMessageVersions(sessionId: string, versionGroupId: string) {
  const response = await fetch(
    `/api/studio/sessions/${sessionId}/messages?versionGroupId=${encodeURIComponent(
      versionGroupId
    )}`
  )

  return readJson<StudioMessage[]>(response)
}

async function generateSessionTitle(sessionId: string, prompt: string) {
  await fetch(`/api/studio/sessions/${sessionId}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })
}

async function streamAssistantResponse({
  sessionId,
  model,
  reasoningEffort,
  retryMessageId,
  signal,
  onFirstChunk,
  onChunk,
}: {
  sessionId: string
  model: SupportedChatModel
  reasoningEffort: ChatReasoningEffort
  retryMessageId?: string
  signal: AbortSignal
  onFirstChunk?: () => void
  onChunk: (snapshot: ChatStreamSnapshot) => void
}): Promise<ChatStreamSnapshot> {
  const response = await fetch("/api/studio/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      model,
      reasoningEffort,
      retryMessageId,
    }),
    signal,
  })

  if (!response.ok) {
    let message = "Request failed"

    try {
      const payload = (await response.json()) as {
        error?: string
        message?: string
      }
      message = payload.error || payload.message || message
    } catch {
      // Ignore JSON parsing failures and fall back to the generic message.
    }

    throw new Error(message)
  }

  if (!response.body) {
    throw new Error("Response body is missing.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let content = ""
  let activities: StudioMessageActivity[] = []
  let reasoningContent = ""
  let reasoningDurationMs: number | null = null
  let buffer = ""
  let receivedFirstChunk = false
  const reasoningStartedAt = performance.now()

  function markReasoningDone() {
    if (reasoningContent && reasoningDurationMs === null) {
      reasoningDurationMs = Math.max(
        1000,
        Math.round(performance.now() - reasoningStartedAt)
      )
    }
  }

  function handleEvent(event: ChatStreamEvent) {
    if (!receivedFirstChunk) {
      receivedFirstChunk = true
      onFirstChunk?.()
    }

    if (event.type === "reasoning") {
      reasoningContent += event.delta
    } else if (event.type === "content") {
      markReasoningDone()
      content += event.delta
    } else if (event.type === "tool_call") {
      markReasoningDone()
      activities = [
        ...activities.filter((activity) => activity.id !== event.toolCallId),
        {
          id: event.toolCallId,
          toolName: event.toolName,
          status: "running",
          input: event.input,
          output: "",
          error: null,
        },
      ]
    } else if (event.type === "tool_result") {
      markReasoningDone()
      activities = activities.map((activity) =>
        activity.id === event.toolCallId
          ? {
              ...activity,
              status: event.status,
              output: event.output ?? "",
              error: event.error ?? null,
            }
          : activity
      )
    }

    onChunk({ content, activities, reasoningContent, reasoningDurationMs })
  }

  function parseLine(line: string) {
    if (!line.trim()) {
      return
    }

    const event = JSON.parse(line) as Partial<ChatStreamEvent>

    if (
      (event.type === "content" || event.type === "reasoning") &&
      typeof event.delta === "string"
    ) {
      handleEvent({
        type: event.type,
        delta: event.delta,
      })
      return
    }

    if (
      event.type === "tool_call" &&
      typeof event.toolCallId === "string" &&
      typeof event.toolName === "string" &&
      typeof event.input === "string"
    ) {
      handleEvent({
        type: "tool_call",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
      })
      return
    }

    if (
      event.type === "tool_result" &&
      typeof event.toolCallId === "string" &&
      typeof event.toolName === "string" &&
      (event.status === "complete" || event.status === "error")
    ) {
      handleEvent({
        type: "tool_result",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: event.status,
        output: typeof event.output === "string" ? event.output : undefined,
        error: typeof event.error === "string" ? event.error : undefined,
      })
    }
  }

  while (true) {
    const { value, done } = await reader.read()

    if (done) {
      break
    }

    const chunk = decoder.decode(value, { stream: true })

    if (!chunk) {
      continue
    }

    buffer += chunk

    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      parseLine(line)
    }
  }

  buffer += decoder.decode()

  if (buffer) {
    parseLine(buffer)
  }

  markReasoningDone()

  return { content, activities, reasoningContent, reasoningDurationMs }
}

function StudioChatWorkbench({
  sessionId,
  onSessionChange,
  onSessionsChange,
}: StudioChatWorkbenchProps) {
  const { t } = useI18n()
  const [input, setInput] = React.useState("")
  const [selectedModel, setSelectedModel] = useChatModel()
  const [selectedReasoningEffort, setSelectedReasoningEffort] =
    useChatReasoningEffort(selectedModel)
  const [messages, setMessages] = React.useState<StudioMessage[]>([])
  const [pendingAttachments, setPendingAttachments] = React.useState<
    PendingAttachment[]
  >([])
  const [activeRuns, setActiveRuns] = React.useState<
    Record<string, ActiveChatRun>
  >({})
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [chatErrors, setChatErrors] = React.useState<Record<string, boolean>>(
    {}
  )
  const abortControllersRef = React.useRef(new Map<string, AbortController>())
  const sessionIdRef = React.useRef(sessionId)

  const activeRun = sessionId ? activeRuns[sessionId] : undefined
  const isBusy = Boolean(activeRun)
  const visibleMessages = sessionId ? messages : []
  const hasMessages = visibleMessages.length > 0 || isBusy
  const canSubmit =
    (input.trim().length > 0 || pendingAttachments.length > 0) && !isBusy
  const error =
    sessionId && chatErrors[sessionId]
      ? "chat-failed"
      : sessionId && loadFailed
        ? "load-failed"
        : ""

  const addFiles = React.useCallback((files: FileList | null) => {
    if (!files || files.length === 0) {
      return
    }

    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    )

    void Promise.all(
      imageFiles
        .filter((file) => file.size <= MAX_ATTACHMENT_BYTES)
        .map(async (file) => ({
          id: createClientId(),
          type: "image" as const,
          name: file.name,
          mimeType: file.type,
          dataUrl: await readFileAsDataUrl(file),
        }))
    ).then((next) => {
      if (next.length === 0) {
        return
      }

      setPendingAttachments((current) =>
        [...current, ...next].slice(0, MAX_ATTACHMENTS)
      )
    })
  }, [])

  const removeAttachment = React.useCallback((id: string) => {
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    )
  }, [])

  React.useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  React.useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => (sessionId ? listMessages(sessionId) : []))
      .then((nextMessages) => {
        if (!cancelled) {
          setMessages(nextMessages)
          setLoadFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  React.useEffect(() => {
    const abortControllers = abortControllersRef.current

    return () => {
      abortControllers.forEach((controller) => controller.abort())
      abortControllers.clear()
    }
  }, [])

  const startAssistantRun = React.useCallback(
    (
      activeSessionId: string,
      model: SupportedChatModel,
      reasoningEffort: ChatReasoningEffort,
      options: {
        retryMessageId?: string
        versionGroupId?: string | null
        replacesMessageId?: string | null
      } = {}
    ) => {
      const abortController = new AbortController()
      abortControllersRef.current.set(activeSessionId, abortController)
      setChatErrors((current) => {
        if (!current[activeSessionId]) return current

        const next = { ...current }
        delete next[activeSessionId]
        return next
      })
      setActiveRuns((current) => ({
        ...current,
        [activeSessionId]: {
          phase: "thinking",
          content: "",
          activities: [],
          reasoningContent: "",
          reasoningDurationMs: null,
        },
      }))

      void streamAssistantResponse({
        sessionId: activeSessionId,
        model,
        reasoningEffort,
        retryMessageId: options.retryMessageId,
        signal: abortController.signal,
        onFirstChunk() {
          setActiveRuns((current) => {
            const run = current[activeSessionId]
            if (!run) return current

            return {
              ...current,
              [activeSessionId]: { ...run, phase: "streaming" },
            }
          })
        },
        onChunk(snapshot) {
          setActiveRuns((current) => {
            const run = current[activeSessionId]
            if (!run) return current

            return {
              ...current,
              [activeSessionId]: {
                phase: "streaming",
                content: snapshot.content,
                activities: snapshot.activities,
                reasoningContent: snapshot.reasoningContent,
                reasoningDurationMs: snapshot.reasoningDurationMs,
              },
            }
          })
        },
      })
        .then(async (assistantMessage) => {
          abortControllersRef.current.delete(activeSessionId)

          if (
            assistantMessage.content.trim() ||
            assistantMessage.reasoningContent.trim()
          ) {
            const savedMessage = await createMessage(
              {
                sessionId: activeSessionId,
                role: "assistant",
                content: assistantMessage.content,
                model,
                activities: assistantMessage.activities,
                reasoningContent: assistantMessage.reasoningContent,
                reasoningDurationMs: assistantMessage.reasoningDurationMs,
                versionGroupId: options.versionGroupId,
                replacesMessageId: options.replacesMessageId,
              }
            )

            if (sessionIdRef.current === activeSessionId) {
              setMessages((current) =>
                options.replacesMessageId
                  ? current.map((message) =>
                      message.id === options.replacesMessageId
                        ? savedMessage
                        : message
                    )
                  : [...current, savedMessage]
              )
            }

            onSessionsChange()
          }

          setActiveRuns((current) => {
            const next = { ...current }
            delete next[activeSessionId]
            return next
          })
        })
        .catch((nextError) => {
          abortControllersRef.current.delete(activeSessionId)
          setActiveRuns((current) => {
            const next = { ...current }
            delete next[activeSessionId]
            return next
          })

          if (
            nextError instanceof DOMException &&
            nextError.name === "AbortError"
          ) {
            return
          }

          setChatErrors((current) => ({
            ...current,
            [activeSessionId]: true,
          }))
        })
    },
    [onSessionsChange]
  )

  const stopAssistantRun = React.useCallback((activeSessionId: string) => {
    const controller = abortControllersRef.current.get(activeSessionId)
    controller?.abort()
    abortControllersRef.current.delete(activeSessionId)
    setActiveRuns((current) => {
      const next = { ...current }
      delete next[activeSessionId]
      return next
    })
  }, [])

  const appendMessageIfActive = React.useCallback(
    (activeSessionId: string, message: StudioMessage) => {
      if (sessionIdRef.current !== activeSessionId) {
        return
      }
      setMessages((current) => [...current, message])
    },
    []
  )

  const handleRetryMessage = React.useCallback(
    (message: StudioMessage) => {
      if (!sessionId || isBusy || message.role !== "assistant") {
        return
      }

      startAssistantRun(
        sessionId,
        selectedModel,
        selectedReasoningEffort,
        {
          retryMessageId: message.id,
          versionGroupId: message.versionGroupId ?? message.id,
          replacesMessageId: message.id,
        }
      )
    },
    [
      isBusy,
      selectedModel,
      selectedReasoningEffort,
      sessionId,
      startAssistantRun,
    ]
  )

  async function handleSubmit() {
    const prompt = input.trim()
    const attachments = pendingAttachments

    if ((!prompt && attachments.length === 0) || isBusy) {
      return
    }

    setInput("")
    setPendingAttachments([])

    const isNewSession = !sessionId

    try {
      const activeSession =
        sessionId.length > 0
          ? { id: sessionId }
          : await createSession(prompt || attachments[0]?.name || "New chat")
      const activeSessionId = activeSession.id

      const userMessage = await createMessage({
        sessionId: activeSessionId,
        role: "user",
        content: prompt,
        attachments: attachments.map((attachment) => ({
          type: attachment.type,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
        })),
      })

      if (!sessionId) {
        setMessages([userMessage])
        onSessionChange(activeSessionId)
      } else {
        appendMessageIfActive(activeSessionId, userMessage)
      }

      onSessionsChange()

      if (isNewSession && prompt) {
        void generateSessionTitle(activeSessionId, prompt)
          .then(() => onSessionsChange())
          .catch(() => {
            // Keep the prompt-based fallback title on failure.
          })
      }

      startAssistantRun(
        activeSessionId,
        selectedModel,
        selectedReasoningEffort
      )
    } catch {
      if (sessionId) {
        setChatErrors((current) => ({ ...current, [sessionId]: true }))
      } else {
        setLoadFailed(true)
      }
    }
  }

  function handleStop() {
    if (sessionId) {
      stopAssistantRun(sessionId)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1">
        {hasMessages ? (
          <ChatContainerRoot className="h-full min-h-0">
            <ChatContainerContent className="mx-auto flex min-h-full w-full max-w-5xl gap-6 px-8 py-10">
              {visibleMessages.map((message) => (
                <ChatMessageBubble
                  key={message.id}
                  message={message}
                  onRetry={handleRetryMessage}
                />
              ))}

              {activeRun?.phase === "thinking" ? (
                <div className="flex w-full justify-start">
                  <TextShimmer className="text-sm" duration={2}>
                    {t.studioThinking}
                  </TextShimmer>
                </div>
              ) : null}

              {activeRun?.phase === "streaming" &&
              (activeRun.content ||
                activeRun.reasoningContent ||
                activeRun.activities.length > 0) ? (
                <StreamingAssistantMessage
                  content={activeRun.content}
                  activities={activeRun.activities}
                  reasoningContent={activeRun.reasoningContent}
                  reasoningDurationMs={activeRun.reasoningDurationMs}
                />
              ) : null}

              {error ? (
                <p className="text-sm text-muted-foreground">
                  {error === "chat-failed"
                    ? t.studioChatFailed
                    : t.studioLoadFailed}
                </p>
              ) : null}

              <ChatContainerScrollAnchor />
            </ChatContainerContent>
          </ChatContainerRoot>
        ) : (
          <div className="flex h-full items-center justify-center px-8 pb-24">
            <div className="flex w-full max-w-3xl flex-col items-center gap-6">
              <h1 className="font-heading text-2xl font-semibold">
                {t.studioChatGreeting}
              </h1>
              <ChatComposer
                value={input}
                model={selectedModel}
                reasoningEffort={selectedReasoningEffort}
                attachments={pendingAttachments}
                onModelChange={setSelectedModel}
                onReasoningEffortChange={setSelectedReasoningEffort}
                onValueChange={setInput}
                onAddFiles={addFiles}
                onRemoveAttachment={removeAttachment}
                onSubmit={handleSubmit}
                onStop={handleStop}
                canSubmit={canSubmit}
                isBusy={isBusy}
              />
            </div>
          </div>
        )}
      </div>

      {hasMessages ? (
        <div className="shrink-0 px-8 pb-5">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
            <ChatComposer
              value={input}
              model={selectedModel}
              reasoningEffort={selectedReasoningEffort}
              attachments={pendingAttachments}
              onModelChange={setSelectedModel}
              onReasoningEffortChange={setSelectedReasoningEffort}
              onValueChange={setInput}
              onAddFiles={addFiles}
              onRemoveAttachment={removeAttachment}
              onSubmit={handleSubmit}
              onStop={handleStop}
              canSubmit={canSubmit}
              isBusy={isBusy}
            />
            <p className="text-center text-xs text-muted-foreground">
              {t.studioDisclaimer}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}

type ChatComposerProps = {
  value: string
  model: SupportedChatModel
  reasoningEffort: ChatReasoningEffort
  attachments: PendingAttachment[]
  onModelChange: (model: SupportedChatModel) => void
  onReasoningEffortChange: (effort: ChatReasoningEffort) => void
  onValueChange: (value: string) => void
  onAddFiles: (files: FileList | null) => void
  onRemoveAttachment: (id: string) => void
  onSubmit: () => void
  onStop: () => void
  canSubmit: boolean
  isBusy: boolean
}

function ChatComposer({
  value,
  model,
  reasoningEffort,
  attachments,
  onModelChange,
  onReasoningEffortChange,
  onValueChange,
  onAddFiles,
  onRemoveAttachment,
  onSubmit,
  onStop,
  canSubmit,
  isBusy,
}: ChatComposerProps) {
  const { t } = useI18n()
  const [isTextareaFocused, setIsTextareaFocused] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const showCustomCaret = isTextareaFocused && value.length === 0
  const reasoningLabelByValue: Record<ChatReasoningEffort, string> = {
    none: t.studioReasoningNone,
    minimal: t.studioReasoningMinimal,
    low: t.studioReasoningLow,
    medium: t.studioReasoningMedium,
    high: t.studioReasoningHigh,
    xhigh: t.studioReasoningXHigh,
    max: t.studioReasoningMax,
    enabled: t.studioReasoningEnabled,
  }
  const resolvedReasoningEffort = resolveChatReasoningEffort(
    model,
    reasoningEffort
  )
  const reasoningOptions = getChatReasoningEfforts(model).map((effort) => ({
    value: effort,
    label: reasoningLabelByValue[effort],
  }))
  const reasoningEffortLabel =
    reasoningOptions.find((option) => option.value === resolvedReasoningEffort)
      ?.label ?? reasoningLabelByValue[resolvedReasoningEffort]

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = event.clipboardData?.files

    if (
      files &&
      files.length > 0 &&
      Array.from(files).some((file) => file.type.startsWith("image/"))
    ) {
      // Pasted an image/file (e.g. a screenshot) — attach it instead of
      // letting the textarea insert a placeholder. Plain text still pastes
      // normally because clipboardData.files is empty for text.
      event.preventDefault()
      onAddFiles(files)
    }
  }

  return (
    <PromptInput
      value={value}
      onValueChange={onValueChange}
      onSubmit={onSubmit}
      isLoading={isBusy}
      className="w-full rounded-4xl border bg-background/95 px-3.5 py-3 shadow-lg shadow-foreground/5"
    >
      {attachments.length > 0 ? (
        <div
          className="mb-2 flex flex-wrap gap-2 px-1"
          onClick={(event) => event.stopPropagation()}
        >
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group relative size-16 overflow-hidden rounded-2xl border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.dataUrl}
                alt={attachment.name}
                className="size-full object-cover"
              />
              <button
                type="button"
                aria-label={t.studioRemoveAttachment}
                className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition group-hover:opacity-100 [&_svg]:size-3.5"
                onClick={(event) => {
                  event.stopPropagation()
                  onRemoveAttachment(attachment.id)
                }}
              >
                <RiCloseLine aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="relative min-w-0 px-1">
        {showCustomCaret ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-2 left-1 z-10 h-5 w-px animate-[studio-caret-blink_1.05s_steps(1,end)_infinite] rounded-full bg-foreground"
          />
        ) : null}

        <PromptInputTextarea
          placeholder={t.studioPromptPlaceholder}
          onFocus={() => setIsTextareaFocused(true)}
          onBlur={() => setIsTextareaFocused(false)}
          onPaste={handlePaste}
          className={cn(
            "max-h-40 min-h-9 w-full px-0 py-1.5 text-base text-foreground placeholder:text-muted-foreground md:text-base",
            showCustomCaret && "caret-transparent"
          )}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex shrink-0 items-center gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              onAddFiles(event.target.files)
              event.target.value = ""
            }}
          />
          <PromptInputAction tooltip={t.studioAttach}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isBusy}
              className="size-8 rounded-full p-0 [&_svg]:size-5"
              onClick={() => fileInputRef.current?.click()}
            >
              <RiAddLine aria-hidden />
            </Button>
          </PromptInputAction>
        </div>

        <PromptInputActions
          className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          <Select
            value={model}
            onValueChange={(nextValue) =>
              onModelChange(nextValue as SupportedChatModel)
            }
            disabled={isBusy}
          >
            <SelectTrigger
              size="sm"
              className="h-8 max-w-40 rounded-full bg-background px-3 text-sm sm:max-w-48"
              aria-label={t.studioChatModel}
            >
              <span className="truncate">{getChatModelLabel(model)}</span>
            </SelectTrigger>
            <SelectContent position="popper" side="top" align="end">
              <SelectGroup>
                {CHAT_MODEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            value={resolvedReasoningEffort}
            onValueChange={(nextValue) =>
              onReasoningEffortChange(nextValue as ChatReasoningEffort)
            }
            disabled={isBusy}
          >
            <SelectTrigger
              size="sm"
              className="h-8 rounded-full bg-background px-3 text-sm"
              aria-label={t.studioReasoningEffort}
            >
              <RiBrainLine aria-hidden className="size-4" />
              <span>{reasoningEffortLabel}</span>
            </SelectTrigger>
            <SelectContent position="popper" side="top" align="end">
              <SelectGroup>
                {reasoningOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="icon-sm"
            className="size-8 rounded-full bg-foreground p-0 text-background hover:bg-foreground/85 [&_svg]:size-4"
            disabled={!canSubmit && !isBusy}
            aria-label={isBusy ? t.studioStop : t.studioSend}
            onClick={(event) => {
              event.stopPropagation()
              if (isBusy) {
                onStop()
              } else {
                onSubmit()
              }
            }}
          >
            {isBusy ? (
              <RiStopFill aria-hidden />
            ) : (
              <RiArrowUpLine aria-hidden />
            )}
          </Button>
        </PromptInputActions>
      </div>
    </PromptInput>
  )
}

function ChatMessageBubble({
  message,
  onRetry,
}: {
  message: StudioMessage
  onRetry: (message: StudioMessage) => void
}) {
  if (message.role === "user") {
    return (
      <Message className="justify-end">
        <div className="flex max-w-[70%] flex-col items-end gap-2">
          {message.attachments.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2">
              {message.attachments.map((attachment, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${message.id}-${index}`}
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  className="max-h-60 max-w-full rounded-2xl border object-contain"
                />
              ))}
            </div>
          ) : null}
          {message.content ? (
            <MessageContent className="rounded-full bg-foreground px-5 py-3 text-base text-background">
              {message.content}
            </MessageContent>
          ) : null}
        </div>
      </Message>
    )
  }

  return (
    <AssistantMessage
      message={message}
      onRetry={onRetry}
    />
  )
}

const markdownClassName =
  "prose-sm max-w-none leading-7 text-foreground dark:prose-invert prose-headings:font-heading prose-headings:text-foreground prose-h1:text-xl prose-h2:mt-4 prose-h2:text-lg prose-h3:mt-3 prose-h3:text-base prose-p:my-2 prose-a:text-primary prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-pre:my-3 prose-table:my-3 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2"

const reasoningMarkdownClassName =
  "max-w-none leading-6 prose-p:my-2 prose-headings:my-2 prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-pre:my-3"

const streamingPulseDotClassName =
  "[&>*:last-child]:after:ml-1.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:size-2.5 [&>*:last-child]:after:translate-y-[1px] [&>*:last-child]:after:rounded-full [&>*:last-child]:after:bg-foreground [&>*:last-child]:after:align-middle [&>*:last-child]:after:content-[''] [&>*:last-child]:after:animate-[studio-pulse-dot_1.1s_ease-in-out_infinite]"

function formatReasoningDuration(locale: "en" | "zh", durationMs: number) {
  const seconds = Math.max(1, Math.round(durationMs / 1000))

  if (locale === "zh") {
    return `思考了 ${seconds} 秒`
  }

  if (seconds <= 3) {
    return "Thought for a few seconds"
  }

  return `Thought for ${seconds} seconds`
}

function AssistantReasoning({
  content,
  isStreaming = false,
  durationMs,
}: {
  content: string
  isStreaming?: boolean
  durationMs?: number | null
}) {
  const { locale } = useI18n()

  if (!content.trim()) {
    return null
  }

  const label =
    durationMs === null || durationMs === undefined
      ? "Reasoning"
      : formatReasoningDuration(locale, durationMs)

  return (
    <Reasoning isStreaming={isStreaming} className="flex flex-col gap-1">
      <ReasoningTrigger className="w-fit">
        {isStreaming ? (
          <TextShimmer duration={2}>Reasoning</TextShimmer>
        ) : (
          label
        )}
      </ReasoningTrigger>
      <ReasoningContent
        markdown
        className="ml-2 border-l-2 border-l-border px-3 pb-1"
        contentClassName={reasoningMarkdownClassName}
      >
        {content}
      </ReasoningContent>
    </Reasoning>
  )
}

function StreamingAssistantMessage({
  content,
  activities,
  reasoningContent,
  reasoningDurationMs,
}: {
  content: string
  activities: StudioMessageActivity[]
  reasoningContent: string
  reasoningDurationMs: number | null
}) {
  return (
    <Message className="justify-start">
      <div className="flex w-full flex-col gap-2">
        <AssistantReasoning
          content={reasoningContent}
          durationMs={reasoningDurationMs}
          isStreaming={reasoningDurationMs === null}
        />
        <AssistantActivities activities={activities} />
        {content.trim() ? (
          <MessageContent
            markdown
            className={cn(
              "bg-transparent p-0",
              markdownClassName,
              streamingPulseDotClassName
            )}
          >
            {content}
          </MessageContent>
        ) : null}
      </div>
    </Message>
  )
}

function getWebSearchQuery(input: string) {
  try {
    const parsed = JSON.parse(input) as { query?: unknown }

    if (typeof parsed.query === "string" && parsed.query.trim()) {
      return parsed.query.trim()
    }
  } catch {
    // Fall back to the raw input below.
  }

  return input.trim()
}

function AssistantActivities({
  activities,
}: {
  activities: StudioMessageActivity[]
}) {
  const { t } = useI18n()
  const visibleActivities = activities.filter(
    (activity) => activity.toolName === "web_search"
  )

  if (visibleActivities.length === 0) {
    return null
  }

  return (
    <ChainOfThought className="my-1">
      {visibleActivities.map((activity) => (
        <ChainOfThoughtStep
          key={`${activity.id}-${activity.status}`}
          disabled
        >
          <ChainOfThoughtTrigger
            className="cursor-default"
            leftIcon={
              activity.status === "complete" ? (
                <RiCheckLine aria-hidden />
              ) : (
                <RiSearchLine aria-hidden />
              )
            }
          >
            {activity.status === "running" ? (
              <TextShimmer duration={2}>
                {t.studioToolSearching(getWebSearchQuery(activity.input))}
              </TextShimmer>
            ) : activity.status === "error" ? (
              t.studioToolError
            ) : (
              t.studioToolAnalyzed(getWebSearchQuery(activity.input))
            )}
          </ChainOfThoughtTrigger>
        </ChainOfThoughtStep>
      ))}
    </ChainOfThought>
  )
}

function getStoredChatModelLabel(model: string | null) {
  if (!model) {
    return ""
  }

  return (
    CHAT_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model
  )
}

function MessageVersionsDialog({
  message,
  open,
  onOpenChange,
}: {
  message: StudioMessage
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const [versions, setVersions] = React.useState<StudioMessage[]>([message])
  const [activeIndex, setActiveIndex] = React.useState(0)

  React.useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    const versionGroupId = message.versionGroupId ?? message.id

    void listMessageVersions(message.sessionId, versionGroupId)
      .then((nextVersions) => {
        if (cancelled) {
          return
        }

        const effectiveVersions =
          nextVersions.length > 0 ? nextVersions : [message]
        const nextIndex = effectiveVersions.findIndex(
          (version) => version.id === message.id
        )

        setVersions(effectiveVersions)
        setActiveIndex(
          nextIndex >= 0 ? nextIndex : effectiveVersions.length - 1
        )
      })
      .catch(() => {
        if (!cancelled) {
          setVersions([message])
          setActiveIndex(0)
        }
      })

    return () => {
      cancelled = true
    }
  }, [message, open])

  const activeVersion = versions[activeIndex] ?? message
  const modelLabel = getStoredChatModelLabel(activeVersion.model)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader className="items-center">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              disabled={activeIndex <= 0}
              onClick={() =>
                setActiveIndex((current) => Math.max(0, current - 1))
              }
            >
              <RiArrowLeftSLine aria-hidden />
            </Button>
            <DialogTitle>
              {t.studioVersionTitle(activeVersion.versionIndex)}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              disabled={activeIndex >= versions.length - 1}
              onClick={() =>
                setActiveIndex((current) =>
                  Math.min(versions.length - 1, current + 1)
                )
              }
            >
              <RiArrowRightSLine aria-hidden />
            </Button>
          </div>
          {modelLabel ? (
            <p className="text-xs text-muted-foreground">
              {t.studioUsedModel(modelLabel)}
            </p>
          ) : null}
        </DialogHeader>

        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <AssistantReasoning
            content={activeVersion.reasoningContent}
            durationMs={activeVersion.reasoningDurationMs}
          />
          {activeVersion.content.trim() ? (
            <MessageContent
              markdown
              className={cn("bg-transparent p-0", markdownClassName)}
            >
              {activeVersion.content}
            </MessageContent>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AssistantMessage({
  message,
  onRetry,
}: {
  message: StudioMessage
  onRetry: (message: StudioMessage) => void
}) {
  const { t } = useI18n()
  const [liked, setLiked] = React.useState<boolean | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [versionsOpen, setVersionsOpen] = React.useState(false)
  const copyableContent = message.content || message.reasoningContent
  const modelLabel = getStoredChatModelLabel(message.model)

  function handleCopy() {
    void navigator.clipboard.writeText(copyableContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Message className="justify-start">
      <div className="flex w-full flex-col gap-2">
        <AssistantReasoning
          content={message.reasoningContent}
          durationMs={message.reasoningDurationMs}
        />
        <AssistantActivities activities={message.activities} />
        {message.content.trim() ? (
          <MessageContent
            markdown
            className={cn("bg-transparent p-0", markdownClassName)}
          >
            {message.content}
          </MessageContent>
        ) : null}
        <MessageActions className="gap-1.5">
          {message.versionCount > 1 ? (
            <MessageAction tooltip={t.studioViewVersions}>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 rounded-xl px-2"
                onClick={() => setVersionsOpen(true)}
              >
                <span className="text-sm font-medium">
                  {message.versionCount}
                </span>
                <RiRefreshLine className="size-4" aria-hidden />
              </Button>
            </MessageAction>
          ) : null}

          <MessageAction
            tooltip={
              <span className="flex flex-col items-center gap-0.5">
                <span>{t.studioRetry}</span>
                {modelLabel ? (
                  <span className="text-[11px] text-background/70">
                    {t.studioUsedModel(modelLabel)}
                  </span>
                ) : null}
              </span>
            }
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              onClick={() => onRetry(message)}
            >
              <RiRefreshLine aria-hidden />
            </Button>
          </MessageAction>

          <MessageAction tooltip={copied ? t.copied : t.studioCopy}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              onClick={handleCopy}
            >
              <RiFileCopyLine
                className={cn(copied && "text-emerald-500")}
                aria-hidden
              />
            </Button>
          </MessageAction>

          <MessageAction tooltip="Helpful">
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "rounded-full",
                liked === true && "bg-emerald-50 text-emerald-600"
              )}
              onClick={() => setLiked(true)}
            >
              <RiThumbUpLine aria-hidden />
            </Button>
          </MessageAction>

          <MessageAction tooltip="Not helpful">
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "rounded-full",
                liked === false && "bg-red-50 text-red-600"
              )}
              onClick={() => setLiked(false)}
            >
              <RiThumbDownLine aria-hidden />
            </Button>
          </MessageAction>
        </MessageActions>
        <MessageVersionsDialog
          message={message}
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
        />
      </div>
    </Message>
  )
}

export { StudioChatWorkbench }
