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
  RiCodeLine,
  RiFileCopyLine,
  RiFileTextLine,
  RiRefreshLine,
  RiSearchLine,
  RiStopFill,
  RiTerminalLine,
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
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from "@/components/ui/chain-of-thought"
import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "@/components/prompt-kit/code-block"
import { Shimmer } from "@/components/ai-elements/shimmer"
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
  StudioMessagePart,
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
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function formatAttachmentSize(bytes: number | null | undefined) {
  if (typeof bytes !== "number") {
    return ""
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  parts: StudioMessagePart[]
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
  parts: StudioMessagePart[]
  reasoningContent: string
  reasoningDurationMs: number | null
}

const CHAT_MODEL_STORAGE_KEY = "astraflow:chat-model"
const CHAT_REASONING_EFFORT_STORAGE_KEY = "astraflow:chat-reasoning-effort"

const chatModelListeners = new Set<() => void>()
const chatReasoningEffortListeners = new Set<() => void>()

function shouldDebugStudioChatClient() {
  if (typeof window === "undefined") {
    return false
  }

  return window.localStorage.getItem("astraflow:debug-chat") === "1"
}

function getActivityDebugSnapshot(activities: StudioMessageActivity[]) {
  return activities.map((activity) => ({
    id: activity.id,
    toolName: activity.toolName,
    status: activity.status,
    inputLength: activity.input.length,
    outputLength: activity.output.length,
    hasError: Boolean(activity.error),
  }))
}

function debugStudioChatClient(
  label: string,
  payload: Record<string, unknown>
) {
  if (!shouldDebugStudioChatClient()) {
    return
  }

  console.info(`[studio-chat:client-tool] ${label}`, payload)
}

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
    parts?: StudioMessagePart[]
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
        parts: input.parts ?? [],
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
  let parts: StudioMessagePart[] = []
  let reasoningContent = ""
  let reasoningDurationMs: number | null = null
  let buffer = ""
  let receivedFirstChunk = false
  let clientToolEventSeq = 0
  let activeReasoningPartId: string | null = null
  let activeReasoningStartedAt: number | null = null
  let totalReasoningDurationMs = 0

  function markReasoningDone() {
    if (!activeReasoningPartId || activeReasoningStartedAt === null) {
      return
    }

    const durationMs = Math.max(
      1000,
      Math.round(performance.now() - activeReasoningStartedAt)
    )
    totalReasoningDurationMs += durationMs
    reasoningDurationMs = totalReasoningDurationMs
    parts = parts.map((part) =>
      part.type === "reasoning" && part.id === activeReasoningPartId
        ? { ...part, durationMs }
        : part
    )
    activeReasoningPartId = null
    activeReasoningStartedAt = null
  }

  function appendReasoningPart(delta: string) {
    if (!delta) {
      return
    }

    reasoningContent += delta
    const lastPart = parts.at(-1)

    if (lastPart?.type === "reasoning" && lastPart.durationMs === null) {
      if (!activeReasoningPartId) {
        activeReasoningPartId = lastPart.id
      }

      if (activeReasoningStartedAt === null) {
        activeReasoningStartedAt = performance.now()
      }

      parts = [
        ...parts.slice(0, -1),
        {
          ...lastPart,
          content: lastPart.content + delta,
        },
      ]
      return
    }

    const partId = createClientId()
    activeReasoningPartId = partId
    activeReasoningStartedAt = performance.now()
    parts = [
      ...parts,
      {
        id: partId,
        type: "reasoning",
        content: delta,
        durationMs: null,
      },
    ]
  }

  function appendTextPart(delta: string) {
    if (!delta) {
      return
    }

    const lastPart = parts.at(-1)

    if (lastPart?.type === "text") {
      parts = [
        ...parts.slice(0, -1),
        {
          ...lastPart,
          content: lastPart.content + delta,
        },
      ]
      return
    }

    parts = [
      ...parts,
      {
        id: createClientId(),
        type: "text",
        content: delta,
      },
    ]
  }

  function upsertToolPart(activity: StudioMessageActivity) {
    const existingIndex = parts.findIndex(
      (part) => part.type === "tool" && part.activity.id === activity.id
    )

    if (existingIndex < 0) {
      parts = [
        ...parts,
        {
          id: activity.id,
          type: "tool",
          activity,
        },
      ]
      return
    }

    parts = parts.map((part, index) =>
      index === existingIndex && part.type === "tool"
        ? { ...part, activity }
        : part
    )
  }

  function handleEvent(event: ChatStreamEvent) {
    if (!receivedFirstChunk) {
      receivedFirstChunk = true
      onFirstChunk?.()
    }

    if (event.type === "reasoning") {
      appendReasoningPart(event.delta)
    } else if (event.type === "content") {
      markReasoningDone()
      content += event.delta
      appendTextPart(event.delta)
    } else if (event.type === "tool_call") {
      markReasoningDone()
      const existingById = activities.find(
        (activity) => activity.id === event.toolCallId
      )
      const latestSameTool = activities.findLast(
        (activity) => activity.toolName === event.toolName
      )

      debugStudioChatClient("tool_call_received", {
        seq: ++clientToolEventSeq,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        inputLength: event.input.length,
        existingById: existingById
          ? {
              status: existingById.status,
              outputLength: existingById.output.length,
            }
          : null,
        latestSameTool: latestSameTool
          ? {
              id: latestSameTool.id,
              status: latestSameTool.status,
              outputLength: latestSameTool.output.length,
            }
          : null,
        before: getActivityDebugSnapshot(activities),
      })

      const activity: StudioMessageActivity = existingById
        ? {
            ...existingById,
            input: existingById.input || event.input,
          }
        : {
            id: event.toolCallId,
            toolName: event.toolName,
            status: "running",
            input: event.input,
            output: "",
            error: null,
          }

      activities = existingById
        ? activities.map((candidate) =>
            candidate.id === event.toolCallId ? activity : candidate
          )
        : [
            ...activities.filter(
              (candidate) => candidate.id !== event.toolCallId
            ),
            activity,
          ]
      upsertToolPart(activity)
      debugStudioChatClient("tool_call_applied", {
        seq: clientToolEventSeq,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        after: getActivityDebugSnapshot(activities),
      })
    } else if (event.type === "tool_result") {
      markReasoningDone()
      let activityIndex = activities.findIndex(
        (activity) => activity.id === event.toolCallId
      )
      let matchStrategy = activityIndex >= 0 ? "id" : "none"

      if (activityIndex < 0) {
        for (let index = activities.length - 1; index >= 0; index--) {
          const activity = activities[index]

          if (
            activity.toolName === event.toolName &&
            activity.status === "running"
          ) {
            activityIndex = index
            matchStrategy = "latest-running-same-tool"
            break
          }
        }
      }

      debugStudioChatClient("tool_result_received", {
        seq: ++clientToolEventSeq,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: event.status,
        outputLength: event.output?.length ?? 0,
        errorLength: event.error?.length ?? 0,
        matchStrategy,
        matchedIndex: activityIndex,
        before: getActivityDebugSnapshot(activities),
      })

      const nextActivity: StudioMessageActivity =
        activityIndex >= 0
          ? {
              ...activities[activityIndex],
              status: event.status,
              output: event.output ?? "",
              error: event.error ?? null,
            }
          : {
              id: event.toolCallId,
              toolName: event.toolName,
              status: event.status,
              input: "",
              output: event.output ?? "",
              error: event.error ?? null,
            }

      activities =
        activityIndex >= 0
          ? activities.map((activity, index) =>
              index === activityIndex ? nextActivity : activity
            )
          : [...activities, nextActivity]

      upsertToolPart(nextActivity)
      debugStudioChatClient("tool_result_applied", {
        seq: clientToolEventSeq,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        matchStrategy,
        activityId: nextActivity.id,
        after: getActivityDebugSnapshot(activities),
      })
    }

    onChunk({ content, activities, parts, reasoningContent, reasoningDurationMs })
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

  return { content, activities, parts, reasoningContent, reasoningDurationMs }
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

    const acceptedFiles = Array.from(files)

    void Promise.all(
      acceptedFiles
        .filter((file) => file.size <= MAX_ATTACHMENT_BYTES)
        .map(async (file) => ({
          id: createClientId(),
          type: file.type.startsWith("image/")
            ? ("image" as const)
            : ("file" as const),
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
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
      const initialSnapshot: ChatStreamSnapshot = {
        content: "",
        activities: [],
        parts: [],
        reasoningContent: "",
        reasoningDurationMs: null,
      }
      let latestSnapshot = initialSnapshot

      const hasPersistableSnapshot = (snapshot: ChatStreamSnapshot) =>
        snapshot.content.trim().length > 0 ||
        snapshot.reasoningContent.trim().length > 0 ||
        snapshot.activities.some((activity) => activity.status !== "running")

      const finalizeStoppedSnapshot = (
        snapshot: ChatStreamSnapshot
      ): ChatStreamSnapshot => {
        const completedActivities = snapshot.activities.filter(
          (activity) => activity.status !== "running"
        )
        const completedActivityIds = new Set(
          completedActivities.map((activity) => activity.id)
        )

        return {
          ...snapshot,
          activities: completedActivities,
          parts: snapshot.parts.filter((part) => {
            if (part.type === "text" || part.type === "reasoning") {
              return true
            }

            return completedActivityIds.has(part.activity.id)
          }),
        }
      }

      const saveAssistantSnapshot = async (snapshot: ChatStreamSnapshot) => {
        if (!hasPersistableSnapshot(snapshot)) {
          return null
        }

        const savedMessage = await createMessage({
          sessionId: activeSessionId,
          role: "assistant",
          content: snapshot.content,
          model,
          activities: snapshot.activities,
          parts: snapshot.parts,
          reasoningContent: snapshot.reasoningContent,
          reasoningDurationMs: snapshot.reasoningDurationMs,
          versionGroupId: options.versionGroupId,
          replacesMessageId: options.replacesMessageId,
        })

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
        return savedMessage
      }

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
          parts: [],
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
          latestSnapshot = snapshot
          setActiveRuns((current) => {
            const run = current[activeSessionId]
            if (!run) return current

            return {
              ...current,
              [activeSessionId]: {
                phase: "streaming",
                content: snapshot.content,
                activities: snapshot.activities,
                parts: snapshot.parts,
                reasoningContent: snapshot.reasoningContent,
                reasoningDurationMs: snapshot.reasoningDurationMs,
              },
            }
          })
        },
      })
        .then(async (assistantMessage) => {
          abortControllersRef.current.delete(activeSessionId)

          await saveAssistantSnapshot(assistantMessage)

          setActiveRuns((current) => {
            const next = { ...current }
            delete next[activeSessionId]
            return next
          })
        })
        .catch(async (nextError) => {
          abortControllersRef.current.delete(activeSessionId)

          if (
            nextError instanceof DOMException &&
            nextError.name === "AbortError"
          ) {
            try {
              await saveAssistantSnapshot(
                finalizeStoppedSnapshot(latestSnapshot)
              )
            } catch {
              setChatErrors((current) => ({
                ...current,
                [activeSessionId]: true,
              }))
            }

            setActiveRuns((current) => {
              const next = { ...current }
              delete next[activeSessionId]
              return next
            })
            return
          }

          try {
            await saveAssistantSnapshot(finalizeStoppedSnapshot(latestSnapshot))
          } catch {
            // Keep surfacing the run failure below; partial persistence is best-effort.
          }

          setActiveRuns((current) => {
            const next = { ...current }
            delete next[activeSessionId]
            return next
          })

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
          id: attachment.id,
          type: attachment.type,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
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
                  <Shimmer className="text-sm">
                    {t.studioThinking}
                  </Shimmer>
                </div>
              ) : null}

              {activeRun?.phase === "streaming" &&
              (activeRun.content ||
                activeRun.reasoningContent ||
                activeRun.parts.length > 0) ? (
                <StreamingAssistantMessage
                  content={activeRun.content}
                  activities={activeRun.activities}
                  parts={activeRun.parts}
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

function FileAttachmentChip({
  attachment,
  compact = false,
}: {
  attachment: StudioAttachment
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex h-full min-w-0 items-center gap-2 bg-background/70 px-3 py-2",
        compact ? "text-xs" : "rounded-2xl border text-sm shadow-sm"
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <RiFileTextLine aria-hidden className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{attachment.name}</div>
        <div className="truncate text-muted-foreground">
          {[attachment.mimeType, formatAttachmentSize(attachment.size)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </div>
  )
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

    if (files && files.length > 0) {
      // Pasted a file (e.g. a screenshot or document) — attach it instead of
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
              className={cn(
                "group relative overflow-hidden rounded-2xl border bg-muted",
                attachment.type === "image" ? "size-16" : "h-16 w-52 max-w-full"
              )}
            >
              {attachment.type === "image" && attachment.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  className="size-full object-cover"
                />
              ) : (
                <FileAttachmentChip attachment={attachment} compact />
              )}
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
              {message.attachments.map((attachment, index) =>
                attachment.type === "image" && attachment.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${message.id}-${index}`}
                    src={attachment.dataUrl}
                    alt={attachment.name}
                    className="max-h-60 max-w-full rounded-2xl border object-contain"
                  />
                ) : (
                  <FileAttachmentChip
                    key={`${message.id}-${index}`}
                    attachment={attachment}
                  />
                )
              )}
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

const assistantTraceContainerClassName = "not-prose my-0 text-muted-foreground"

const assistantTraceTriggerClassName =
  "min-h-7 max-w-full text-sm leading-6 [&>div]:min-w-0 [&>div]:gap-2 [&>div>span:last-child]:min-w-0"

const assistantTraceLabelClassName =
  "block max-w-full truncate leading-6"

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
  const { locale, t } = useI18n()

  if (!content.trim()) {
    return null
  }

  const label =
    durationMs === null || durationMs === undefined
      ? "Reasoning"
      : formatReasoningDuration(locale, durationMs)

  return (
    <Reasoning
      isStreaming={isStreaming}
      className={cn(assistantTraceContainerClassName, "flex flex-col")}
    >
      <ReasoningTrigger
        className={cn(
          "min-h-7 w-fit max-w-full text-sm leading-6",
          "[&>span]:min-w-0 [&>span]:truncate"
        )}
      >
        {isStreaming ? (
          <Shimmer as="span">{t.studioThinking}</Shimmer>
        ) : (
          label
        )}
      </ReasoningTrigger>
      <ReasoningContent
        markdown
        className="ml-1.75 border-l border-l-border/70 pl-6 pb-1"
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
  parts,
  reasoningContent,
  reasoningDurationMs,
}: {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
  reasoningContent: string
  reasoningDurationMs: number | null
}) {
  const showTopLevelReasoning = !hasRenderableReasoningParts(parts)

  return (
    <Message className="justify-start">
      <div className="flex w-full flex-col gap-2">
        {showTopLevelReasoning ? (
          <AssistantReasoning
            content={reasoningContent}
            durationMs={reasoningDurationMs}
            isStreaming={reasoningDurationMs === null}
          />
        ) : null}
        <AssistantContentParts
          content={content}
          activities={activities}
          parts={parts}
          streaming
        />
      </div>
    </Message>
  )
}

function getFallbackMessageParts(
  content: string,
  activities: StudioMessageActivity[]
): StudioMessagePart[] {
  const fallbackParts: StudioMessagePart[] = activities.map((activity) => ({
    id: activity.id,
    type: "tool",
    activity,
  }))

  if (content.trim()) {
    fallbackParts.push({
      id: "content",
      type: "text",
      content,
    })
  }

  return fallbackParts
}

function hasRenderableReasoningParts(parts: StudioMessagePart[]) {
  return parts.some(
    (part) => part.type === "reasoning" && part.content.trim().length > 0
  )
}

function getRenderableMessageParts({
  content,
  activities,
  parts,
}: {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
}) {
  return parts.length > 0 ? parts : getFallbackMessageParts(content, activities)
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

function getWebFetchUrl(input: string) {
  try {
    const parsed = JSON.parse(input) as { url?: unknown }

    if (typeof parsed.url === "string" && parsed.url.trim()) {
      return parsed.url.trim()
    }
  } catch {
    // Fall back to the raw input below.
  }

  return input.trim()
}

function getRunCodePayload(input: string) {
  try {
    const parsed = JSON.parse(input) as {
      code?: unknown
      language?: unknown
      auto_pause?: unknown
      sandbox_id?: unknown
    }

    return {
      code: typeof parsed.code === "string" ? parsed.code : input,
      language:
        typeof parsed.language === "string" && parsed.language.trim()
          ? parsed.language.trim()
          : "python",
      autoPause:
        typeof parsed.auto_pause === "boolean" ? parsed.auto_pause : null,
      sandboxId:
        typeof parsed.sandbox_id === "string" && parsed.sandbox_id.trim()
          ? parsed.sandbox_id.trim()
          : null,
    }
  } catch {
    // Fall back to a generic label below.
  }

  return {
    code: input,
    language: "plaintext",
    autoPause: null,
    sandboxId: null,
  }
}

function getRunCommandPayload(input: string) {
  try {
    const parsed = JSON.parse(input) as {
      command?: unknown
      cwd?: unknown
    }

    return {
      command: typeof parsed.command === "string" ? parsed.command : input,
      cwd:
        typeof parsed.cwd === "string" && parsed.cwd.trim()
          ? parsed.cwd.trim()
          : null,
    }
  } catch {
    // Fall back to a generic label below.
  }

  return {
    command: input,
    cwd: null,
  }
}

function formatCommandActivityLabel({
  command,
  running,
  t,
}: {
  command: string
  running: boolean
  t: ReturnType<typeof useI18n>["t"]
}) {
  const isZh = t.studioThinking === "正在思考"
  const fallback = running
    ? isZh
      ? command
        ? `正在执行命令 ${command}`
        : "正在执行命令"
      : command
        ? `Running command ${command}`
        : "Running command"
    : isZh
      ? command
        ? `已执行命令 ${command}`
        : "已执行命令"
      : command
        ? `Ran command ${command}`
        : "Ran command"
  const formatter = running
    ? (t as Partial<typeof t>).studioToolRunningCommand
    : (t as Partial<typeof t>).studioToolRanCommand

  return typeof formatter === "function" ? formatter(command) : fallback
}

function parseToolInputObject(input: string) {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>

    return typeof parsed === "object" && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function getFileToolTarget(input: string) {
  const parsed = parseToolInputObject(input)

  if (!parsed) {
    return input.trim()
  }

  const path = typeof parsed.path === "string" ? parsed.path.trim() : ""
  const name = typeof parsed.name === "string" ? parsed.name.trim() : ""
  const fileId =
    typeof parsed.file_id === "string" ? parsed.file_id.trim() : ""

  return path || name || fileId || ""
}

function getFileToolOutputTarget(output: string) {
  const match = output.match(
    /^(?:Uploaded file|Saved sandbox file for download|Read file|Wrote file|Files in):\s*(.+)$/m
  )

  return match?.[1]?.trim() ?? ""
}

function getFileActivityTarget(activity: StudioMessageActivity) {
  const inputTarget = getFileToolTarget(activity.input)
  const outputTarget = getFileToolOutputTarget(activity.output)

  return activity.status === "complete"
    ? outputTarget || inputTarget
    : inputTarget || outputTarget
}

function getActivityLabel(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  if (activity.status === "error") {
    return t.studioToolError
  }

  if (activity.toolName === "web_fetch") {
    const url = getWebFetchUrl(activity.input)

    return activity.status === "running"
      ? t.studioToolFetching(url)
      : t.studioToolFetched(url)
  }

  if (activity.toolName === "run_code") {
    const { language } = getRunCodePayload(activity.input)

    return activity.status === "running"
      ? t.studioToolRunningCode(language)
      : t.studioToolRanCode(language)
  }

  if (activity.toolName === "run_command") {
    const { command } = getRunCommandPayload(activity.input)

    return formatCommandActivityLabel({
      command,
      running: activity.status === "running",
      t,
    })
  }

  if (
    activity.toolName === "upload_file" ||
    activity.toolName === "list_files" ||
    activity.toolName === "read_file" ||
    activity.toolName === "write_file" ||
    activity.toolName === "download_file"
  ) {
    const target = getFileActivityTarget(activity)

    if (activity.toolName === "upload_file") {
      return activity.status === "running"
        ? t.studioToolUploadingFile(target)
        : t.studioToolUploadedFile(target)
    }

    if (activity.toolName === "list_files") {
      return activity.status === "running"
        ? t.studioToolListingFiles(target)
        : t.studioToolListedFiles(target)
    }

    if (activity.toolName === "read_file") {
      return activity.status === "running"
        ? t.studioToolReadingFile(target)
        : t.studioToolReadFile(target)
    }

    if (activity.toolName === "write_file") {
      return activity.status === "running"
        ? t.studioToolWritingFile(target)
        : t.studioToolWroteFile(target)
    }

    return activity.status === "running"
      ? t.studioToolSavingFile(target)
      : t.studioToolSavedFile(target)
  }

  const query = getWebSearchQuery(activity.input)

  return activity.status === "running"
    ? t.studioToolSearching(query)
    : t.studioToolAnalyzed(query)
}

function renderActivityInlineLabel(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  const label =
    activity.status === "error"
      ? t.studioToolError
      : getActivityLabel(activity, t)

  return (
    <span className={assistantTraceLabelClassName}>
      {activity.status === "running" ? (
        <Shimmer as="span">{label}</Shimmer>
      ) : (
        label
      )}
    </span>
  )
}

function FileToolActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep key={`${activity.id}-${activity.status}`} disabled>
        <ChainOfThoughtTrigger
          className={cn(assistantTraceTriggerClassName, "cursor-default")}
          leftIcon={
            activity.status === "complete" ? (
              <RiCheckLine aria-hidden className="size-4" />
            ) : (
              <RiFileTextLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function RunCommandActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const payload = getRunCommandPayload(activity.input)
  const output =
    activity.status === "error"
      ? activity.error || t.studioToolError
      : activity.output.trim()
  const defaultOpen = activity.status === "running" || activity.status === "error"

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        defaultOpen={defaultOpen}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={
            activity.status === "complete" ? (
              <RiCheckLine aria-hidden className="size-4" />
            ) : (
              <RiTerminalLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          <CodeBlock className="rounded-2xl shadow-sm">
            <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <RiTerminalLine
                  aria-hidden
                  className="size-4 text-muted-foreground"
                />
                <span className="truncate text-sm font-medium">
                  {t.input} · bash
                </span>
              </div>
              {payload.cwd ? (
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="max-w-52 truncate">{payload.cwd}</span>
                </div>
              ) : null}
            </CodeBlockGroup>
            <CodeBlockCode code={payload.command} language="bash" />
          </CodeBlock>

          {activity.status === "running" ? null : (
            <div className="space-y-2 border-l pl-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                {t.output}
              </div>
              {output ? (
                <MessageContent
                  markdown
                  className={cn("bg-transparent p-0", markdownClassName)}
                >
                  {output}
                </MessageContent>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {t.studioToolNoOutput}
                </div>
              )}
            </div>
          )}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function RunCodeActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const payload = getRunCodePayload(activity.input)
  const output =
    activity.status === "error"
      ? activity.error || t.studioToolError
      : activity.output.trim()
  const lifecycleLabel =
    payload.autoPause === null
      ? null
      : payload.autoPause
        ? t.studioToolAutoPause
        : t.studioToolKillAfterRun
  const defaultOpen = activity.status === "running" || activity.status === "error"

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        defaultOpen={defaultOpen}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={
            activity.status === "complete" ? (
              <RiCheckLine aria-hidden className="size-4" />
            ) : (
              <RiCodeLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          <CodeBlock className="rounded-2xl shadow-sm">
            <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <RiCodeLine
                  aria-hidden
                  className="size-4 text-muted-foreground"
                />
                <span className="truncate text-sm font-medium">
                  {t.input} · {payload.language}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {lifecycleLabel ? <span>{lifecycleLabel}</span> : null}
                {payload.sandboxId ? (
                  <span className="max-w-40 truncate">{payload.sandboxId}</span>
                ) : null}
              </div>
            </CodeBlockGroup>
            <CodeBlockCode code={payload.code} language={payload.language} />
          </CodeBlock>

          {activity.status === "running" ? null : (
            <div className="space-y-2 border-l pl-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                {t.output}
              </div>
              {output ? (
                <MessageContent
                  markdown
                  className={cn("bg-transparent p-0", markdownClassName)}
                >
                  {output}
                </MessageContent>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {t.studioToolNoOutput}
                </div>
              )}
            </div>
          )}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function AssistantActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()

  if (activity.toolName === "run_code") {
    return <RunCodeActivity activity={activity} />
  }

  if (activity.toolName === "run_command") {
    return <RunCommandActivity activity={activity} />
  }

  if (
    activity.toolName === "upload_file" ||
    activity.toolName === "list_files" ||
    activity.toolName === "read_file" ||
    activity.toolName === "write_file" ||
    activity.toolName === "download_file"
  ) {
    return <FileToolActivity activity={activity} />
  }

  if (
    activity.toolName !== "web_search" &&
    activity.toolName !== "web_fetch"
  ) {
    return null
  }

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep key={`${activity.id}-${activity.status}`} disabled>
        <ChainOfThoughtTrigger
          className={cn(assistantTraceTriggerClassName, "cursor-default")}
          leftIcon={
            activity.status === "complete" ? (
              <RiCheckLine aria-hidden className="size-4" />
            ) : activity.toolName === "web_fetch" ? (
              <RiFileTextLine aria-hidden className="size-4" />
            ) : (
              <RiSearchLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function AssistantContentParts({
  content,
  activities,
  parts,
  streaming = false,
}: {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
  streaming?: boolean
}) {
  const renderableParts = getRenderableMessageParts({
    content,
    activities,
    parts,
  })
  const lastTextPartIndex = renderableParts.findLastIndex(
    (part) => part.type === "text" && part.content.trim()
  )
  const lastReasoningPartIndex = renderableParts.findLastIndex(
    (part) => part.type === "reasoning" && part.content.trim()
  )

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      {renderableParts.map((part, index) => {
        if (part.type === "tool") {
          return <AssistantActivity key={part.id} activity={part.activity} />
        }

        if (part.type === "reasoning") {
          return (
            <AssistantReasoning
              key={part.id}
              content={part.content}
              durationMs={part.durationMs}
              isStreaming={
                streaming &&
                index === lastReasoningPartIndex &&
                part.durationMs === null
              }
            />
          )
        }

        if (!part.content.trim()) {
          return null
        }

        return (
          <MessageContent
            key={part.id}
            markdown
            className={cn(
              "bg-transparent p-0",
              markdownClassName,
              streaming &&
                index === lastTextPartIndex &&
                streamingPulseDotClassName
            )}
          >
            {part.content}
          </MessageContent>
        )
      })}
    </div>
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
  const showTopLevelReasoning = !hasRenderableReasoningParts(
    activeVersion.parts
  )

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
          {showTopLevelReasoning ? (
            <AssistantReasoning
              content={activeVersion.reasoningContent}
              durationMs={activeVersion.reasoningDurationMs}
            />
          ) : null}
          <AssistantContentParts
            content={activeVersion.content}
            activities={activeVersion.activities}
            parts={activeVersion.parts}
          />
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
  const showTopLevelReasoning = !hasRenderableReasoningParts(message.parts)

  function handleCopy() {
    void navigator.clipboard.writeText(copyableContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Message className="justify-start">
      <div className="flex w-full flex-col gap-2">
        {showTopLevelReasoning ? (
          <AssistantReasoning
            content={message.reasoningContent}
            durationMs={message.reasoningDurationMs}
          />
        ) : null}
        <AssistantContentParts
          content={message.content}
          activities={message.activities}
          parts={message.parts}
        />
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
