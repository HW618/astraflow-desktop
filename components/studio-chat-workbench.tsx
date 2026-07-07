"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiBrainLine,
  RiCloseLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiFileTextLine,
  RiInformationLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSearchLine,
  RiStopFill,
  RiThumbDownLine,
  RiThumbUpLine,
} from "@remixicon/react"
import {
  Archive,
  Eye,
  File,
  FileImage,
  FileSpreadsheet,
  Folder,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Globe,
  Hand,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreVertical,
  PanelBottom,
  PanelRight,
  SquareTerminal,
  FileText,
  Zap,
} from "lucide-react"
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
import { CodeBlock, CodeBlockCode } from "@/components/prompt-kit/code-block"
import { Markdown } from "@/components/prompt-kit/markdown"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useI18n } from "@/components/i18n-provider"
import {
  StudioTerminalPanel,
  StudioTerminalSurface,
} from "@/components/studio-terminal-panel"
import {
  AssistantReasoning,
  MessagePartsRenderer,
  PendingPermissionApprovalPanel,
  PendingUserInputPanel,
  hasRenderableReasoningParts,
} from "@/components/studio-message-parts-renderer"
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL,
  getChatModelConfig,
  getDefaultChatReasoningEffort,
  getChatReasoningEfforts,
  isChatReasoningEffort,
  isChatReasoningEffortSupported,
  resolveChatReasoningEffort,
  type ChatReasoningEffort,
  type SupportedChatModel,
} from "@/lib/chat-models"
import type {
  AgentModelDefinition,
  AgentModelSettingsPayload,
} from "@/lib/agent-model-settings-shared"
import {
  parseSlashCommandText,
  type PromptMention,
  type SlashCommandDescriptor,
} from "@/lib/agent/composer-types"
import type { AgentRuntimeInfo } from "@/lib/agent/runtime"
import {
  consumePendingProjectId,
  setPendingProjectId,
} from "@/lib/studio-pending-project"
import {
  type InstalledMcpServer,
  type InstalledMcpServersApiResponse,
} from "@/lib/mcp"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import type {
  InstalledSkill,
  InstalledSkillsApiResponse,
} from "@/lib/skill-market"
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
  StudioTokenUsage,
  StudioUserInputAnswer,
} from "@/lib/studio-types"
import {
  dispatchStudioLocalProjectsChanged,
  dispatchStudioSessionsChanged,
  STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
  STUDIO_SESSIONS_CHANGED_EVENT,
} from "@/lib/studio-session-events"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import { cn, createClientId } from "@/lib/utils"
import { useStudioChatRunLiveStream } from "@/hooks/use-studio-chat-run"

type StudioChatWorkbenchProps = {
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

type PendingAttachment = StudioAttachment & { id: string }

type ComposerPopupPlacement = "top" | "bottom"

type StudioOutputFile = {
  path: string
  name: string
}

type ComposerFileMention = {
  kind: "file" | "folder"
  path: string
  relativePath: string
  name: string
}

type ComposerSessionMention = {
  kind: "session"
  sessionId: string
  title: string
}

type ComposerMention = ComposerFileMention | ComposerSessionMention

function serializeComposerMentions(
  mentions: ComposerMention[]
): PromptMention[] {
  return mentions.map((mention) =>
    mention.kind === "session"
      ? {
          kind: "session",
          sessionId: mention.sessionId,
          title: mention.title,
        }
      : {
          kind: mention.kind,
          path: mention.path,
          name: mention.name,
        }
  )
}

type StudioTerminalTab = {
  id: string
  cwd: string | null
  sequence: number
  title: string
  resolvedCwd?: string
}

type StudioRightPanelMode =
  | "launcher"
  | "files"
  | "side-chat"
  | "browser"
  | "browser-settings"
  | "terminal"

type StudioBrowserTab = {
  id: string
  title: string
  address: string
  url: string
}

type StudioWorkspaceBrowserTab = StudioBrowserTab & {
  kind: "browser"
}

type StudioWorkspaceFileTab = {
  id: string
  kind: "files"
  title: string
  entry: AstraFlowSidePanelDirectoryEntry | null
}

type StudioWorkspaceTerminalTab = StudioTerminalTab & {
  kind: "terminal"
}

type StudioWorkspaceSideChatTab = {
  id: string
  kind: "side-chat"
  title: string
}

type StudioWorkspaceTab =
  | StudioWorkspaceBrowserTab
  | StudioWorkspaceFileTab
  | StudioWorkspaceTerminalTab
  | StudioWorkspaceSideChatTab

type StudioSidePanelFilePreview =
  | {
      kind: "text"
      entry: AstraFlowSidePanelDirectoryEntry
      file: AstraFlowSidePanelTextFile
    }
  | {
      kind: "image"
      entry: AstraFlowSidePanelDirectoryEntry
      file: AstraFlowSidePanelDataUrlFile
    }
  | {
      kind: "unsupported"
      entry: AstraFlowSidePanelDirectoryEntry
      error?: string
    }

type StudioSideChatMessage = {
  id: string
  role: "assistant" | "user"
  content: string
}

const MAX_ATTACHMENTS = 6
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const TERMINAL_PANEL_OPEN_STORAGE_KEY = "astraflow.studio.terminal-panel-open"
const RIGHT_PANEL_OPEN_STORAGE_KEY = "astraflow.studio.right-panel-open"
const RIGHT_PANEL_MODE_STORAGE_KEY = "astraflow.studio.right-panel-mode"
const RIGHT_PANEL_WIDTH_STORAGE_KEY = "astraflow.studio.right-panel-width.v2"
const RIGHT_PANEL_DEFAULT_WIDTH = 360
const RIGHT_PANEL_MIN_WIDTH = 300
const RIGHT_PANEL_MAX_WIDTH = 460
const COMPOSER_ICON_ONLY_WIDTH = 650
const TEXT_FILE_EXTENSIONS = new Set([
  "",
  "c",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "env",
  "go",
  "h",
  "htm",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mjs",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
])
const IMAGE_FILE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])

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

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") {
    return fallback
  }

  const stored = window.localStorage.getItem(key)

  if (stored === "true") {
    return true
  }

  if (stored === "false") {
    return false
  }

  return fallback
}

function isStudioRightPanelMode(
  value: string | null
): value is StudioRightPanelMode {
  return (
    value === "launcher" ||
    value === "files" ||
    value === "side-chat" ||
    value === "browser" ||
    value === "browser-settings" ||
    value === "terminal"
  )
}

function readStoredRightPanelMode(): StudioRightPanelMode {
  if (typeof window === "undefined") {
    return "launcher"
  }

  const stored = window.localStorage.getItem(RIGHT_PANEL_MODE_STORAGE_KEY)

  return isStudioRightPanelMode(stored) ? stored : "launcher"
}

function clampRightPanelWidth(value: number) {
  if (!Number.isFinite(value)) {
    return RIGHT_PANEL_DEFAULT_WIDTH
  }

  const viewportMax =
    typeof window === "undefined"
      ? RIGHT_PANEL_MAX_WIDTH
      : Math.min(
          RIGHT_PANEL_MAX_WIDTH,
          Math.max(RIGHT_PANEL_MIN_WIDTH, window.innerWidth - 520)
        )

  return Math.min(viewportMax, Math.max(RIGHT_PANEL_MIN_WIDTH, value))
}

function readStoredRightPanelWidth() {
  if (typeof window === "undefined") {
    return RIGHT_PANEL_DEFAULT_WIDTH
  }

  return clampRightPanelWidth(
    Number(window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY))
  )
}

function useElementWidth<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null)
  const [width, setWidth] = React.useState(0)

  React.useLayoutEffect(() => {
    const element = ref.current

    if (!element) {
      return
    }
    const currentElement = element

    function updateWidth() {
      setWidth(Math.round(currentElement.getBoundingClientRect().width))
    }

    updateWidth()

    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(currentElement)

    return () => resizeObserver.disconnect()
  }, [])

  return [ref, width] as const
}

function useComposerPopupPlacement(
  anchorRef: React.RefObject<HTMLElement | null>,
  open: boolean
) {
  const [placement, setPlacement] =
    React.useState<ComposerPopupPlacement>("bottom")

  React.useLayoutEffect(() => {
    if (!open) {
      return
    }

    function updatePlacement() {
      const anchor = anchorRef.current

      if (!anchor) {
        setPlacement("bottom")
        return
      }

      const rect = anchor.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top

      setPlacement(
        spaceBelow < 320 && spaceAbove > spaceBelow ? "top" : "bottom"
      )
    }

    updatePlacement()
    window.addEventListener("resize", updatePlacement)

    return () => window.removeEventListener("resize", updatePlacement)
  }, [anchorRef, open])

  return placement
}

function getPathTail(path: string | null | undefined) {
  const normalized = path?.replace(/\/+$/, "").trim()

  if (!normalized) {
    return ""
  }

  return normalized.split("/").filter(Boolean).at(-1) ?? normalized
}

function createStudioTerminalTab(
  project: StudioLocalProjectWithGitInfo | null,
  fallbackTitle: string,
  sequence = 1
): StudioTerminalTab {
  const cwd = project?.path ?? null
  const title = project?.name || getPathTail(cwd) || fallbackTitle

  return {
    id: createClientId(),
    cwd,
    sequence,
    title: formatTerminalTabTitle(title, sequence),
  }
}

function formatTerminalTabTitle(title: string, sequence: number) {
  return sequence > 1 ? `${title} ${sequence}` : title
}

function formatSidePanelFileSize(bytes: number | null | undefined) {
  if (typeof bytes !== "number") {
    return ""
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isVirtualSidePanelPath(path: string) {
  return path.startsWith("/api/") || /^https?:\/\//i.test(path)
}

function isLikelyTextEntry(entry: AstraFlowSidePanelDirectoryEntry) {
  if (entry.kind !== "file") {
    return false
  }

  if (isVirtualSidePanelPath(entry.path)) {
    return false
  }

  return TEXT_FILE_EXTENSIONS.has(entry.extension)
}

function isImageEntry(entry: AstraFlowSidePanelDirectoryEntry) {
  return (
    entry.kind === "file" &&
    !isVirtualSidePanelPath(entry.path) &&
    IMAGE_FILE_EXTENSIONS.has(entry.extension)
  )
}

function isPreviewableSidePanelEntry(entry: AstraFlowSidePanelDirectoryEntry) {
  return isLikelyTextEntry(entry) || isImageEntry(entry)
}

function inferCodeLanguage(entry: AstraFlowSidePanelDirectoryEntry) {
  const extension = entry.extension.toLowerCase()
  const lowerName = entry.name.toLowerCase()

  if (lowerName === "dockerfile") {
    return "dockerfile"
  }

  if (lowerName === ".env" || extension === "env") {
    return "dotenv"
  }

  const aliases: Record<string, string> = {
    cjs: "javascript",
    h: "c",
    hpp: "cpp",
    js: "javascript",
    jsonl: "json",
    jsx: "jsx",
    md: "markdown",
    mjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "shellscript",
    ts: "typescript",
    tsx: "tsx",
    yml: "yaml",
  }

  return aliases[extension] ?? (extension || "plaintext")
}

function parseMarkdownFrontmatter(content: string) {
  const normalized = content.replace(/^\uFEFF/, "")
  const lines = normalized.split(/\r?\n/)

  if (lines[0]?.trim() !== "---") {
    return { body: content, metadata: [] as Array<[string, string]> }
  }

  const endIndex = lines.findIndex((line, index) => {
    return index > 0 && line.trim() === "---"
  })

  if (endIndex < 0) {
    return { body: content, metadata: [] as Array<[string, string]> }
  }

  const metadata = parseSimpleYamlMetadata(lines.slice(1, endIndex).join("\n"))
  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .replace(/^\s+/, "")

  return { body, metadata }
}

function parseSimpleYamlMetadata(yaml: string): Array<[string, string]> {
  const metadata: Array<[string, string]> = []
  let currentKey = ""

  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)

    if (keyValueMatch) {
      currentKey = keyValueMatch[1]
      const value = cleanYamlScalar(keyValueMatch[2])

      metadata.push([currentKey, value])
      continue
    }

    const listItemMatch = line.match(/^\s*-\s*(.+)$/)

    if (listItemMatch && currentKey) {
      const lastItem = metadata.at(-1)
      const value = cleanYamlScalar(listItemMatch[1])

      if (lastItem?.[0] === currentKey) {
        lastItem[1] = lastItem[1] ? `${lastItem[1]}, ${value}` : value
      }
    }
  }

  return metadata.filter(([, value]) => value.trim().length > 0)
}

function cleanYamlScalar(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "")
}

function formatFileBreadcrumb(path: string | null | undefined) {
  const tail = getPathTail(path)

  return tail || "~"
}

function normalizeBrowserUrl(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ""
  }

  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("file://")
  ) {
    return trimmed
  }

  if (trimmed.includes(".") || trimmed.includes(":")) {
    return `https://${trimmed}`
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

function createStudioBrowserTab(): StudioBrowserTab {
  return {
    id: createClientId(),
    title: "新选项卡",
    address: "",
    url: "",
  }
}

function createWorkspaceBrowserTab(): StudioWorkspaceBrowserTab {
  return {
    ...createStudioBrowserTab(),
    kind: "browser",
  }
}

function createWorkspaceFileTab(
  entry: AstraFlowSidePanelDirectoryEntry | null,
  fallbackTitle: string
): StudioWorkspaceFileTab {
  return {
    id: createClientId(),
    kind: "files",
    title: entry?.name ?? fallbackTitle,
    entry,
  }
}

function createWorkspaceTerminalTab(
  project: StudioLocalProjectWithGitInfo | null,
  fallbackTitle: string,
  sequence: number
): StudioWorkspaceTerminalTab {
  return {
    ...createStudioTerminalTab(project, fallbackTitle, sequence),
    kind: "terminal",
  }
}

function createWorkspaceSideChatTab(title: string): StudioWorkspaceSideChatTab {
  return {
    id: createClientId(),
    kind: "side-chat",
    title,
  }
}

function getWorkspaceTabMode(tab: StudioWorkspaceTab): StudioRightPanelMode {
  return tab.kind
}

function getWorkspaceTabTitle(tab: StudioWorkspaceTab) {
  if (tab.kind === "files") {
    return tab.entry?.name ?? tab.title
  }

  return tab.title
}

function createSidePanelEntryFromPath(
  path: string
): AstraFlowSidePanelDirectoryEntry {
  const normalizedPath = path
  const name = normalizedPath.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  const extension = name.includes(".")
    ? (name.split(".").at(-1)?.toLowerCase() ?? "")
    : ""

  return {
    name,
    path: normalizedPath,
    kind: "file",
    extension,
    size: 0,
    modifiedAt: Date.now(),
  }
}

function getMarkdownTargetFilePath(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref) {
    return null
  }

  if (trimmedHref.startsWith("/api/")) {
    return null
  }

  if (trimmedHref.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmedHref).pathname)
    } catch {
      return null
    }
  }

  if (trimmedHref.startsWith("/") || trimmedHref.startsWith("~/")) {
    return trimmedHref
  }

  return null
}

function getMarkdownTargetBrowserUrl(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref) {
    return null
  }

  if (trimmedHref.startsWith("/api/")) {
    return new URL(trimmedHref, window.location.href).toString()
  }

  try {
    const url = new URL(trimmedHref)

    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

function useCloseTabCommand(handler: () => void, active = true) {
  const handlerRef = React.useRef(handler)

  React.useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  React.useEffect(() => {
    if (!active) {
      return
    }

    const disposeDesktopListener = window.astraflowDesktop?.onCloseTabCommand?.(
      () => {
        handlerRef.current()
      }
    )

    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        event.preventDefault()
        handlerRef.current()
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)

    return () => {
      disposeDesktopListener?.()
      window.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [active])
}

function getBrowserTabTitle(url: string) {
  if (!url) {
    return "新选项卡"
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "") || "浏览器"
  } catch {
    return "浏览器"
  }
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
      error?: unknown
      message?: string
    }

const CHAT_MODEL_STORAGE_KEY = "astraflow:chat-model"
const CHAT_RUNTIME_STORAGE_KEY = "astraflow:chat-runtime"
const CHAT_REASONING_EFFORT_STORAGE_KEY = "astraflow:chat-reasoning-effort"
const CHAT_DEFAULTS_STORAGE_KEY = "astraflow-chat-defaults"
const CHAT_ENVIRONMENT_STORAGE_KEY = "astraflow:chat-environment"
const DEFAULT_CHAT_RUNTIME_ID = "astraflow"
const PROJECT_NONE_VALUE = "__none__"

type ChatRunEnvironment = "remote" | "local"

type ChatPreferenceRecord = {
  chatModel?: SupportedChatModel | null
  chatRuntimeId?: string | null
  chatReasoningEffort?: ChatReasoningEffort | null
}

type StoredChatDefaults = {
  runtimeId?: string
  model?: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
}

type ResolvedChatPreferences = {
  runtimeId: string
  model: SupportedChatModel
  reasoningEffort: ChatReasoningEffort
}

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
    compact: false,
  },
}

const chatModelListeners = new Set<() => void>()
const chatRuntimeListeners = new Set<() => void>()
const chatEnvironmentListeners = new Set<() => void>()
const chatReasoningEffortListeners = new Set<() => void>()
const terminalPanelOpenListeners = new Set<() => void>()
const rightPanelListeners = new Set<() => void>()
let rightPanelHydrated = false

function getStoredTerminalPanelOpen() {
  return readStoredBoolean(TERMINAL_PANEL_OPEN_STORAGE_KEY, false)
}

function setStoredTerminalPanelOpen(open: boolean) {
  window.localStorage.setItem(TERMINAL_PANEL_OPEN_STORAGE_KEY, String(open))
  terminalPanelOpenListeners.forEach((listener) => listener())
}

function subscribeTerminalPanelOpen(listener: () => void) {
  terminalPanelOpenListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    terminalPanelOpenListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function useTerminalPanelOpen() {
  const open = React.useSyncExternalStore(
    subscribeTerminalPanelOpen,
    getStoredTerminalPanelOpen,
    () => false
  )

  return [open, setStoredTerminalPanelOpen] as const
}

function notifyRightPanelListeners() {
  rightPanelListeners.forEach((listener) => listener())
}

function subscribeRightPanel(listener: () => void) {
  rightPanelListeners.add(listener)
  window.addEventListener("storage", listener)

  if (!rightPanelHydrated) {
    queueMicrotask(() => {
      rightPanelHydrated = true
      notifyRightPanelListeners()
    })
  }

  return () => {
    rightPanelListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function getStoredRightPanelOpen() {
  return readStoredBoolean(RIGHT_PANEL_OPEN_STORAGE_KEY, false)
}

function setStoredRightPanelOpen(open: boolean) {
  rightPanelHydrated = true
  window.localStorage.setItem(RIGHT_PANEL_OPEN_STORAGE_KEY, String(open))
  notifyRightPanelListeners()
}

function setStoredRightPanelMode(mode: StudioRightPanelMode) {
  rightPanelHydrated = true
  window.localStorage.setItem(RIGHT_PANEL_MODE_STORAGE_KEY, mode)
  notifyRightPanelListeners()
}

function setStoredRightPanelWidth(width: number) {
  const nextWidth = clampRightPanelWidth(width)

  rightPanelHydrated = true
  window.localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(nextWidth))
  notifyRightPanelListeners()
}

function getHydratedRightPanelOpen() {
  return rightPanelHydrated ? getStoredRightPanelOpen() : false
}

function getHydratedRightPanelMode() {
  return rightPanelHydrated ? readStoredRightPanelMode() : "launcher"
}

function getHydratedRightPanelWidth() {
  return rightPanelHydrated
    ? readStoredRightPanelWidth()
    : RIGHT_PANEL_DEFAULT_WIDTH
}

function useRightPanelOpen() {
  const open = React.useSyncExternalStore(
    subscribeRightPanel,
    getHydratedRightPanelOpen,
    () => false
  )

  return [open, setStoredRightPanelOpen] as const
}

function useRightPanelMode() {
  const mode = React.useSyncExternalStore(
    subscribeRightPanel,
    getHydratedRightPanelMode,
    () => "launcher" as StudioRightPanelMode
  )

  return [mode, setStoredRightPanelMode] as const
}

function useRightPanelWidth() {
  const width = React.useSyncExternalStore(
    subscribeRightPanel,
    getHydratedRightPanelWidth,
    () => RIGHT_PANEL_DEFAULT_WIDTH
  )

  return [width, setStoredRightPanelWidth] as const
}

function getStoredChatModel(): SupportedChatModel {
  if (typeof window === "undefined") {
    return DEFAULT_CHAT_MODEL
  }

  const stored = window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY)

  if (stored?.trim()) {
    return stored.trim()
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

function getAgentChatModelLabel(
  model: SupportedChatModel,
  modelOptions: AgentModelDefinition[]
) {
  return (
    modelOptions.find((option) => option.id === model)?.label ??
    getChatModelLabel(model)
  )
}

function getFallbackAgentModelOptions(): AgentModelDefinition[] {
  return CHAT_MODEL_OPTIONS.map((option) => ({
    id: option.value,
    label: option.label,
    providerModel: option.providerModel,
    protocol: option.protocol,
    baseUrl: null,
    supportedRuntimeIds: [...option.supportedRuntimeIds],
    reasoningEfforts: [...option.reasoningEfforts],
    defaultReasoningEffort: option.defaultReasoningEffort,
    builtin: true,
    enabled: true,
  }))
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

function getChatModelOptionsForRuntime(
  runtimeId: string,
  agentModelSettings: AgentModelSettingsPayload | null
) {
  const models = agentModelSettings?.models ?? getFallbackAgentModelOptions()
  const compatibleModels = models.filter(
    (model) =>
      model.enabled &&
      model.supportedRuntimeIds.some((supportedRuntimeId) => {
        return supportedRuntimeId === runtimeId
      })
  )

  return compatibleModels.length > 0 ? compatibleModels : models
}

function getChatModelReasoningEffort(
  model: SupportedChatModel,
  reasoningEffort: ChatReasoningEffort | null | undefined,
  modelOptions: AgentModelDefinition[]
) {
  const modelOption = modelOptions.find((option) => option.id === model)
  const supportedEfforts =
    modelOption?.reasoningEfforts ?? getChatReasoningEfforts(model)

  if (reasoningEffort && supportedEfforts.includes(reasoningEffort)) {
    return reasoningEffort
  }

  return (
    modelOption?.defaultReasoningEffort ??
    resolveChatReasoningEffort(
      model,
      reasoningEffort ?? getDefaultChatReasoningEffort(model)
    )
  )
}

function resolveChatPreferences(
  preferences: ChatPreferenceRecord,
  runtimeInfos: ChatRuntimeOption[],
  agentModelSettings: AgentModelSettingsPayload | null
): ResolvedChatPreferences {
  const runtimeId = resolveChatRuntimeId(
    preferences.chatRuntimeId?.trim() || DEFAULT_CHAT_RUNTIME_ID,
    runtimeInfos
  )
  const modelOptions = getChatModelOptionsForRuntime(
    runtimeId,
    agentModelSettings
  )
  const runtimeDefault =
    agentModelSettings?.runtimes[
      runtimeId as keyof AgentModelSettingsPayload["runtimes"]
    ]?.defaultModel
  const model =
    modelOptions.find((option) => option.id === preferences.chatModel)?.id ??
    modelOptions.find((option) => option.id === runtimeDefault)?.id ??
    modelOptions.find((option) => option.id === DEFAULT_CHAT_MODEL)?.id ??
    modelOptions[0]?.id ??
    DEFAULT_CHAT_MODEL
  const reasoningEffort = getChatModelReasoningEffort(
    model,
    preferences.chatReasoningEffort,
    modelOptions
  )

  return {
    runtimeId,
    model,
    reasoningEffort,
  }
}

function mergeChatPreferences(
  sessionPreferences: ChatPreferenceRecord | null | undefined,
  chatDefaults: StoredChatDefaults | null
): ChatPreferenceRecord {
  return {
    chatRuntimeId:
      sessionPreferences?.chatRuntimeId ?? chatDefaults?.runtimeId ?? null,
    chatModel: sessionPreferences?.chatModel ?? chatDefaults?.model ?? null,
    chatReasoningEffort:
      sessionPreferences?.chatReasoningEffort ??
      chatDefaults?.reasoningEffort ??
      null,
  }
}

function hasExplicitChatPreferences(
  preferences: ChatPreferenceRecord | null | undefined
) {
  return Boolean(
    preferences?.chatRuntimeId ||
      preferences?.chatModel ||
      preferences?.chatReasoningEffort
  )
}

function readStoredChatDefaults(): StoredChatDefaults | null {
  if (typeof window === "undefined") {
    return null
  }

  const stored = window.localStorage.getItem(CHAT_DEFAULTS_STORAGE_KEY)

  if (!stored) {
    return null
  }

  try {
    const parsed = JSON.parse(stored) as {
      runtimeId?: unknown
      model?: unknown
      reasoningEffort?: unknown
    }
    const defaults: StoredChatDefaults = {}

    if (typeof parsed.runtimeId === "string" && parsed.runtimeId.trim()) {
      defaults.runtimeId = parsed.runtimeId.trim()
    }

    if (typeof parsed.model === "string" && parsed.model.trim()) {
      defaults.model = parsed.model.trim()
    }

    if (
      typeof parsed.reasoningEffort === "string" &&
      isChatReasoningEffort(parsed.reasoningEffort)
    ) {
      defaults.reasoningEffort = parsed.reasoningEffort
    }

    return Object.keys(defaults).length > 0 ? defaults : null
  } catch {
    return null
  }
}

function writeStoredChatDefaults(defaults: ResolvedChatPreferences) {
  window.localStorage.setItem(
    CHAT_DEFAULTS_STORAGE_KEY,
    JSON.stringify({
      runtimeId: defaults.runtimeId,
      model: defaults.model,
      reasoningEffort: defaults.reasoningEffort,
    })
  )
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

function stringifyApiError(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function readJson<T>(response: Response) {
  const data = (await response.json()) as ApiResponse<T>

  if (!response.ok || !data.ok) {
    const detail = data.ok ? "" : data.message || stringifyApiError(data.error)

    throw new Error(detail || `Request failed (${response.status})`)
  }

  return data.data
}

async function listAgentRuntimes() {
  const response = await fetch("/api/studio/agent-runtimes", {
    cache: "no-store",
  })

  return normalizeChatRuntimeInfos(await readJson<AgentRuntimeInfo[]>(response))
}

async function getAgentModelSettingsForComposer() {
  const response = await fetch("/api/studio/agent-model-settings", {
    cache: "no-store",
  })

  return readJson<AgentModelSettingsPayload>(response)
}

async function listLocalProjectsForComposer() {
  const response = await fetch("/api/studio/local-projects", {
    cache: "no-store",
  })

  return readJson<StudioLocalProjectWithGitInfo[]>(response)
}

async function createLocalProjectForComposer(path: string) {
  const response = await fetch("/api/studio/local-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  })

  return readJson<StudioLocalProjectWithGitInfo>(response)
}

async function listStudioSessionsForComposer() {
  const response = await fetch("/api/studio/sessions", { cache: "no-store" })

  return readJson<StudioSession[]>(response)
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeRuntimeSlashCommand(
  value: unknown
): SlashCommandDescriptor | null {
  if (!isObjectRecord(value) || typeof value.name !== "string") {
    return null
  }

  const name = value.name.trim().replace(/^\/+/, "")

  if (!name) {
    return null
  }

  return {
    name,
    description: typeof value.description === "string" ? value.description : "",
    inputHint:
      typeof value.inputHint === "string" ? value.inputHint : undefined,
    source: "runtime",
    runtimeId:
      typeof value.runtimeId === "string" ? value.runtimeId : undefined,
  }
}

function getCommandsFromResponsePayload(payload: unknown): unknown[] {
  if (!isObjectRecord(payload)) {
    return []
  }

  if (Array.isArray(payload.commands)) {
    return payload.commands
  }

  if (isObjectRecord(payload.data) && Array.isArray(payload.data.commands)) {
    return payload.data.commands
  }

  if (Array.isArray(payload.data)) {
    return payload.data
  }

  return []
}

async function listSessionSlashCommands(sessionId: string) {
  if (!sessionId) {
    return []
  }

  try {
    const response = await fetch(
      `/api/studio/sessions/${encodeURIComponent(sessionId)}/commands`,
      { cache: "no-store" }
    )

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as unknown

    return getCommandsFromResponsePayload(payload)
      .map(normalizeRuntimeSlashCommand)
      .filter((command): command is SlashCommandDescriptor => Boolean(command))
  } catch {
    return []
  }
}

type WorkspaceFileCandidate = {
  path: string
  relativePath: string
  name: string
  kind: "file" | "folder"
}

function normalizeWorkspaceFileCandidate(
  value: unknown
): WorkspaceFileCandidate | null {
  if (
    !isObjectRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.relativePath !== "string" ||
    typeof value.name !== "string" ||
    (value.kind !== "file" && value.kind !== "folder")
  ) {
    return null
  }

  return {
    path: value.path,
    relativePath: value.relativePath,
    name: value.name,
    kind: value.kind,
  }
}

function getWorkspaceFilesFromResponsePayload(payload: unknown): unknown[] {
  if (!isObjectRecord(payload)) {
    return []
  }

  if (Array.isArray(payload.files)) {
    return payload.files
  }

  if (isObjectRecord(payload.data) && Array.isArray(payload.data.files)) {
    return payload.data.files
  }

  return []
}

async function listWorkspaceFilesForComposer({
  projectId,
  query,
  limit = 30,
}: {
  projectId: string
  query: string
  limit?: number
}) {
  if (!projectId) {
    return []
  }

  const searchParams = new URLSearchParams({
    projectId,
    q: query,
    limit: String(limit),
  })

  try {
    const response = await fetch(
      `/api/studio/workspace/files?${searchParams.toString()}`,
      { cache: "no-store" }
    )

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as unknown

    return getWorkspaceFilesFromResponsePayload(payload)
      .map(normalizeWorkspaceFileCandidate)
      .filter((file): file is WorkspaceFileCandidate => Boolean(file))
  } catch {
    return []
  }
}

async function createSession(
  title: string,
  preferences?: {
    chatModel: SupportedChatModel
    chatRuntimeId: string
    chatReasoningEffort: ChatReasoningEffort
  }
) {
  const response = await fetch("/api/studio/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "chat",
      title,
      chatModel: preferences?.chatModel,
      chatRuntimeId: preferences?.chatRuntimeId,
      chatReasoningEffort: preferences?.chatReasoningEffort,
    }),
  })

  return readJson<StudioSession>(response)
}

async function updateSessionChatPreferences(
  sessionId: string,
  preferences: {
    chatModel?: SupportedChatModel | null
    chatRuntimeId?: string | null
    chatReasoningEffort?: ChatReasoningEffort | null
  }
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
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
  feedback?: string
}) {
  const response = await fetch("/api/studio/chat/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return readJson<{ resolved: boolean }>(response)
}

async function sendUserInputDecision(input: {
  sessionId: string
  requestId: string
  answers: StudioUserInputAnswer[]
  cancelled?: boolean
}) {
  const response = await fetch("/api/studio/chat/user-input", {
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
  mentions?: PromptMention[]
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
        ...(input.mentions && input.mentions.length > 0
          ? { mentions: input.mentions }
          : {}),
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

async function compactCodexDirectSessionRequest(sessionId: string) {
  const response = await fetch(
    `/api/studio/sessions/${encodeURIComponent(sessionId)}/compact`,
    {
      method: "POST",
    }
  )

  return readJson<{ usage: StudioTokenUsage | null }>(response)
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

function getPendingPermissionPart(messages: StudioMessage[]) {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex]

    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.parts[partIndex]

      if (part.type === "permission" && part.status === "pending") {
        return part
      }
    }
  }

  return null
}

function getPendingUserInputPart(messages: StudioMessage[]) {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex]

    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.parts[partIndex]

      if (part.type === "user_input" && part.status === "pending") {
        return part
      }
    }
  }

  return null
}

function hasActiveMediaGenerationPart(messages: StudioMessage[]) {
  return messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === "media_generation" &&
        (part.status === "queued" ||
          part.status === "running" ||
          part.status === "polling")
    )
  )
}

function parseToolJsonObject(input: string) {
  try {
    const parsed = JSON.parse(input) as unknown

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function getToolPathInput(input: string) {
  const parsed = parseToolJsonObject(input)

  if (!parsed) {
    return input.trim()
  }

  const keys = [
    "path",
    "file_path",
    "filePath",
    "absolute_path",
    "absolutePath",
  ]

  for (const key of keys) {
    const value = parsed[key]

    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return ""
}

function getOutputFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function getSessionOutputFiles(messages: StudioMessage[]) {
  const outputFiles = new Map<string, StudioOutputFile>()
  const writeToolNames = new Set([
    "write_file",
    "edit_file",
    "Write",
    "create_file",
  ])

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }

    for (const part of message.parts) {
      let path = ""

      if (
        part.type === "file" &&
        part.status === "complete" &&
        part.kind !== "delete"
      ) {
        path = part.path
      } else if (
        part.type === "tool" &&
        part.activity.status === "complete" &&
        writeToolNames.has(part.activity.toolName)
      ) {
        path = getToolPathInput(part.activity.input)
      }

      const normalizedPath = path.trim()

      if (normalizedPath && !outputFiles.has(normalizedPath)) {
        outputFiles.set(normalizedPath, {
          path: normalizedPath,
          name: getOutputFileName(normalizedPath),
        })
      }
    }
  }

  return Array.from(outputFiles.values())
}

function getUserMessageHistory(messages: StudioMessage[]) {
  const history: string[] = []

  for (const message of messages) {
    if (message.role !== "user" || message.content.trim().length === 0) {
      continue
    }

    if (history[history.length - 1] !== message.content) {
      history.push(message.content)
    }
  }

  return history
}

function StudioChatWorkbench({
  sessionId,
  onSessionChange,
  onSessionsChange,
}: StudioChatWorkbenchProps) {
  const { locale, t } = useI18n()
  const greetingPeriod = useStudioGreetingPeriod()
  const [input, setInput] = React.useState("")
  const [selectedModel, setSelectedModel] = useChatModel()
  const [selectedRuntimeId, setSelectedRuntimeId] = useChatRuntime()
  const [selectedReasoningEffort] = useChatReasoningEffort(selectedModel)
  const [selectedEnvironment, setSelectedEnvironment] = useChatEnvironment()
  const [runtimeInfos, setRuntimeInfos] = React.useState<ChatRuntimeOption[]>(
    () => [FALLBACK_CHAT_RUNTIME_INFO]
  )
  const [agentModelSettings, setAgentModelSettings] =
    React.useState<AgentModelSettingsPayload | null>(null)
  const [chatDefaultsHydrated, setChatDefaultsHydrated] =
    React.useState(false)
  const [chatDefaults, setChatDefaults] =
    React.useState<StoredChatDefaults | null>(null)
  const [sessionChatPreferences, setSessionChatPreferences] =
    React.useState<ChatPreferenceRecord | null | undefined>(undefined)
  const [localProjects, setLocalProjects] = React.useState<
    StudioLocalProjectWithGitInfo[]
  >([])
  const [isAddingLocalProject, setIsAddingLocalProject] =
    React.useState(false)
  const [selectedProjectId, setSelectedProjectId] = React.useState<
    string | null
  >(null)
  const [currentSessionTitle, setCurrentSessionTitle] = React.useState("")
  const [selectedPermissionMode, setSelectedPermissionMode] =
    React.useState<StudioPermissionMode>("ask")
  const [messages, setMessages] = React.useState<StudioMessage[]>([])
  const [pendingAttachments, setPendingAttachments] = React.useState<
    PendingAttachment[]
  >([])
  const [promptMentions, setPromptMentions] = React.useState<ComposerMention[]>(
    []
  )
  const [startingSessionIds, setStartingSessionIds] = React.useState<
    Set<string>
  >(() => new Set())
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [chatErrors, setChatErrors] = React.useState<Record<string, string>>({})
  const [liveStreamConnected, setLiveStreamConnected] = React.useState(false)
  const [latestRunUsage, setLatestRunUsage] =
    React.useState<StudioTokenUsage | null>(null)
  const sessionIdRef = React.useRef(sessionId)
  const sessionProjectRequestIdRef = React.useRef(0)
  const preferenceSaveIdRef = React.useRef(0)
  const normalizedPreferenceSaveKeyRef = React.useRef("")

  const saveChatPreferences = React.useCallback(
    (
      activeSessionId: string,
      preferences: {
        chatModel?: SupportedChatModel | null
        chatRuntimeId?: string | null
        chatReasoningEffort?: ChatReasoningEffort | null
      }
    ) => {
      const requestId = preferenceSaveIdRef.current + 1
      preferenceSaveIdRef.current = requestId

      void updateSessionChatPreferences(activeSessionId, preferences).catch(
        () => {
          if (preferenceSaveIdRef.current === requestId) {
            preferenceSaveIdRef.current = 0
          }
        }
      )
    },
    []
  )

  const visibleMessages = React.useMemo(
    () => (sessionId ? messages : []),
    [messages, sessionId]
  )
  const outputFiles = React.useMemo(
    () => getSessionOutputFiles(visibleMessages),
    [visibleMessages]
  )
  const userMessageHistory = React.useMemo(
    () => getUserMessageHistory(visibleMessages),
    [visibleMessages]
  )
  const pendingPermissionPart = React.useMemo(
    () => getPendingPermissionPart(visibleMessages),
    [visibleMessages]
  )
  const pendingUserInputPart = React.useMemo(
    () => getPendingUserInputPart(visibleMessages),
    [visibleMessages]
  )
  const hasActiveMediaGeneration = React.useMemo(
    () => hasActiveMediaGenerationPart(visibleMessages),
    [visibleMessages]
  )
  const resolvedRuntimeId = resolveChatRuntimeId(
    selectedRuntimeId,
    runtimeInfos
  )
  const modelOptions = React.useMemo(() => {
    return getChatModelOptionsForRuntime(resolvedRuntimeId, agentModelSettings)
  }, [agentModelSettings, resolvedRuntimeId])
  const commitChatDefaults = React.useCallback(
    (preferences: ResolvedChatPreferences) => {
      writeStoredChatDefaults(preferences)
      setChatDefaults({
        runtimeId: preferences.runtimeId,
        model: preferences.model,
        reasoningEffort: preferences.reasoningEffort,
      })
    },
    []
  )
  const applyChatSelection = React.useCallback(
    (preferences: ResolvedChatPreferences) => {
      setStoredChatReasoningEffort(
        preferences.model,
        preferences.reasoningEffort
      )
      setSelectedRuntimeId(preferences.runtimeId)
      setSelectedModel(preferences.model)
    },
    [setSelectedModel, setSelectedRuntimeId]
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
  const chatError = sessionId ? chatErrors[sessionId] : ""
  const error = chatError
    ? "chat-failed"
    : sessionId && loadFailed
      ? "load-failed"
      : ""
  const selectedProject = React.useMemo(
    () =>
      selectedProjectId
        ? (localProjects.find((project) => project.id === selectedProjectId) ??
          null)
        : null,
    [localProjects, selectedProjectId]
  )
  const [terminalPanelOpen, setTerminalPanelOpen] = useTerminalPanelOpen()
  const [rightPanelOpen, setRightPanelOpen] = useRightPanelOpen()
  const [rightPanelMode, setRightPanelMode] = useRightPanelMode()
  const [rightPanelWidth, setRightPanelWidth] = useRightPanelWidth()
  const [rightPanelFocused, setRightPanelFocused] = React.useState(false)
  const [modelSelectOpen, setModelSelectOpen] = React.useState(false)
  const [reasoningSelectOpen, setReasoningSelectOpen] = React.useState(false)
  const effectiveRightPanelFocused = rightPanelOpen && rightPanelFocused

  React.useEffect(() => {
    function syncChatDefaults() {
      setChatDefaults(readStoredChatDefaults())
      setChatDefaultsHydrated(true)
    }

    syncChatDefaults()
    window.addEventListener("storage", syncChatDefaults)

    return () => {
      window.removeEventListener("storage", syncChatDefaults)
    }
  }, [])

  React.useEffect(() => {
    if (
      !chatDefaultsHydrated ||
      (sessionId && sessionChatPreferences === undefined)
    ) {
      return
    }

    const nextPreferences = resolveChatPreferences(
      mergeChatPreferences(sessionChatPreferences, chatDefaults),
      runtimeInfos,
      agentModelSettings
    )
    const preferencesChanged =
      selectedRuntimeId !== nextPreferences.runtimeId ||
      selectedModel !== nextPreferences.model ||
      selectedReasoningEffort !== nextPreferences.reasoningEffort

    if (preferencesChanged) {
      applyChatSelection(nextPreferences)
    }

    const explicitSessionPreferences = hasExplicitChatPreferences(
      sessionChatPreferences
    )
      ? sessionChatPreferences
      : null

    if (
      sessionId &&
      explicitSessionPreferences &&
      (explicitSessionPreferences.chatRuntimeId !== nextPreferences.runtimeId ||
        explicitSessionPreferences.chatModel !== nextPreferences.model ||
        explicitSessionPreferences.chatReasoningEffort !==
          nextPreferences.reasoningEffort)
    ) {
      const nextSessionPreferences = {
        chatModel: nextPreferences.model,
        chatRuntimeId: nextPreferences.runtimeId,
        chatReasoningEffort: nextPreferences.reasoningEffort,
      }

      queueMicrotask(() => {
        setSessionChatPreferences(nextSessionPreferences)
      })
      saveChatPreferences(sessionId, nextSessionPreferences)
    }
  }, [
    agentModelSettings,
    applyChatSelection,
    chatDefaults,
    chatDefaultsHydrated,
    runtimeInfos,
    saveChatPreferences,
    selectedModel,
    selectedReasoningEffort,
    selectedRuntimeId,
    sessionChatPreferences,
    sessionId,
  ])

  const handleRuntimeChange = React.useCallback(
    (nextRuntimeId: string) => {
      const nextPreferences = resolveChatPreferences(
        {
          chatModel: selectedModel,
          chatRuntimeId: nextRuntimeId,
          chatReasoningEffort: selectedReasoningEffort,
        },
        runtimeInfos,
        agentModelSettings
      )

      applyChatSelection(nextPreferences)

      if (!sessionId) {
        commitChatDefaults(nextPreferences)
        return
      }

      const nextSessionPreferences = {
        chatModel: nextPreferences.model,
        chatRuntimeId: nextPreferences.runtimeId,
        chatReasoningEffort: nextPreferences.reasoningEffort,
      }
      const saveKey = [
        sessionId,
        nextSessionPreferences.chatRuntimeId,
        nextSessionPreferences.chatModel,
        nextSessionPreferences.chatReasoningEffort,
      ].join(":")

      setSessionChatPreferences(nextSessionPreferences)

      if (normalizedPreferenceSaveKeyRef.current !== saveKey) {
        normalizedPreferenceSaveKeyRef.current = saveKey
        saveChatPreferences(sessionId, nextSessionPreferences)
      }
    },
    [
      agentModelSettings,
      applyChatSelection,
      commitChatDefaults,
      runtimeInfos,
      saveChatPreferences,
      selectedModel,
      selectedReasoningEffort,
      sessionId,
    ]
  )

  const handleModelChange = React.useCallback(
    (nextModel: SupportedChatModel) => {
      const nextPreferences = resolveChatPreferences(
        {
          chatModel: nextModel,
          chatRuntimeId: resolvedRuntimeId,
          chatReasoningEffort: getStoredChatReasoningEffort(nextModel),
        },
        runtimeInfos,
        agentModelSettings
      )

      applyChatSelection(nextPreferences)

      if (!sessionId) {
        commitChatDefaults(nextPreferences)
        return
      }

      const nextSessionPreferences = {
        chatModel: nextPreferences.model,
        chatRuntimeId: nextPreferences.runtimeId,
        chatReasoningEffort: nextPreferences.reasoningEffort,
      }

      setSessionChatPreferences(nextSessionPreferences)
      saveChatPreferences(sessionId, nextSessionPreferences)
    },
    [
      agentModelSettings,
      applyChatSelection,
      commitChatDefaults,
      resolvedRuntimeId,
      runtimeInfos,
      saveChatPreferences,
      sessionId,
    ]
  )

  const handleReasoningEffortChange = React.useCallback(
    (nextEffort: ChatReasoningEffort) => {
      const nextPreferences = resolveChatPreferences(
        {
          chatModel: selectedModel,
          chatRuntimeId: resolvedRuntimeId,
          chatReasoningEffort: nextEffort,
        },
        runtimeInfos,
        agentModelSettings
      )

      applyChatSelection(nextPreferences)

      if (!sessionId) {
        commitChatDefaults(nextPreferences)
        return
      }

      const nextSessionPreferences = {
        chatModel: nextPreferences.model,
        chatRuntimeId: nextPreferences.runtimeId,
        chatReasoningEffort: nextPreferences.reasoningEffort,
      }

      setSessionChatPreferences(nextSessionPreferences)
      saveChatPreferences(sessionId, nextSessionPreferences)
    },
    [
      agentModelSettings,
      applyChatSelection,
      commitChatDefaults,
      resolvedRuntimeId,
      runtimeInfos,
      saveChatPreferences,
      selectedModel,
      sessionId,
    ]
  )

  const toggleTerminalPanel = React.useCallback(() => {
    setTerminalPanelOpen(!getStoredTerminalPanelOpen())
  }, [setTerminalPanelOpen])
  const toggleRightPanel = React.useCallback(() => {
    if (rightPanelOpen) {
      setRightPanelFocused(false)
    }

    setRightPanelOpen(!rightPanelOpen)
  }, [rightPanelOpen, setRightPanelOpen])
  const openRightPanelMode = React.useCallback(
    (mode: StudioRightPanelMode) => {
      setRightPanelMode(mode)
      setRightPanelOpen(true)
    },
    [setRightPanelMode, setRightPanelOpen]
  )
  React.useEffect(() => {
    function handleWindowResize() {
      setRightPanelWidth(readStoredRightPanelWidth())
    }

    handleWindowResize()
    window.addEventListener("resize", handleWindowResize)

    return () => window.removeEventListener("resize", handleWindowResize)
  }, [setRightPanelWidth])
  const handleToggleFullscreen = React.useCallback(() => {
    if (!rightPanelOpen) {
      setRightPanelOpen(true)
    }

    setRightPanelFocused((current) => !current)
  }, [rightPanelOpen, setRightPanelOpen])
  const handleRightPanelOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        setRightPanelFocused(false)
      }

      setRightPanelOpen(open)
    },
    [setRightPanelOpen]
  )
  const handleRightPanelFocusedChange = React.useCallback(
    (focused: boolean) => {
      setRightPanelFocused(focused)
    },
    []
  )

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      const commandKey = event.metaKey || event.ctrlKey

      if (commandKey && key === "j") {
        event.preventDefault()
        toggleTerminalPanel()
        return
      }

      if (commandKey && event.altKey && key === "b") {
        event.preventDefault()
        toggleRightPanel()
        return
      }

      if (commandKey && key === "p") {
        event.preventDefault()
        openRightPanelMode("files")
        return
      }

      if (commandKey && event.altKey && key === "s") {
        event.preventDefault()
        openRightPanelMode("side-chat")
        return
      }

      if (commandKey && key === "t") {
        event.preventDefault()
        openRightPanelMode("browser")
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [openRightPanelMode, toggleRightPanel, toggleTerminalPanel])

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

    void Promise.all([listAgentRuntimes(), getAgentModelSettingsForComposer()])
      .then(([nextRuntimeInfos, nextAgentModelSettings]) => {
        if (!cancelled) {
          setRuntimeInfos(nextRuntimeInfos)
          setAgentModelSettings(nextAgentModelSettings)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeInfos([FALLBACK_CHAT_RUNTIME_INFO])
          setAgentModelSettings(null)
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

  const handleAddLocalProject = React.useCallback(async () => {
    if (!window.astraflowDesktop?.pickFolder || isAddingLocalProject) {
      return
    }

    try {
      setIsAddingLocalProject(true)
      const path = await window.astraflowDesktop.pickFolder()

      if (!path) {
        return
      }

      const project = await createLocalProjectForComposer(path)
      await reloadLocalProjects()
      dispatchStudioLocalProjectsChanged()
      setSelectedProjectId(project.id)
      setPendingProjectId(project.id)
      toast.success(t.studioLocalProjectCreated)
    } catch {
      toast.error(t.studioLocalProjectCreateFailed)
    } finally {
      setIsAddingLocalProject(false)
    }
  }, [
    isAddingLocalProject,
    reloadLocalProjects,
    t.studioLocalProjectCreateFailed,
    t.studioLocalProjectCreated,
  ])

  const reloadSessionProject = React.useCallback(async () => {
    const requestId = sessionProjectRequestIdRef.current + 1
    sessionProjectRequestIdRef.current = requestId
    normalizedPreferenceSaveKeyRef.current = ""
    setSessionChatPreferences(undefined)

    if (!sessionId) {
      setSelectedProjectId(consumePendingProjectId())
      setCurrentSessionTitle("")
      setSelectedPermissionMode("ask")
      setLatestRunUsage(null)
      setSessionChatPreferences(null)
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
      setCurrentSessionTitle(session?.title ?? "")
      setSelectedPermissionMode(session?.permissionMode ?? "ask")
      setLatestRunUsage(session?.latestRunUsage ?? null)
      setSessionChatPreferences({
        chatModel: session?.chatModel ?? null,
        chatRuntimeId: session?.chatRuntimeId ?? null,
        chatReasoningEffort:
          session?.chatReasoningEffort &&
          isChatReasoningEffort(session.chatReasoningEffort)
            ? session.chatReasoningEffort
            : null,
      })
    } catch {
      if (
        sessionProjectRequestIdRef.current !== requestId ||
        sessionIdRef.current !== activeSessionId
      ) {
        return
      }

      setSelectedProjectId(null)
      setCurrentSessionTitle("")
      setSelectedPermissionMode("ask")
      setLatestRunUsage(null)
      setSessionChatPreferences(null)
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
    if (!sessionId || !hasActiveMediaGeneration) {
      return
    }

    let cancelled = false
    const poll = () => {
      void reloadMessages(sessionId)
        .then((nextMessages) => {
          if (cancelled) {
            return
          }

          if (!hasActiveMediaGenerationPart(nextMessages)) {
            onSessionsChange()
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoadFailed(true)
          }
        })
    }

    const timer = window.setInterval(poll, 3000)

    poll()

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [hasActiveMediaGeneration, onSessionsChange, reloadMessages, sessionId])

  const handleLiveSnapshot = React.useCallback(
    (snapshot: StudioChatRunLiveSnapshot) => {
      if (sessionIdRef.current !== snapshot.sessionId) {
        return
      }

      const snapshotError = snapshot.error?.trim()

      if (snapshotError) {
        setChatErrors((current) =>
          current[snapshot.sessionId] === snapshotError
            ? current
            : { ...current, [snapshot.sessionId]: snapshotError }
        )
      } else if (
        snapshot.status === "complete" ||
        snapshot.status === "cancelled"
      ) {
        setChatErrors((current) => {
          if (!current[snapshot.sessionId]) return current

          const next = { ...current }
          delete next[snapshot.sessionId]
          return next
        })
      }

      if (!snapshot.message) {
        return
      }

      setMessages((currentMessages) =>
        mergeLiveMessage(currentMessages, snapshot.message!)
      )
      if (snapshot.usage) {
        setLatestRunUsage(snapshot.usage)
      }
      setLoadFailed(false)
    },
    []
  )
  const handleLiveDone = React.useCallback(() => {
    if (!sessionId) {
      return
    }

    void reloadMessages(sessionId)
      .then(() => onSessionsChange())
      .catch(() => setLoadFailed(true))
  }, [onSessionsChange, reloadMessages, sessionId])

  useStudioChatRunLiveStream({
    enabled: Boolean(sessionId && (hasStreamingMessage || isStarting)),
    onConnectionChange: setLiveStreamConnected,
    onDone: handleLiveDone,
    onError: () => setLiveStreamConnected(false),
    onSnapshot: handleLiveSnapshot,
    sessionId,
  })

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
        .catch((runError) => {
          const message =
            runError instanceof Error ? runError.message : t.studioChatFailed

          setChatErrors((current) => ({
            ...current,
            [activeSessionId]: message,
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
    [onSessionsChange, reloadMessages, t.studioChatFailed]
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

  const executeBuiltinSlashCommand = React.useCallback(
    (name: string) => {
      const commandName = name.toLowerCase()

      if (!isBuiltinSlashCommandName(commandName)) {
        return false
      }

      setInput("")
      setPromptMentions([])

      if (commandName === "clear") {
        setPendingAttachments([])
        setMessages([])
        setLoadFailed(false)
        setSelectedProjectId(null)
        setCurrentSessionTitle("")
        setSelectedPermissionMode("ask")
        setLatestRunUsage(null)
        setPendingProjectId(null)
        setSelectedEnvironment("local")
        setModelSelectOpen(false)
        setReasoningSelectOpen(false)
        setChatErrors((current) => {
          if (!sessionId || !current[sessionId]) {
            return current
          }

          const next = { ...current }
          delete next[sessionId]
          return next
        })
        onSessionChange("")
        return true
      }

      if (commandName === "model") {
        setReasoningSelectOpen(false)
        setModelSelectOpen(true)
        return true
      }

      if (commandName === "reasoning") {
        setModelSelectOpen(false)
        setReasoningSelectOpen(true)
        return true
      }

      if (commandName !== "compact") {
        return false
      }

      if (resolvedRuntimeId !== "codex-direct") {
        return false
      }

      if (!sessionId) {
        toast.error(t.studioCompactRequiresSession)
        return true
      }

      setStartingSessionIds((current) => {
        const next = new Set(current)
        next.add(sessionId)
        return next
      })
      void compactCodexDirectSessionRequest(sessionId)
        .then(async ({ usage }) => {
          if (usage) {
            setLatestRunUsage(usage)
          }

          await reloadSessionProject()
          onSessionsChange()
          dispatchStudioSessionsChanged()
        })
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : t.studioCompactFailed
          )
        })
        .finally(() => {
          setStartingSessionIds((current) => {
            const next = new Set(current)
            next.delete(sessionId)
            return next
          })
        })

      return true
    },
    [
      onSessionChange,
      onSessionsChange,
      reloadSessionProject,
      resolvedRuntimeId,
      sessionId,
      setSelectedEnvironment,
      t.studioCompactFailed,
      t.studioCompactRequiresSession,
    ]
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
      status: Extract<StudioMessagePart, { type: "permission" }>["status"],
      feedback?: string
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
        feedback,
      }).catch(() => {
        toast.error(t.studioPermissionDecisionFailed)
        void reloadMessages(sessionId)
      })
    },
    [reloadMessages, sessionId, t]
  )

  const handleUserInputDecision = React.useCallback(
    (
      requestId: string,
      answers: StudioUserInputAnswer[],
      status: Extract<StudioMessagePart, { type: "user_input" }>["status"]
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
                  part.type === "user_input" && part.id === requestId
                    ? {
                        ...part,
                        status,
                        answers,
                      }
                    : part
                ),
              }
        )
      )

      void sendUserInputDecision({
        sessionId,
        requestId,
        answers,
        cancelled: status === "cancelled",
      }).catch(() => {
        toast.error(t.requestFailed)
        void reloadMessages(sessionId)
      })
    },
    [reloadMessages, sessionId, t]
  )

  async function handleSubmit() {
    const prompt = input.trim()
    const attachments = pendingAttachments
    const mentions = serializeComposerMentions(
      promptMentions.filter((mention) =>
        textHasComposerMentionToken(input, mention)
      )
    )

    if ((!prompt && attachments.length === 0) || isBusy) {
      return
    }

    const slashCommand = parseSlashCommandText(prompt)

    if (
      slashCommand &&
      isBuiltinSlashCommandName(slashCommand.name) &&
      executeBuiltinSlashCommand(slashCommand.name)
    ) {
      return
    }

    setInput("")
    setPendingAttachments([])
    setPromptMentions([])

    const isNewSession = !sessionId

    try {
      const activeSession =
        sessionId.length > 0
          ? { id: sessionId }
          : await createSession(prompt || attachments[0]?.name || "New chat", {
              chatModel: selectedModel,
              chatRuntimeId: resolvedRuntimeId,
              chatReasoningEffort: selectedReasoningEffort,
            })
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
        mentions,
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
        setCurrentSessionTitle(
          "title" in activeSession ? activeSession.title : ""
        )
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
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : t.studioChatFailed

      if (sessionId) {
        setChatErrors((current) => ({ ...current, [sessionId]: message }))
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

  const rightPanelCopy = getStudioRightPanelCopy(locale)
  const chatTitle = currentSessionTitle.trim() || t.studioUntitledSession

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 bg-background">
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col bg-background",
          effectiveRightPanelFocused && "hidden"
        )}
      >
        <div
          data-electron-drag-header
          data-studio-chat-titlebar
          className="flex h-(--titlebar-height) shrink-0 items-center gap-3 px-4"
        >
          <div
            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
            title={chatTitle}
          >
            {chatTitle}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={rightPanelCopy.focusWorkspace}
                  title={rightPanelCopy.focusWorkspace}
                  className={cn(
                    "size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                    effectiveRightPanelFocused && "bg-muted text-foreground"
                  )}
                  onClick={handleToggleFullscreen}
                >
                  {effectiveRightPanelFocused ? (
                    <Minimize2 aria-hidden className="size-3.5" />
                  ) : (
                    <Maximize2 aria-hidden className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent align="end" side="bottom">
                <span>{rightPanelCopy.focusWorkspace}</span>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-testid="studio-terminal-panel-toggle"
                  aria-label={t.studioTerminalPanelToggle}
                  title={t.studioTerminalPanelToggle}
                  className={cn(
                    "size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                    terminalPanelOpen && "bg-muted text-foreground"
                  )}
                  onClick={toggleTerminalPanel}
                >
                  <PanelBottom aria-hidden className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent align="end" side="bottom">
                <span>{t.studioTerminalPanelToggle}</span>
                <span
                  data-slot="kbd"
                  className="bg-background/15 px-1.5 py-0.5 text-[11px] font-semibold text-background/80"
                >
                  Cmd+J
                </span>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-testid="studio-right-panel-toggle"
                  aria-label={rightPanelCopy.toggleRightPanel}
                  title={rightPanelCopy.toggleRightPanel}
                  className={cn(
                    "size-7 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
                    rightPanelOpen && "bg-muted text-foreground"
                  )}
                  onClick={toggleRightPanel}
                >
                  <PanelRight aria-hidden className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent align="end" side="bottom">
                <span>{rightPanelCopy.toggleRightPanel}</span>
                <span
                  data-slot="kbd"
                  className="bg-background/15 px-1.5 py-0.5 text-[11px] font-semibold text-background/80"
                >
                  ⌥⌘B
                </span>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <StudioOutputsCard files={outputFiles} />
          {hasMessages ? (
            <ChatContainerRoot className="h-full min-h-0">
              <ChatContainerContent
                className={cn(
                  "flex min-h-full w-full gap-6 px-8 py-10",
                  outputFiles.length > 0
                    ? "mr-auto ml-0 max-w-[calc(100%-22rem)]"
                    : "mx-auto max-w-5xl"
                )}
              >
                {visibleMessages.map((message) => (
                  <ChatMessageBubble
                    key={message.id}
                    message={message}
                    onRetry={handleRetryMessage}
                  />
                ))}

                {isStarting && !hasStreamingMessage ? (
                  <div className="flex w-full justify-start">
                    <Shimmer className="text-sm">{t.studioThinking}</Shimmer>
                  </div>
                ) : null}

                {error ? (
                  <div
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm",
                      error === "chat-failed"
                        ? "border-destructive/25 bg-destructive/5 text-destructive"
                        : "border-border/70 bg-muted/35 text-muted-foreground"
                    )}
                  >
                    <p>
                      {error === "chat-failed"
                        ? t.studioChatFailed
                        : t.studioLoadFailed}
                    </p>
                    {error === "chat-failed" && chatError ? (
                      <p className="mt-1 text-xs break-words whitespace-pre-wrap text-destructive/80">
                        {chatError}
                      </p>
                    ) : null}
                  </div>
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
                  key={`composer:${sessionId || "new"}`}
                  sessionId={sessionId}
                  value={input}
                  userMessageHistory={userMessageHistory}
                  model={selectedModel}
                  modelOptions={modelOptions}
                  runtimeId={resolvedRuntimeId}
                  runtimeInfos={runtimeInfos}
                  reasoningEffort={selectedReasoningEffort}
                  permissionMode={selectedPermissionMode}
                  localProjects={localProjects}
                  selectedProjectId={selectedProjectId}
                  environment={selectedEnvironment}
                  contextUsage={latestRunUsage}
                  isAddingProject={isAddingLocalProject}
                  attachments={pendingAttachments}
                  mentions={promptMentions}
                  onModelChange={handleModelChange}
                  onRuntimeChange={handleRuntimeChange}
                  onEnvironmentChange={setSelectedEnvironment}
                  onReasoningEffortChange={handleReasoningEffortChange}
                  onPermissionModeChange={handlePermissionModeChange}
                  onAddProject={handleAddLocalProject}
                  onProjectChange={handleProjectChange}
                  onValueChange={setInput}
                  onMentionsChange={setPromptMentions}
                  onAddFiles={addFiles}
                  onRemoveAttachment={removeAttachment}
                  modelSelectOpen={modelSelectOpen}
                  onModelSelectOpenChange={setModelSelectOpen}
                  reasoningSelectOpen={reasoningSelectOpen}
                  onReasoningSelectOpenChange={setReasoningSelectOpen}
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
            <div
              className={cn(
                "flex w-full flex-col gap-2",
                outputFiles.length > 0
                  ? "mr-auto ml-0 max-w-[calc(100%-22rem)]"
                  : "mx-auto max-w-5xl"
              )}
            >
              {pendingUserInputPart ? (
                <PendingUserInputPanel
                  key={pendingUserInputPart.id}
                  part={pendingUserInputPart}
                  onDecision={handleUserInputDecision}
                />
              ) : pendingPermissionPart ? (
                <PendingPermissionApprovalPanel
                  part={pendingPermissionPart}
                  onDecision={handlePermissionDecision}
                />
              ) : (
                <>
                  <ChatComposer
                    key={`composer:${sessionId || "new"}`}
                    sessionId={sessionId}
                    value={input}
                    userMessageHistory={userMessageHistory}
                    model={selectedModel}
                    modelOptions={modelOptions}
                    runtimeId={resolvedRuntimeId}
                    runtimeInfos={runtimeInfos}
                    reasoningEffort={selectedReasoningEffort}
                    permissionMode={selectedPermissionMode}
                    localProjects={localProjects}
                    selectedProjectId={selectedProjectId}
                    environment={selectedEnvironment}
                    contextUsage={latestRunUsage}
                    isAddingProject={isAddingLocalProject}
                    attachments={pendingAttachments}
                    mentions={promptMentions}
                    onModelChange={handleModelChange}
                    onRuntimeChange={handleRuntimeChange}
                    onEnvironmentChange={setSelectedEnvironment}
                    onReasoningEffortChange={handleReasoningEffortChange}
                    onPermissionModeChange={handlePermissionModeChange}
                    onAddProject={handleAddLocalProject}
                    onProjectChange={handleProjectChange}
                    onValueChange={setInput}
                    onMentionsChange={setPromptMentions}
                    onAddFiles={addFiles}
                    onRemoveAttachment={removeAttachment}
                    modelSelectOpen={modelSelectOpen}
                    onModelSelectOpenChange={setModelSelectOpen}
                    reasoningSelectOpen={reasoningSelectOpen}
                    onReasoningSelectOpenChange={setReasoningSelectOpen}
                    onSubmit={handleSubmit}
                    onStop={handleStop}
                    canSubmit={canSubmit}
                    isBusy={isBusy}
                  />
                  <p className="text-center text-xs text-muted-foreground">
                    {t.studioDisclaimer}
                  </p>
                </>
              )}
            </div>
          </div>
        ) : null}

        <StudioTerminalPanel
          open={terminalPanelOpen}
          project={selectedProject}
          onOpenChange={setTerminalPanelOpen}
        />
      </div>

      <StudioRightPanel
        open={rightPanelOpen}
        focused={effectiveRightPanelFocused}
        mode={rightPanelMode}
        width={rightPanelWidth}
        project={selectedProject}
        onOpenChange={handleRightPanelOpenChange}
        onFocusedChange={handleRightPanelFocusedChange}
        onModeChange={setRightPanelMode}
        onWidthChange={setRightPanelWidth}
      />
    </section>
  )
}

function StudioOutputsCard({ files }: { files: StudioOutputFile[] }) {
  const { t } = useI18n()
  const visibleFiles = files.slice(0, 8)
  const overflowCount = Math.max(0, files.length - visibleFiles.length)

  if (files.length === 0) {
    return null
  }

  function handleOpenPath(path: string) {
    if (window.astraflowDesktop?.sidePanelShowItem) {
      void window.astraflowDesktop.sidePanelShowItem(path)
      return
    }

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(path)
      toast.success(t.studioOutputPathCopied)
      return
    }

    toast.error(path)
  }

  return (
    <div className="pointer-events-auto absolute top-4 right-8 z-20 w-64 max-w-[calc(100%-4rem)] rounded-2xl border bg-popover p-3 text-popover-foreground shadow-xl shadow-foreground/10">
      <div className="mb-2 flex items-center gap-2">
        <FileText aria-hidden className="size-3.5 text-muted-foreground" />
        <h2 className="text-xs font-semibold">{t.studioOutputsTitle}</h2>
      </div>
      <div className="flex flex-col gap-1">
        {visibleFiles.map((file) => (
          <button
            key={file.path}
            type="button"
            title={file.path}
            className="flex h-7 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => handleOpenPath(file.path)}
          >
            <RiFileTextLine aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
          </button>
        ))}
      </div>
      {overflowCount > 0 ? (
        <div className="mt-1 px-2 text-xs text-muted-foreground">
          {t.studioOutputsOverflow(overflowCount)}
        </div>
      ) : null}
    </div>
  )
}

function getStudioRightPanelCopy(locale: string) {
  if (locale === "zh") {
    return {
      add: "添加",
      allowBrowser: "允许 AstraFlow 控制内置浏览器",
      alwaysAsk: "始终询问",
      alwaysInclude: "始终包含",
      browser: "浏览器",
      browserDataCleared: "浏览数据已清除",
      browserDataFailed: "清除浏览数据失败",
      browserMenu: "浏览器菜单",
      browserSettings: "Browser settings",
      browserStart: "开始浏览",
      browserStartDescription: "输入 URL 以打开页面",
      browserTitle: "浏览器",
      browsingData: "浏览数据",
      browsingDataHelp:
        "清除应用内浏览器中的历史记录、网站数据、缓存和下载历史记录",
      clearAllBrowsingData: "清除所有浏览数据",
      clearBrowsingData: "Clear browsing data",
      desktopUnavailable: "仅桌面应用可用",
      emptyFolder: "这个文件夹为空",
      files: "文件",
      filesShortcut: "⌘P",
      filterFiles: "筛选文件...",
      findInPage: "在页面中查找",
      focusWorkspace: "聚焦工作区",
      forceReload: "强制重新加载",
      localTargetApp: "AstraFlow",
      localUrlHelp: "本地开发站点默认打开位置",
      localUrlTarget: "本地 URL 打开目标位置",
      newTab: "新选项卡",
      noPreview: "无法预览这个文件",
      noWebsitePermissions: "尚无网站专属权限",
      open: "打开",
      permissions: "权限",
      permissionsHelp: "选择是否让 AstraFlow 在打开网站前先请求批准。",
      screenshotHelp:
        "截图可帮助 AstraFlow 更好地理解并处理评论，但会增加套餐用量",
      screenshotMode: "批注截图",
      settingsDescription:
        "管理 AstraFlow 的浏览器。可在计算机使用设置中设置 Google Chrome",
      showDeviceToolbar: "显示设备工具栏",
      sideChat: "侧边聊天",
      sideChatGreeting: "在侧边聊天里记录临时想法，不影响主对话。",
      sideChatPlaceholder: "写一条侧边消息...",
      sideChatShortcut: "⌥⌘S",
      terminal: "终端",
      toggleRightPanel: "显示/隐藏侧边栏",
      truncated: "文件较大，已截断预览",
      websitePermissions: "网站权限",
      websitePermissionsHelp: "为特定网站覆盖上述默认设置",
      zoom: "缩放",
    }
  }

  return {
    add: "Add",
    allowBrowser: "Allow AstraFlow to control the in-app browser",
    alwaysAsk: "Always ask",
    alwaysInclude: "Always include",
    browser: "Browser",
    browserDataCleared: "Browsing data cleared",
    browserDataFailed: "Failed to clear browsing data",
    browserMenu: "Browser menu",
    browserSettings: "Browser settings",
    browserStart: "Start browsing",
    browserStartDescription: "Enter a URL to open a page",
    browserTitle: "Browser",
    browsingData: "Browsing data",
    browsingDataHelp:
      "Clear history, website data, cache, and download history from the in-app browser",
    clearAllBrowsingData: "Clear all browsing data",
    clearBrowsingData: "Clear browsing data",
    desktopUnavailable: "Only available in the desktop app",
    emptyFolder: "This folder is empty",
    files: "Files",
    filesShortcut: "⌘P",
    filterFiles: "Filter files...",
    findInPage: "Find in page",
    focusWorkspace: "Focus workspace",
    forceReload: "Force reload",
    localTargetApp: "AstraFlow",
    localUrlHelp: "Default open location for local development sites",
    localUrlTarget: "Local URL target",
    newTab: "New tab",
    noPreview: "This file cannot be previewed",
    noWebsitePermissions: "No website-specific permissions",
    open: "Open",
    permissions: "Permissions",
    permissionsHelp:
      "Choose whether AstraFlow should ask before opening websites.",
    screenshotHelp:
      "Screenshots help AstraFlow understand and handle comments, but use more quota",
    screenshotMode: "Comment screenshots",
    settingsDescription:
      "Manage AstraFlow's browser. Set Google Chrome in computer use settings",
    showDeviceToolbar: "Show device toolbar",
    sideChat: "Side chat",
    sideChatGreeting:
      "Capture temporary notes here without changing the main thread.",
    sideChatPlaceholder: "Write a side message...",
    sideChatShortcut: "⌥⌘S",
    terminal: "Terminal",
    toggleRightPanel: "Show/hide side panel",
    truncated: "Large file truncated for preview",
    websitePermissions: "Website permissions",
    websitePermissionsHelp: "Override defaults for specific websites",
    zoom: "Zoom",
  }
}

type StudioRightPanelCopy = ReturnType<typeof getStudioRightPanelCopy>

function StudioRightPanel({
  open,
  focused,
  mode,
  width,
  project,
  onOpenChange,
  onFocusedChange,
  onModeChange,
  onWidthChange,
}: {
  open: boolean
  focused: boolean
  mode: StudioRightPanelMode
  width: number
  project: StudioLocalProjectWithGitInfo | null
  onOpenChange: (open: boolean) => void
  onFocusedChange: (focused: boolean) => void
  onModeChange: (mode: StudioRightPanelMode) => void
  onWidthChange: (width: number) => void
}) {
  const { locale, t } = useI18n()
  const copy = React.useMemo(() => getStudioRightPanelCopy(locale), [locale])
  const [workspaceTabs, setWorkspaceTabs] = React.useState<
    StudioWorkspaceTab[]
  >([])
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = React.useState("")
  const [nextTerminalSequence, setNextTerminalSequence] = React.useState(1)
  const suppressAutoOpenModeRef = React.useRef<StudioRightPanelMode | null>(
    null
  )
  const activeWorkspaceTab =
    workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) ??
    workspaceTabs[0] ??
    null
  const activeWorkspaceMode = activeWorkspaceTab
    ? getWorkspaceTabMode(activeWorkspaceTab)
    : mode
  const fileTabs = workspaceTabs.filter(
    (tab): tab is StudioWorkspaceFileTab => tab.kind === "files"
  )
  const terminalTabs = workspaceTabs.filter(
    (tab): tab is StudioWorkspaceTerminalTab => tab.kind === "terminal"
  )

  const activateWorkspaceTab = React.useCallback(
    (tab: StudioWorkspaceTab) => {
      setActiveWorkspaceTabId(tab.id)
      onModeChange(getWorkspaceTabMode(tab))
    },
    [onModeChange]
  )

  const handleOpenFileTab = React.useCallback(
    (entry: AstraFlowSidePanelDirectoryEntry) => {
      const existingTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceFileTab =>
          tab.kind === "files" && tab.entry?.path === entry.path
      )

      if (existingTab) {
        activateWorkspaceTab(existingTab)
        return
      }

      const reusableEmptyFileTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceFileTab =>
          tab.kind === "files" && tab.entry === null
      )
      const nextTab: StudioWorkspaceFileTab = reusableEmptyFileTab
        ? { ...reusableEmptyFileTab, title: entry.name, entry }
        : createWorkspaceFileTab(entry, copy.files)

      setWorkspaceTabs((current) => {
        if (reusableEmptyFileTab) {
          return current.map((tab) =>
            tab.id === reusableEmptyFileTab.id ? nextTab : tab
          )
        }

        return [...current, nextTab]
      })
      activateWorkspaceTab(nextTab)
    },
    [activateWorkspaceTab, copy.files, workspaceTabs]
  )

  const handleAddWorkspaceMode = React.useCallback(
    (nextMode: StudioRightPanelMode) => {
      if (nextMode === "launcher" || nextMode === "browser-settings") {
        onModeChange(nextMode)
        return
      }

      if (nextMode === "files") {
        const existingFileTab = workspaceTabs.find(
          (tab): tab is StudioWorkspaceFileTab => tab.kind === "files"
        )
        const nextTab =
          existingFileTab ?? createWorkspaceFileTab(null, copy.files)

        if (!existingFileTab) {
          setWorkspaceTabs((current) => [...current, nextTab])
        }

        activateWorkspaceTab(nextTab)
        return
      }

      if (nextMode === "browser") {
        if (mode === "browser-settings") {
          const existingBrowserTab =
            activeWorkspaceTab?.kind === "browser"
              ? activeWorkspaceTab
              : workspaceTabs.find(
                  (tab): tab is StudioWorkspaceBrowserTab =>
                    tab.kind === "browser"
                )

          if (existingBrowserTab) {
            activateWorkspaceTab(existingBrowserTab)
            return
          }
        }

        const nextTab = createWorkspaceBrowserTab()

        setWorkspaceTabs((current) => [...current, nextTab])
        activateWorkspaceTab(nextTab)
        return
      }

      if (nextMode === "terminal") {
        const nextTab = createWorkspaceTerminalTab(
          project,
          t.studioTerminalTab,
          nextTerminalSequence
        )

        setNextTerminalSequence((current) => current + 1)
        setWorkspaceTabs((current) => [...current, nextTab])
        activateWorkspaceTab(nextTab)
        return
      }

      const existingSideChatTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceSideChatTab => tab.kind === "side-chat"
      )
      const nextTab =
        existingSideChatTab ?? createWorkspaceSideChatTab(copy.sideChat)

      if (!existingSideChatTab) {
        setWorkspaceTabs((current) => [...current, nextTab])
      }

      activateWorkspaceTab(nextTab)
    },
    [
      activateWorkspaceTab,
      copy.files,
      copy.sideChat,
      activeWorkspaceTab,
      mode,
      nextTerminalSequence,
      onModeChange,
      project,
      t.studioTerminalTab,
      workspaceTabs,
    ]
  )

  const handleUpdateWorkspaceTab = React.useCallback(
    (
      tabId: string,
      updater: (tab: StudioWorkspaceTab) => StudioWorkspaceTab
    ) => {
      setWorkspaceTabs((current) =>
        current.map((tab) => (tab.id === tabId ? updater(tab) : tab))
      )
    },
    []
  )

  const handleCloseWorkspaceTab = React.useCallback(
    (tabId: string) => {
      const closingIndex = workspaceTabs.findIndex((tab) => tab.id === tabId)

      if (closingIndex < 0) {
        return
      }

      const nextTabs = workspaceTabs.filter((tab) => tab.id !== tabId)
      const nextActiveTab =
        activeWorkspaceTabId === tabId
          ? (nextTabs[Math.max(0, closingIndex - 1)] ?? nextTabs[0] ?? null)
          : (nextTabs.find((tab) => tab.id === activeWorkspaceTabId) ?? null)

      if (!nextActiveTab) {
        suppressAutoOpenModeRef.current = getWorkspaceTabMode(
          workspaceTabs[closingIndex]
        )
      }

      setWorkspaceTabs(nextTabs)
      setActiveWorkspaceTabId(nextActiveTab?.id ?? "")
      onModeChange(
        nextActiveTab ? getWorkspaceTabMode(nextActiveTab) : "launcher"
      )
    },
    [activeWorkspaceTabId, onModeChange, workspaceTabs]
  )

  useCloseTabCommand(
    () => {
      if (activeWorkspaceTab) {
        handleCloseWorkspaceTab(activeWorkspaceTab.id)
      }
    },
    open && Boolean(activeWorkspaceTab)
  )

  React.useEffect(() => {
    if (mode === "launcher" || mode === "browser-settings") {
      suppressAutoOpenModeRef.current = null
    }
  }, [mode])

  React.useEffect(() => {
    if (!open) {
      return
    }

    if (mode === "launcher" || mode === "browser-settings") {
      return
    }

    if (!activeWorkspaceTab && suppressAutoOpenModeRef.current === mode) {
      return
    }

    if (
      activeWorkspaceTab &&
      getWorkspaceTabMode(activeWorkspaceTab) === mode
    ) {
      return
    }

    queueMicrotask(() => handleAddWorkspaceMode(mode))
  }, [activeWorkspaceTab, handleAddWorkspaceMode, mode, open])

  const handleOpenMarkdownTarget = React.useCallback(
    (href: string) => {
      const filePath = getMarkdownTargetFilePath(href)

      onOpenChange(true)

      if (filePath) {
        handleOpenFileTab(createSidePanelEntryFromPath(filePath))
        return
      }

      const url = getMarkdownTargetBrowserUrl(href)

      if (!url) {
        return
      }

      const nextTab: StudioWorkspaceBrowserTab = {
        ...createWorkspaceBrowserTab(),
        address: url,
        title: getBrowserTabTitle(url),
        url,
      }

      setWorkspaceTabs((current) => [...current, nextTab])
      activateWorkspaceTab(nextTab)
    },
    [activateWorkspaceTab, handleOpenFileTab, onOpenChange]
  )

  React.useEffect(() => {
    function handleEvent(event: Event) {
      const detail = (event as CustomEvent<StudioOpenMarkdownTargetDetail>)
        .detail

      if (detail?.href) {
        handleOpenMarkdownTarget(detail.href)
      }
    }

    window.addEventListener(STUDIO_OPEN_MARKDOWN_TARGET_EVENT, handleEvent)

    return () =>
      window.removeEventListener(STUDIO_OPEN_MARKDOWN_TARGET_EVENT, handleEvent)
  }, [handleOpenMarkdownTarget])

  React.useEffect(() => {
    if (!open) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (focused) {
          onFocusedChange(false)
          return
        }

        onOpenChange(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [focused, onFocusedChange, onOpenChange, open])

  function handleResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()

    const startX = event.clientX
    const startWidth = width

    function handleMove(moveEvent: PointerEvent) {
      onWidthChange(startWidth + startX - moveEvent.clientX)
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
  }

  return (
    <aside
      data-testid="studio-right-panel"
      aria-hidden={!open}
      className={cn(
        "relative shrink-0 overflow-hidden border-l bg-background transition-[width,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        open ? "border-border" : "pointer-events-none border-transparent",
        focused && "min-w-0 flex-1 border-l-0"
      )}
      style={{ width: open ? (focused ? "100%" : width) : 0 }}
    >
      <div
        className={cn(
          "relative flex h-full min-h-0 flex-col bg-background transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          open ? "translate-x-0 opacity-100" : "translate-x-5 opacity-0"
        )}
        style={{ width: focused ? "100%" : width }}
      >
        {!focused ? (
          <div
            role="separator"
            aria-orientation="vertical"
            className="absolute top-0 left-0 z-20 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/25"
            onPointerDown={handleResizePointerDown}
          />
        ) : null}

        {mode === "launcher" && workspaceTabs.length === 0 ? (
          <StudioRightPanelLauncher copy={copy} onModeChange={onModeChange} />
        ) : (
          <>
            <StudioWorkspaceTabStrip
              activeMode={activeWorkspaceMode}
              activeTabId={activeWorkspaceTab?.id ?? ""}
              copy={copy}
              tabs={workspaceTabs}
              onAddMode={handleAddWorkspaceMode}
              onCloseTab={handleCloseWorkspaceTab}
              onSelectTab={(tabId) => {
                const nextTab = workspaceTabs.find((tab) => tab.id === tabId)

                if (nextTab) {
                  activateWorkspaceTab(nextTab)
                }
              }}
            />

            <div className="relative min-h-0 flex-1">
              {mode === "browser-settings" ? (
                <StudioRightPanelBrowserSettings
                  copy={copy}
                  onModeChange={handleAddWorkspaceMode}
                />
              ) : null}

              <div
                className={cn(
                  "absolute inset-0 min-h-0",
                  mode === "browser-settings" ||
                    activeWorkspaceTab?.kind !== "files"
                    ? "hidden"
                    : "block"
                )}
              >
                <StudioRightPanelFiles
                  activeFileTabId={
                    activeWorkspaceTab?.kind === "files"
                      ? activeWorkspaceTab.id
                      : ""
                  }
                  copy={copy}
                  defaultDirectory={project?.path ?? null}
                  fileTabs={fileTabs}
                  onOpenFile={handleOpenFileTab}
                />
              </div>

              <div
                className={cn(
                  "absolute inset-0 min-h-0",
                  mode === "browser-settings" ||
                    activeWorkspaceTab?.kind !== "browser"
                    ? "hidden"
                    : "block"
                )}
              >
                {activeWorkspaceTab?.kind === "browser" ? (
                  <StudioRightPanelBrowser
                    copy={copy}
                    tab={activeWorkspaceTab}
                    onModeChange={handleAddWorkspaceMode}
                    onTabChange={(updater) =>
                      handleUpdateWorkspaceTab(activeWorkspaceTab.id, (tab) =>
                        tab.kind === "browser" ? updater(tab) : tab
                      )
                    }
                  />
                ) : null}
              </div>

              {activeWorkspaceTab?.kind === "side-chat" ? (
                <StudioRightPanelSideChat copy={copy} />
              ) : null}

              {terminalTabs.length > 0 ? (
                <div
                  className={cn(
                    "absolute inset-0 min-h-0",
                    mode === "browser-settings" ||
                      activeWorkspaceTab?.kind !== "terminal"
                      ? "hidden"
                      : "block"
                  )}
                >
                  <StudioSideTerminal
                    active={
                      open &&
                      mode !== "browser-settings" &&
                      activeWorkspaceTab?.kind === "terminal"
                    }
                    activeTabId={
                      activeWorkspaceTab?.kind === "terminal"
                        ? activeWorkspaceTab.id
                        : ""
                    }
                    copy={copy}
                    tabs={terminalTabs}
                    onResolvedCwd={(tabId, resolvedCwd) =>
                      handleUpdateWorkspaceTab(tabId, (tab) => {
                        if (tab.kind !== "terminal") {
                          return tab
                        }

                        const title =
                          tab.cwd === null
                            ? formatTerminalTabTitle(
                                getPathTail(resolvedCwd) || t.studioTerminalTab,
                                tab.sequence
                              )
                            : tab.title

                        return {
                          ...tab,
                          resolvedCwd,
                          title,
                        }
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

function StudioRightPanelLauncher({
  copy,
  onModeChange,
}: {
  copy: StudioRightPanelCopy
  onModeChange: (mode: StudioRightPanelMode) => void
}) {
  const items = getStudioRightPanelItems(copy)

  return (
    <div className="flex h-full min-h-0 flex-col px-3 pt-12 pb-5">
      <div className="flex min-h-0 flex-1 items-center">
        <div className="flex w-full min-w-0 flex-col gap-1.5">
          {items.map((item) => {
            const Icon = item.icon

            return (
              <button
                key={item.mode}
                type="button"
                className="flex h-10 w-full min-w-0 items-center gap-2.5 rounded-lg bg-muted/55 px-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
                onClick={() => onModeChange(item.mode)}
              >
                <Icon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut ? (
                  <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {item.shortcut}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StudioWorkspaceTabStrip({
  activeMode,
  activeTabId,
  copy,
  tabs,
  onAddMode,
  onCloseTab,
  onSelectTab,
}: {
  activeMode: StudioRightPanelMode
  activeTabId: string
  copy: StudioRightPanelCopy
  tabs: StudioWorkspaceTab[]
  onAddMode: (mode: StudioRightPanelMode) => void
  onCloseTab: (tabId: string) => void
  onSelectTab: (tabId: string) => void
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 border-b px-3 pr-24">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <div className="max-w-full min-w-0 [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-center gap-1">
            {tabs.map((tab) => {
              const isSelected = tab.id === activeTabId

              return (
                <div
                  key={tab.id}
                  className={cn(
                    "group flex h-8 max-w-48 min-w-0 items-center rounded-lg text-xs transition-colors",
                    isSelected
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                  title={getWorkspaceTabTitle(tab)}
                >
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left"
                    aria-current={isSelected ? "page" : undefined}
                    onClick={() => onSelectTab(tab.id)}
                  >
                    <StudioWorkspaceTabIcon tab={tab} />
                    <span className="truncate">
                      {getWorkspaceTabTitle(tab)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "mr-1 grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-opacity group-focus-within:opacity-75 group-hover:opacity-75 hover:bg-background/80 hover:text-foreground",
                      isSelected ? "opacity-70" : "opacity-0"
                    )}
                    aria-label="Close tab"
                    title="Close tab"
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                  >
                    <RiCloseLine aria-hidden className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <StudioRightPanelModeMenu
          activeMode={activeMode}
          copy={copy}
          includeActiveMode
          onModeChange={onAddMode}
        />
      </div>
    </div>
  )
}

function StudioWorkspaceTabIcon({ tab }: { tab: StudioWorkspaceTab }) {
  if (tab.kind === "browser") {
    return <Globe aria-hidden className="size-3.5 shrink-0" />
  }

  if (tab.kind === "terminal") {
    return <SquareTerminal aria-hidden className="size-3.5 shrink-0" />
  }

  if (tab.kind === "side-chat") {
    return <MessageSquare aria-hidden className="size-3.5 shrink-0" />
  }

  return tab.entry ? (
    <StudioSidePanelFileIcon entry={tab.entry} />
  ) : (
    <RiFileTextLine aria-hidden className="size-3.5 shrink-0" />
  )
}

function getStudioRightPanelItems(copy: StudioRightPanelCopy) {
  return [
    {
      mode: "files" as const,
      label: copy.files,
      shortcut: copy.filesShortcut,
      icon: Folder,
    },
    {
      mode: "side-chat" as const,
      label: copy.sideChat,
      shortcut: copy.sideChatShortcut,
      icon: MessageSquare,
    },
    {
      mode: "browser" as const,
      label: copy.browser,
      shortcut: "⌘T",
      icon: Globe,
    },
    {
      mode: "terminal" as const,
      label: copy.terminal,
      shortcut: "",
      icon: SquareTerminal,
    },
  ]
}

function StudioRightPanelModeMenu({
  activeMode,
  copy,
  extraItems = [],
  includeActiveMode = false,
  onModeChange,
}: {
  activeMode: StudioRightPanelMode
  copy: StudioRightPanelCopy
  extraItems?: Array<{
    key: string
    label: string
    icon: React.ComponentType<{ "aria-hidden"?: boolean; className?: string }>
    shortcut?: string
    onSelect: () => void
  }>
  includeActiveMode?: boolean
  onModeChange: (mode: StudioRightPanelMode) => void
}) {
  const [open, setOpen] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const items = getStudioRightPanelItems(copy).filter(
    (item) => includeActiveMode || item.mode !== activeMode
  )

  React.useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener("pointerdown", handlePointerDown)

    return () => window.removeEventListener("pointerdown", handlePointerDown)
  }, [open])

  return (
    <div ref={menuRef} className="relative shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-expanded={open}
        aria-label={copy.add}
        title={copy.add}
        className={cn("size-8 rounded-lg", open && "bg-muted text-foreground")}
        onClick={() => setOpen((current) => !current)}
      >
        <RiAddLine aria-hidden className="size-4" />
      </Button>

      {open ? (
        <div className="absolute top-9 left-0 z-40 w-44 rounded-lg border bg-background p-1.5 text-sm shadow-xl">
          {extraItems.map((item) => {
            const Icon = item.icon

            return (
              <button
                key={item.key}
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left font-medium hover:bg-muted"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <Icon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut ? (
                  <span className="text-xs text-muted-foreground">
                    {item.shortcut}
                  </span>
                ) : null}
              </button>
            )
          })}
          {extraItems.length > 0 && items.length > 0 ? (
            <div className="my-1 h-px bg-border" />
          ) : null}
          {items.map((item) => {
            const Icon = item.icon

            return (
              <button
                key={item.mode}
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left font-medium hover:bg-muted"
                onClick={() => {
                  setOpen(false)
                  onModeChange(item.mode)
                }}
              >
                <Icon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut ? (
                  <span className="text-xs text-muted-foreground">
                    {item.shortcut}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function StudioRightPanelFiles({
  activeFileTabId,
  copy,
  defaultDirectory,
  fileTabs,
  onOpenFile,
}: {
  activeFileTabId: string
  copy: StudioRightPanelCopy
  defaultDirectory: string | null
  fileTabs: StudioWorkspaceFileTab[]
  onOpenFile: (entry: AstraFlowSidePanelDirectoryEntry) => void
}) {
  const [directory, setDirectory] = React.useState<string | null>(null)
  const [listing, setListing] =
    React.useState<AstraFlowSidePanelDirectory | null>(null)
  const [preview, setPreview] =
    React.useState<StudioSidePanelFilePreview | null>(null)
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  const previewRequestRef = React.useRef(0)
  const defaultDirectoryRef = React.useRef<string | null>(null)
  const hasAppliedDefaultDirectoryRef = React.useRef(false)

  const activeFileTab =
    fileTabs.find((tab) => tab.id === activeFileTabId) ??
    fileTabs.find((tab) => tab.entry) ??
    null
  const selectedEntry =
    activeFileTab?.entry ??
    (activeFileTab?.entry?.path
      ? listing?.entries.find(
          (entry) => entry.path === activeFileTab.entry?.path
        )
      : null) ??
    null

  React.useEffect(() => {
    let cancelled = false
    const projectChanged = defaultDirectoryRef.current !== defaultDirectory

    if (!projectChanged && hasAppliedDefaultDirectoryRef.current) {
      return
    }

    defaultDirectoryRef.current = defaultDirectory

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      if (defaultDirectory) {
        setDirectory(defaultDirectory)
        hasAppliedDefaultDirectoryRef.current = true
      } else if (projectChanged) {
        setDirectory(null)
        hasAppliedDefaultDirectoryRef.current = true
      }
    })

    return () => {
      cancelled = true
    }
  }, [defaultDirectory])

  const loadPreviewForEntry = React.useCallback(
    async (entry: AstraFlowSidePanelDirectoryEntry) => {
      const requestId = previewRequestRef.current + 1
      previewRequestRef.current = requestId
      setPreviewLoading(true)
      setPreview(null)

      try {
        const bridge = window.astraflowDesktop

        if (isImageEntry(entry)) {
          if (!bridge?.sidePanelReadFileDataUrl) {
            throw new Error(copy.desktopUnavailable)
          }

          const file = await bridge.sidePanelReadFileDataUrl(entry.path)

          if (previewRequestRef.current === requestId) {
            setPreview({ kind: "image", entry, file })
          }
          return
        }

        if (isLikelyTextEntry(entry)) {
          if (!bridge?.sidePanelReadTextFile) {
            throw new Error(copy.desktopUnavailable)
          }

          const file = await bridge.sidePanelReadTextFile(entry.path)

          if (previewRequestRef.current === requestId) {
            setPreview({ kind: "text", entry, file })
          }
          return
        }

        if (previewRequestRef.current === requestId) {
          setPreview({ kind: "unsupported", entry })
        }
      } catch (previewError) {
        if (previewRequestRef.current === requestId) {
          setPreview({
            kind: "unsupported",
            entry,
            error:
              previewError instanceof Error
                ? previewError.message
                : copy.noPreview,
          })
        }
      } finally {
        if (previewRequestRef.current === requestId) {
          setPreviewLoading(false)
        }
      }
    },
    [copy.desktopUnavailable, copy.noPreview]
  )

  React.useEffect(() => {
    if (!selectedEntry) {
      return
    }

    queueMicrotask(() => {
      void loadPreviewForEntry(selectedEntry)
    })
  }, [loadPreviewForEntry, selectedEntry])

  React.useEffect(() => {
    let disposed = false

    async function loadDirectory() {
      const bridge = window.astraflowDesktop

      if (!bridge?.sidePanelListDirectory) {
        setError(copy.desktopUnavailable)
        setLoading(false)
        return
      }

      setLoading(true)
      setError("")

      try {
        const nextListing = await bridge.sidePanelListDirectory(directory)

        if (disposed) {
          return
        }

        setListing(nextListing)

        const firstPreviewable =
          nextListing.entries.find(isPreviewableSidePanelEntry) ??
          nextListing.entries.find((entry) => entry.kind === "file") ??
          null

        if (firstPreviewable && fileTabs.length === 0) {
          onOpenFile(firstPreviewable)
        } else if (!firstPreviewable) {
          setPreview(null)
        }
      } catch (loadError) {
        if (!disposed) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : copy.desktopUnavailable
          )
          setListing(null)
          setPreview(null)
        }
      } finally {
        if (!disposed) {
          setLoading(false)
        }
      }
    }

    void loadDirectory()

    return () => {
      disposed = true
    }
  }, [
    copy.desktopUnavailable,
    directory,
    fileTabs.length,
    loadPreviewForEntry,
    onOpenFile,
  ])

  function handleSelectEntry(entry: AstraFlowSidePanelDirectoryEntry) {
    if (entry.kind === "directory") {
      setDirectory(entry.path)
      return
    }

    onOpenFile(entry)
  }

  function handleOpenSelected() {
    const target = selectedEntry?.path ?? listing?.cwd

    if (target) {
      void window.astraflowDesktop?.sidePanelShowItem(target)
    }
  }

  const filteredEntries = (listing?.entries ?? []).filter((entry) =>
    entry.name.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => setDirectory(null)}
          >
            {formatFileBreadcrumb(listing?.cwd)}
          </button>
          {selectedEntry ? (
            <>
              <span className="px-2 text-muted-foreground/60">›</span>
              <span className="font-medium text-foreground">
                {selectedEntry.name}
              </span>
            </>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8 rounded-lg"
          aria-label={copy.open}
          title={copy.open}
          onClick={handleOpenSelected}
        >
          <RiExternalLinkLine aria-hidden className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-lg px-2 text-xs"
          onClick={handleOpenSelected}
        >
          <Folder aria-hidden className="size-3.5" />
          {copy.open}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(190px,42%)]">
        <div className="min-h-0 overflow-auto border-r bg-background">
          {loading && !listing ? (
            <div className="p-8 text-sm text-muted-foreground">Loading...</div>
          ) : error ? (
            <div className="p-8 text-sm text-muted-foreground">{error}</div>
          ) : !selectedEntry ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              {listing?.entries.length ? copy.noPreview : copy.emptyFolder}
            </div>
          ) : previewLoading ? (
            <div className="p-8 text-sm text-muted-foreground">Loading...</div>
          ) : preview ? (
            <StudioSidePanelPreview preview={preview} copy={copy} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              {listing?.entries.length ? copy.noPreview : copy.emptyFolder}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col bg-background p-3">
          <label className="relative shrink-0">
            <RiSearchLine
              aria-hidden
              className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={query}
              placeholder={copy.filterFiles}
              className="h-9 w-full rounded-lg border bg-background pr-2.5 pl-8 text-xs transition-colors outline-none focus:border-ring"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {filteredEntries.map((entry) => {
              const isSelected = selectedEntry?.path === entry.path

              return (
                <button
                  key={entry.path}
                  type="button"
                  className={cn(
                    "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
                    isSelected
                      ? "bg-muted text-foreground"
                      : "text-foreground hover:bg-muted/60"
                  )}
                  onClick={() => void handleSelectEntry(entry)}
                >
                  <StudioSidePanelFileIcon entry={entry} />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {entry.kind === "file" && entry.size ? (
                    <span className="hidden text-[10px] text-muted-foreground xl:inline">
                      {formatSidePanelFileSize(entry.size)}
                    </span>
                  ) : null}
                </button>
              )
            })}
            {!loading && filteredEntries.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                {copy.emptyFolder}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function StudioSidePanelPreview({
  preview,
  copy,
}: {
  preview: StudioSidePanelFilePreview
  copy: StudioRightPanelCopy
}) {
  if (preview.kind === "image") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.file.dataUrl}
            alt={preview.entry.name}
            className="max-h-full max-w-full rounded-md object-contain shadow-sm"
          />
        </div>
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-t px-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate text-foreground">
            {preview.entry.name}
          </span>
          <span className="shrink-0">
            {formatSidePanelFileSize(preview.file.size)}
          </span>
        </div>
      </div>
    )
  }

  if (preview.kind === "text") {
    return (
      <StudioTextFilePreview
        entry={preview.entry}
        file={preview.file}
        copy={copy}
      />
    )
  }

  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {preview.error || copy.noPreview}
    </div>
  )
}

function StudioTextFilePreview({
  entry,
  file,
  copy,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelTextFile
  copy: StudioRightPanelCopy
}) {
  const isMarkdown = entry.extension === "md" || entry.name.endsWith(".md")

  if (isMarkdown) {
    return <StudioMarkdownFilePreview file={file} copy={copy} />
  }

  const isHtml =
    entry.extension === "html" ||
    entry.extension === "htm" ||
    entry.name.endsWith(".html") ||
    entry.name.endsWith(".htm")

  if (isHtml && !file.truncated) {
    return <StudioHtmlFilePreview entry={entry} file={file} />
  }

  return (
    <div className="min-h-full bg-background">
      <CodeBlock className="min-w-max rounded-none border-0 bg-transparent">
        <CodeBlockCode
          code={file.content}
          language={inferCodeLanguage(entry)}
          className="text-[12px] leading-5 [&>pre]:min-h-full [&>pre]:px-4 [&>pre]:py-4"
        />
      </CodeBlock>
      {file.truncated ? (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          {copy.truncated}
        </p>
      ) : null}
    </div>
  )
}

function StudioHtmlFilePreview({
  entry,
  file,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
  file: AstraFlowSidePanelTextFile
}) {
  const { t } = useI18n()
  const [view, setView] = React.useState<"rendered" | "source">("rendered")

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {entry.name}
        </span>
        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-muted/60 p-0.5">
          <button
            type="button"
            onClick={() => setView("rendered")}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs transition-colors",
              view === "rendered"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.studioFilePreviewRendered}
          </button>
          <button
            type="button"
            onClick={() => setView("source")}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs transition-colors",
              view === "source"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.studioFilePreviewSource}
          </button>
        </div>
      </div>
      {view === "rendered" ? (
        <div className="min-h-0 flex-1 bg-white">
          <iframe
            key={entry.path}
            title={entry.name}
            srcDoc={file.content}
            className="size-full border-0 bg-white"
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <CodeBlock className="min-w-max rounded-none border-0 bg-transparent">
            <CodeBlockCode
              code={file.content}
              language={inferCodeLanguage(entry)}
              className="text-[12px] leading-5 [&>pre]:min-h-full [&>pre]:px-4 [&>pre]:py-4"
            />
          </CodeBlock>
        </div>
      )}
    </div>
  )
}

function StudioMarkdownFilePreview({
  file,
  copy,
}: {
  file: AstraFlowSidePanelTextFile
  copy: StudioRightPanelCopy
}) {
  const parsed = React.useMemo(
    () => parseMarkdownFrontmatter(file.content),
    [file.content]
  )
  const title =
    parsed.metadata.find(([key]) => ["name", "title"].includes(key))?.[1] ??
    file.name
  const description =
    parsed.metadata.find(([key]) => key === "description")?.[1] ?? ""
  const secondaryMetadata = parsed.metadata.filter(
    ([key]) => !["name", "title", "description"].includes(key)
  )

  return (
    <div className="mx-auto min-h-full max-w-3xl px-6 py-5">
      {parsed.metadata.length > 0 ? (
        <section className="mb-5 rounded-lg border bg-muted/20 p-4">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
          {secondaryMetadata.length > 0 ? (
            <div className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
              {secondaryMetadata.map(([key, value]) => (
                <div
                  key={key}
                  className="flex min-w-0 items-start gap-2 rounded-md bg-background/80 px-2 py-1.5"
                >
                  <span className="shrink-0 font-medium text-muted-foreground">
                    {key}
                  </span>
                  <span className="min-w-0 break-words text-foreground">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:text-foreground prose-a:text-primary prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5">
        {parsed.body || file.content}
      </Markdown>

      {file.truncated ? (
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          {copy.truncated}
        </p>
      ) : null}
    </div>
  )
}

function StudioSidePanelFileIcon({
  entry,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
}) {
  if (entry.kind === "directory") {
    return (
      <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    )
  }

  if (IMAGE_FILE_EXTENSIONS.has(entry.extension)) {
    return <FileImage aria-hidden className="size-4 shrink-0 text-rose-500" />
  }

  if (["csv", "tsv", "xlsx", "xls"].includes(entry.extension)) {
    return (
      <FileSpreadsheet aria-hidden className="size-4 shrink-0 text-cyan-600" />
    )
  }

  if (["zip", "tar", "gz", "dmg"].includes(entry.extension)) {
    return <Archive aria-hidden className="size-4 shrink-0 text-amber-600" />
  }

  return <File aria-hidden className="size-4 shrink-0 text-muted-foreground" />
}

function StudioRightPanelSideChat({ copy }: { copy: StudioRightPanelCopy }) {
  const [messages, setMessages] = React.useState<StudioSideChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: copy.sideChatGreeting,
    },
  ])
  const [draft, setDraft] = React.useState("")

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const content = draft.trim()

    if (!content) {
      return
    }

    setMessages((current) => [
      ...current,
      {
        id: createClientId(),
        role: "user",
        content,
      },
    ])
    setDraft("")
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-2">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[88%] rounded-xl px-3 py-2 text-xs leading-5",
                message.role === "user"
                  ? "self-end bg-foreground text-background"
                  : "self-start bg-muted text-foreground"
              )}
            >
              {message.content}
            </div>
          ))}
        </div>
      </div>

      <form className="shrink-0 border-t p-3" onSubmit={handleSubmit}>
        <div className="flex items-center gap-2 rounded-xl border bg-background p-1.5">
          <input
            value={draft}
            placeholder={copy.sideChatPlaceholder}
            className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="icon-sm" disabled={!draft.trim()}>
            <RiArrowUpLine aria-hidden className="size-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}

const studioBrowserTitleCache = new Map<string, string>()
const studioBrowserTitleRequests = new Map<string, Promise<string>>()

function fetchStudioBrowserTitle(url: string) {
  const cachedTitle = studioBrowserTitleCache.get(url)
  if (cachedTitle !== undefined) {
    return Promise.resolve(cachedTitle)
  }

  const existingRequest = studioBrowserTitleRequests.get(url)
  if (existingRequest) {
    return existingRequest
  }

  const request = fetch(
    `/api/studio/browser-title?url=${encodeURIComponent(url)}`
  )
    .then((response) => (response.ok ? response.json() : null))
    .then((payload: { ok?: boolean; title?: string } | null) => {
      const title = payload?.ok ? payload.title?.trim() || "" : ""
      studioBrowserTitleCache.set(url, title)
      return title
    })
    .catch(() => {
      studioBrowserTitleCache.set(url, "")
      return ""
    })
    .finally(() => {
      studioBrowserTitleRequests.delete(url)
    })

  studioBrowserTitleRequests.set(url, request)
  return request
}

function StudioRightPanelBrowser({
  copy,
  tab,
  onModeChange,
  onTabChange,
}: {
  copy: StudioRightPanelCopy
  onModeChange: (mode: StudioRightPanelMode) => void
  tab: StudioWorkspaceBrowserTab
  onTabChange: (
    updater: (tab: StudioWorkspaceBrowserTab) => StudioWorkspaceBrowserTab
  ) => void
}) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [zoom, setZoom] = React.useState(100)
  const activeTabUrl = tab.url

  const updateActiveTab = React.useCallback(
    (
      updater: (tab: StudioWorkspaceBrowserTab) => StudioWorkspaceBrowserTab
    ) => {
      onTabChange(updater)
    },
    [onTabChange]
  )
  const onTabChangeRef = React.useRef(onTabChange)

  React.useEffect(() => {
    onTabChangeRef.current = onTabChange
  }, [onTabChange])

  function handleAddressSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const url = normalizeBrowserUrl(tab.address)

    updateActiveTab((currentTab) => ({
      ...currentTab,
      title: getBrowserTabTitle(url),
      url,
    }))
  }

  React.useEffect(() => {
    if (!activeTabUrl) {
      return
    }

    let disposed = false

    void fetchStudioBrowserTitle(activeTabUrl).then((title) => {
      if (!title || disposed) {
        return
      }

      onTabChangeRef.current((currentTab) =>
        currentTab.title !== title ? { ...currentTab, title } : currentTab
      )
    })

    return () => {
      disposed = true
    }
  }, [activeTabUrl])

  function handleBrowserFrameLoad(
    event: React.SyntheticEvent<HTMLIFrameElement>
  ) {
    try {
      const title = event.currentTarget.contentDocument?.title?.trim()

      if (!title) {
        return
      }

      updateActiveTab((currentTab) =>
        currentTab.title !== title ? { ...currentTab, title } : currentTab
      )
    } catch {
      // Remote pages usually disallow frame document access; title lookup falls
      // back to the server route above.
    }
  }

  async function handleClearData() {
    try {
      await window.astraflowDesktop?.browserClearData?.()
      toast.success(copy.browserDataCleared)
      setMenuOpen(false)
    } catch {
      toast.error(copy.browserDataFailed)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex h-10 shrink-0 items-center gap-1 border-b px-3"
        onSubmit={handleAddressSubmit}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled
        >
          <RiArrowLeftSLine aria-hidden className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled
        >
          <RiArrowRightSLine aria-hidden className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md"
          onClick={() => {
            if (tab.url) {
              updateActiveTab((currentTab) => ({ ...currentTab, url: "" }))
              requestAnimationFrame(() => {
                updateActiveTab((currentTab) => ({
                  ...currentTab,
                  url: normalizeBrowserUrl(currentTab.address),
                }))
              })
            }
          }}
        >
          <RiRefreshLine aria-hidden className="size-3.5" />
        </Button>
        <input
          value={tab.address}
          placeholder="输入 URL"
          className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-center text-[11px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
          title={tab.title || tab.address || copy.browser}
          onChange={(event) =>
            updateActiveTab((currentTab) => ({
              ...currentTab,
              address: event.target.value,
            }))
          }
        />
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={copy.browserMenu}
            className={cn("size-7 rounded-md", menuOpen && "bg-muted")}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <MoreVertical aria-hidden className="size-3.5" />
          </Button>

          {menuOpen ? (
            <div className="absolute top-9 right-0 z-40 w-[13rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-1.5 text-[11px] shadow-xl">
              <button
                type="button"
                className="flex h-7 w-full items-center justify-between rounded-md px-2 text-left hover:bg-muted"
                onClick={() => void handleClearData()}
              >
                <span>{copy.clearBrowsingData}</span>
                <RiArrowRightSLine
                  aria-hidden
                  className="size-3.5 text-muted-foreground"
                />
              </button>
              <div className="my-1 h-px bg-border" />
              <div className="flex h-7 items-center justify-between px-2">
                <span className="font-medium">{copy.zoom}</span>
                <div className="flex items-center overflow-hidden rounded-md border bg-muted/40">
                  <button
                    type="button"
                    className="grid size-6 place-items-center text-muted-foreground hover:text-foreground"
                    onClick={() => setZoom((value) => Math.max(50, value - 10))}
                  >
                    −
                  </button>
                  <span className="w-10 text-center font-medium">{zoom}%</span>
                  <button
                    type="button"
                    className="grid size-6 place-items-center text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setZoom((value) => Math.min(200, value + 10))
                    }
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="my-1 h-px bg-border" />
              {[copy.forceReload, copy.findInPage, copy.showDeviceToolbar].map(
                (label) => (
                  <button
                    key={label}
                    type="button"
                    className="flex h-7 w-full items-center rounded-md px-2 text-left text-muted-foreground"
                    disabled
                  >
                    {label}
                  </button>
                )
              )}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                className="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-muted"
                onClick={() => {
                  setMenuOpen(false)
                  onModeChange("browser-settings")
                }}
              >
                {copy.browserSettings}
              </button>
            </div>
          ) : null}
        </div>
      </form>

      <div className="min-h-0 flex-1 bg-background">
        {tab.url ? (
          <iframe
            key={tab.url}
            title={tab.title}
            src={tab.url}
            className="size-full border-0 bg-background"
            style={{ zoom: `${zoom}%` }}
            onLoad={handleBrowserFrameLoad}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Globe aria-hidden className="size-10 text-muted-foreground/80" />
            <div>
              <h3 className="text-sm font-semibold">{copy.browserStart}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {copy.browserStartDescription}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StudioRightPanelBrowserSettings({
  copy,
  onModeChange,
}: {
  copy: StudioRightPanelCopy
  onModeChange: (mode: StudioRightPanelMode) => void
}) {
  const [browserEnabled, setBrowserEnabled] = React.useState(() =>
    readStoredBoolean("astraflow.studio.browser-enabled", true)
  )

  function toggleBrowserEnabled() {
    const nextValue = !browserEnabled

    window.localStorage.setItem(
      "astraflow.studio.browser-enabled",
      String(nextValue)
    )
    setBrowserEnabled(nextValue)
  }

  return (
    <div className="h-full min-h-0 overflow-x-hidden overflow-y-auto px-3 pt-12 pb-5">
      <div className="w-full min-w-0">
        <button
          type="button"
          className="mb-3 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          onClick={() => onModeChange("browser")}
        >
          <RiArrowLeftSLine aria-hidden className="size-3" />
          {copy.browser}
        </button>

        <h2 className="text-base font-semibold tracking-normal">
          {copy.browserTitle}
        </h2>
        <p className="mt-1 text-[11px] leading-4 [overflow-wrap:anywhere] text-muted-foreground">
          {copy.settingsDescription}
        </p>

        <div className="mt-4 rounded-md border bg-background p-2.5">
          <div className="flex items-center gap-2">
            <div className="grid size-7 shrink-0 place-items-center rounded-md border">
              <Globe aria-hidden className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[11px] font-semibold">{copy.browser}</h3>
              <p className="mt-0.5 text-[10px] leading-3.5 [overflow-wrap:anywhere] text-muted-foreground">
                {copy.allowBrowser}
              </p>
            </div>
            <button
              type="button"
              aria-pressed={browserEnabled}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                browserEnabled ? "bg-blue-500" : "bg-muted"
              )}
              onClick={toggleBrowserEnabled}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-background shadow transition-transform",
                  browserEnabled ? "left-[18px]" : "left-0.5"
                )}
              />
            </button>
          </div>
        </div>

        <StudioBrowserSettingsSection title="常规">
          <StudioBrowserSettingsRow
            title={copy.localUrlTarget}
            description={copy.localUrlHelp}
            value={copy.localTargetApp}
          />
          <StudioBrowserSettingsRow
            title={copy.browsingData}
            description={copy.browsingDataHelp}
            value={copy.clearAllBrowsingData}
          />
          <StudioBrowserSettingsRow
            title={copy.screenshotMode}
            description={copy.screenshotHelp}
            value={copy.alwaysInclude}
          />
        </StudioBrowserSettingsSection>

        <StudioBrowserSettingsSection title={copy.permissions}>
          <StudioBrowserSettingsRow
            title="审批"
            description={copy.permissionsHelp}
            value={copy.alwaysAsk}
          />
        </StudioBrowserSettingsSection>

        <div className="mt-5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold">{copy.websitePermissions}</h3>
            <p className="mt-0.5 text-[10px] leading-3.5 [overflow-wrap:anywhere] text-muted-foreground">
              {copy.websitePermissionsHelp}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-6 shrink-0 gap-1 rounded-md px-2 text-[10px]"
          >
            <RiAddLine aria-hidden className="size-3" />
            {copy.add}
          </Button>
        </div>
        <div className="mt-2.5 rounded-md border p-3 text-center text-[10px] font-medium text-muted-foreground">
          {copy.noWebsitePermissions}
        </div>
      </div>
    </div>
  )
}

function StudioBrowserSettingsSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-5">
      <h3 className="mb-1.5 text-xs font-semibold">{title}</h3>
      <div className="overflow-hidden rounded-md border bg-background">
        {children}
      </div>
    </section>
  )
}

function StudioBrowserSettingsRow({
  title,
  description,
  value,
}: {
  title: string
  description: string
  value: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b px-2.5 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <h4 className="text-[11px] font-semibold [overflow-wrap:anywhere]">
          {title}
        </h4>
        <p className="mt-0.5 text-[10px] leading-3.5 [overflow-wrap:anywhere] text-muted-foreground">
          {description}
        </p>
      </div>
      <button
        type="button"
        className="flex h-7 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-muted px-2 text-left text-[11px] font-semibold"
      >
        <span className="min-w-0 truncate">{value}</span>
        <RiArrowDownSLine
          aria-hidden
          className="size-3 shrink-0 text-muted-foreground"
        />
      </button>
    </div>
  )
}

function StudioSideTerminal({
  active,
  copy,
  activeTabId,
  tabs,
  onResolvedCwd,
}: {
  active: boolean
  copy: StudioRightPanelCopy
  activeTabId: string
  tabs: StudioWorkspaceTerminalTab[]
  onResolvedCwd: (tabId: string, resolvedCwd: string) => void
}) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  return (
    <div
      aria-label={copy.terminal}
      className="relative h-full min-h-0 bg-background"
    >
      {tabs.map((tab) => (
        <StudioTerminalSurface
          key={tab.id}
          active={active && tab.id === activeTab?.id}
          cwd={tab.cwd}
          fitEnabled={active && tab.id === activeTab?.id}
          onResolvedCwd={(resolvedCwd) => onResolvedCwd(tab.id, resolvedCwd)}
        />
      ))}
    </div>
  )
}

type ChatComposerProps = {
  sessionId: string
  value: string
  userMessageHistory: string[]
  model: SupportedChatModel
  modelOptions: AgentModelDefinition[]
  runtimeId: string
  runtimeInfos: ChatRuntimeOption[]
  reasoningEffort: ChatReasoningEffort
  permissionMode: StudioPermissionMode
  localProjects: StudioLocalProjectWithGitInfo[]
  selectedProjectId: string | null
  environment: ChatRunEnvironment
  contextUsage: StudioTokenUsage | null
  isAddingProject: boolean
  attachments: PendingAttachment[]
  mentions: ComposerMention[]
  onModelChange: (model: SupportedChatModel) => void
  onRuntimeChange: (runtimeId: string) => void
  onEnvironmentChange: (environment: ChatRunEnvironment) => void
  onReasoningEffortChange: (effort: ChatReasoningEffort) => void
  onPermissionModeChange: (permissionMode: StudioPermissionMode) => void
  onAddProject: () => void
  onProjectChange: (projectId: string | null) => void
  onValueChange: (value: string) => void
  onMentionsChange: (mentions: ComposerMention[]) => void
  onAddFiles: (files: FileList | null) => void
  onRemoveAttachment: (id: string) => void
  modelSelectOpen: boolean
  onModelSelectOpenChange: (open: boolean) => void
  reasoningSelectOpen: boolean
  onReasoningSelectOpenChange: (open: boolean) => void
  onSubmit: () => void
  onStop: () => void
  canSubmit: boolean
  isBusy: boolean
}

type BuiltinSlashCommandName = "clear" | "model" | "reasoning" | "compact"

type SlashCommandToken = {
  start: number
  end: number
  prefix: string
}

type MentionToken = {
  start: number
  end: number
  prefix: string
}

const BUILTIN_SLASH_COMMAND_NAMES = new Set<BuiltinSlashCommandName>([
  "clear",
  "model",
  "reasoning",
  "compact",
])

function isBuiltinSlashCommandName(
  name: string
): name is BuiltinSlashCommandName {
  return BUILTIN_SLASH_COMMAND_NAMES.has(
    name.toLowerCase() as BuiltinSlashCommandName
  )
}

function getBuiltinSlashCommands(
  t: ReturnType<typeof useI18n>["t"],
  supportsCompact: boolean
): SlashCommandDescriptor[] {
  const commands: SlashCommandDescriptor[] = [
    {
      name: "clear",
      description: t.studioCommandClearDescription,
      source: "builtin",
    },
    {
      name: "model",
      description: t.studioCommandModelDescription,
      source: "builtin",
    },
    {
      name: "reasoning",
      description: t.studioCommandReasoningDescription,
      source: "builtin",
    },
  ]

  if (supportsCompact) {
    commands.push({
      name: "compact",
      description: t.studioCommandCompactDescription,
      source: "builtin",
    })
  }

  return commands
}

function formatCompactTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`
  }

  return String(value)
}

function ContextUsageIndicator({
  contextWindow,
  usage,
}: {
  contextWindow: number
  usage: StudioTokenUsage | null
}) {
  const { t } = useI18n()

  if (!usage || contextWindow <= 0 || usage.inputTokens <= 0) {
    return null
  }

  const percent = Math.min(
    100,
    Math.round((usage.inputTokens / contextWindow) * 100)
  )
  const ringStyle = {
    background: `conic-gradient(var(--primary) ${percent}%, var(--muted) 0)`,
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-background px-2 text-xs text-muted-foreground"
          aria-label={t.studioContextUsageTooltip(
            usage.inputTokens,
            contextWindow,
            percent
          )}
        >
          <span
            aria-hidden
            className="grid size-3.5 place-items-center rounded-full"
            style={ringStyle}
          >
            <span className="size-2 rounded-full bg-background" />
          </span>
          <span className="tabular-nums">
            {t.studioContextUsageLabel(
              formatCompactTokenCount(usage.inputTokens),
              formatCompactTokenCount(contextWindow)
            )}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="end">
        {t.studioContextUsageTooltip(
          usage.inputTokens,
          contextWindow,
          percent
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function getSlashCommandTokenAtCursor(
  text: string,
  cursorPosition: number | null
): SlashCommandToken | null {
  if (cursorPosition === null) {
    return null
  }

  const cursor = Math.max(0, Math.min(cursorPosition, text.length))
  let start = cursor

  while (start > 0 && !/\s/.test(text[start - 1])) {
    start -= 1
  }

  const tokenBeforeCursor = text.slice(start, cursor)

  if (!/^\/[A-Za-z0-9_:-]*$/.test(tokenBeforeCursor)) {
    return null
  }

  let end = cursor

  while (end < text.length && !/\s/.test(text[end])) {
    end += 1
  }

  return {
    start,
    end,
    prefix: tokenBeforeCursor.slice(1),
  }
}

function getMentionTokenAtCursor(
  text: string,
  cursorPosition: number | null
): MentionToken | null {
  if (cursorPosition === null) {
    return null
  }

  const cursor = Math.max(0, Math.min(cursorPosition, text.length))
  let start = cursor

  while (start > 0 && !/\s/.test(text[start - 1])) {
    start -= 1
  }

  const tokenBeforeCursor = text.slice(start, cursor)

  if (!/^@[^\s]*$/.test(tokenBeforeCursor)) {
    return null
  }

  let end = cursor

  while (end < text.length && !/\s/.test(text[end])) {
    end += 1
  }

  return {
    start,
    end,
    prefix: tokenBeforeCursor.slice(1),
  }
}

function normalizeMentionQuery(rawPrefix: string) {
  return rawPrefix.trim().replace(/^"/, "")
}

function formatQuotedMentionValue(value: string) {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`
}

function formatFileMentionReference(relativePath: string) {
  if (!/\s/.test(relativePath)) {
    return relativePath
  }

  return formatQuotedMentionValue(relativePath)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function formatSessionMentionReference(title: string) {
  return `session:${formatQuotedMentionValue(title)}`
}

function getFileMentionTokenPattern(relativePath: string) {
  const unquoted = escapeRegExp(relativePath)
  const quoted = escapeRegExp(formatFileMentionReference(relativePath))

  return `@(?:${quoted}|${unquoted})`
}

function getSessionMentionTokenPattern(title: string) {
  return `@${escapeRegExp(formatSessionMentionReference(title))}`
}

function getComposerMentionTokenPattern(mention: ComposerMention) {
  return mention.kind === "session"
    ? getSessionMentionTokenPattern(mention.title)
    : getFileMentionTokenPattern(mention.relativePath)
}

function textHasComposerMentionToken(text: string, mention: ComposerMention) {
  return new RegExp(
    `(^|\\s)${getComposerMentionTokenPattern(mention)}(?=$|\\s)`
  ).test(text)
}

function removeComposerMentionTokenFromText(
  text: string,
  mention: ComposerMention
) {
  return text.replace(
    new RegExp(`(^|\\s)${getComposerMentionTokenPattern(mention)}(\\s|$)`, "g"),
    (_match, leading: string) => leading
  )
}

function fileCandidateMatchesFilter(
  file: WorkspaceFileCandidate,
  rawFilter: string
) {
  const filter = normalizeMentionQuery(rawFilter).toLowerCase()

  if (!filter) {
    return true
  }

  return [file.name, file.relativePath]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(filter))
}

function mergeComposerMention(
  mentions: ComposerMention[],
  file: WorkspaceFileCandidate
) {
  const nextMention: ComposerFileMention = {
    kind: file.kind,
    path: file.path,
    relativePath: file.relativePath,
    name: file.name,
  }
  const existingIndex = mentions.findIndex(
    (mention) => mention.kind === file.kind && mention.path === file.path
  )

  if (existingIndex === -1) {
    return [...mentions, nextMention]
  }

  return mentions.map((mention, index) =>
    index === existingIndex ? nextMention : mention
  )
}

function mergeComposerSessionMention(
  mentions: ComposerMention[],
  session: StudioSession
) {
  const nextMention: ComposerSessionMention = {
    kind: "session",
    sessionId: session.id,
    title: session.title,
  }
  const existingIndex = mentions.findIndex(
    (mention) => mention.kind === "session" && mention.sessionId === session.id
  )

  if (existingIndex === -1) {
    return [...mentions, nextMention]
  }

  return mentions.map((mention, index) =>
    index === existingIndex ? nextMention : mention
  )
}

function sessionCandidateMatchesFilter(
  session: StudioSession,
  rawFilter: string
) {
  const filter = normalizeMentionQuery(rawFilter).toLowerCase()

  if (!filter) {
    return true
  }

  return session.title.toLowerCase().includes(filter)
}

function formatComposerSessionUpdatedAt(updatedAt: string) {
  const date = new Date(updatedAt)

  if (Number.isNaN(date.getTime())) {
    return updatedAt
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function commandMatchesFilter(
  command: SlashCommandDescriptor,
  rawFilter: string
) {
  const filter = rawFilter.trim().toLowerCase()

  if (!filter) {
    return true
  }

  return [command.name, command.description, command.inputHint]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(filter))
}

function getComposerSkillLabel(skill: InstalledSkill) {
  return skill.skill.Name || skill.slug
}

function getComposerSkillDescription(skill: InstalledSkill, locale: string) {
  return locale === "zh"
    ? skill.skill.DescZh || skill.skill.Desc
    : skill.skill.Desc
}

function skillMatchesSlashFilter(skill: InstalledSkill, rawFilter: string) {
  const filter = rawFilter.trim().toLowerCase()

  if (!filter) {
    return true
  }

  return [skill.slug, skill.skill.Name, skill.skill.Desc, skill.skill.DescZh]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(filter))
}

function getComposerMcpLabel(server: InstalledMcpServer) {
  return server.title || server.name
}

function mcpMatchesSlashFilter(server: InstalledMcpServer, rawFilter: string) {
  const filter = rawFilter.trim().toLowerCase()

  if (!filter) {
    return true
  }

  return [server.id, server.name, server.title, server.description]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(filter))
}

type SlashComposerMenuEntry =
  | { kind: "command"; command: SlashCommandDescriptor }
  | { kind: "skill"; skill: InstalledSkill }
  | { kind: "mcp"; server: InstalledMcpServer }

function mergeSlashCommands(
  builtinCommands: SlashCommandDescriptor[],
  runtimeCommands: SlashCommandDescriptor[]
) {
  const seen = new Set<string>()
  const merged: SlashCommandDescriptor[] = []

  for (const command of [...builtinCommands, ...runtimeCommands]) {
    const key = command.name.toLowerCase()

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    merged.push(command)
  }

  return merged
}

function OptionInfoTooltip({ description }: { description: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={description}
          className="mr-4 ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/65 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
        className="max-w-56 text-left leading-5 whitespace-normal"
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

function formatProjectGitMeta(
  project: StudioLocalProjectWithGitInfo,
  t: ReturnType<typeof useI18n>["t"]
) {
  const meta = [t.studioLocalProjectLocal]
  const isZh = t.studioThinking === "正在思考"

  if (project.git.branch) {
    meta.push(project.git.branch)
  }

  if (project.git.isDirty) {
    meta.push(t.studioLocalProjectDirty)
  }

  if (
    typeof project.git.changedFiles === "number" &&
    project.git.changedFiles > 0
  ) {
    meta.push(
      isZh
        ? `${project.git.changedFiles} 个文件`
        : `${project.git.changedFiles} files`
    )
  }

  if (
    typeof project.git.additions === "number" &&
    typeof project.git.deletions === "number" &&
    (project.git.additions > 0 || project.git.deletions > 0)
  ) {
    meta.push(`+${project.git.additions} -${project.git.deletions}`)
  }

  return meta.join(" · ")
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
    case "codex-direct":
      return t.studioAgentRuntimeCodexDescription
    case "claude-code":
    case "claude-native":
      return t.studioAgentRuntimeClaudeCodeDescription
    case "opencode":
    case "opencode-native":
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

type SkillsMarketPageProps = {
  embedded?: boolean
  initialView?: "market" | "mine"
}

function SkillsMarketPageLoading() {
  return (
    <div className="flex h-full min-h-0 items-end justify-center p-6">
      <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-sm text-muted-foreground shadow-lg">
        <RiLoader4Line className="animate-spin" aria-hidden />
        <span>Loading</span>
      </div>
    </div>
  )
}

const LazySkillsMarketPage = dynamic<SkillsMarketPageProps>(
  () =>
    import("@/components/skills-market-page").then(
      (mod) => mod.SkillsMarketPage
    ),
  { loading: SkillsMarketPageLoading }
)

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

  React.useEffect(() => {
    function handleOpenComposerPlugins() {
      setOpen(true)
    }

    window.addEventListener(
      "astraflow:open-composer-plugins",
      handleOpenComposerPlugins
    )

    return () => {
      window.removeEventListener(
        "astraflow:open-composer-plugins",
        handleOpenComposerPlugins
      )
    }
  }, [])

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
        className="h-7 rounded-full px-2 text-xs font-medium"
        onClick={() => setOpen(true)}
      >
        <span>{t.studioComposerPlugins}</span>
        <span className="ml-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/10 px-1 text-[9px] leading-none font-semibold text-foreground/75 ring-1 ring-foreground/10">
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
          {open ? <LazySkillsMarketPage embedded initialView="mine" /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ChatComposer({
  sessionId,
  value,
  userMessageHistory,
  model,
  modelOptions,
  runtimeId,
  runtimeInfos,
  reasoningEffort,
  permissionMode,
  localProjects,
  selectedProjectId,
  environment,
  contextUsage,
  isAddingProject,
  attachments,
  mentions,
  onModelChange,
  onRuntimeChange,
  onEnvironmentChange,
  onReasoningEffortChange,
  onPermissionModeChange,
  onAddProject,
  onProjectChange,
  onValueChange,
  onMentionsChange,
  onAddFiles,
  onRemoveAttachment,
  modelSelectOpen,
  onModelSelectOpenChange,
  reasoningSelectOpen,
  onReasoningSelectOpenChange,
  onSubmit,
  onStop,
  canSubmit,
  isBusy,
}: ChatComposerProps) {
  const { locale, t } = useI18n()
  const [isTextareaFocused, setIsTextareaFocused] = React.useState(false)
  const [composerRef, composerWidth] = useElementWidth<HTMLDivElement>()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const menuAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const runtimeCommandRequestIdRef = React.useRef(0)
  const mentionFileRequestIdRef = React.useRef(0)
  const mentionSessionRequestIdRef = React.useRef(0)
  const wasBusyRef = React.useRef(isBusy)
  const historyDraftRef = React.useRef("")
  const isApplyingHistoryValueRef = React.useRef(false)
  const [runtimeCommands, setRuntimeCommands] = React.useState<
    SlashCommandDescriptor[]
  >([])
  const [installedSkillsForSlash, setInstalledSkillsForSlash] = React.useState<
    InstalledSkill[] | null
  >(null)
  const [installedMcpForSlash, setInstalledMcpForSlash] = React.useState<
    InstalledMcpServer[] | null
  >(null)
  const [workspaceFiles, setWorkspaceFiles] = React.useState<
    WorkspaceFileCandidate[]
  >([])
  const [mentionSessions, setMentionSessions] = React.useState<StudioSession[]>(
    []
  )
  const [workspaceFilesLoading, setWorkspaceFilesLoading] =
    React.useState(false)
  const [mentionSessionsLoading, setMentionSessionsLoading] =
    React.useState(false)
  const [cursorPosition, setCursorPosition] = React.useState<number | null>(
    null
  )
  const [selectedCommandIndex, setSelectedCommandIndex] = React.useState(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = React.useState(0)
  const [projectSearch, setProjectSearch] = React.useState("")
  const [dismissedSlashTokenKey, setDismissedSlashTokenKey] = React.useState<
    string | null
  >(null)
  const [dismissedMentionTokenKey, setDismissedMentionTokenKey] =
    React.useState<string | null>(null)
  const [historyIndex, setHistoryIndex] = React.useState<number | null>(null)
  const activeHistoryIndex = value.length === 0 ? null : historyIndex
  const showCustomCaret = isTextareaFocused && value.length === 0
  const iconOnlyControls =
    composerWidth > 0 && composerWidth < COMPOSER_ICON_ONLY_WIDTH
  const supportsCompact =
    runtimeInfos.find((runtime) => runtime.id === runtimeId)?.capabilities
      .compact ?? false
  const builtinCommands = React.useMemo(
    () => getBuiltinSlashCommands(t, supportsCompact),
    [supportsCompact, t]
  )
  const slashCommandToken = React.useMemo(
    () => getSlashCommandTokenAtCursor(value, cursorPosition),
    [cursorPosition, value]
  )
  const mentionToken = React.useMemo(
    () => getMentionTokenAtCursor(value, cursorPosition),
    [cursorPosition, value]
  )
  const slashCommandTokenKey = slashCommandToken
    ? `${slashCommandToken.start}:${slashCommandToken.end}:${value.slice(
        slashCommandToken.start,
        slashCommandToken.end
      )}:${cursorPosition ?? ""}`
    : null
  const mentionTokenKey = mentionToken
    ? `${mentionToken.start}:${mentionToken.end}:${value.slice(
        mentionToken.start,
        mentionToken.end
      )}:${cursorPosition ?? ""}`
    : null
  const mentionQuery = mentionToken
    ? normalizeMentionQuery(mentionToken.prefix)
    : ""
  const allSlashCommands = React.useMemo(
    () => mergeSlashCommands(builtinCommands, sessionId ? runtimeCommands : []),
    [builtinCommands, runtimeCommands, sessionId]
  )
  const filteredSlashCommands = React.useMemo(
    () =>
      slashCommandToken
        ? allSlashCommands.filter((command) =>
            commandMatchesFilter(command, slashCommandToken.prefix)
          )
        : [],
    [allSlashCommands, slashCommandToken]
  )
  const filteredSlashSkills = React.useMemo(
    () =>
      slashCommandToken
        ? (installedSkillsForSlash ?? [])
            .filter((skill) => skill.enabled)
            .filter((skill) =>
              skillMatchesSlashFilter(skill, slashCommandToken.prefix)
            )
        : [],
    [installedSkillsForSlash, slashCommandToken]
  )
  const filteredSlashMcpServers = React.useMemo(
    () =>
      slashCommandToken
        ? (installedMcpForSlash ?? [])
            .filter((server) => server.enabled)
            .filter((server) =>
              mcpMatchesSlashFilter(server, slashCommandToken.prefix)
            )
        : [],
    [installedMcpForSlash, slashCommandToken]
  )
  const slashMenuEntries = React.useMemo<SlashComposerMenuEntry[]>(
    () => [
      ...filteredSlashCommands.map((command) => ({
        kind: "command" as const,
        command,
      })),
      ...filteredSlashSkills.map((skill) => ({
        kind: "skill" as const,
        skill,
      })),
      ...filteredSlashMcpServers.map((server) => ({
        kind: "mcp" as const,
        server,
      })),
    ],
    [filteredSlashCommands, filteredSlashMcpServers, filteredSlashSkills]
  )
  const activeCommandIndex =
    slashMenuEntries.length > 0
      ? Math.min(selectedCommandIndex, slashMenuEntries.length - 1)
      : 0
  const filteredWorkspaceFiles = React.useMemo(
    () =>
      mentionToken && selectedProjectId
        ? workspaceFiles.filter((file) =>
            fileCandidateMatchesFilter(file, mentionToken.prefix)
          )
        : [],
    [mentionToken, selectedProjectId, workspaceFiles]
  )
  const filteredMentionSessions = React.useMemo(
    () =>
      mentionToken
        ? mentionSessions
            .filter(
              (session) =>
                session.mode === "chat" &&
                session.id !== sessionId &&
                sessionCandidateMatchesFilter(session, mentionToken.prefix)
            )
            .slice(0, 8)
        : [],
    [mentionSessions, mentionToken, sessionId]
  )
  const addLocalMentionIndex =
    filteredWorkspaceFiles.length + filteredMentionSessions.length
  const mentionMenuItemCount = addLocalMentionIndex + 1
  const activeMentionIndex =
    mentionMenuItemCount > 0
      ? Math.min(selectedMentionIndex, mentionMenuItemCount - 1)
      : 0
  const showSlashCommandMenu = Boolean(
    slashCommandToken && slashCommandTokenKey !== dismissedSlashTokenKey
  )
  const showMentionMenu = Boolean(
    mentionToken && mentionTokenKey !== dismissedMentionTokenKey
  )
  const composerMenuPlacement = useComposerPopupPlacement(
    menuAnchorRef,
    showSlashCommandMenu || showMentionMenu
  )
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

  const refreshRuntimeCommands = React.useCallback(() => {
    const requestId = runtimeCommandRequestIdRef.current + 1
    runtimeCommandRequestIdRef.current = requestId

    if (!sessionId) {
      return
    }

    void listSessionSlashCommands(sessionId).then((commands) => {
      if (runtimeCommandRequestIdRef.current === requestId) {
        setRuntimeCommands(commands)
      }
    })
  }, [sessionId])

  const syncCursorPosition = React.useCallback(
    (textarea: HTMLTextAreaElement | null = textareaRef.current) => {
      setCursorPosition(textarea ? textarea.selectionStart : null)
    },
    []
  )

  const handleComposerValueChange = React.useCallback(
    (nextValue: string) => {
      if (isApplyingHistoryValueRef.current) {
        isApplyingHistoryValueRef.current = false
      } else if (activeHistoryIndex !== null) {
        setHistoryIndex(null)
        historyDraftRef.current = nextValue
      } else if (nextValue.length === 0) {
        setHistoryIndex(null)
        historyDraftRef.current = ""
      }

      onValueChange(nextValue)
    },
    [activeHistoryIndex, onValueChange]
  )

  const focusTextareaAt = React.useCallback((cursor: number) => {
    window.setTimeout(() => {
      const textarea = textareaRef.current

      if (!textarea) {
        return
      }

      textarea.focus()
      textarea.setSelectionRange(cursor, cursor)
      setCursorPosition(cursor)
    }, 0)
  }, [])

  const applyHistoryValue = React.useCallback(
    (nextValue: string) => {
      isApplyingHistoryValueRef.current = true
      handleComposerValueChange(nextValue)
      focusTextareaAt(nextValue.length)
    },
    [focusTextareaAt, handleComposerValueChange]
  )

  const acceptMentionFile = React.useCallback(
    (
      file: WorkspaceFileCandidate,
      token: MentionToken | null = mentionToken
    ) => {
      if (!token) {
        return
      }

      const insertion = `@${formatFileMentionReference(file.relativePath)} `
      const nextValue =
        value.slice(0, token.start) + insertion + value.slice(token.end)
      const nextCursor = token.start + insertion.length

      onValueChange(nextValue)
      onMentionsChange(mergeComposerMention(mentions, file))
      setDismissedMentionTokenKey(null)
      setSelectedMentionIndex(0)
      focusTextareaAt(nextCursor)
    },
    [
      focusTextareaAt,
      mentionToken,
      mentions,
      onMentionsChange,
      onValueChange,
      value,
    ]
  )

  const acceptMentionSession = React.useCallback(
    (session: StudioSession, token: MentionToken | null = mentionToken) => {
      if (!token) {
        return
      }

      const insertion = `@${formatSessionMentionReference(session.title)} `
      const nextValue =
        value.slice(0, token.start) + insertion + value.slice(token.end)
      const nextCursor = token.start + insertion.length

      onValueChange(nextValue)
      onMentionsChange(mergeComposerSessionMention(mentions, session))
      setDismissedMentionTokenKey(null)
      setSelectedMentionIndex(0)
      focusTextareaAt(nextCursor)
    },
    [
      focusTextareaAt,
      mentionToken,
      mentions,
      onMentionsChange,
      onValueChange,
      value,
    ]
  )

  const acceptAddLocalFile = React.useCallback(
    (token: MentionToken | null = mentionToken) => {
      if (token) {
        const nextValue = value.slice(0, token.start) + value.slice(token.end)

        onValueChange(nextValue)
        focusTextareaAt(token.start)
      }

      setDismissedMentionTokenKey(mentionTokenKey)
      setSelectedMentionIndex(0)

      window.setTimeout(() => {
        fileInputRef.current?.click()
      }, 0)
    },
    [focusTextareaAt, mentionToken, mentionTokenKey, onValueChange, value]
  )

  const removeMention = React.useCallback(
    (mention: ComposerMention) => {
      onMentionsChange(mentions.filter((current) => current !== mention))

      const nextValue = removeComposerMentionTokenFromText(value, mention)

      if (nextValue !== value) {
        onValueChange(nextValue)
      }

      focusTextareaAt(
        Math.min(nextValue.length, cursorPosition ?? nextValue.length)
      )
    },
    [
      cursorPosition,
      focusTextareaAt,
      mentions,
      onMentionsChange,
      onValueChange,
      value,
    ]
  )

  const acceptSlashCommand = React.useCallback(
    (
      command: SlashCommandDescriptor,
      token: SlashCommandToken | null = slashCommandToken
    ) => {
      if (!token) {
        return
      }

      const insertion = `/${command.name} `
      const nextValue =
        value.slice(0, token.start) + insertion + value.slice(token.end)
      const nextCursor = token.start + insertion.length

      onValueChange(nextValue)
      setDismissedSlashTokenKey(null)
      setSelectedCommandIndex(0)
      focusTextareaAt(nextCursor)
    },
    [focusTextareaAt, onValueChange, slashCommandToken, value]
  )

  const acceptSlashSkill = React.useCallback(
    (
      skill: InstalledSkill,
      token: SlashCommandToken | null = slashCommandToken
    ) => {
      if (!token) {
        return
      }

      const slug = skill.slug || skill.skill.Name

      if (!slug) {
        return
      }

      const insertion = `/${slug} `
      const nextValue =
        value.slice(0, token.start) + insertion + value.slice(token.end)
      const nextCursor = token.start + insertion.length

      onValueChange(nextValue)
      setDismissedSlashTokenKey(null)
      setSelectedCommandIndex(0)
      focusTextareaAt(nextCursor)
    },
    [focusTextareaAt, onValueChange, slashCommandToken, value]
  )

  const acceptSlashMcp = React.useCallback(() => {
    setDismissedSlashTokenKey(slashCommandTokenKey)
    setSelectedCommandIndex(0)
    window.dispatchEvent(new CustomEvent("astraflow:open-composer-plugins"))
  }, [slashCommandTokenKey])

  const handleComposerMenuKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showMentionMenu) {
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setSelectedMentionIndex((current) =>
            mentionMenuItemCount > 0 ? (current + 1) % mentionMenuItemCount : 0
          )
          return
        }

        if (event.key === "ArrowUp") {
          event.preventDefault()
          setSelectedMentionIndex((current) =>
            mentionMenuItemCount > 0
              ? (current - 1 + mentionMenuItemCount) % mentionMenuItemCount
              : 0
          )
          return
        }

        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault()

          const file =
            activeMentionIndex < filteredWorkspaceFiles.length
              ? filteredWorkspaceFiles[activeMentionIndex]
              : null
          const session =
            activeMentionIndex >= filteredWorkspaceFiles.length
              ? filteredMentionSessions[
                  activeMentionIndex - filteredWorkspaceFiles.length
                ]
              : null

          if (file) {
            acceptMentionFile(file)
          } else if (session) {
            acceptMentionSession(session)
          } else {
            acceptAddLocalFile()
          }
          return
        }

        if (event.key === "Escape") {
          event.preventDefault()
          setDismissedMentionTokenKey(mentionTokenKey)
        }
        return
      }

      if (showSlashCommandMenu && event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedCommandIndex((current) =>
          slashMenuEntries.length > 0
            ? (Math.min(current, slashMenuEntries.length - 1) + 1) %
              slashMenuEntries.length
            : 0
        )
        return
      }

      if (showSlashCommandMenu && event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedCommandIndex((current) =>
          slashMenuEntries.length > 0
            ? (Math.min(current, slashMenuEntries.length - 1) -
                1 +
                slashMenuEntries.length) %
              slashMenuEntries.length
            : 0
        )
        return
      }

      if (
        showSlashCommandMenu &&
        (event.key === "Enter" || event.key === "Tab")
      ) {
        event.preventDefault()

        const entry = slashMenuEntries[activeCommandIndex]

        if (entry?.kind === "command") {
          acceptSlashCommand(entry.command)
        } else if (entry?.kind === "skill") {
          acceptSlashSkill(entry.skill)
        } else if (entry?.kind === "mcp") {
          acceptSlashMcp()
        }
        return
      }

      if (showSlashCommandMenu && event.key === "Escape") {
        event.preventDefault()
        setDismissedSlashTokenKey(slashCommandTokenKey)
        return
      }

      if (event.key !== "Escape" && event.key.length === 1) {
        if (dismissedSlashTokenKey) {
          setDismissedSlashTokenKey(null)
        }

        if (dismissedMentionTokenKey) {
          setDismissedMentionTokenKey(null)
        }
      }
    },
    [
      acceptAddLocalFile,
      acceptMentionFile,
      acceptMentionSession,
      acceptSlashCommand,
      acceptSlashMcp,
      acceptSlashSkill,
      activeCommandIndex,
      activeMentionIndex,
      dismissedMentionTokenKey,
      dismissedSlashTokenKey,
      filteredMentionSessions,
      filteredWorkspaceFiles,
      mentionMenuItemCount,
      mentionTokenKey,
      showMentionMenu,
      showSlashCommandMenu,
      slashMenuEntries,
      slashCommandTokenKey,
    ]
  )

  const canNavigateHistoryForArrow = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        showSlashCommandMenu ||
        showMentionMenu ||
        userMessageHistory.length === 0 ||
        (value.length > 0 && activeHistoryIndex === null)
      ) {
        return false
      }

      const textarea = event.currentTarget

      if (textarea.selectionStart !== textarea.selectionEnd) {
        return false
      }

      if (event.key === "ArrowUp") {
        return !value.slice(0, textarea.selectionStart).includes("\n")
      }

      if (event.key === "ArrowDown") {
        return !value.slice(textarea.selectionEnd).includes("\n")
      }

      return false
    },
    [
      activeHistoryIndex,
      showMentionMenu,
      showSlashCommandMenu,
      userMessageHistory.length,
      value,
    ]
  )

  const handleHistoryNavigationKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
        !canNavigateHistoryForArrow(event)
      ) {
        return false
      }

      if (event.key === "ArrowDown" && activeHistoryIndex === null) {
        return false
      }

      event.preventDefault()

      if (event.key === "ArrowUp") {
        const nextIndex =
          activeHistoryIndex === null
            ? userMessageHistory.length - 1
            : Math.max(0, activeHistoryIndex - 1)

        if (activeHistoryIndex === null) {
          historyDraftRef.current = value
        }

        setHistoryIndex(nextIndex)
        applyHistoryValue(userMessageHistory[nextIndex])
        return true
      }

      const currentHistoryIndex = activeHistoryIndex

      if (currentHistoryIndex === null) {
        return false
      }

      const nextIndex = currentHistoryIndex + 1

      if (nextIndex >= userMessageHistory.length) {
        const draft = historyDraftRef.current

        setHistoryIndex(null)
        applyHistoryValue(draft)
        return true
      }

      setHistoryIndex(nextIndex)
      applyHistoryValue(userMessageHistory[nextIndex])
      return true
    },
    [
      applyHistoryValue,
      canNavigateHistoryForArrow,
      activeHistoryIndex,
      userMessageHistory,
      value,
    ]
  )

  const handleComposerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      handleComposerMenuKeyDown(event)

      if (event.defaultPrevented) {
        return
      }

      handleHistoryNavigationKeyDown(event)
    },
    [handleComposerMenuKeyDown, handleHistoryNavigationKeyDown]
  )

  React.useEffect(() => {
    const requestId = mentionFileRequestIdRef.current + 1
    mentionFileRequestIdRef.current = requestId

    if (!mentionToken || !selectedProjectId) {
      const timer = window.setTimeout(() => {
        if (mentionFileRequestIdRef.current === requestId) {
          setWorkspaceFiles([])
          setWorkspaceFilesLoading(false)
        }
      }, 0)

      return () => {
        window.clearTimeout(timer)
      }
    }

    const timer = window.setTimeout(() => {
      setWorkspaceFilesLoading(true)

      void listWorkspaceFilesForComposer({
        projectId: selectedProjectId,
        query: mentionQuery,
        limit: 30,
      })
        .then((files) => {
          if (mentionFileRequestIdRef.current === requestId) {
            setWorkspaceFiles(files)
          }
        })
        .finally(() => {
          if (mentionFileRequestIdRef.current === requestId) {
            setWorkspaceFilesLoading(false)
          }
        })
    }, 150)

    return () => {
      window.clearTimeout(timer)
    }
  }, [mentionQuery, mentionToken, selectedProjectId])

  React.useEffect(() => {
    const requestId = mentionSessionRequestIdRef.current + 1
    mentionSessionRequestIdRef.current = requestId

    if (!showMentionMenu) {
      const timer = window.setTimeout(() => {
        if (mentionSessionRequestIdRef.current === requestId) {
          setMentionSessions([])
          setMentionSessionsLoading(false)
        }
      }, 0)

      return () => {
        window.clearTimeout(timer)
      }
    }

    const timer = window.setTimeout(() => {
      setMentionSessionsLoading(true)

      void listStudioSessionsForComposer()
        .then((sessions) => {
          if (mentionSessionRequestIdRef.current === requestId) {
            setMentionSessions(sessions)
          }
        })
        .finally(() => {
          if (mentionSessionRequestIdRef.current === requestId) {
            setMentionSessionsLoading(false)
          }
        })
    }, 150)

    return () => {
      window.clearTimeout(timer)
    }
  }, [sessionId, showMentionMenu])

  React.useEffect(() => {
    if (mentions.length === 0) {
      return
    }

    const nextMentions = mentions.filter((mention) =>
      textHasComposerMentionToken(value, mention)
    )

    if (nextMentions.length !== mentions.length) {
      onMentionsChange(nextMentions)
    }
  }, [mentions, onMentionsChange, value])

  React.useEffect(() => {
    refreshRuntimeCommands()
  }, [refreshRuntimeCommands])

  React.useEffect(() => {
    if (
      !showSlashCommandMenu ||
      (installedSkillsForSlash !== null && installedMcpForSlash !== null)
    ) {
      return
    }

    let cancelled = false

    void Promise.allSettled([
      installedSkillsForSlash === null
        ? listInstalledSkillsForComposer()
        : Promise.resolve(installedSkillsForSlash),
      installedMcpForSlash === null
        ? listInstalledMcpForComposer()
        : Promise.resolve(installedMcpForSlash),
    ]).then(([skillsResult, mcpResult]) => {
      if (cancelled) {
        return
      }

      if (installedSkillsForSlash === null) {
        setInstalledSkillsForSlash(
          skillsResult.status === "fulfilled" ? skillsResult.value : []
        )
      }

      if (installedMcpForSlash === null) {
        setInstalledMcpForSlash(
          mcpResult.status === "fulfilled" ? mcpResult.value : []
        )
      }
    })

    return () => {
      cancelled = true
    }
  }, [installedMcpForSlash, installedSkillsForSlash, showSlashCommandMenu])

  React.useEffect(() => {
    if (wasBusyRef.current && !isBusy) {
      refreshRuntimeCommands()
    }

    wasBusyRef.current = isBusy
  }, [isBusy, refreshRuntimeCommands])

  React.useLayoutEffect(() => {
    syncCursorPosition()
  }, [syncCursorPosition, value])

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
  const selectedModelOption =
    modelOptions.find((option) => option.id === model) ?? null
  const selectedModelReasoningEfforts =
    selectedModelOption?.reasoningEfforts ?? getChatReasoningEfforts(model)
  const resolvedReasoningEffort = selectedModelReasoningEfforts.includes(
    reasoningEffort
  )
    ? reasoningEffort
    : (selectedModelOption?.defaultReasoningEffort ??
      resolveChatReasoningEffort(model, reasoningEffort))
  const reasoningOptions = selectedModelReasoningEfforts.map((effort) => ({
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
  const normalizedProjectSearch = projectSearch.trim().toLowerCase()
  const filteredLocalProjects = normalizedProjectSearch
    ? localProjects.filter((project) => {
        const haystack = `${project.name} ${project.path}`.toLowerCase()
        return haystack.includes(normalizedProjectSearch)
      })
    : localProjects
  const showSessionScopeControls = !sessionId
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
  const contextWindow =
    contextUsage?.modelContextWindow ?? getChatModelConfig(model).contextWindow

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
      ref={composerRef}
      data-tour-id="studio-composer"
      className="relative flex w-full flex-col overflow-visible rounded-[1.875rem] bg-muted/40 p-0.5 shadow-lg shadow-foreground/5"
    >
      <div ref={menuAnchorRef} className="relative w-full">
        {showSlashCommandMenu ? (
          <div
            role="listbox"
            aria-label={t.studioCommandMenuTitle}
            className={cn(
              "absolute inset-x-0.5 z-50 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl ring-1 shadow-foreground/10 ring-foreground/5",
              composerMenuPlacement === "top"
                ? "bottom-full mb-1"
                : "top-full mt-1"
            )}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <div className="max-h-64 overflow-y-auto p-1.5">
              {slashMenuEntries.length > 0 ? (
                <>
                  {filteredSlashCommands.map((command, index) => {
                    const selected = index === activeCommandIndex

                    return (
                      <button
                        key={`${command.source}:${command.runtimeId ?? "local"}:${command.name}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={cn(
                          "flex w-full min-w-0 items-baseline gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                          selected
                            ? "bg-accent text-accent-foreground"
                            : "text-popover-foreground hover:bg-accent/60"
                        )}
                        onMouseEnter={() => setSelectedCommandIndex(index)}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          acceptSlashCommand(command)
                        }}
                      >
                        <span className="shrink-0 text-[13px] font-medium capitalize">
                          {command.name}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                          {command.description || t.studioCommandNoDescription}
                          {command.inputHint ? (
                            <span className="text-muted-foreground/70">
                              {" "}
                              {command.inputHint}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    )
                  })}

                  {filteredSlashSkills.length > 0 ? (
                    <div
                      className={
                        filteredSlashCommands.length > 0 ? "mt-1" : undefined
                      }
                    >
                      <div className="px-3 pt-1.5 pb-1 text-[13px] text-muted-foreground">
                        {t.studioSlashMenuSkills}
                      </div>
                      {filteredSlashSkills.map((skill, index) => {
                        const menuIndex = filteredSlashCommands.length + index
                        const selected = menuIndex === activeCommandIndex
                        const description = getComposerSkillDescription(
                          skill,
                          locale
                        )

                        return (
                          <button
                            key={skill.slug}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={cn(
                              "flex w-full min-w-0 items-baseline gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                              selected
                                ? "bg-accent text-accent-foreground"
                                : "text-popover-foreground hover:bg-accent/60"
                            )}
                            onMouseEnter={() =>
                              setSelectedCommandIndex(menuIndex)
                            }
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              acceptSlashSkill(skill)
                            }}
                          >
                            <span className="shrink-0 text-[13px] font-medium">
                              {getComposerSkillLabel(skill)}
                            </span>
                            {description ? (
                              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                                {description}
                              </span>
                            ) : (
                              <span className="min-w-0 flex-1" />
                            )}
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              /{skill.slug}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : null}

                  {filteredSlashMcpServers.length > 0 ? (
                    <div
                      className={
                        filteredSlashCommands.length > 0 ||
                        filteredSlashSkills.length > 0
                          ? "mt-1"
                          : undefined
                      }
                    >
                      <div className="px-3 pt-1.5 pb-1 text-[13px] text-muted-foreground">
                        {t.studioSlashMenuMcp}
                      </div>
                      {filteredSlashMcpServers.map((server, index) => {
                        const menuIndex =
                          filteredSlashCommands.length +
                          filteredSlashSkills.length +
                          index
                        const selected = menuIndex === activeCommandIndex

                        return (
                          <button
                            key={server.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={cn(
                              "flex w-full min-w-0 items-baseline gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                              selected
                                ? "bg-accent text-accent-foreground"
                                : "text-popover-foreground hover:bg-accent/60"
                            )}
                            onMouseEnter={() =>
                              setSelectedCommandIndex(menuIndex)
                            }
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              acceptSlashMcp()
                            }}
                          >
                            <span className="shrink-0 text-[13px] font-medium">
                              {getComposerMcpLabel(server)}
                            </span>
                            {server.description ? (
                              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                                {server.description}
                              </span>
                            ) : (
                              <span className="min-w-0 flex-1" />
                            )}
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              MCP
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="px-3 py-3 text-[13px] text-muted-foreground">
                  {t.studioCommandMenuEmpty}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {showMentionMenu ? (
          <div
            role="listbox"
            aria-label={t.studioMentionMenuTitle}
            className={cn(
              "absolute inset-x-0.5 z-50 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl ring-1 shadow-foreground/10 ring-foreground/5",
              composerMenuPlacement === "top"
                ? "bottom-full mb-1"
                : "top-full mt-1"
            )}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <div className="max-h-72 overflow-y-auto p-1.5">
              <div className="px-3 pt-1.5 pb-1 text-[13px] text-muted-foreground">
                {t.studioMentionFilesTitle}
              </div>

              {!selectedProjectId ? (
                <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                  {t.studioMentionProjectRequired}
                </div>
              ) : workspaceFilesLoading &&
                filteredWorkspaceFiles.length === 0 ? (
                <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                  {t.studioMentionFilesLoading}
                </div>
              ) : filteredWorkspaceFiles.length > 0 ? (
                filteredWorkspaceFiles.map((file, index) => {
                  const selected = index === activeMentionIndex
                  const MentionIcon = file.kind === "folder" ? Folder : File

                  return (
                    <button
                      key={`${file.kind}:${file.path}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                        selected
                          ? "bg-accent text-accent-foreground"
                          : "text-popover-foreground hover:bg-accent/60"
                      )}
                      onMouseEnter={() => setSelectedMentionIndex(index)}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        acceptMentionFile(file)
                      }}
                    >
                      <MentionIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="shrink-0 text-[13px] font-medium">
                        {file.name}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                        {file.relativePath}
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                  {t.studioMentionFilesEmpty}
                </div>
              )}

              <div className="mt-1 border-t pt-1">
                <div className="px-3 pt-1.5 pb-1 text-[13px] text-muted-foreground">
                  {t.studioMentionSessionsTitle}
                </div>

                {mentionSessionsLoading &&
                filteredMentionSessions.length === 0 ? (
                  <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                    {t.studioMentionSessionsLoading}
                  </div>
                ) : filteredMentionSessions.length > 0 ? (
                  filteredMentionSessions.map((session, index) => {
                    const menuIndex = filteredWorkspaceFiles.length + index
                    const selected = menuIndex === activeMentionIndex

                    return (
                      <button
                        key={session.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={cn(
                          "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                          selected
                            ? "bg-accent text-accent-foreground"
                            : "text-popover-foreground hover:bg-accent/60"
                        )}
                        onMouseEnter={() => setSelectedMentionIndex(menuIndex)}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          acceptMentionSession(session)
                        }}
                      >
                        <MessageSquare
                          aria-hidden
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {session.title}
                        </span>
                        <span className="shrink-0 text-[13px] text-muted-foreground">
                          {formatComposerSessionUpdatedAt(session.updatedAt)}
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
                    {t.studioMentionSessionsEmpty}
                  </div>
                )}
              </div>

              <div className="mt-1 border-t pt-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={activeMentionIndex === addLocalMentionIndex}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                    activeMentionIndex === addLocalMentionIndex
                      ? "bg-accent text-accent-foreground"
                      : "text-popover-foreground hover:bg-accent/60"
                  )}
                  onMouseEnter={() =>
                    setSelectedMentionIndex(addLocalMentionIndex)
                  }
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    acceptAddLocalFile()
                  }}
                >
                  <RiAddLine
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {t.studioMentionAddLocalFile}
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <PromptInput
          value={value}
          onValueChange={handleComposerValueChange}
          onSubmit={onSubmit}
          isLoading={isBusy}
          className="w-full rounded-[1.625rem] border bg-background/95 px-3.5 py-3 shadow-sm"
        >
          {mentions.length > 0 ? (
            <div
              className="mb-2 flex flex-wrap gap-1.5 px-1"
              onClick={(event) => event.stopPropagation()}
            >
              {mentions.map((mention) => (
                <span
                  key={
                    mention.kind === "session"
                      ? `session:${mention.sessionId}`
                      : `${mention.kind}:${mention.path}`
                  }
                  title={
                    mention.kind === "session"
                      ? mention.title
                      : mention.relativePath
                  }
                  className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 text-xs font-medium text-foreground"
                >
                  {mention.kind === "session" ? (
                    <MessageSquare
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  ) : mention.kind === "folder" ? (
                    <Folder
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  ) : (
                    <File
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  )}
                  <span className="max-w-44 min-w-0 truncate">
                    {mention.kind === "session" ? mention.title : mention.name}
                  </span>
                  <button
                    type="button"
                    aria-label={t.studioMentionRemove}
                    className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeMention(mention)
                    }}
                  >
                    <RiCloseLine aria-hidden className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

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
              textareaRef={textareaRef}
              placeholder={t.studioPromptPlaceholder}
              onFocus={(event) => {
                setIsTextareaFocused(true)
                syncCursorPosition(event.currentTarget)
              }}
              onBlur={() => {
                setIsTextareaFocused(false)
                setCursorPosition(null)
              }}
              onClick={(event) => syncCursorPosition(event.currentTarget)}
              onKeyDown={handleComposerKeyDown}
              onKeyUp={(event) => syncCursorPosition(event.currentTarget)}
              onPaste={handlePaste}
              onSelect={(event) => syncCursorPosition(event.currentTarget)}
              className={cn(
                "max-h-40 min-h-9 w-full px-0 py-1.5 text-base text-foreground placeholder:text-muted-foreground md:text-base",
                showCustomCaret && "caret-transparent"
              )}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
            <div
              className="flex shrink-0 items-center gap-1.5"
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
                  className="size-7 rounded-full p-0 [&_svg]:size-4"
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
                    className={cn(
                      "h-7 max-w-40 rounded-full border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted/60 sm:max-w-44",
                      iconOnlyControls &&
                        "w-7 max-w-7 justify-center gap-0 px-0 [&>svg:last-child]:hidden"
                    )}
                    aria-label={t.studioPermissionMode}
                    title={permissionModeOption.description}
                  >
                    <PermissionModeIcon aria-hidden className="size-3.5" />
                    <span
                      className={cn("truncate", iconOnlyControls && "sr-only")}
                    >
                      {permissionModeOption.label}
                    </span>
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
              className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5"
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
                  className={cn(
                    "h-7 max-w-40 rounded-full bg-background px-2.5 text-xs sm:max-w-48",
                    iconOnlyControls &&
                      "w-7 max-w-7 justify-center gap-0 px-0 [&>svg:last-child]:hidden"
                  )}
                  aria-label={t.studioAgentRuntime}
                  title={runtimeDescription}
                >
                  <AgentRuntimeIcon
                    runtimeId={runtimeId}
                    className="size-3.5"
                  />
                  <span
                    className={cn("truncate", iconOnlyControls && "sr-only")}
                  >
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

              <ContextUsageIndicator
                contextWindow={contextWindow}
                usage={contextUsage}
              />

              <Select
                open={modelSelectOpen}
                onOpenChange={onModelSelectOpenChange}
                value={model}
                onValueChange={(nextValue) =>
                  onModelChange(nextValue as SupportedChatModel)
                }
                disabled={isBusy}
              >
                <SelectTrigger
                  data-tour-id="studio-composer-model"
                  size="sm"
                  className="h-7 max-w-36 rounded-full bg-background px-2.5 text-xs sm:max-w-44"
                  aria-label={t.studioChatModel}
                  title={t.studioChatModelDescription}
                >
                  <span className="truncate">
                    {getAgentChatModelLabel(model, modelOptions)}
                  </span>
                </SelectTrigger>
                <SelectContent position="popper" side="top" align="end">
                  <SelectGroup>
                    {modelOptions.map((option) => (
                      <SelectItem
                        key={option.id}
                        value={option.id}
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
                open={reasoningSelectOpen}
                onOpenChange={onReasoningSelectOpenChange}
                value={resolvedReasoningEffort}
                onValueChange={(nextValue) =>
                  onReasoningEffortChange(nextValue as ChatReasoningEffort)
                }
                disabled={isBusy || reasoningOptions.length <= 1}
              >
                <SelectTrigger
                  size="sm"
                  className={cn(
                    "h-7 rounded-full bg-background px-2.5 text-xs",
                    iconOnlyControls &&
                      "w-7 max-w-7 justify-center gap-0 px-0 [&>svg:last-child]:hidden"
                  )}
                  aria-label={t.studioReasoningEffort}
                  title={
                    reasoningOptions.find(
                      (option) => option.value === resolvedReasoningEffort
                    )?.description
                  }
                >
                  <RiBrainLine aria-hidden className="size-3.5" />
                  <span className={cn(iconOnlyControls && "sr-only")}>
                    {reasoningEffortLabel}
                  </span>
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
                className="size-7 rounded-full bg-foreground p-0 text-background hover:bg-foreground/85 [&_svg]:size-3.5"
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
      </div>

      {showSessionScopeControls ? (
      <div className="flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground">
        <Select
          value={selectedProjectValue}
          onValueChange={handleProjectValueChange}
          disabled={isBusy}
        >
          <SelectTrigger
            data-tour-id="studio-composer-project"
            size="sm"
            className="h-6 w-fit max-w-52 rounded-lg border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted/70"
            aria-label={t.studioLocalProjectSelect}
            title={
              selectedProject
                ? t.studioLocalProjectBoundDescription(selectedProject.path)
                : t.studioLocalProjectNoneDescription
            }
          >
            <FolderGit2 aria-hidden className="size-3.5" />
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
            <div className="sticky top-0 z-10 space-y-1 border-b bg-popover p-2">
              <div className="relative">
                <RiSearchLine
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder={t.search}
                  className="h-7 rounded-lg pl-7 text-xs"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start rounded-lg px-2 text-xs"
                disabled={isAddingProject}
                onClick={(event) => {
                  event.preventDefault()
                  onAddProject()
                }}
              >
                {isAddingProject ? (
                  <RiLoader4Line className="animate-spin" aria-hidden />
                ) : (
                  <FolderPlus aria-hidden className="size-3.5" />
                )}
                <span>{t.studioLocalProjectAdd}</span>
              </Button>
            </div>
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
              {filteredLocalProjects.length > 0 ? (
                filteredLocalProjects.map((project) => (
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
                      meta={formatProjectGitMeta(project, t)}
                    />
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="__empty__" disabled>
                  {localProjects.length > 0
                    ? t.studioNoResults
                    : t.studioLocalProjectEmpty}
                </SelectItem>
              )}
            </SelectGroup>
            {isAddingProject ? (
              <div className="sticky bottom-0 flex items-center gap-2 border-t bg-popover px-3 py-2 text-xs text-muted-foreground">
                <RiLoader4Line className="animate-spin" aria-hidden />
                <span>{t.studioLocalProjectAdding}</span>
              </div>
            ) : null}
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
            className="h-6 w-fit rounded-lg border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted/70"
            aria-label={t.studioProjectEnvironment}
            title={
              runtimeEnvironment === "remote"
                ? t.studioLocalProjectRemoteDescription
                : t.studioLocalProjectLocalDescription
            }
          >
            <Globe aria-hidden className="size-3.5" />
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
                ? formatProjectGitMeta(selectedProject, t)
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
      ) : null}
    </div>
  )
}

const ChatMessageBubble = React.memo(function ChatMessageBubble({
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

  return <AssistantMessage message={message} onRetry={onRetry} />
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
  const [chatEnvironment] = useChatEnvironment()

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
          <MessagePartsRenderer
            content={activeVersion.content}
            activities={activeVersion.activities}
            parts={activeVersion.parts}
            sessionId={activeVersion.sessionId}
            environment={chatEnvironment}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

const AssistantMessage = React.memo(function AssistantMessage({
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
  const [chatEnvironment] = useChatEnvironment()
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
          <MessagePartsRenderer
            content={message.content}
            activities={message.activities}
            parts={message.parts}
            sessionId={message.sessionId}
            streaming={isStreaming}
            environment={chatEnvironment}
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
