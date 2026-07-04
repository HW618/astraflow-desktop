"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiBookOpenLine,
  RiBrainLine,
  RiCheckLine,
  RiCloseLine,
  RiCodeLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiFileTextLine,
  RiInformationLine,
  RiRefreshLine,
  RiSearchLine,
  RiStopFill,
  RiTerminalLine,
  RiThumbDownLine,
  RiThumbUpLine,
} from "@remixicon/react"
import { Eye, FolderGit2, GitBranch, Globe, Hand, Zap } from "lucide-react"
import { toast } from "sonner"

import { AgentRuntimeIcon } from "@/components/agent-runtime-icons"
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
  DialogClose,
  DialogContent,
  DialogDescription,
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useI18n } from "@/components/i18n-provider"
import { SkillsMarketPage } from "@/components/skills-market-page"
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
import type { AgentRuntimeInfo } from "@/lib/agent/runtime"
import {
  consumePendingProjectId,
  setPendingProjectId,
} from "@/lib/studio-pending-project"
import {
  getMcpToolDisplayName,
  isMcpToolName,
  type InstalledMcpServersApiResponse,
} from "@/lib/mcp"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import type { InstalledSkillsApiResponse } from "@/lib/skill-market"
import type {
  StudioAttachment,
  StudioMessageActivity,
  StudioMessage,
  StudioMessagePart,
  StudioChatRunLiveSnapshot,
  StudioChatRunSnapshot,
  StudioLocalProjectWithGitInfo,
  StudioPermissionMode,
  StudioPermissionOption,
  StudioSession,
} from "@/lib/studio-types"
import {
  dispatchStudioSessionsChanged,
  STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
  STUDIO_SESSIONS_CHANGED_EVENT,
} from "@/lib/studio-session-events"
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

function getAttachmentRenderKey(attachment: StudioAttachment) {
  return (
    attachment.id ??
    [
      attachment.type,
      attachment.name,
      attachment.mimeType,
      attachment.size ?? "unknown-size",
      attachment.storagePath ?? attachment.sandboxPath ?? "inline",
    ].join(":")
  )
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

const CHAT_MODEL_STORAGE_KEY = "astraflow:chat-model"
const CHAT_RUNTIME_STORAGE_KEY = "astraflow:chat-runtime"
const CHAT_REASONING_EFFORT_STORAGE_KEY = "astraflow:chat-reasoning-effort"
const CHAT_ENVIRONMENT_STORAGE_KEY = "astraflow:chat-environment"
const DEFAULT_CHAT_RUNTIME_ID = "astraflow"
const PROJECT_NONE_VALUE = "__none__"

type ChatRunEnvironment = "remote" | "local"

const DEFAULT_CHAT_ENVIRONMENT: ChatRunEnvironment = "local"

type ChatRuntimeOption = Pick<
  AgentRuntimeInfo,
  "id" | "label" | "description" | "capabilities"
>

const FALLBACK_CHAT_RUNTIME_INFO: ChatRuntimeOption = {
  id: DEFAULT_CHAT_RUNTIME_ID,
  label: "AstraFlow Agent",
  description: "AstraFlow agent with remote sandbox and local execution",
  capabilities: {
    hitl: true,
    resume: false,
    subagents: true,
    plan: true,
    sandbox: true,
    mcp: true,
    skills: true,
  },
}

const chatModelListeners = new Set<() => void>()
const chatRuntimeListeners = new Set<() => void>()
const chatEnvironmentListeners = new Set<() => void>()
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

function getStoredChatRuntime() {
  if (typeof window === "undefined") {
    return DEFAULT_CHAT_RUNTIME_ID
  }

  const stored = window.localStorage.getItem(CHAT_RUNTIME_STORAGE_KEY)?.trim()

  return stored || DEFAULT_CHAT_RUNTIME_ID
}

function setStoredChatRuntime(runtimeId: string) {
  window.localStorage.setItem(CHAT_RUNTIME_STORAGE_KEY, runtimeId)
  chatRuntimeListeners.forEach((listener) => listener())
}

function subscribeChatRuntime(listener: () => void) {
  chatRuntimeListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    chatRuntimeListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function useChatRuntime() {
  const runtimeId = React.useSyncExternalStore(
    subscribeChatRuntime,
    getStoredChatRuntime,
    () => DEFAULT_CHAT_RUNTIME_ID
  )

  return [runtimeId, setStoredChatRuntime] as const
}

function getStoredChatEnvironment(): ChatRunEnvironment {
  if (typeof window === "undefined") {
    return DEFAULT_CHAT_ENVIRONMENT
  }

  const stored = window.localStorage.getItem(CHAT_ENVIRONMENT_STORAGE_KEY)

  return stored === "remote" || stored === "local"
    ? stored
    : DEFAULT_CHAT_ENVIRONMENT
}

function setStoredChatEnvironment(environment: ChatRunEnvironment) {
  window.localStorage.setItem(CHAT_ENVIRONMENT_STORAGE_KEY, environment)
  chatEnvironmentListeners.forEach((listener) => listener())
}

function subscribeChatEnvironment(listener: () => void) {
  chatEnvironmentListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    chatEnvironmentListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function useChatEnvironment() {
  const environment = React.useSyncExternalStore(
    subscribeChatEnvironment,
    getStoredChatEnvironment,
    () => DEFAULT_CHAT_ENVIRONMENT
  )

  return [environment, setStoredChatEnvironment] as const
}

function getStoredChatReasoningEffort(
  model: SupportedChatModel
): ChatReasoningEffort {
  if (typeof window === "undefined") {
    return getDefaultChatReasoningEffort(model)
  }

  const stored = window.localStorage.getItem(CHAT_REASONING_EFFORT_STORAGE_KEY)

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
  const stored = window.localStorage.getItem(CHAT_REASONING_EFFORT_STORAGE_KEY)

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

function normalizeChatRuntimeInfos(runtimes: AgentRuntimeInfo[]) {
  const seenRuntimeIds = new Set<string>()
  const normalized = runtimes.reduce<ChatRuntimeOption[]>(
    (options, runtime) => {
      if (seenRuntimeIds.has(runtime.id)) {
        return options
      }

      seenRuntimeIds.add(runtime.id)
      options.push({
        id: runtime.id,
        label: runtime.label,
        description: runtime.description,
        capabilities: runtime.capabilities,
      })
      return options
    },
    []
  )

  if (!seenRuntimeIds.has(DEFAULT_CHAT_RUNTIME_ID)) {
    return [FALLBACK_CHAT_RUNTIME_INFO, ...normalized]
  }

  return normalized.length > 0 ? normalized : [FALLBACK_CHAT_RUNTIME_INFO]
}

function resolveChatRuntimeId(
  runtimeId: string,
  runtimeInfos: ChatRuntimeOption[]
) {
  return runtimeInfos.some((runtime) => runtime.id === runtimeId)
    ? runtimeId
    : DEFAULT_CHAT_RUNTIME_ID
}

function getChatRuntimeLabel(
  runtimeId: string,
  runtimeInfos: ChatRuntimeOption[]
) {
  return (
    runtimeInfos.find((runtime) => runtime.id === runtimeId)?.label ??
    FALLBACK_CHAT_RUNTIME_INFO.label
  )
}

function supportsPermissionMode(
  runtimeId: string,
  runtimeInfos: ChatRuntimeOption[]
) {
  return (
    runtimeInfos.find((runtime) => runtime.id === runtimeId)?.capabilities
      .hitl ?? false
  )
}

async function readJson<T>(response: Response) {
  const data = (await response.json()) as ApiResponse<T>

  if (!response.ok || !data.ok) {
    throw new Error("Request failed")
  }

  return data.data
}

async function listAgentRuntimes() {
  const response = await fetch("/api/studio/agent-runtimes", {
    cache: "no-store",
  })

  return normalizeChatRuntimeInfos(await readJson<AgentRuntimeInfo[]>(response))
}

async function listLocalProjectsForComposer() {
  const response = await fetch("/api/studio/local-projects", {
    cache: "no-store",
  })

  return readJson<StudioLocalProjectWithGitInfo[]>(response)
}

async function listStudioSessionsForComposer() {
  const response = await fetch("/api/studio/sessions", { cache: "no-store" })

  return readJson<StudioSession[]>(response)
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

async function updateSessionProject(
  sessionId: string,
  projectId: string | null
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  })

  return readJson<StudioSession>(response)
}

async function updateSessionPermissionMode(
  sessionId: string,
  permissionMode: StudioPermissionMode
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissionMode }),
  })

  return readJson<StudioSession>(response)
}

async function sendPermissionDecision(input: {
  sessionId: string
  requestId: string
  optionId: string
}) {
  const response = await fetch("/api/studio/chat/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return readJson<{ resolved: boolean }>(response)
}

async function listMessages(sessionId: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}/messages`)

  return readJson<StudioMessage[]>(response)
}

async function createMessage(input: {
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
}) {
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

async function startAssistantRunRequest({
  sessionId,
  model,
  reasoningEffort,
  runtimeId,
  environment,
  retryMessageId,
}: {
  sessionId: string
  model: SupportedChatModel
  reasoningEffort: ChatReasoningEffort
  runtimeId: string
  environment?: ChatRunEnvironment
  retryMessageId?: string
}) {
  const response = await fetch("/api/studio/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      model,
      reasoningEffort,
      runtimeId,
      environment,
      retryMessageId,
    }),
  })

  return readJson<StudioChatRunSnapshot>(response)
}

async function stopAssistantRunRequest(sessionId: string) {
  const response = await fetch("/api/studio/chat", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  })

  return readJson<StudioChatRunSnapshot | null>(response)
}

async function listInstalledSkillsForComposer() {
  const response = await fetch("/api/skills/installed", {
    cache: "no-store",
  })
  const payload = (await response.json()) as InstalledSkillsApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function listInstalledMcpForComposer() {
  const response = await fetch("/api/mcp/installed", {
    cache: "no-store",
  })
  const payload = (await response.json()) as InstalledMcpServersApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

function parseLiveSnapshot(event: MessageEvent<string>) {
  try {
    return JSON.parse(event.data) as StudioChatRunLiveSnapshot
  } catch {
    return null
  }
}

function getMessageProgressScore(message: StudioMessage) {
  return (
    message.content.length +
    message.reasoningContent.length +
    message.activities.length +
    message.parts.length
  )
}

function mergeReloadedMessages(
  currentMessages: StudioMessage[],
  nextMessages: StudioMessage[]
) {
  const currentById = new Map(
    currentMessages.map((message) => [message.id, message])
  )

  return nextMessages.map((nextMessage) => {
    const currentMessage = currentById.get(nextMessage.id)

    if (
      currentMessage?.status === "streaming" &&
      nextMessage.status === "streaming" &&
      getMessageProgressScore(currentMessage) >
        getMessageProgressScore(nextMessage)
    ) {
      return currentMessage
    }

    return nextMessage
  })
}

function mergeLiveMessage(
  currentMessages: StudioMessage[],
  liveMessage: StudioMessage
) {
  const existingIndex = currentMessages.findIndex(
    (message) => message.id === liveMessage.id
  )

  if (existingIndex >= 0) {
    return currentMessages.map((message, index) =>
      index === existingIndex ? liveMessage : message
    )
  }

  if (liveMessage.role !== "assistant" || !liveMessage.versionGroupId) {
    return [...currentMessages, liveMessage]
  }

  const replacementIndex = currentMessages.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.versionGroupId === liveMessage.versionGroupId
  )

  if (replacementIndex < 0) {
    return [...currentMessages, liveMessage]
  }

  return [
    ...currentMessages.slice(0, replacementIndex),
    liveMessage,
    ...currentMessages.slice(replacementIndex + 1),
  ]
}

function getStudioGreetingPeriod(date = new Date()) {
  const hour = date.getHours()

  if (hour < 5) {
    return "lateNight"
  }

  if (hour < 10) {
    return "morning"
  }

  if (hour < 12) {
    return "lateMorning"
  }

  if (hour < 14) {
    return "noon"
  }

  if (hour < 17) {
    return "afternoon"
  }

  if (hour < 19) {
    return "evening"
  }

  return "night"
}

function useStudioGreetingPeriod() {
  const [period, setPeriod] = React.useState("anytime")

  React.useEffect(() => {
    const updatePeriod = () => setPeriod(getStudioGreetingPeriod())

    updatePeriod()

    const timer = window.setInterval(updatePeriod, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  return period
}

function StudioChatWorkbench({
  sessionId,
  onSessionChange,
  onSessionsChange,
}: StudioChatWorkbenchProps) {
  const { t } = useI18n()
  const greetingPeriod = useStudioGreetingPeriod()
  const [input, setInput] = React.useState("")
  const [selectedModel, setSelectedModel] = useChatModel()
  const [selectedRuntimeId, setSelectedRuntimeId] = useChatRuntime()
  const [selectedReasoningEffort, setSelectedReasoningEffort] =
    useChatReasoningEffort(selectedModel)
  const [selectedEnvironment, setSelectedEnvironment] = useChatEnvironment()
  const [runtimeInfos, setRuntimeInfos] = React.useState<ChatRuntimeOption[]>(
    () => [FALLBACK_CHAT_RUNTIME_INFO]
  )
  const [localProjects, setLocalProjects] = React.useState<
    StudioLocalProjectWithGitInfo[]
  >([])
  const [selectedProjectId, setSelectedProjectId] = React.useState<
    string | null
  >(null)
  const [selectedPermissionMode, setSelectedPermissionMode] =
    React.useState<StudioPermissionMode>("ask")
  const [messages, setMessages] = React.useState<StudioMessage[]>([])
  const [pendingAttachments, setPendingAttachments] = React.useState<
    PendingAttachment[]
  >([])
  const [startingSessionIds, setStartingSessionIds] = React.useState<
    Set<string>
  >(() => new Set())
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [chatErrors, setChatErrors] = React.useState<Record<string, boolean>>(
    {}
  )
  const [liveStreamConnected, setLiveStreamConnected] = React.useState(false)
  const sessionIdRef = React.useRef(sessionId)
  const sessionProjectRequestIdRef = React.useRef(0)

  const visibleMessages = sessionId ? messages : []
  const resolvedRuntimeId = resolveChatRuntimeId(
    selectedRuntimeId,
    runtimeInfos
  )
  const resolvedEnvironment =
    resolvedRuntimeId === DEFAULT_CHAT_RUNTIME_ID
      ? selectedEnvironment
      : undefined
  const isStarting = sessionId ? startingSessionIds.has(sessionId) : false
  const hasStreamingMessage = visibleMessages.some(
    (message) => message.role === "assistant" && message.status === "streaming"
  )
  const isBusy = isStarting || hasStreamingMessage
  const hasMessages = visibleMessages.length > 0 || isStarting
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

    void listAgentRuntimes()
      .then((nextRuntimeInfos) => {
        if (!cancelled) {
          setRuntimeInfos(nextRuntimeInfos)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeInfos([FALLBACK_CHAT_RUNTIME_INFO])
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const reloadLocalProjects = React.useCallback(async () => {
    try {
      setLocalProjects(await listLocalProjectsForComposer())
    } catch {
      setLocalProjects([])
    }
  }, [])

  const reloadSessionProject = React.useCallback(async () => {
    const requestId = sessionProjectRequestIdRef.current + 1
    sessionProjectRequestIdRef.current = requestId

    if (!sessionId) {
      setSelectedProjectId(consumePendingProjectId())
      setSelectedPermissionMode("ask")
      return
    }

    const activeSessionId = sessionId

    try {
      const sessions = await listStudioSessionsForComposer()
      const session = sessions.find(
        (candidate) => candidate.id === activeSessionId
      )

      if (
        sessionProjectRequestIdRef.current !== requestId ||
        sessionIdRef.current !== activeSessionId
      ) {
        return
      }

      setSelectedProjectId(session?.projectId ?? null)
      setSelectedPermissionMode(session?.permissionMode ?? "ask")
    } catch {
      if (
        sessionProjectRequestIdRef.current !== requestId ||
        sessionIdRef.current !== activeSessionId
      ) {
        return
      }

      setSelectedProjectId(null)
      setSelectedPermissionMode("ask")
    }
  }, [sessionId])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadLocalProjects()
    })
  }, [reloadLocalProjects])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadSessionProject()
    })
  }, [reloadSessionProject])

  React.useEffect(() => {
    function handleLocalProjectsChanged() {
      void reloadLocalProjects()
    }

    window.addEventListener(
      STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
      handleLocalProjectsChanged
    )

    return () => {
      window.removeEventListener(
        STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
        handleLocalProjectsChanged
      )
    }
  }, [reloadLocalProjects])

  React.useEffect(() => {
    function handleSessionsChanged() {
      void reloadSessionProject()
    }

    window.addEventListener(
      STUDIO_SESSIONS_CHANGED_EVENT,
      handleSessionsChanged
    )

    return () => {
      window.removeEventListener(
        STUDIO_SESSIONS_CHANGED_EVENT,
        handleSessionsChanged
      )
    }
  }, [reloadSessionProject])

  const reloadMessages = React.useCallback(async (activeSessionId: string) => {
    const nextMessages = activeSessionId
      ? await listMessages(activeSessionId)
      : []

    if (sessionIdRef.current === activeSessionId) {
      setMessages((currentMessages) =>
        mergeReloadedMessages(currentMessages, nextMessages)
      )
      setLoadFailed(false)
    }

    return nextMessages
  }, [])

  React.useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => (sessionId ? reloadMessages(sessionId) : []))
      .then((nextMessages) => {
        if (!cancelled) {
          setMessages((currentMessages) =>
            mergeReloadedMessages(currentMessages, nextMessages)
          )
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
  }, [reloadMessages, sessionId])

  React.useEffect(() => {
    if (
      !sessionId ||
      (!hasStreamingMessage && !isStarting) ||
      liveStreamConnected
    ) {
      return
    }

    let cancelled = false
    const poll = () => {
      void reloadMessages(sessionId)
        .then((nextMessages) => {
          if (cancelled) {
            return
          }

          const stillStreaming = nextMessages.some(
            (message) =>
              message.role === "assistant" && message.status === "streaming"
          )

          if (!stillStreaming) {
            onSessionsChange()
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoadFailed(true)
          }
        })
    }

    const timer = window.setInterval(poll, 1000)

    poll()

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [
    hasStreamingMessage,
    isStarting,
    liveStreamConnected,
    onSessionsChange,
    reloadMessages,
    sessionId,
  ])

  React.useEffect(() => {
    if (!sessionId || (!hasStreamingMessage && !isStarting)) {
      return
    }

    if (typeof window === "undefined" || !("EventSource" in window)) {
      return
    }

    const source = new EventSource(
      `/api/studio/chat/events?sessionId=${encodeURIComponent(sessionId)}`
    )
    let closed = false

    const applySnapshot = (snapshot: StudioChatRunLiveSnapshot) => {
      if (sessionIdRef.current !== snapshot.sessionId || !snapshot.message) {
        return
      }

      setMessages((currentMessages) =>
        mergeLiveMessage(currentMessages, snapshot.message!)
      )
      setLoadFailed(false)
    }

    const handleOpen = () => {
      if (!closed) {
        setLiveStreamConnected(true)
      }
    }

    const handleSnapshot = (event: Event) => {
      const snapshot = parseLiveSnapshot(event as MessageEvent<string>)

      if (snapshot) {
        applySnapshot(snapshot)
      }
    }

    const handleDone = (event: Event) => {
      const snapshot = parseLiveSnapshot(event as MessageEvent<string>)

      if (snapshot) {
        applySnapshot(snapshot)
      }

      close()
      void reloadMessages(sessionId)
        .then(() => onSessionsChange())
        .catch(() => setLoadFailed(true))
    }

    const handleError = () => {
      setLiveStreamConnected(false)
      close()
    }

    const close = () => {
      if (closed) {
        return
      }

      closed = true
      source.removeEventListener("open", handleOpen)
      source.removeEventListener("snapshot", handleSnapshot)
      source.removeEventListener("done", handleDone)
      source.close()
    }

    source.addEventListener("open", handleOpen)
    source.addEventListener("snapshot", handleSnapshot)
    source.addEventListener("done", handleDone)
    source.onerror = handleError

    return () => {
      setLiveStreamConnected(false)
      close()
    }
  }, [
    hasStreamingMessage,
    isStarting,
    onSessionsChange,
    reloadMessages,
    sessionId,
  ])

  const startAssistantRun = React.useCallback(
    (
      activeSessionId: string,
      model: SupportedChatModel,
      reasoningEffort: ChatReasoningEffort,
      runtimeId: string,
      environment?: ChatRunEnvironment,
      options: {
        retryMessageId?: string
      } = {}
    ) => {
      setStartingSessionIds((current) => {
        const next = new Set(current)
        next.add(activeSessionId)
        return next
      })
      setChatErrors((current) => {
        if (!current[activeSessionId]) return current

        const next = { ...current }
        delete next[activeSessionId]
        return next
      })
      void startAssistantRunRequest({
        sessionId: activeSessionId,
        model,
        reasoningEffort,
        runtimeId,
        environment,
        retryMessageId: options.retryMessageId,
      })
        .then(async () => {
          await reloadMessages(activeSessionId)
          onSessionsChange()
        })
        .catch(() => {
          setChatErrors((current) => ({
            ...current,
            [activeSessionId]: true,
          }))
        })
        .finally(() => {
          setStartingSessionIds((current) => {
            const next = new Set(current)
            next.delete(activeSessionId)
            return next
          })
        })
    },
    [onSessionsChange, reloadMessages]
  )

  const stopAssistantRun = React.useCallback(
    (activeSessionId: string) => {
      void stopAssistantRunRequest(activeSessionId)
        .then(async () => {
          await reloadMessages(activeSessionId)
          onSessionsChange()
        })
        .finally(() => {
          setStartingSessionIds((current) => {
            const next = new Set(current)
            next.delete(activeSessionId)
            return next
          })
        })
    },
    [onSessionsChange, reloadMessages]
  )

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
        resolvedRuntimeId,
        resolvedEnvironment,
        {
          retryMessageId: message.id,
        }
      )
    },
    [
      isBusy,
      resolvedEnvironment,
      resolvedRuntimeId,
      selectedModel,
      selectedReasoningEffort,
      sessionId,
      startAssistantRun,
    ]
  )

  const handleProjectChange = React.useCallback(
    async (projectId: string | null) => {
      const previousProjectId = selectedProjectId

      setSelectedProjectId(projectId)

      if (!sessionId) {
        setPendingProjectId(projectId)
        return
      }

      const activeSessionId = sessionId

      try {
        const session = await updateSessionProject(activeSessionId, projectId)

        onSessionsChange()
        dispatchStudioSessionsChanged()

        if (
          session.id !== activeSessionId ||
          sessionIdRef.current !== activeSessionId
        ) {
          return
        }

        setSelectedProjectId(session.projectId)
        setSelectedPermissionMode(session.permissionMode)
      } catch {
        if (sessionIdRef.current === activeSessionId) {
          setSelectedProjectId(previousProjectId)
          toast.error(t.studioLocalProjectBindFailed)
        }
      }
    },
    [onSessionsChange, selectedProjectId, sessionId, t]
  )

  const handlePermissionModeChange = React.useCallback(
    async (permissionMode: StudioPermissionMode) => {
      const previousPermissionMode = selectedPermissionMode

      setSelectedPermissionMode(permissionMode)

      if (!sessionId) {
        return
      }

      const activeSessionId = sessionId

      try {
        const session = await updateSessionPermissionMode(
          activeSessionId,
          permissionMode
        )

        onSessionsChange()
        dispatchStudioSessionsChanged()

        if (
          session.id !== activeSessionId ||
          sessionIdRef.current !== activeSessionId
        ) {
          return
        }

        setSelectedPermissionMode(session.permissionMode)
      } catch {
        if (sessionIdRef.current === activeSessionId) {
          setSelectedPermissionMode(previousPermissionMode)
          toast.error(t.requestFailed)
        }
      }
    },
    [onSessionsChange, selectedPermissionMode, sessionId, t]
  )

  const handlePermissionDecision = React.useCallback(
    (
      requestId: string,
      option: StudioPermissionOption,
      status: Extract<StudioMessagePart, { type: "permission" }>["status"]
    ) => {
      if (!sessionId) {
        return
      }

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.sessionId !== sessionId
            ? message
            : {
                ...message,
                parts: message.parts.map((part) =>
                  part.type === "permission" && part.id === requestId
                    ? {
                        ...part,
                        status,
                        selectedOptionId: option.optionId,
                      }
                    : part
                ),
              }
        )
      )

      void sendPermissionDecision({
        sessionId,
        requestId,
        optionId: option.optionId,
      }).catch(() => {
        toast.error(t.studioPermissionDecisionFailed)
        void reloadMessages(sessionId)
      })
    },
    [reloadMessages, sessionId, t]
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
      const projectIdForNewSession =
        !sessionId &&
        selectedProjectId &&
        localProjects.some((project) => project.id === selectedProjectId)
          ? selectedProjectId
          : null
      let nextPermissionMode = selectedPermissionMode

      if (projectIdForNewSession) {
        try {
          const updatedSession = await updateSessionProject(
            activeSessionId,
            projectIdForNewSession
          )

          setSelectedProjectId(updatedSession.projectId)
          nextPermissionMode = updatedSession.permissionMode
          setPendingProjectId(null)
        } catch {
          toast.error(t.studioLocalProjectBindFailed)
        }
      } else if (!sessionId) {
        setSelectedProjectId(null)
        setPendingProjectId(null)
      }

      if (
        !sessionId &&
        selectedPermissionMode !== "ask" &&
        selectedPermissionMode !== nextPermissionMode
      ) {
        try {
          const updatedSession = await updateSessionPermissionMode(
            activeSessionId,
            selectedPermissionMode
          )

          nextPermissionMode = updatedSession.permissionMode
        } catch {
          toast.error(t.requestFailed)
        }
      }

      setSelectedPermissionMode(nextPermissionMode)

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
        selectedReasoningEffort,
        resolvedRuntimeId,
        resolvedEnvironment
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
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1">
        {hasMessages ? (
          <ChatContainerRoot className="h-full min-h-0">
            <ChatContainerContent className="mx-auto flex min-h-full w-full max-w-5xl gap-6 px-8 py-10">
              {visibleMessages.map((message) => (
                <ChatMessageBubble
                  key={message.id}
                  message={message}
                  onRetry={handleRetryMessage}
                  onPermissionDecision={handlePermissionDecision}
                />
              ))}

              {isStarting && !hasStreamingMessage ? (
                <div className="flex w-full justify-start">
                  <Shimmer className="text-sm">{t.studioThinking}</Shimmer>
                </div>
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
                {t.studioChatGreeting(greetingPeriod)}
              </h1>
              <ChatComposer
                value={input}
                model={selectedModel}
                runtimeId={resolvedRuntimeId}
                runtimeInfos={runtimeInfos}
                reasoningEffort={selectedReasoningEffort}
                permissionMode={selectedPermissionMode}
                localProjects={localProjects}
                selectedProjectId={selectedProjectId}
                environment={selectedEnvironment}
                attachments={pendingAttachments}
                onModelChange={setSelectedModel}
                onRuntimeChange={setSelectedRuntimeId}
                onEnvironmentChange={setSelectedEnvironment}
                onReasoningEffortChange={setSelectedReasoningEffort}
                onPermissionModeChange={handlePermissionModeChange}
                onProjectChange={handleProjectChange}
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
              runtimeId={resolvedRuntimeId}
              runtimeInfos={runtimeInfos}
              reasoningEffort={selectedReasoningEffort}
              permissionMode={selectedPermissionMode}
              localProjects={localProjects}
              selectedProjectId={selectedProjectId}
              environment={selectedEnvironment}
              attachments={pendingAttachments}
              onModelChange={setSelectedModel}
              onRuntimeChange={setSelectedRuntimeId}
              onEnvironmentChange={setSelectedEnvironment}
              onReasoningEffortChange={setSelectedReasoningEffort}
              onPermissionModeChange={handlePermissionModeChange}
              onProjectChange={handleProjectChange}
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
  runtimeId: string
  runtimeInfos: ChatRuntimeOption[]
  reasoningEffort: ChatReasoningEffort
  permissionMode: StudioPermissionMode
  localProjects: StudioLocalProjectWithGitInfo[]
  selectedProjectId: string | null
  environment: ChatRunEnvironment
  attachments: PendingAttachment[]
  onModelChange: (model: SupportedChatModel) => void
  onRuntimeChange: (runtimeId: string) => void
  onEnvironmentChange: (environment: ChatRunEnvironment) => void
  onReasoningEffortChange: (effort: ChatReasoningEffort) => void
  onPermissionModeChange: (permissionMode: StudioPermissionMode) => void
  onProjectChange: (projectId: string | null) => void
  onValueChange: (value: string) => void
  onAddFiles: (files: FileList | null) => void
  onRemoveAttachment: (id: string) => void
  onSubmit: () => void
  onStop: () => void
  canSubmit: boolean
  isBusy: boolean
}

function OptionInfoTooltip({ description }: { description: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={description}
          className="ml-auto mr-4 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/65 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          tabIndex={0}
        >
          <RiInformationLine aria-hidden className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        sideOffset={8}
        className="max-w-56 whitespace-normal text-left leading-5"
      >
        {description}
      </TooltipContent>
    </Tooltip>
  )
}

function SelectOptionRow({
  description,
  icon,
  label,
  meta,
}: {
  description: string
  icon?: React.ReactNode
  label: string
  meta?: string
}) {
  return (
    <span className="flex w-full min-w-0 items-center gap-2">
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? (
        <span className="max-w-40 truncate text-xs font-normal text-muted-foreground">
          {meta}
        </span>
      ) : null}
      <OptionInfoTooltip description={description} />
    </span>
  )
}

function getRuntimeGuideDescription(
  runtimeId: string,
  fallback: string,
  t: ReturnType<typeof useI18n>["t"]
) {
  switch (runtimeId) {
    case DEFAULT_CHAT_RUNTIME_ID:
      return t.studioAgentRuntimeAstraflowDescription
    case "codex":
      return t.studioAgentRuntimeCodexDescription
    case "claude-code":
      return t.studioAgentRuntimeClaudeCodeDescription
    case "opencode":
      return t.studioAgentRuntimeOpenCodeDescription
    default:
      return fallback || t.studioAgentRuntimeDescription
  }
}

function getReasoningEffortDescription(
  effort: ChatReasoningEffort,
  t: ReturnType<typeof useI18n>["t"]
) {
  switch (effort) {
    case "none":
      return t.studioReasoningNoneDescription
    case "enabled":
      return t.studioReasoningEnabledDescription
    case "minimal":
      return t.studioReasoningMinimalDescription
    case "low":
      return t.studioReasoningLowDescription
    case "medium":
      return t.studioReasoningMediumDescription
    case "high":
      return t.studioReasoningHighDescription
    case "xhigh":
      return t.studioReasoningXHighDescription
    case "max":
      return t.studioReasoningMaxDescription
  }
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

function ChatComposerPluginsButton() {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const [enabledCount, setEnabledCount] = React.useState(0)

  const refreshInstalledSkills = React.useCallback(() => {
    void Promise.allSettled([
      listInstalledSkillsForComposer(),
      listInstalledMcpForComposer(),
    ])
      .then(([skillsResult, mcpResult]) => {
        const skillCount =
          skillsResult.status === "fulfilled"
            ? skillsResult.value.filter((skill) => skill.enabled).length
            : 0
        const mcpCount =
          mcpResult.status === "fulfilled"
            ? mcpResult.value.filter((server) => server.enabled).length
            : 0

        setEnabledCount(skillCount + mcpCount)
      })
      .catch(() => setEnabledCount(0))
  }, [])

  React.useEffect(() => {
    queueMicrotask(refreshInstalledSkills)
  }, [refreshInstalledSkills])

  React.useEffect(() => {
    if (open) {
      queueMicrotask(refreshInstalledSkills)
    }
  }, [open, refreshInstalledSkills])

  React.useEffect(() => {
    function handleProjectChanged() {
      queueMicrotask(refreshInstalledSkills)
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [refreshInstalledSkills])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)

        if (!nextOpen) {
          queueMicrotask(refreshInstalledSkills)
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 rounded-full px-2.5 text-sm font-medium"
        onClick={() => setOpen(true)}
      >
        <span>{t.studioComposerPlugins}</span>
        <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px] leading-none font-semibold text-foreground/75 ring-1 ring-foreground/10">
          {enabledCount}
        </span>
      </Button>

      <DialogContent
        className="flex h-[min(76vh,720px)] w-[min(86vw,1180px)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border bg-background p-0 shadow-2xl sm:max-w-none"
        overlayClassName="bg-slate-950/16 backdrop-blur-[1px]"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 flex-row items-center justify-between gap-4 border-b bg-background px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-lg">{t.skills}</DialogTitle>
            <DialogDescription className="sr-only">
              {t.studioComposerPluginsDescription}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              className="shrink-0 rounded-full"
            >
              <RiCloseLine aria-hidden />
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          <SkillsMarketPage embedded initialView="mine" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ChatComposer({
  value,
  model,
  runtimeId,
  runtimeInfos,
  reasoningEffort,
  permissionMode,
  localProjects,
  selectedProjectId,
  environment,
  attachments,
  onModelChange,
  onRuntimeChange,
  onEnvironmentChange,
  onReasoningEffortChange,
  onPermissionModeChange,
  onProjectChange,
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
  const permissionLabelByValue: Record<StudioPermissionMode, string> = {
    auto: t.studioPermissionAuto,
    ask: t.studioPermissionAsk,
    readonly: t.studioPermissionReadonly,
  }
  const permissionOptions: Array<{
    value: StudioPermissionMode
    label: string
    icon: typeof Zap
    description: string
  }> = [
    {
      value: "auto",
      label: permissionLabelByValue.auto,
      icon: Zap,
      description: t.studioPermissionAutoDescription,
    },
    {
      value: "ask",
      label: permissionLabelByValue.ask,
      icon: Hand,
      description: t.studioPermissionAskDescription,
    },
    {
      value: "readonly",
      label: permissionLabelByValue.readonly,
      icon: Eye,
      description: t.studioPermissionReadonlyDescription,
    },
  ]
  const permissionModeOption =
    permissionOptions.find((option) => option.value === permissionMode) ??
    permissionOptions[0]
  const PermissionModeIcon = permissionModeOption.icon
  const resolvedReasoningEffort = resolveChatReasoningEffort(
    model,
    reasoningEffort
  )
  const reasoningOptions = getChatReasoningEfforts(model).map((effort) => ({
    value: effort,
    label: reasoningLabelByValue[effort],
    description: getReasoningEffortDescription(effort, t),
  }))
  const reasoningEffortLabel =
    reasoningOptions.find((option) => option.value === resolvedReasoningEffort)
      ?.label ?? reasoningLabelByValue[resolvedReasoningEffort]
  const selectedRuntimeInfo =
    runtimeInfos.find((runtime) => runtime.id === runtimeId) ??
    FALLBACK_CHAT_RUNTIME_INFO
  const showPermissionMode = supportsPermissionMode(runtimeId, runtimeInfos)
  const selectedProject =
    localProjects.find((project) => project.id === selectedProjectId) ?? null
  const selectedProjectValue = selectedProject?.id ?? PROJECT_NONE_VALUE
  const isAstraflowRuntime = runtimeId === DEFAULT_CHAT_RUNTIME_ID
  const hasAstraflowRuntime = runtimeInfos.some(
    (runtime) => runtime.id === DEFAULT_CHAT_RUNTIME_ID
  )
  // The AstraFlow Agent can run in the remote sandbox or on this machine;
  // other runtimes (Codex, Claude Code, ...) always run locally.
  const runtimeEnvironment = isAstraflowRuntime ? environment : "local"
  const runtimeDescription = getRuntimeGuideDescription(
    runtimeId,
    selectedRuntimeInfo.description,
    t
  )

  function handleEnvironmentChange(nextValue: string) {
    if (nextValue === runtimeEnvironment) {
      return
    }

    if (nextValue === "remote") {
      if (!isAstraflowRuntime && hasAstraflowRuntime) {
        onRuntimeChange(DEFAULT_CHAT_RUNTIME_ID)
      }

      onEnvironmentChange("remote")
      return
    }

    if (isAstraflowRuntime) {
      onEnvironmentChange("local")
    }
  }

  function handleProjectValueChange(nextValue: string) {
    onProjectChange(nextValue === PROJECT_NONE_VALUE ? null : nextValue)
  }

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
    <div
      data-tour-id="studio-composer"
      className="flex w-full flex-col overflow-hidden rounded-[1.875rem] bg-muted/40 p-0.5 shadow-lg shadow-foreground/5"
    >
      <PromptInput
        value={value}
        onValueChange={onValueChange}
        onSubmit={onSubmit}
        isLoading={isBusy}
        className="w-full rounded-[1.625rem] border bg-background/95 px-3.5 py-3 shadow-sm"
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
                  attachment.type === "image"
                    ? "size-16"
                    : "h-16 w-52 max-w-full"
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
            {showPermissionMode ? (
              <Select
                value={permissionMode}
                onValueChange={(nextValue) =>
                  onPermissionModeChange(nextValue as StudioPermissionMode)
                }
                disabled={isBusy}
              >
                <SelectTrigger
                  data-tour-id="studio-composer-permission"
                  size="sm"
                  className="h-8 max-w-44 rounded-full border-transparent bg-transparent px-2.5 text-sm shadow-none hover:bg-muted/60 sm:max-w-48"
                  aria-label={t.studioPermissionMode}
                  title={permissionModeOption.description}
                >
                  <PermissionModeIcon aria-hidden className="size-4" />
                  <span className="truncate">{permissionModeOption.label}</span>
                </SelectTrigger>
                <SelectContent position="popper" side="top" align="start">
                  <SelectGroup>
                    {permissionOptions.map((option) => {
                      const Icon = option.icon

                      return (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          className="pr-10"
                        >
                          <SelectOptionRow
                            description={option.description}
                            icon={
                              <Icon
                                aria-hidden
                                className="size-4 text-muted-foreground"
                              />
                            }
                            label={option.label}
                          />
                        </SelectItem>
                      )
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
            <ChatComposerPluginsButton />
          </div>

          <PromptInputActions
            className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
            onClick={(event) => event.stopPropagation()}
          >
            <Select
              value={runtimeId}
              onValueChange={onRuntimeChange}
              disabled={isBusy}
            >
              <SelectTrigger
                data-tour-id="studio-composer-runtime"
                size="sm"
                className="h-8 max-w-44 rounded-full bg-background px-3 text-sm sm:max-w-52"
                aria-label={t.studioAgentRuntime}
                title={runtimeDescription}
              >
                <AgentRuntimeIcon runtimeId={runtimeId} />
                <span className="truncate">
                  {getChatRuntimeLabel(runtimeId, runtimeInfos)}
                </span>
              </SelectTrigger>
              <SelectContent position="popper" side="top" align="end">
                <SelectGroup>
                  {runtimeInfos.map((runtime) => (
                    <SelectItem
                      key={runtime.id}
                      value={runtime.id}
                      textValue={runtime.label}
                      title={getRuntimeGuideDescription(
                        runtime.id,
                        runtime.description,
                        t
                      )}
                      className="pr-10"
                    >
                      <SelectOptionRow
                        description={getRuntimeGuideDescription(
                          runtime.id,
                          runtime.description,
                          t
                        )}
                        icon={<AgentRuntimeIcon runtimeId={runtime.id} />}
                        label={runtime.label}
                      />
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select
              value={model}
              onValueChange={(nextValue) =>
                onModelChange(nextValue as SupportedChatModel)
              }
              disabled={isBusy}
            >
              <SelectTrigger
                data-tour-id="studio-composer-model"
                size="sm"
                className="h-8 max-w-40 rounded-full bg-background px-3 text-sm sm:max-w-48"
                aria-label={t.studioChatModel}
                title={t.studioChatModelDescription}
              >
                <span className="truncate">{getChatModelLabel(model)}</span>
              </SelectTrigger>
              <SelectContent position="popper" side="top" align="end">
                <SelectGroup>
                  {CHAT_MODEL_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="pr-10"
                    >
                      <SelectOptionRow
                        description={t.studioChatModelDescription}
                        label={option.label}
                      />
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
                title={
                  reasoningOptions.find(
                    (option) => option.value === resolvedReasoningEffort
                  )?.description
                }
              >
                <RiBrainLine aria-hidden className="size-4" />
                <span>{reasoningEffortLabel}</span>
              </SelectTrigger>
              <SelectContent position="popper" side="top" align="end">
                <SelectGroup>
                  {reasoningOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="pr-10"
                    >
                      <SelectOptionRow
                        description={option.description}
                        label={option.label}
                      />
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

      <div className="flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-sm text-muted-foreground">
        <Select
          value={selectedProjectValue}
          onValueChange={handleProjectValueChange}
          disabled={isBusy}
        >
          <SelectTrigger
            data-tour-id="studio-composer-project"
            size="sm"
            className="h-7 w-fit max-w-56 rounded-lg border-transparent bg-transparent px-2 text-sm shadow-none hover:bg-muted/70"
            aria-label={t.studioLocalProjectSelect}
            title={
              selectedProject
                ? t.studioLocalProjectBoundDescription(selectedProject.path)
                : t.studioLocalProjectNoneDescription
            }
          >
            <FolderGit2 aria-hidden className="size-4" />
            <span
              className={cn(
                "truncate",
                selectedProject && "font-medium text-foreground"
              )}
            >
              {selectedProject
                ? selectedProject.name
                : t.studioLocalProjectSelect}
            </span>
          </SelectTrigger>
          <SelectContent position="popper" side="top" align="start">
            <SelectGroup>
              <SelectItem value={PROJECT_NONE_VALUE} className="pr-10">
                <SelectOptionRow
                  description={t.studioLocalProjectNoneDescription}
                  icon={
                    <FolderGit2
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  }
                  label={t.studioLocalProjectNone}
                />
              </SelectItem>
              {localProjects.length > 0 ? (
                localProjects.map((project) => (
                  <SelectItem
                    key={project.id}
                    value={project.id}
                    textValue={project.name}
                    title={project.path}
                    className="pr-10"
                  >
                    <SelectOptionRow
                      description={t.studioLocalProjectBoundDescription(
                        project.path
                      )}
                      icon={
                        <FolderGit2
                          aria-hidden
                          className="size-4 text-muted-foreground"
                        />
                      }
                      label={project.name}
                      meta={[
                        t.studioLocalProjectLocal,
                        project.git.branch,
                        project.git.isDirty ? t.studioLocalProjectDirty : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="__empty__" disabled>
                  {t.studioLocalProjectEmpty}
                </SelectItem>
              )}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          value={runtimeEnvironment}
          onValueChange={handleEnvironmentChange}
          disabled={isBusy}
        >
          <SelectTrigger
            data-tour-id="studio-composer-environment"
            size="sm"
            className="h-7 w-fit rounded-lg border-transparent bg-transparent px-2 text-sm shadow-none hover:bg-muted/70"
            aria-label={t.studioProjectEnvironment}
            title={
              runtimeEnvironment === "remote"
                ? t.studioLocalProjectRemoteDescription
                : t.studioLocalProjectLocalDescription
            }
          >
            <Globe aria-hidden className="size-4" />
            <span>
              {runtimeEnvironment === "remote"
                ? t.studioLocalProjectRemote
                : t.studioLocalProjectLocal}
            </span>
          </SelectTrigger>
          <SelectContent position="popper" side="top" align="start">
            <SelectGroup>
              <SelectItem
                value="remote"
                disabled={!hasAstraflowRuntime}
                className="pr-10"
              >
                <SelectOptionRow
                  description={t.studioLocalProjectRemoteDescription}
                  icon={
                    <Globe
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  }
                  label={t.studioLocalProjectRemote}
                />
              </SelectItem>
              <SelectItem
                value="local"
                disabled={!isAstraflowRuntime}
                className="pr-10"
              >
                <SelectOptionRow
                  description={t.studioLocalProjectLocalDescription}
                  icon={
                    <Globe
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  }
                  label={t.studioLocalProjectLocal}
                />
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        {selectedProject?.git.branch ? (
          <span
            className="flex min-w-0 items-center gap-1.5 px-2"
            title={
              selectedProject.git.isDirty
                ? `${selectedProject.git.branch} · ${t.studioLocalProjectDirty}`
                : selectedProject.git.branch
            }
          >
            <GitBranch aria-hidden className="size-4" />
            <span className="max-w-32 truncate">
              {selectedProject.git.branch}
            </span>
            {selectedProject.git.isDirty ? (
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-amber-500"
              />
            ) : null}
          </span>
        ) : null}

      </div>
    </div>
  )
}

const ChatMessageBubble = React.memo(function ChatMessageBubble({
  message,
  onPermissionDecision,
  onRetry,
}: {
  message: StudioMessage
  onPermissionDecision: (
    requestId: string,
    option: StudioPermissionOption,
    status: Extract<StudioMessagePart, { type: "permission" }>["status"]
  ) => void
  onRetry: (message: StudioMessage) => void
}) {
  if (message.role === "user") {
    return (
      <Message className="justify-end">
        <div className="flex max-w-[70%] flex-col items-end gap-2">
          {message.attachments.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2">
              {message.attachments.map((attachment) => {
                const attachmentKey = getAttachmentRenderKey(attachment)

                return attachment.type === "image" && attachment.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={attachmentKey}
                    src={attachment.dataUrl}
                    alt={attachment.name}
                    className="max-h-60 max-w-full rounded-2xl border object-contain"
                  />
                ) : (
                  <FileAttachmentChip
                    key={attachmentKey}
                    attachment={attachment}
                  />
                )
              })}
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
      onPermissionDecision={onPermissionDecision}
      onRetry={onRetry}
    />
  )
})

const markdownClassName =
  "prose-sm max-w-none leading-7 text-foreground dark:prose-invert prose-headings:font-heading prose-headings:text-foreground prose-h1:text-xl prose-h2:mt-4 prose-h2:text-lg prose-h3:mt-3 prose-h3:text-base prose-p:my-2 prose-a:text-primary prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-pre:my-3 prose-table:my-3 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2"

const reasoningMarkdownClassName =
  "max-w-none leading-6 prose-p:my-2 prose-headings:my-2 prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-pre:my-3"

const assistantTraceContainerClassName = "not-prose my-0 text-muted-foreground"

const assistantTraceTriggerClassName =
  "min-h-7 max-w-full text-sm leading-6 [&>div]:min-w-0 [&>div]:gap-2 [&>div>span:last-child]:min-w-0"

const assistantTraceLabelClassName = "block max-w-full truncate leading-6"

const streamingPulseDotClassName =
  "[&>*:last-child]:after:ml-1.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:size-2.5 [&>*:last-child]:after:translate-y-[1px] [&>*:last-child]:after:rounded-full [&>*:last-child]:after:bg-foreground [&>*:last-child]:after:align-middle [&>*:last-child]:after:content-[''] [&>*:last-child]:after:animate-[studio-pulse-dot_1.1s_ease-in-out_infinite]"

const fileToolNames = new Set([
  "upload_file",
  "list_files",
  "read_file",
  "write_file",
  "download_file",
  "ls",
  "edit_file",
  "glob",
  "grep",
])

const commandToolNames = new Set(["run_command", "execute"])

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
        {isStreaming ? <Shimmer as="span">{t.studioThinking}</Shimmer> : label}
      </ReasoningTrigger>
      <ReasoningContent
        markdown
        className="ml-1.75 border-l border-l-border/70 pb-1 pl-6"
        contentClassName={reasoningMarkdownClassName}
      >
        {content}
      </ReasoningContent>
    </Reasoning>
  )
}

function AssistantPlan({
  todos,
}: {
  todos: Extract<StudioMessagePart, { type: "plan" }>["todos"]
}) {
  if (todos.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        assistantTraceContainerClassName,
        "rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm text-foreground"
      )}
    >
      <ul className="flex flex-col gap-1.5">
        {todos.map((todo) => (
          <li
            key={`${todo.status}-${todo.text}`}
            className={cn(
              "flex min-w-0 items-start gap-2",
              todo.status === "completed" && "text-muted-foreground",
              todo.status === "in_progress" && "text-primary"
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                todo.status === "completed" &&
                  "border-primary bg-primary text-primary-foreground",
                todo.status === "in_progress" &&
                  "border-primary bg-primary/10 text-primary",
                todo.status === "pending" && "border-border bg-background"
              )}
            >
              {todo.status === "completed" ? (
                <RiCheckLine aria-hidden className="size-3" />
              ) : todo.status === "in_progress" ? (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-primary"
                />
              ) : null}
            </span>
            <span
              className={cn(
                "min-w-0 leading-5",
                todo.status === "completed" &&
                  "line-through decoration-muted-foreground/70"
              )}
            >
              {todo.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function getPermissionDecisionStatus(option: StudioPermissionOption) {
  return option.kind.startsWith("allow")
    ? ("approved" as const)
    : ("denied" as const)
}

function getPermissionStatusLabel(
  status: Extract<StudioMessagePart, { type: "permission" }>["status"],
  t: ReturnType<typeof useI18n>["t"]
) {
  switch (status) {
    case "approved":
      return t.studioPermissionApproved
    case "denied":
      return t.studioPermissionDenied
    case "cancelled":
      return t.studioPermissionCancelled
    case "pending":
      return t.studioPermissionPending
  }
}

function AssistantPermissionCard({
  part,
  onDecision,
}: {
  part: Extract<StudioMessagePart, { type: "permission" }>
  onDecision: (
    requestId: string,
    option: StudioPermissionOption,
    status: Extract<StudioMessagePart, { type: "permission" }>["status"]
  ) => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = React.useState(false)
  const input = part.input.trim()
  const selectedOption = part.options.find(
    (option) => option.optionId === part.selectedOptionId
  )
  const showToggle = input.length > 320 || input.split(/\r?\n/).length > 4

  return (
    <div
      className={cn(
        assistantTraceContainerClassName,
        "rounded-xl border border-border/70 bg-card px-3 py-3 text-sm text-foreground shadow-sm"
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-muted-foreground uppercase">
            {t.studioPermissionRequested}
          </div>
          <div className="mt-0.5 truncate font-medium">{part.toolName}</div>
        </div>
        <Badge
          variant={
            part.status === "denied" || part.status === "cancelled"
              ? "destructive"
              : part.status === "approved"
                ? "secondary"
                : "outline"
          }
        >
          {getPermissionStatusLabel(part.status, t)}
        </Badge>
      </div>

      <div className="mt-3 min-w-0">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t.studioPermissionInput}
        </div>
        <pre
          className={cn(
            "min-w-0 overflow-x-auto rounded-lg bg-muted/60 px-2.5 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground",
            !expanded && "max-h-24 overflow-hidden"
          )}
        >
          {input || t.studioPermissionNoInput}
        </pre>
        {showToggle ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-7 rounded-lg px-2 text-xs"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? t.showLess : t.showMore}
          </Button>
        ) : null}
      </div>

      {part.status === "pending" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {part.options.map((option) => (
            <Button
              key={option.optionId}
              type="button"
              variant={
                option.kind.startsWith("reject")
                  ? "destructive"
                  : option.kind === "allow_always"
                    ? "default"
                    : "outline"
              }
              size="sm"
              className="h-8 rounded-xl"
              onClick={() =>
                onDecision(part.id, option, getPermissionDecisionStatus(option))
              }
            >
              {option.name || option.optionId}
            </Button>
          ))}
        </div>
      ) : selectedOption ? (
        <div className="mt-3 text-xs text-muted-foreground">
          {selectedOption.name || selectedOption.optionId}
        </div>
      ) : null}
    </div>
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

function formatGenericToolActivityLabel({
  running,
  toolName,
  t,
}: {
  running: boolean
  toolName: string
  t: ReturnType<typeof useI18n>["t"]
}) {
  const isZh = t.studioThinking === "正在思考"

  if (isZh) {
    return toolName
      ? `${running ? "正在调用工具" : "已调用工具"} ${toolName}`
      : running
        ? "正在调用工具"
        : "已调用工具"
  }

  return toolName
    ? `${running ? "Calling tool" : "Called tool"} ${toolName}`
    : running
      ? "Calling tool"
      : "Called tool"
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
  const fileId = typeof parsed.file_id === "string" ? parsed.file_id.trim() : ""
  const pattern =
    typeof parsed.pattern === "string" ? parsed.pattern.trim() : ""
  const query = typeof parsed.query === "string" ? parsed.query.trim() : ""

  return path || name || fileId || pattern || query || ""
}

function getSandboxHostToolPort(input: string) {
  const parsed = parseToolInputObject(input)

  if (!parsed) {
    return input.trim()
  }

  const port = parsed.port

  return typeof port === "number" || typeof port === "string"
    ? String(port).trim()
    : ""
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

function getSkillToolSlug(input: string) {
  try {
    const parsed = JSON.parse(input) as unknown

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { slug?: unknown }).slug === "string"
    ) {
      return (parsed as { slug: string }).slug.trim()
    }
  } catch {
    // Tool input can be a plain string in streamed events.
  }

  return input.trim()
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

  if (commandToolNames.has(activity.toolName)) {
    const { command } = getRunCommandPayload(activity.input)

    return formatCommandActivityLabel({
      command,
      running: activity.status === "running",
      t,
    })
  }

  if (activity.toolName === "sandbox_get_host") {
    const port = getSandboxHostToolPort(activity.input)

    return activity.status === "running"
      ? t.studioToolResolvingHost(port)
      : t.studioToolResolvedHost(port)
  }

  if (fileToolNames.has(activity.toolName)) {
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

    if (activity.toolName === "ls" || activity.toolName === "glob") {
      return activity.status === "running"
        ? t.studioToolListingFiles(target)
        : t.studioToolListedFiles(target)
    }

    if (activity.toolName === "read_file") {
      return activity.status === "running"
        ? t.studioToolReadingFile(target)
        : t.studioToolReadFile(target)
    }

    if (activity.toolName === "grep") {
      return activity.status === "running"
        ? t.studioToolSearching(target)
        : t.studioToolAnalyzed(target)
    }

    if (
      activity.toolName === "write_file" ||
      activity.toolName === "edit_file"
    ) {
      return activity.status === "running"
        ? t.studioToolWritingFile(target)
        : t.studioToolWroteFile(target)
    }

    return activity.status === "running"
      ? t.studioToolSavingFile(target)
      : t.studioToolSavedFile(target)
  }

  if (activity.toolName === "list_installed_skills") {
    return activity.status === "running"
      ? t.studioToolListingSkills
      : t.studioToolListedSkills
  }

  if (activity.toolName === "list_installed_mcp_servers") {
    return activity.status === "running"
      ? t.studioToolListingMcpServers
      : t.studioToolListedMcpServers
  }

  if (activity.toolName === "load_skill") {
    const slug = getSkillToolSlug(activity.input)

    return activity.status === "running"
      ? t.studioToolLoadingSkill(slug)
      : t.studioToolLoadedSkill(slug)
  }

  if (isMcpToolName(activity.toolName)) {
    const toolName = getMcpToolDisplayName(activity.toolName)

    return activity.status === "running"
      ? t.studioToolCallingMcpTool(toolName)
      : t.studioToolCalledMcpTool(toolName)
  }

  if (activity.toolName === "web_search") {
    const query = getWebSearchQuery(activity.input)

    return activity.status === "running"
      ? t.studioToolSearching(query)
      : t.studioToolAnalyzed(query)
  }

  return formatGenericToolActivityLabel({
    running: activity.status === "running",
    toolName: activity.toolName,
    t,
  })
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

function cleanDetectedUrl(value: string) {
  return value.replace(/[),.;\]]+$/g, "")
}

function extractDetectedUrls(text: string) {
  const seen = new Set<string>()
  const urls: string[] = []

  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/g)) {
    const url = cleanDetectedUrl(match[0])

    if (!seen.has(url)) {
      seen.add(url)
      urls.push(url)
    }
  }

  return urls
}

function extractFencedOutputSection(output: string, label: string) {
  const match = output.match(
    new RegExp(`^${label}:\\n\`\`\`[^\\n]*\\n([\\s\\S]*?)\\n\`\`\``, "m")
  )

  return match?.[1]?.trim() ?? ""
}

function extractPlainOutputSection(output: string, label: string) {
  const marker = `${label}:\n`
  const start = output.indexOf(marker)

  if (start < 0) {
    return ""
  }

  const rest = output.slice(start + marker.length)
  const nextSection = rest.search(/\n\n(?:STDOUT|STDERR|RESULTS|ERROR):\n/)

  return (nextSection >= 0 ? rest.slice(0, nextSection) : rest).trim()
}

function parseSandboxToolOutput(output: string) {
  const sectionStart = output.search(/\n\n(?:STDOUT|STDERR|RESULTS|ERROR):\n/)
  const prelude = (
    sectionStart >= 0 ? output.slice(0, sectionStart) : output
  ).trim()
  const fields = new Map<string, string>()
  const title =
    prelude
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.includes(":")) ?? ""

  for (const line of prelude.split("\n")) {
    const match = line.match(/^([^:\n]{2,48}):\s*(.+)$/)

    if (match) {
      fields.set(match[1].trim(), match[2].trim())
    }
  }

  const stdout = extractFencedOutputSection(output, "STDOUT")
  const stderr = extractFencedOutputSection(output, "STDERR")
  const results =
    extractFencedOutputSection(output, "RESULTS") ||
    extractPlainOutputSection(output, "RESULTS")
  const error =
    extractFencedOutputSection(output, "ERROR") ||
    extractPlainOutputSection(output, "ERROR")
  const urls = extractDetectedUrls(output)
  const explicitUrl = fields.get("URL")
  const primaryUrl =
    explicitUrl && /^https?:\/\//i.test(explicitUrl)
      ? cleanDetectedUrl(explicitUrl)
      : (urls[0] ?? null)
  const fieldEntries = [
    "Runtime template",
    "Sandbox ID",
    "Working directory",
    "Exit code",
    "Auto pause",
    "Port",
    "Host",
    "URL",
    "WebSocket URL",
  ]
    .map((label) => [label, fields.get(label)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))

  return {
    title,
    fieldEntries,
    stdout,
    stderr,
    results,
    error,
    primaryUrl,
    isSandboxOutput:
      title.startsWith("AstraFlow Sandbox") ||
      title === "Sandbox host resolved.",
  }
}

function SandboxPreviewCard({ url }: { url: string }) {
  const { t } = useI18n()

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <RiExternalLinkLine
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">
              {t.studioSandboxPreview}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {url}
            </span>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="rounded-2xl">
          <a href={url} target="_blank" rel="noreferrer">
            <RiExternalLinkLine aria-hidden />
            <span>{t.studioSandboxOpenPreview}</span>
          </a>
        </Button>
      </div>
      <div className="h-[min(60vh,420px)] bg-white">
        <iframe
          title={t.studioSandboxPreview}
          src={url}
          className="size-full border-0 bg-white"
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
        />
      </div>
    </div>
  )
}

function SandboxOutputSection({
  title,
  content,
  tone = "default",
}: {
  title: string
  content: string
  tone?: "default" | "destructive"
}) {
  if (!content.trim()) {
    return null
  }

  return (
    <CodeBlock
      className={cn(
        "rounded-2xl shadow-sm",
        tone === "destructive" && "border-destructive/30"
      )}
    >
      <CodeBlockGroup
        className={cn(
          "gap-3 border-b bg-muted/40 px-3 py-2",
          tone === "destructive" && "bg-destructive/5"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <RiCodeLine
            aria-hidden
            className={cn(
              "size-4 text-muted-foreground",
              tone === "destructive" && "text-destructive"
            )}
          />
          <span
            className={cn(
              "truncate text-sm font-medium",
              tone === "destructive" && "text-destructive"
            )}
          >
            {title}
          </span>
        </div>
      </CodeBlockGroup>
      <CodeBlockCode code={content} language="text" />
    </CodeBlock>
  )
}

function SandboxToolOutput({ output }: { output: string }) {
  const { t } = useI18n()
  const parsed = parseSandboxToolOutput(output)
  const hasStructuredOutput =
    parsed.isSandboxOutput ||
    parsed.primaryUrl ||
    parsed.stdout ||
    parsed.stderr ||
    parsed.results ||
    parsed.error

  if (!hasStructuredOutput) {
    return (
      <MessageContent
        markdown
        className={cn("bg-transparent p-0", markdownClassName)}
      >
        {output}
      </MessageContent>
    )
  }

  return (
    <div className="space-y-3">
      {parsed.fieldEntries.length > 0 ? (
        <div className="rounded-2xl border bg-card p-3 shadow-sm">
          <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
            {t.studioSandboxDetails}
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {parsed.fieldEntries.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd
                  className="truncate font-mono text-foreground"
                  title={value}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {parsed.primaryUrl ? (
        <SandboxPreviewCard url={parsed.primaryUrl} />
      ) : null}

      <SandboxOutputSection
        title={t.studioSandboxStdout}
        content={parsed.stdout}
      />
      <SandboxOutputSection
        title={t.studioSandboxResults}
        content={parsed.results}
      />
      <SandboxOutputSection
        title={t.studioSandboxStderr}
        content={parsed.stderr}
        tone="destructive"
      />
      <SandboxOutputSection
        title={t.studioSandboxError}
        content={parsed.error}
        tone="destructive"
      />
    </div>
  )
}

function getActivityFailureOutput(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  if (activity.status !== "error") {
    return ""
  }

  const explicitError = activity.error?.trim()

  if (explicitError) {
    return explicitError
  }

  const output = activity.output.trim()

  if (!output) {
    return t.studioToolError
  }

  const parsed = parseSandboxToolOutput(output)

  return parsed.error || parsed.stderr || output
}

function ToolFailureDetails({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const { t } = useI18n()
  const output = getActivityFailureOutput(activity, t)

  return (
    <div className="space-y-2 border-l pl-3">
      <div className="text-xs font-semibold text-destructive uppercase">
        {t.studioToolError}
      </div>
      {output ? (
        <SandboxToolOutput output={output} />
      ) : (
        <div className="text-sm text-muted-foreground">
          {t.studioToolNoOutput}
        </div>
      )}
    </div>
  )
}

function InlineToolActivity({
  activity,
  leftIcon,
}: {
  activity: StudioMessageActivity
  leftIcon: React.ReactNode
}) {
  const { t } = useI18n()
  const failed = activity.status === "error"

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        defaultOpen={failed}
        disabled={!failed}
      >
        <ChainOfThoughtTrigger
          className={cn(
            assistantTraceTriggerClassName,
            !failed && "cursor-default"
          )}
          leftIcon={leftIcon}
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>
        {failed ? (
          <ChainOfThoughtContent>
            <ToolFailureDetails activity={activity} />
          </ChainOfThoughtContent>
        ) : null}
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function FileToolActivity({ activity }: { activity: StudioMessageActivity }) {
  return (
    <InlineToolActivity
      activity={activity}
      leftIcon={
        activity.status === "complete" ? (
          <RiCheckLine aria-hidden className="size-4" />
        ) : (
          <RiFileTextLine aria-hidden className="size-4" />
        )
      }
    />
  )
}

function GenericToolActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const output =
    activity.status === "error"
      ? getActivityFailureOutput(activity, t)
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
          <div className="space-y-2 border-l pl-3">
            {activity.input.trim() ? (
              <CodeBlock className="rounded-2xl shadow-sm">
                <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <RiTerminalLine
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                    <span className="truncate text-sm font-medium">
                      {t.input} · {activity.toolName}
                    </span>
                  </div>
                </CodeBlockGroup>
                <CodeBlockCode code={activity.input} language="json" />
              </CodeBlock>
            ) : null}

            {activity.status === "running" ? null : output ? (
              <>
                <div
                  className={cn(
                    "text-xs font-semibold uppercase",
                    activity.status === "error"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {activity.status === "error" ? t.studioToolError : t.output}
                </div>
                <SandboxToolOutput output={output} />
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                {t.studioToolNoOutput}
              </div>
            )}
          </div>
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function RunCommandActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const payload = getRunCommandPayload(activity.input)
  const output =
    activity.status === "error"
      ? getActivityFailureOutput(activity, t)
      : activity.output.trim()
  const defaultOpen =
    activity.status === "running" || activity.status === "error"

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
              <div
                className={cn(
                  "text-xs font-semibold uppercase",
                  activity.status === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {activity.status === "error" ? t.studioToolError : t.output}
              </div>
              {output ? (
                <SandboxToolOutput output={output} />
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
      ? getActivityFailureOutput(activity, t)
      : activity.output.trim()
  const lifecycleLabel =
    payload.autoPause === null
      ? null
      : payload.autoPause
        ? t.studioToolAutoPause
        : t.studioToolKillAfterRun
  const defaultOpen =
    activity.status === "running" || activity.status === "error"

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
              <div
                className={cn(
                  "text-xs font-semibold uppercase",
                  activity.status === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {activity.status === "error" ? t.studioToolError : t.output}
              </div>
              {output ? (
                <SandboxToolOutput output={output} />
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

function SandboxHostActivity({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const { t } = useI18n()
  const output =
    activity.status === "error"
      ? getActivityFailureOutput(activity, t)
      : activity.output.trim()
  const defaultOpen =
    activity.status === "running" ||
    activity.status === "error" ||
    Boolean(output)

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
              <RiExternalLinkLine aria-hidden className="size-4" />
            ) : (
              <RiTerminalLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          {activity.status === "running" ? null : output ? (
            <div className="space-y-2 border-l pl-3">
              <div
                className={cn(
                  "text-xs font-semibold uppercase",
                  activity.status === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {activity.status === "error" ? t.studioToolError : t.output}
              </div>
              <SandboxToolOutput output={output} />
            </div>
          ) : (
            <div className="border-l pl-3 text-sm text-muted-foreground">
              {t.studioToolNoOutput}
            </div>
          )}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function AssistantActivity({ activity }: { activity: StudioMessageActivity }) {
  if (activity.toolName === "run_code") {
    return <RunCodeActivity activity={activity} />
  }

  if (commandToolNames.has(activity.toolName)) {
    return <RunCommandActivity activity={activity} />
  }

  if (activity.toolName === "sandbox_get_host") {
    return <SandboxHostActivity activity={activity} />
  }

  if (fileToolNames.has(activity.toolName)) {
    return <FileToolActivity activity={activity} />
  }

  if (
    activity.toolName === "list_installed_skills" ||
    activity.toolName === "list_installed_mcp_servers" ||
    activity.toolName === "load_skill"
  ) {
    return (
      <InlineToolActivity
        activity={activity}
        leftIcon={
          activity.status === "complete" ? (
            <RiCheckLine aria-hidden className="size-4" />
          ) : (
            <RiBookOpenLine aria-hidden className="size-4" />
          )
        }
      />
    )
  }

  if (isMcpToolName(activity.toolName)) {
    return (
      <InlineToolActivity
        activity={activity}
        leftIcon={
          activity.status === "complete" ? (
            <RiCheckLine aria-hidden className="size-4" />
          ) : (
            <RiExternalLinkLine aria-hidden className="size-4" />
          )
        }
      />
    )
  }

  if (activity.toolName === "web_search" || activity.toolName === "web_fetch") {
    return (
      <InlineToolActivity
        activity={activity}
        leftIcon={
          activity.status === "complete" ? (
            <RiCheckLine aria-hidden className="size-4" />
          ) : activity.toolName === "web_fetch" ? (
            <RiFileTextLine aria-hidden className="size-4" />
          ) : (
            <RiSearchLine aria-hidden className="size-4" />
          )
        }
      />
    )
  }

  return <GenericToolActivity activity={activity} />
}

const AssistantContentParts = React.memo(function AssistantContentParts({
  content,
  activities,
  onPermissionDecision,
  parts,
  streaming = false,
}: {
  content: string
  activities: StudioMessageActivity[]
  onPermissionDecision: (
    requestId: string,
    option: StudioPermissionOption,
    status: Extract<StudioMessagePart, { type: "permission" }>["status"]
  ) => void
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

        if (part.type === "plan") {
          return <AssistantPlan key={part.id} todos={part.todos} />
        }

        if (part.type === "permission") {
          return (
            <AssistantPermissionCard
              key={part.id}
              part={part}
              onDecision={onPermissionDecision}
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
})

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
            onPermissionDecision={() => undefined}
            parts={activeVersion.parts}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

const AssistantMessage = React.memo(function AssistantMessage({
  message,
  onPermissionDecision,
  onRetry,
}: {
  message: StudioMessage
  onPermissionDecision: (
    requestId: string,
    option: StudioPermissionOption,
    status: Extract<StudioMessagePart, { type: "permission" }>["status"]
  ) => void
  onRetry: (message: StudioMessage) => void
}) {
  const { t } = useI18n()
  const [liked, setLiked] = React.useState<boolean | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [versionsOpen, setVersionsOpen] = React.useState(false)
  const copyableContent = message.content || message.reasoningContent
  const modelLabel = getStoredChatModelLabel(message.model)
  const showTopLevelReasoning = !hasRenderableReasoningParts(message.parts)
  const isStreaming = message.status === "streaming"
  const hasStreamingContent =
    message.content.trim().length > 0 ||
    message.reasoningContent.trim().length > 0 ||
    message.activities.length > 0 ||
    message.parts.length > 0

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
            isStreaming={isStreaming && message.reasoningDurationMs === null}
          />
        ) : null}
        {isStreaming && !hasStreamingContent ? (
          <Shimmer className="text-sm">{t.studioThinking}</Shimmer>
        ) : (
          <AssistantContentParts
            content={message.content}
            activities={message.activities}
            onPermissionDecision={onPermissionDecision}
            parts={message.parts}
            streaming={isStreaming}
          />
        )}
        {!isStreaming ? (
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
                  className={cn(copied && "text-primary")}
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
                  liked === true && "bg-primary/10 text-primary"
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
        ) : null}
        <MessageVersionsDialog
          message={message}
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
        />
      </div>
    </Message>
  )
})

export { StudioChatWorkbench }
