"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArchiveLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBookOpenLine,
  RiCheckLine,
  RiCloseLine,
  RiDownloadLine,
  RiEditLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiFolderLine,
  RiRefreshLine,
  RiSearchLine,
  RiTimeLine,
  RiUser3Line,
  RiVerifiedBadgeLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { Markdown } from "@/components/prompt-kit/markdown"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  extractMcpRegistryTransports,
  normalizeMcpServerId,
  type InstalledMcpServer,
  type InstalledMcpServerApiResponse,
  type InstalledMcpServersApiResponse,
  type McpKeyValue,
  type McpRegistryServer,
  type McpRegistryServersApiResponse,
  type McpTransportConfig,
  type McpTransportType,
} from "@/lib/mcp"
import {
  type SkillDetailApiResponse,
  type InstalledSkill,
  type InstalledSkillApiResponse,
  type InstalledSkillsApiResponse,
  type SkillImportApiResponse,
  type SkillImportCandidate,
  type SkillImportCandidatesApiResponse,
  type SkillImportScanData,
  type SkillMarketApiResponse,
  type SkillMeta,
  type SkillOrderBy,
} from "@/lib/skill-market"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 24
const allCategoriesValue = "__all__"
const defaultMcpTransport: McpTransportType = "streamable-http"

class LoginRequiredError extends Error {
  constructor() {
    super("Login required.")
    this.name = "LoginRequiredError"
  }
}

function isLoginRequiredError(error: unknown) {
  return error instanceof LoginRequiredError
}

function throwIfUnauthorized(response: Response) {
  if (response.status === 401) {
    throw new LoginRequiredError()
  }
}

type SkillDetailState = {
  skill: SkillMeta
  skillMd: string
}

type SkillsView = "market" | "mine"
type PluginType = "skills" | "mcp"
type SkillCardSize = "default" | "large"

type SkillsMarketPageProps = {
  embedded?: boolean
  initialView?: SkillsView
}

type McpManualFormState = {
  id: string
  name: string
  title: string
  description: string
  source: "manual" | "registry"
  registryName: string
  registryVersion: string
  transport: McpTransportType
  url: string
  command: string
  args: string
  cwd: string
  headers: McpKeyValue[]
  env: string
  localCommandConfirmed: boolean
}

type InstallMcpPayload = {
  id?: string
  name: string
  title?: string
  description?: string
  source?: "manual" | "registry"
  registryName?: string | null
  registryVersion?: string | null
  enabled?: boolean
  config: McpTransportConfig
  localCommandConfirmed?: boolean
}

function createEmptyMcpForm(): McpManualFormState {
  return {
    id: "",
    name: "",
    title: "",
    description: "",
    source: "manual",
    registryName: "",
    registryVersion: "",
    transport: defaultMcpTransport,
    url: "",
    command: "",
    args: "",
    cwd: "",
    headers: [],
    env: "",
    localCommandConfirmed: false,
  }
}

function getSkillGridClass(size: SkillCardSize, spacious = false) {
  const gap = size === "large" || spacious ? "gap-4" : "gap-3"

  if (size === "large") {
    return `grid grid-cols-1 ${gap} md:grid-cols-2 2xl:grid-cols-3`
  }

  return `grid grid-cols-1 ${gap} sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`
}

function getLocaleTag(locale: string) {
  return locale === "zh" ? "zh-CN" : "en-US"
}

function compactNumber(value: number | undefined, locale: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-"
  }

  return new Intl.NumberFormat(getLocaleTag(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function formatBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-"
  }

  const units = ["B", "KB", "MB", "GB"]
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

function formatUpdatedAt(value: number | undefined, locale: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-"
  }

  const timestamp = value < 1_000_000_000_000 ? value * 1000 : value
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function formatIsoDate(value: string | undefined, locale: string) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function getSkillTitle(skill: SkillMeta) {
  return skill.Name?.trim() || skill.Slug?.trim() || "Untitled skill"
}

function getSkillDescription(skill: SkillMeta, locale: string) {
  const preferred = locale === "zh" ? skill.DescZh : skill.Desc
  const fallback = locale === "zh" ? skill.Desc : skill.DescZh

  return preferred?.trim() || fallback?.trim() || ""
}

function getSkillSearchText(skill: SkillMeta) {
  return [
    skill.Slug,
    skill.Name,
    skill.Author,
    skill.Desc,
    skill.DescZh,
    skill.Category,
    skill.UpStream,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function categoryLabel(category: string) {
  return category
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getMcpSearchText(server: InstalledMcpServer | McpRegistryServer) {
  return [
    server.id,
    server.name,
    server.title,
    server.description,
    "version" in server ? server.version : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function getMcpTransportLabel(
  transport: McpTransportType,
  t: ReturnType<typeof useI18n>["t"]
) {
  if (transport === "stdio") {
    return t.mcpTransportStdio
  }

  if (transport === "sse") {
    return t.mcpTransportSse
  }

  return t.mcpTransportHttp
}

function readRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function parseKeyValueLines(value: string): McpKeyValue[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const secretPrefix = "secret:"
      const isSecret = line.toLowerCase().startsWith(secretPrefix)
      const normalizedLine = isSecret ? line.slice(secretPrefix.length) : line
      const separatorIndex = normalizedLine.indexOf("=")
      const name =
        separatorIndex >= 0
          ? normalizedLine.slice(0, separatorIndex).trim()
          : normalizedLine.trim()
      const entryValue =
        separatorIndex >= 0 ? normalizedLine.slice(separatorIndex + 1) : ""

      return {
        name,
        value: entryValue,
        isSecret,
        hasValue: isSecret ? separatorIndex >= 0 : Boolean(entryValue),
      }
    })
    .filter((entry) => entry.name)
}

function formatKeyValueLines(entries: McpKeyValue[] | undefined) {
  return (entries ?? [])
    .map((entry) => {
      const prefix = entry.isSecret ? "secret:" : ""

      return `${prefix}${entry.name}=${entry.value ?? ""}`
    })
    .join("\n")
}

function createEmptyKeyValueRow(): McpKeyValue {
  return {
    name: "",
    value: "",
    isSecret: false,
    hasValue: false,
  }
}

function normalizeKeyValueRows(entries: McpKeyValue[] | undefined) {
  return (entries ?? [])
    .map((entry) => {
      const value = entry.value ?? ""

      return {
        name: entry.name.trim(),
        value,
        isSecret: Boolean(entry.isSecret),
        hasValue: entry.isSecret
          ? Boolean(entry.hasValue || value)
          : Boolean(value),
      }
    })
    .filter((entry) => entry.name)
}

function parseArgumentLine(value: string) {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? []

  return matches.map((item) => item.replace(/^["']|["']$/g, ""))
}

function formatArgumentLine(args: string[] | undefined) {
  return (args ?? [])
    .map((item) => (/[\s"']/.test(item) ? JSON.stringify(item) : item))
    .join(" ")
}

function createMcpEditDraft(server: InstalledMcpServer): McpManualFormState {
  const base = {
    ...createEmptyMcpForm(),
    id: server.id,
    name: server.name,
    title: server.title,
    description: server.description,
    source: server.source,
    registryName: server.registryName ?? "",
    registryVersion: server.registryVersion ?? "",
    transport: server.config.type,
  }

  if (server.config.type === "stdio") {
    return {
      ...base,
      command: server.config.command,
      args: formatArgumentLine(server.config.args),
      cwd: server.config.cwd ?? "",
      env: formatKeyValueLines(server.config.env),
      localCommandConfirmed: false,
    }
  }

  return {
    ...base,
    url: server.config.url,
    headers: server.config.headers,
  }
}

function formatIsoDateTime(value: string | null | undefined, locale: string) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function getRegistryRemotes(server: McpRegistryServer) {
  return Array.isArray(server.serverJson.remotes)
    ? server.serverJson.remotes.map(readRecord)
    : []
}

function getRegistryPackages(server: McpRegistryServer) {
  return Array.isArray(server.serverJson.packages)
    ? server.serverJson.packages.map(readRecord)
    : []
}

function readRegistryArguments(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item
      }

      const record = readRecord(item)

      return (
        readString(record.value) ||
        readString(record.default) ||
        readString(record.name)
      )
    })
    .filter(Boolean)
}

function getRegistryPackageTransport(packageEntry: Record<string, unknown>) {
  const rawTransport = packageEntry.transport

  if (typeof rawTransport === "string") {
    return rawTransport.trim()
  }

  return readString(readRecord(rawTransport).type)
}

function createMcpRemoteInstallPayload(
  server: McpRegistryServer,
  transport: "streamable-http" | "sse"
): InstallMcpPayload | null {
  const remote = getRegistryRemotes(server).find(
    (item) => readString(item.type) === transport && readString(item.url)
  )

  if (!remote) {
    return null
  }

  return {
    id: normalizeMcpServerId(server.name),
    name: server.name,
    title: server.title,
    description: server.description,
    source: "registry",
    registryName: server.name,
    registryVersion: server.version,
    enabled: true,
    config: {
      type: transport,
      url: readString(remote.url),
      headers: [],
    },
  }
}

function createMcpStdioDraft(server: McpRegistryServer): McpManualFormState {
  const packageEntry =
    getRegistryPackages(server).find(
      (item) => getRegistryPackageTransport(item) === "stdio"
    ) ?? {}
  const runtimeHint = readString(packageEntry.runtimeHint)
  const identifier = readString(packageEntry.identifier)
  const version = readString(packageEntry.version) || server.version
  const args = [
    ...readRegistryArguments(packageEntry.runtimeArguments),
    identifier && version && version !== "latest"
      ? `${identifier}@${version}`
      : identifier,
    ...readRegistryArguments(packageEntry.packageArguments),
  ].filter(Boolean)

  return {
    ...createEmptyMcpForm(),
    id: normalizeMcpServerId(server.name),
    name: server.name,
    title: server.title,
    description: server.description,
    source: "registry",
    registryName: server.name,
    registryVersion: server.version,
    transport: "stdio",
    command: runtimeHint || "npx",
    args: args.join(" "),
  }
}

function createMcpInstallDraft(server: McpRegistryServer) {
  return (
    createMcpRemoteInstallPayload(server, "streamable-http") ??
    createMcpRemoteInstallPayload(server, "sse")
  )
}

async function fetchSkills({
  category,
  keyword,
  offset,
  orderBy,
  signal,
}: {
  category: string
  keyword: string
  offset: number
  orderBy: SkillOrderBy
  signal: AbortSignal
}) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(PAGE_SIZE),
    orderBy,
  })

  if (keyword) {
    params.set("keyword", keyword)
  }

  if (category !== allCategoriesValue) {
    params.set("category", category)
  }

  const response = await fetch(`/api/skills?${params}`, {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillMarketApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload
}

async function fetchSkillDetail(skill: SkillMeta, signal: AbortSignal) {
  const slug = skill.Slug?.trim()

  if (!slug) {
    throw new Error("Skill slug is missing.")
  }

  const params = new URLSearchParams()

  if (skill.Version?.trim()) {
    params.set("version", skill.Version.trim())
  }

  const response = await fetch(
    `/api/skills/${encodeURIComponent(slug)}${
      params.size > 0 ? `?${params}` : ""
    }`,
    { signal, cache: "no-store" }
  )
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillDetailApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function fetchInstalledSkills(signal: AbortSignal) {
  const response = await fetch("/api/skills/installed", {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as InstalledSkillsApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function installSkill(skill: SkillMeta) {
  const slug = skill.Slug?.trim()

  if (!slug) {
    throw new Error("Skill slug is missing.")
  }

  const response = await fetch("/api/skills/installed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug,
      ...(skill.Version?.trim() ? { version: skill.Version.trim() } : {}),
    }),
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as InstalledSkillApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function fetchSkillImportCandidates(signal?: AbortSignal) {
  const response = await fetch("/api/skills/import-candidates", {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillImportCandidatesApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function importSkillCandidatePaths(sourcePaths: string[]) {
  const response = await fetch("/api/skills/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePaths }),
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillImportApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function parseSkillFolderFiles(fileList: FileList) {
  const formData = new FormData()

  formData.append("mode", "parse")

  for (const file of Array.from(fileList)) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name

    formData.append("files", file)
    formData.append("paths", relativePath)
  }

  const response = await fetch("/api/skills/import", {
    method: "POST",
    body: formData,
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillImportCandidatesApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function importSkillFolderFiles(
  fileList: FileList,
  selectedPaths?: string[]
) {
  const formData = new FormData()

  for (const file of Array.from(fileList)) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name

    formData.append("files", file)
    formData.append("paths", relativePath)
  }

  for (const selectedPath of selectedPaths ?? []) {
    formData.append("selectedPaths", selectedPath)
  }

  const response = await fetch("/api/skills/import", {
    method: "POST",
    body: formData,
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillImportApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function updateInstalledSkill(slug: string, enabled: boolean) {
  const response = await fetch(
    `/api/skills/installed/${encodeURIComponent(slug)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }
  )
  throwIfUnauthorized(response)

  const payload = (await response.json()) as InstalledSkillApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function removeInstalledSkill(slug: string) {
  const response = await fetch(
    `/api/skills/installed/${encodeURIComponent(slug)}`,
    { method: "DELETE" }
  )
  throwIfUnauthorized(response)

  const payload = (await response.json()) as
    | { ok: true }
    | { ok: false; message: string }

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }
}

async function fetchMcpMarket({
  cursor,
  keyword,
  signal,
}: {
  cursor: string
  keyword: string
  signal: AbortSignal
}) {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    version: "latest",
  })

  if (cursor) {
    params.set("cursor", cursor)
  }

  if (keyword) {
    params.set("keyword", keyword)
  }

  const response = await fetch(`/api/mcp/market?${params}`, {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as McpRegistryServersApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload
}

async function fetchInstalledMcp(signal: AbortSignal) {
  const response = await fetch("/api/mcp/installed", {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as InstalledMcpServersApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function installMcpServer(payload: InstallMcpPayload) {
  const response = await fetch("/api/mcp/installed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  throwIfUnauthorized(response)

  const responsePayload = (await response.json()) as InstalledMcpServerApiResponse

  if (!response.ok || !responsePayload.ok) {
    throw new Error(
      (!responsePayload.ok && responsePayload.message) || "Request failed"
    )
  }

  return responsePayload.data
}

async function updateInstalledMcp(id: string, payload: Partial<InstallMcpPayload>) {
  const response = await fetch(`/api/mcp/installed/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  throwIfUnauthorized(response)

  const responsePayload = (await response.json()) as InstalledMcpServerApiResponse

  if (!response.ok || !responsePayload.ok) {
    throw new Error(
      (!responsePayload.ok && responsePayload.message) || "Request failed"
    )
  }

  return responsePayload.data
}

async function testInstalledMcp(id: string) {
  const response = await fetch(
    `/api/mcp/installed/${encodeURIComponent(id)}/test`,
    { method: "POST" }
  )
  throwIfUnauthorized(response)

  const payload = (await response.json()) as
    | { ok: true; data: InstalledMcpServer }
    | { ok: false; message: string; data?: InstalledMcpServer }

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

async function removeInstalledMcp(id: string) {
  const response = await fetch(`/api/mcp/installed/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as
    | { ok: true }
    | { ok: false; message: string }

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }
}

function SkillStat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  )
}

function PluginCardDescription({ children }: { children: string }) {
  return (
    <p
      className="h-[64px] min-h-[64px] overflow-y-auto whitespace-pre-line pr-2 text-sm leading-5 text-muted-foreground [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      tabIndex={0}
    >
      {children}
    </p>
  )
}

function SkillCard({
  installedSkill,
  installing,
  locale,
  onInstall,
  onOpen,
  size = "default",
  skill,
}: {
  installedSkill?: InstalledSkill
  installing?: boolean
  locale: string
  onInstall?: (skill: SkillMeta) => void
  onOpen: (skill: SkillMeta) => void
  size?: SkillCardSize
  skill: SkillMeta
}) {
  const { t } = useI18n()
  const title = getSkillTitle(skill)
  const description = getSkillDescription(skill, locale)
  const slug = skill.Slug?.trim() || "-"
  const canInstall =
    Boolean(skill.Slug?.trim()) && !installedSkill && Boolean(onInstall)

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20",
        size === "large" ? "min-h-[252px]" : "min-h-[226px]"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <RiBookOpenLine className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">{title}</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {slug}
              </p>
            </div>
          </div>
        </div>

        <PluginCardDescription>
          {description || t.skillNoDescription}
        </PluginCardDescription>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <SkillStat
            icon={<RiDownloadLine className="size-3.5" aria-hidden />}
            label={t.skillDownloads(compactNumber(skill.Downloads, locale))}
          />
          <SkillStat
            icon={<RiFileTextLine className="size-3.5" aria-hidden />}
            label={t.skillFiles(skill.FileCount ?? 0)}
          />
          <SkillStat
            icon={<RiArchiveLine className="size-3.5" aria-hidden />}
            label={formatBytes(skill.SizeBytes)}
          />
          <SkillStat
            icon={<RiTimeLine className="size-3.5" aria-hidden />}
            label={formatUpdatedAt(skill.UpStreamUpdatedAt, locale)}
          />
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2 border-t px-4 py-3">
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => onOpen(skill)}
          >
            {t.skillView}
          </Button>
          <Button
            type="button"
            variant={installedSkill ? "secondary" : "default"}
            size="sm"
            className="h-8"
            disabled={!canInstall || installing}
            onClick={() => onInstall?.(skill)}
          >
            {installedSkill ? (
              <RiCheckLine aria-hidden />
            ) : (
              <RiAddLine aria-hidden />
            )}
            {installedSkill
              ? t.skillAdded
              : installing
                ? t.skillAdding
                : t.skillAdd}
          </Button>
        </div>
      </div>
    </article>
  )
}

function InstalledSkillCard({
  busy,
  installedSkill,
  locale,
  onOpen,
  onRemove,
  onToggle,
  size = "default",
}: {
  busy: boolean
  installedSkill: InstalledSkill
  locale: string
  onOpen: (installedSkill: InstalledSkill) => void
  onRemove: (installedSkill: InstalledSkill) => void
  onToggle: (installedSkill: InstalledSkill, enabled: boolean) => void
  size?: SkillCardSize
}) {
  const { t } = useI18n()
  const skill = installedSkill.skill
  const title = getSkillTitle(skill)
  const description = getSkillDescription(skill, locale)

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20",
        size === "large" ? "min-h-[252px]" : "min-h-[226px]"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <RiBookOpenLine className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">{title}</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {installedSkill.slug}
              </p>
            </div>
          </div>
        </div>

        <PluginCardDescription>
          {description || t.skillNoDescription}
        </PluginCardDescription>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <SkillStat
            icon={<RiFileTextLine className="size-3.5" aria-hidden />}
            label={t.skillFiles(installedSkill.installedFileCount)}
          />
          <SkillStat
            icon={<RiArchiveLine className="size-3.5" aria-hidden />}
            label={formatBytes(installedSkill.installedSizeBytes)}
          />
          <SkillStat
            icon={<RiTimeLine className="size-3.5" aria-hidden />}
            label={t.skillInstalledAt(
              formatIsoDate(installedSkill.installedAt, locale)
            )}
          />
          <SkillStat
            icon={<RiVerifiedBadgeLine className="size-3.5" aria-hidden />}
            label={`v${installedSkill.version}`}
          />
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2 border-t px-4 py-3">
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => onOpen(installedSkill)}
          >
            {t.skillView}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => onToggle(installedSkill, !installedSkill.enabled)}
          >
            {installedSkill.enabled ? t.skillDisable : t.skillEnable}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => onRemove(installedSkill)}
          >
            <RiCloseLine aria-hidden />
            {t.skillRemove}
          </Button>
        </div>
      </div>
    </article>
  )
}

function McpMarketCard({
  busy,
  installed,
  locale,
  onInstall,
  server,
}: {
  busy: boolean
  installed?: InstalledMcpServer
  locale: string
  onInstall: (server: McpRegistryServer) => void
  server: McpRegistryServer
}) {
  const { t } = useI18n()
  const transports =
    server.transports.length > 0
      ? server.transports
      : extractMcpRegistryTransports(server.serverJson)

  return (
    <article className="flex min-h-[226px] min-w-0 flex-col rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20">
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <RiFolderLine className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">{server.title}</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {server.name}
              </p>
            </div>
          </div>
          {server.latest ? (
            <Badge variant="secondary" className="shrink-0">
              <RiVerifiedBadgeLine aria-hidden />
              {t.skillLatest}
            </Badge>
          ) : null}
        </div>

        <PluginCardDescription>
          {server.description || t.skillNoDescription}
        </PluginCardDescription>

        <div className="flex flex-wrap gap-2">
          {transports.length > 0 ? (
            transports.map((transport) => (
              <Badge key={transport} variant="outline">
                {getMcpTransportLabel(transport, t)}
              </Badge>
            ))
          ) : (
            <Badge variant="outline">{t.none}</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <SkillStat
            icon={<RiVerifiedBadgeLine className="size-3.5" aria-hidden />}
            label={`v${server.version}`}
          />
          <SkillStat
            icon={<RiTimeLine className="size-3.5" aria-hidden />}
            label={formatIsoDateTime(server.updatedAt, locale)}
          />
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 border-t px-4 py-3">
        <Badge variant="outline" className="max-w-40">
          <span className="truncate">{server.status || server.source}</span>
        </Badge>
        <Button
          type="button"
          variant={installed ? "secondary" : "default"}
          size="sm"
          className="h-8"
          disabled={Boolean(installed) || busy}
          onClick={() => onInstall(server)}
        >
          {installed ? <RiCheckLine aria-hidden /> : <RiAddLine aria-hidden />}
          {installed ? t.mcpInstalled : busy ? t.skillAdding : t.mcpInstall}
        </Button>
      </div>
    </article>
  )
}

function InstalledMcpCard({
  busy,
  locale,
  onEdit,
  onRemove,
  onTest,
  onToggle,
  server,
}: {
  busy: boolean
  locale: string
  onEdit: (server: InstalledMcpServer) => void
  onRemove: (server: InstalledMcpServer) => void
  onTest: (server: InstalledMcpServer) => void
  onToggle: (server: InstalledMcpServer, enabled: boolean) => void
  server: InstalledMcpServer
}) {
  const { t } = useI18n()

  return (
    <article className="flex min-h-[226px] min-w-0 flex-col rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20">
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <RiFolderLine className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">{server.title}</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {server.name}
              </p>
            </div>
          </div>
          <Badge variant={server.enabled ? "secondary" : "outline"}>
            {server.enabled ? t.skillEnabled : t.skillDisabled}
          </Badge>
        </div>

        <PluginCardDescription>
          {server.description || t.skillNoDescription}
        </PluginCardDescription>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <SkillStat
            icon={<RiFileTextLine className="size-3.5" aria-hidden />}
            label={t.mcpTools(server.tools.length)}
          />
          <SkillStat
            icon={<RiArchiveLine className="size-3.5" aria-hidden />}
            label={t.mcpResources(server.resources.length)}
          />
          <SkillStat
            icon={<RiBookOpenLine className="size-3.5" aria-hidden />}
            label={t.mcpPrompts(server.prompts.length)}
          />
          <SkillStat
            icon={<RiTimeLine className="size-3.5" aria-hidden />}
            label={t.mcpLastConnected(
              formatIsoDateTime(server.lastConnectedAt, locale)
            )}
          />
        </div>

        {server.lastError ? (
          <p className="line-clamp-2 text-xs text-destructive">
            {t.mcpLastError(server.lastError)}
          </p>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <Badge variant="outline" className="shrink-0">
          {getMcpTransportLabel(server.transport, t)}
        </Badge>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => onEdit(server)}
          >
            <RiEditLine aria-hidden />
            {t.mcpEdit}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => onTest(server)}
          >
            {busy ? t.mcpTesting : t.mcpTest}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => onToggle(server, !server.enabled)}
          >
            {server.enabled ? t.skillDisable : t.skillEnable}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => onRemove(server)}
          >
            <RiCloseLine aria-hidden />
            {t.skillRemove}
          </Button>
        </div>
      </div>
    </article>
  )
}

function McpHeadersEditor({
  onChange,
  value,
}: {
  onChange: (value: McpKeyValue[]) => void
  value: McpKeyValue[]
}) {
  const { t } = useI18n()
  const rows = value.length > 0 ? value : [createEmptyKeyValueRow()]

  // McpKeyValue has no intrinsic id, so we keep a stable id per logical row in
  // state aligned to row order. This survives edits (updateRow preserves length
  // and order) and deletions (removeRow drops the matching id), so React keys
  // stay stable and inputs no longer shift onto the wrong row after a middle
  // delete. Length reconciliation uses the render-time state adjustment pattern.
  const [rowIdState, setRowIdState] = React.useState(() => ({
    counter: rows.length,
    ids: rows.map((_, index) => `mcp-header-${index + 1}`),
  }))

  let rowIds = rowIdState.ids
  if (rowIds.length !== rows.length) {
    if (rowIds.length < rows.length) {
      let counter = rowIdState.counter
      rowIds = [...rowIds]
      while (rowIds.length < rows.length) {
        counter += 1
        rowIds.push(`mcp-header-${counter}`)
      }
      setRowIdState({ counter, ids: rowIds })
    } else {
      rowIds = rowIds.slice(0, rows.length)
      setRowIdState({ counter: rowIdState.counter, ids: rowIds })
    }
  }

  function updateRow(index: number, updates: Partial<McpKeyValue>) {
    onChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...updates } : row
      )
    )
  }

  function removeRow(index: number) {
    setRowIdState((state) => ({
      counter: state.counter,
      ids: state.ids.filter((_, rowIndex) => rowIndex !== index),
    }))
    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
  }

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <label className="text-xs font-medium">{t.mcpHeaders}</label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          onClick={() => onChange([...rows, createEmptyKeyValueRow()])}
        >
          <RiAddLine aria-hidden />
          {t.mcpAddHeader}
        </Button>
      </div>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={rowIds[index]}
            className="grid gap-2 rounded-lg border bg-muted/20 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_auto_auto] sm:items-center"
          >
            <Input
              aria-label={`${t.mcpHeaderName} ${index + 1}`}
              value={row.name}
              placeholder={t.mcpHeaderName}
              onChange={(event) =>
                updateRow(index, { name: event.target.value })
              }
            />
            <Input
              aria-label={`${t.mcpHeaderValue} ${index + 1}`}
              value={row.value ?? ""}
              type={row.isSecret ? "password" : "text"}
              placeholder={
                row.isSecret && row.hasValue && !row.value
                  ? t.mcpKeepExistingSecret
                  : t.mcpHeaderValue
              }
              onChange={(event) =>
                updateRow(index, {
                  value: event.target.value,
                  hasValue: row.isSecret
                    ? Boolean(row.hasValue || event.target.value)
                    : Boolean(event.target.value),
                })
              }
            />
            <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={Boolean(row.isSecret)}
                onChange={(event) =>
                  updateRow(index, {
                    isSecret: event.target.checked,
                    hasValue: event.target.checked
                      ? Boolean(row.hasValue || row.value)
                      : Boolean(row.value),
                  })
                }
              />
              <span>{t.mcpSecret}</span>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 justify-self-start sm:justify-self-end"
              aria-label={t.mcpRemoveHeader}
              onClick={() => removeRow(index)}
            >
              <RiCloseLine aria-hidden />
            </Button>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{t.mcpHeadersHint}</p>
    </div>
  )
}

function McpManualDialog({
  busy,
  error,
  form,
  mode,
  onChange,
  onOpenChange,
  onSubmit,
  open,
}: {
  busy: boolean
  error: string
  form: McpManualFormState
  mode: "create" | "edit"
  onChange: (form: McpManualFormState) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  open: boolean
}) {
  const { t } = useI18n()
  const isStdio = form.transport === "stdio"
  const isEditing = mode === "edit"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t.mcpEditTitle : t.mcpManualTitle}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? t.mcpEditDescription : t.mcpManualDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.requestFailed}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="mcp-name">
                {t.mcpName}
              </label>
              <Input
                id="mcp-name"
                value={form.name}
                onChange={(event) =>
                  onChange({ ...form, name: event.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="mcp-title">
                {t.mcpTitle}
              </label>
              <Input
                id="mcp-title"
                value={form.title}
                onChange={(event) =>
                  onChange({ ...form, title: event.target.value })
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="mcp-description">
              {t.mcpDescription}
            </label>
            <Textarea
              id="mcp-description"
              value={form.description}
              onChange={(event) =>
                onChange({ ...form, description: event.target.value })
              }
              className="min-h-20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="mcp-transport">
              {t.mcpTransport}
            </label>
            <Select
              value={form.transport}
              onValueChange={(value) =>
                onChange({
                  ...form,
                  transport: value as McpTransportType,
                })
              }
            >
              <SelectTrigger id="mcp-transport" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="streamable-http">
                  {t.mcpTransportHttp}
                </SelectItem>
                <SelectItem value="sse">{t.mcpTransportSse}</SelectItem>
                <SelectItem value="stdio">{t.mcpTransportStdio}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isStdio ? (
            <>
              <Alert>
                <AlertTitle>{t.mcpTransportStdio}</AlertTitle>
                <AlertDescription>{t.mcpLocalCommandWarning}</AlertDescription>
              </Alert>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="mcp-command">
                    {t.mcpCommand}
                  </label>
                  <Input
                    id="mcp-command"
                    value={form.command}
                    onChange={(event) =>
                      onChange({ ...form, command: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="mcp-args">
                    {t.mcpArguments}
                  </label>
                  <Input
                    id="mcp-args"
                    value={form.args}
                    onChange={(event) =>
                      onChange({ ...form, args: event.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor="mcp-cwd">
                  {t.mcpWorkingDirectory}
                </label>
                <Input
                  id="mcp-cwd"
                  value={form.cwd}
                  onChange={(event) =>
                    onChange({ ...form, cwd: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor="mcp-env">
                  {t.mcpEnvironment}
                </label>
                <Textarea
                  id="mcp-env"
                  value={form.env}
                  onChange={(event) =>
                    onChange({ ...form, env: event.target.value })
                  }
                  placeholder={t.mcpKeyValueHint}
                  className="min-h-24 font-mono text-xs"
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.localCommandConfirmed}
                  onChange={(event) =>
                    onChange({
                      ...form,
                      localCommandConfirmed: event.target.checked,
                    })
                  }
                />
                <span>{t.mcpConfirmLocalCommand}</span>
              </label>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor="mcp-url">
                  {t.mcpUrl}
                </label>
                <Input
                  id="mcp-url"
                  value={form.url}
                  onChange={(event) =>
                    onChange({ ...form, url: event.target.value })
                  }
                />
              </div>
              <McpHeadersEditor
                value={form.headers}
                onChange={(headers) => onChange({ ...form, headers })}
              />
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.studioCancel}
          </Button>
          <Button type="button" disabled={busy} onClick={onSubmit}>
            {busy ? t.mcpSaving : t.mcpSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkillSkeletonGrid({ size = "default" }: { size?: SkillCardSize }) {
  return (
    <div className={getSkillGridClass(size)}>
      {Array.from({ length: 9 }).map((_, index) => (
        <div
          key={`skill-skeleton-${index}`}
          className={cn(
            "flex flex-col rounded-lg border bg-card p-4",
            size === "large" ? "min-h-[252px]" : "min-h-[226px]"
          )}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-md" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="mt-5 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-11/12" />
          <Skeleton className="mt-2 h-3 w-2/3" />
          <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SkillDetailDialog({
  detail,
  error,
  installedSkill,
  installing,
  loading,
  onInstall,
  onOpenChange,
  onRemove,
  onToggle,
  open,
  removing,
  skill,
  updating,
}: {
  detail: SkillDetailState | null
  error: string
  installedSkill?: InstalledSkill
  installing: boolean
  loading: boolean
  onInstall: (skill: SkillMeta) => void
  onOpenChange: (open: boolean) => void
  onRemove: (installedSkill: InstalledSkill) => void
  onToggle: (installedSkill: InstalledSkill, enabled: boolean) => void
  open: boolean
  removing: boolean
  skill: SkillMeta | null
  updating: boolean
}) {
  const { locale, t } = useI18n()
  const activeSkill = detail?.skill ?? skill
  const title = activeSkill ? getSkillTitle(activeSkill) : t.skills
  const description = activeSkill
    ? getSkillDescription(activeSkill, locale)
    : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] min-h-0 flex-col gap-4 sm:max-w-5xl">
        <DialogHeader className="pr-9">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <DialogTitle className="truncate text-lg">{title}</DialogTitle>
            {activeSkill?.Version ? (
              <Badge variant="secondary">v{activeSkill.Version}</Badge>
            ) : null}
            {activeSkill?.Category ? (
              <Badge variant="outline">
                {categoryLabel(activeSkill.Category)}
              </Badge>
            ) : null}
          </div>
          <DialogDescription className="line-clamp-2">
            {description || t.skillNoDescription}
          </DialogDescription>
        </DialogHeader>

        {activeSkill ? (
          <div className="space-y-2">
            <div className="grid gap-2 rounded-lg border bg-muted/25 p-3 text-xs text-muted-foreground sm:grid-cols-4">
              <SkillStat
                icon={<RiDownloadLine className="size-3.5" aria-hidden />}
                label={t.skillDownloads(
                  compactNumber(activeSkill.Downloads, locale)
                )}
              />
              <SkillStat
                icon={<RiFileTextLine className="size-3.5" aria-hidden />}
                label={t.skillFiles(activeSkill.FileCount ?? 0)}
              />
              <SkillStat
                icon={<RiArchiveLine className="size-3.5" aria-hidden />}
                label={formatBytes(activeSkill.SizeBytes)}
              />
              <SkillStat
                icon={<RiTimeLine className="size-3.5" aria-hidden />}
                label={formatUpdatedAt(activeSkill.UpStreamUpdatedAt, locale)}
              />
            </div>
            {installedSkill ? (
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/25 p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-1 flex min-w-0 items-center gap-2">
                    <span className="font-medium text-foreground">
                      {t.skillLocalStatus}
                    </span>
                    <Badge
                      variant={installedSkill.enabled ? "secondary" : "outline"}
                    >
                      {installedSkill.enabled
                        ? t.skillEnabled
                        : t.skillDisabled}
                    </Badge>
                  </div>
                  <p className="line-clamp-2">{t.skillSandboxHint}</p>
                </div>
                <span className="shrink-0">
                  {t.skillInstalledAt(
                    formatIsoDate(installedSkill.installedAt, locale)
                  )}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.requestFailed}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : detail?.skillMd ? (
            <Markdown className="prose-sm max-w-none dark:prose-invert prose-headings:font-heading prose-headings:text-foreground prose-a:text-primary prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5">
              {detail.skillMd}
            </Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">{t.skillNoReadme}</p>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {activeSkill && !installedSkill ? (
            <Button
              type="button"
              size="sm"
              disabled={installing || !activeSkill.Slug?.trim()}
              onClick={() => onInstall(activeSkill)}
            >
              <RiAddLine aria-hidden />
              {installing ? t.skillAdding : t.skillAdd}
            </Button>
          ) : null}
          {installedSkill ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={updating}
                onClick={() => onToggle(installedSkill, !installedSkill.enabled)}
              >
                {installedSkill.enabled ? t.skillDisable : t.skillEnable}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={removing}
                onClick={() => onRemove(installedSkill)}
              >
                <RiCloseLine aria-hidden />
                {removing ? t.skillRemoving : t.skillRemove}
              </Button>
            </>
          ) : null}
          {activeSkill?.UpStreamUrl ? (
            <Button asChild variant="outline" size="sm">
              <a
                href={activeSkill.UpStreamUrl}
                target="_blank"
                rel="noreferrer"
              >
                <RiExternalLinkLine aria-hidden />
                {t.skillUpstream}
              </a>
            </Button>
          ) : null}
          {activeSkill?.ArchiveUrl ? (
            <Button asChild size="sm">
              <a href={activeSkill.ArchiveUrl}>
                <RiDownloadLine aria-hidden />
                {t.skillDownload}
              </a>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkillImportItem({
  item,
  selected,
  onToggle,
}: {
  item: SkillImportCandidate
  selected: boolean
  onToggle: (sourcePath: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(item.sourcePath)}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col rounded-2xl border bg-background px-3 py-2 text-left transition-colors",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:border-muted-foreground/40"
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-[6px] border",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40"
            )}
          >
            {selected ? <RiCheckLine className="size-3" aria-hidden /> : null}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{item.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {item.slug}
            </div>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {formatBytes(item.sizeBytes)}
        </Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {item.description}
      </p>
      <p className="mt-2 truncate text-[11px] text-muted-foreground">
        {item.sourcePath}
      </p>
    </button>
  )
}

function SkillImportDialog({
  busy,
  data,
  onImportSelected,
  onOpenChange,
  onToggleAll,
  onToggleCandidate,
  open,
  selected,
}: {
  busy: boolean
  data: SkillImportScanData | null
  onImportSelected: () => void
  onOpenChange: (open: boolean) => void
  onToggleAll: () => void
  onToggleCandidate: (sourcePath: string) => void
  open: boolean
  selected: Set<string>
}) {
  const { t } = useI18n()
  const candidates = data?.candidates ?? []
  const duplicates = data?.duplicates ?? []
  const invalid = data?.invalid ?? []
  const selectedCount = candidates.filter((candidate) =>
    selected.has(candidate.sourcePath)
  ).length
  const allSelected =
    candidates.length > 0 && selectedCount >= candidates.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] min-h-0 flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t.skillImportScanTitle}</DialogTitle>
          <DialogDescription>{t.skillImportScanDescription}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3 text-sm font-medium">
                <span>{t.skillImportCandidates}</span>
                <div className="flex items-center gap-2">
                  {candidates.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={onToggleAll}
                    >
                      {allSelected
                        ? t.skillImportDeselectAll
                        : t.skillImportSelectAll}
                    </Button>
                  ) : null}
                  <Badge variant="secondary">
                    {candidates.length > 0
                      ? `${selectedCount}/${candidates.length}`
                      : candidates.length}
                  </Badge>
                </div>
              </div>
              {candidates.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {candidates.map((item) => (
                    <SkillImportItem
                      key={item.sourcePath}
                      item={item}
                      selected={selected.has(item.sourcePath)}
                      onToggle={onToggleCandidate}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  {t.skillImportNoCandidates}
                </p>
              )}
            </section>

            {duplicates.length > 0 ? (
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3 text-sm font-medium">
                  <span>{t.skillImportDuplicates}</span>
                  <Badge variant="secondary">{duplicates.length}</Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {duplicates.map((item) => (
                    <div
                      key={`${item.sourcePath}-${item.slug}`}
                      className="rounded-2xl border bg-muted/25 px-3 py-2"
                    >
                      <div className="truncate text-sm font-medium">
                        {item.name}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.alreadyInstalled
                          ? t.skillImportAlreadyInstalled
                          : t.skillImportDuplicateSlug(item.duplicateOf ?? item.slug)}
                      </div>
                      <p className="mt-2 truncate text-[11px] text-muted-foreground">
                        {item.sourcePath}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {invalid.length > 0 ? (
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3 text-sm font-medium">
                  <span>{t.skillImportInvalid}</span>
                  <Badge variant="destructive">{invalid.length}</Badge>
                </div>
                <div className="grid gap-2">
                  {invalid.map((item) => (
                    <div
                      key={item.sourcePath}
                      className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
                    >
                      <div className="truncate font-medium">{item.sourcePath}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.message}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t.skillImportClose}
          </Button>
          <Button
            type="button"
            disabled={busy || selectedCount === 0}
            onClick={onImportSelected}
          >
            <RiDownloadLine aria-hidden />
            {busy
              ? t.skillImporting
              : t.skillImportSelected(selectedCount)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkillsMarketPage({
  embedded = false,
  initialView = "market",
}: SkillsMarketPageProps = {}) {
  const { locale, t } = useI18n()
  const [pluginType, setPluginType] = React.useState<PluginType>("skills")
  const [view, setView] = React.useState<SkillsView>(initialView)
  const [query, setQuery] = React.useState("")
  const [debouncedQuery, setDebouncedQuery] = React.useState("")
  const [category, setCategory] = React.useState(allCategoriesValue)
  const [orderBy, setOrderBy] = React.useState<SkillOrderBy>("popular")
  const [page, setPage] = React.useState(0)
  const [skills, setSkills] = React.useState<SkillMeta[]>([])
  const [installedSkills, setInstalledSkills] = React.useState<
    InstalledSkill[]
  >([])
  const [mcpServers, setMcpServers] = React.useState<McpRegistryServer[]>([])
  const [installedMcpServers, setInstalledMcpServers] = React.useState<
    InstalledMcpServer[]
  >([])
  const [categories, setCategories] = React.useState<string[]>([])
  const [totalCount, setTotalCount] = React.useState(0)
  const [mcpCursor, setMcpCursor] = React.useState("")
  const [mcpCursorStack, setMcpCursorStack] = React.useState<string[]>([])
  const [mcpNextCursor, setMcpNextCursor] = React.useState<string | null>(null)
  const [refreshTick, setRefreshTick] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [mcpLoading, setMcpLoading] = React.useState(false)
  const [installedLoading, setInstalledLoading] = React.useState(true)
  const [mcpInstalledLoading, setMcpInstalledLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [selectedSkill, setSelectedSkill] = React.useState<SkillMeta | null>(
    null
  )
  const [detailSource, setDetailSource] =
    React.useState<SkillsView>("market")
  const [detail, setDetail] = React.useState<SkillDetailState | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState("")
  const [installingSlug, setInstallingSlug] = React.useState("")
  const [updatingSlug, setUpdatingSlug] = React.useState("")
  const [removingSlug, setRemovingSlug] = React.useState("")
  const [mcpBusyId, setMcpBusyId] = React.useState("")
  const [mcpManualOpen, setMcpManualOpen] = React.useState(false)
  const [mcpEditingId, setMcpEditingId] = React.useState("")
  const [mcpManualForm, setMcpManualForm] =
    React.useState<McpManualFormState>(() => createEmptyMcpForm())
  const [mcpManualError, setMcpManualError] = React.useState("")
  const [skillImportOpen, setSkillImportOpen] = React.useState(false)
  const [skillImportData, setSkillImportData] =
    React.useState<SkillImportScanData | null>(null)
  const [skillImportSource, setSkillImportSource] = React.useState<
    "local" | "upload"
  >("local")
  const [skillImportFiles, setSkillImportFiles] =
    React.useState<FileList | null>(null)
  const [skillImportSelected, setSkillImportSelected] = React.useState<
    Set<string>
  >(() => new Set())
  const [skillImportScanning, setSkillImportScanning] = React.useState(false)
  const [skillImporting, setSkillImporting] = React.useState(false)
  const directoryInputRef = React.useRef<HTMLInputElement | null>(null)
  const cardSize: SkillCardSize = embedded ? "large" : "default"
  const skillGridClass = getSkillGridClass(cardSize)
  const installedGridClass = getSkillGridClass(cardSize, true)
  const offset = page * PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const visibleStart = totalCount === 0 ? 0 : offset + 1
  const visibleEnd = Math.min(offset + skills.length, totalCount)
  const normalizedQuery = query.trim().toLowerCase()
  const isSkillsPlugin = pluginType === "skills"
  const isMineView = view === "mine"
  const searchPlaceholder = isMineView
    ? t.skillSearch
    : pluginType === "mcp"
      ? t.mcpSearch
      : t.skillSearch
  const installedBySlug = React.useMemo(() => {
    return new Map(installedSkills.map((skill) => [skill.slug, skill]))
  }, [installedSkills])
  const installedMcpByRegistry = React.useMemo(() => {
    const map = new Map<string, InstalledMcpServer>()

    for (const server of installedMcpServers) {
      if (server.registryName) {
        map.set(`${server.registryName}@${server.registryVersion ?? "latest"}`, server)
        map.set(server.registryName, server)
      }

      map.set(server.name, server)
    }

    return map
  }, [installedMcpServers])
  const selectedInstalledSkill = React.useMemo(() => {
    const slug = selectedSkill?.Slug?.trim()

    return slug ? installedBySlug.get(slug) : undefined
  }, [installedBySlug, selectedSkill])
  const visibleSkills = React.useMemo(() => {
    if (debouncedQuery || !normalizedQuery) {
      return skills
    }

    return skills.filter((skill) =>
      getSkillSearchText(skill).includes(normalizedQuery)
    )
  }, [debouncedQuery, normalizedQuery, skills])
  const visibleInstalledSkills = React.useMemo(() => {
    if (!normalizedQuery) {
      return installedSkills
    }

    return installedSkills.filter((installedSkill) =>
      getSkillSearchText(installedSkill.skill).includes(normalizedQuery)
    )
  }, [installedSkills, normalizedQuery])
  const visibleInstalledMcpServers = React.useMemo(() => {
    if (!normalizedQuery) {
      return installedMcpServers
    }

    return installedMcpServers.filter((server) =>
      getMcpSearchText(server).includes(normalizedQuery)
    )
  }, [installedMcpServers, normalizedQuery])
  const enabledPluginCount =
    installedSkills.filter((skill) => skill.enabled).length +
    installedMcpServers.filter((server) => server.enabled).length
  const totalPluginCount = installedSkills.length + installedMcpServers.length

  const redirectToLoginIfNeeded = React.useCallback(
    (requestError: unknown) => {
      if (!isLoginRequiredError(requestError)) {
        return false
      }

      window.location.replace("/login")
      return true
    },
    []
  )

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(0)
      setMcpCursor("")
      setMcpCursorStack([])
      setMcpNextCursor(null)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [query])

  React.useEffect(() => {
    function handleProjectChanged() {
      setPage(0)
      setMcpCursor("")
      setMcpCursorStack([])
      setMcpNextCursor(null)
      setDetail(null)
      setDetailOpen(false)
      setRefreshTick((current) => current + 1)
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [])

  React.useEffect(() => {
    if (pluginType !== "skills" || view !== "market") {
      return
    }

    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setLoading(true)
      setError("")

      void fetchSkills({
        category,
        keyword: debouncedQuery,
        offset,
        orderBy,
        signal: controller.signal,
      })
        .then((payload) => {
          setSkills(payload.data)
          setTotalCount(payload.totalCount)
          setCategories(payload.allCategories)
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [
    category,
    debouncedQuery,
    offset,
    orderBy,
    pluginType,
    redirectToLoginIfNeeded,
    refreshTick,
    t.requestFailed,
    view,
  ])

  React.useEffect(() => {
    if (pluginType !== "mcp" || view !== "market") {
      return
    }

    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setMcpLoading(true)
      setError("")

      void fetchMcpMarket({
        cursor: mcpCursor,
        keyword: debouncedQuery,
        signal: controller.signal,
      })
        .then((payload) => {
          setMcpServers(payload.data)
          setMcpNextCursor(payload.nextCursor)
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setMcpLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [
    debouncedQuery,
    mcpCursor,
    pluginType,
    redirectToLoginIfNeeded,
    refreshTick,
    t.requestFailed,
    view,
  ])

  React.useEffect(() => {
    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setInstalledLoading(true)

      void fetchInstalledSkills(controller.signal)
        .then((data) => {
          setInstalledSkills(data)
        })
        .catch((loadError) => {
          if (
            !controller.signal.aborted &&
            (pluginType === "skills" || view === "mine")
          ) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setInstalledLoading(false)
          }
        })

      setMcpInstalledLoading(true)

      void fetchInstalledMcp(controller.signal)
        .then((data) => {
          setInstalledMcpServers(data)
        })
        .catch((loadError) => {
          if (
            !controller.signal.aborted &&
            (pluginType === "mcp" || view === "mine")
          ) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setMcpInstalledLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [pluginType, redirectToLoginIfNeeded, refreshTick, t.requestFailed, view])

  const refresh = React.useCallback(() => {
    setDebouncedQuery(query.trim())
    setPage(0)
    setMcpCursor("")
    setMcpCursorStack([])
    setMcpNextCursor(null)
    setRefreshTick((current) => current + 1)
  }, [query])

  const openSkill = React.useCallback((skill: SkillMeta) => {
    setSelectedSkill(skill)
    setDetailSource("market")
    setDetail(null)
    setDetailError("")
    setDetailOpen(true)
  }, [])

  const openInstalledSkill = React.useCallback(
    (installedSkill: InstalledSkill) => {
      setSelectedSkill(installedSkill.skill)
      setDetailSource("mine")
      setDetail({
        skill: installedSkill.skill,
        skillMd: installedSkill.skillMd,
      })
      setDetailLoading(false)
      setDetailError("")
      setDetailOpen(true)
    },
    []
  )

  React.useEffect(() => {
    if (!detailOpen || !selectedSkill) {
      return
    }

    if (detailSource === "mine") {
      return
    }

    const controller = new AbortController()

    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return
      }

      setDetailLoading(true)
      setDetailError("")

      void fetchSkillDetail(selectedSkill, controller.signal)
        .then((data) => {
          setDetail({ skill: data.skill, skillMd: data.skillMd })
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            if (redirectToLoginIfNeeded(loadError)) {
              return
            }

            setDetailError(
              loadError instanceof Error ? loadError.message : t.requestFailed
            )
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setDetailLoading(false)
          }
        })
    })

    return () => controller.abort()
  }, [
    detailOpen,
    detailSource,
    redirectToLoginIfNeeded,
    selectedSkill,
    t.requestFailed,
  ])

  const upsertInstalledSkill = React.useCallback(
    (installedSkill: InstalledSkill) => {
      setInstalledSkills((current) => {
        const existingIndex = current.findIndex(
          (item) => item.slug === installedSkill.slug
        )

        if (existingIndex < 0) {
          return [installedSkill, ...current]
        }

        return current.map((item) =>
          item.slug === installedSkill.slug ? installedSkill : item
        )
      })
    },
    []
  )

  const applySkillImportResult = React.useCallback(
    (result: {
      imported: InstalledSkill[]
      skipped: SkillImportCandidate[]
      failed: Array<{ message: string }>
    }) => {
      for (const installedSkill of result.imported) {
        upsertInstalledSkill(installedSkill)
      }

      if (result.imported.length > 0) {
        setPluginType("skills")
        setView("mine")
        setRefreshTick((current) => current + 1)
      }

      toast.success(
        t.skillImportResult(
          result.imported.length,
          result.skipped.length,
          result.failed.length
        )
      )

      if (result.failed.length > 0) {
        setError(result.failed.map((item) => item.message).join("\n"))
      }
    },
    [t, upsertInstalledSkill]
  )

  const handleScanLocalSkills = React.useCallback(async () => {
    setSkillImportScanning(true)
    setError("")

    try {
      const data = await fetchSkillImportCandidates()
      setSkillImportSource("local")
      setSkillImportFiles(null)
      setSkillImportData(data)
      setSkillImportSelected(
        new Set(data.candidates.map((candidate) => candidate.sourcePath))
      )
      setSkillImportOpen(true)
    } catch (scanError) {
      if (redirectToLoginIfNeeded(scanError)) {
        return
      }

      setError(scanError instanceof Error ? scanError.message : t.requestFailed)
    } finally {
      setSkillImportScanning(false)
    }
  }, [redirectToLoginIfNeeded, t.requestFailed])

  const handleToggleImportCandidate = React.useCallback(
    (sourcePath: string) => {
      setSkillImportSelected((current) => {
        const next = new Set(current)

        if (next.has(sourcePath)) {
          next.delete(sourcePath)
        } else {
          next.add(sourcePath)
        }

        return next
      })
    },
    []
  )

  const handleToggleAllImportCandidates = React.useCallback(() => {
    setSkillImportSelected((current) => {
      const candidates = skillImportData?.candidates ?? []

      if (current.size >= candidates.length && candidates.length > 0) {
        return new Set()
      }

      return new Set(candidates.map((candidate) => candidate.sourcePath))
    })
  }, [skillImportData])

  const handleImportSelectedSkills = React.useCallback(async () => {
    const candidates = skillImportData?.candidates ?? []
    const selectedPaths = candidates
      .map((candidate) => candidate.sourcePath)
      .filter((sourcePath) => skillImportSelected.has(sourcePath))

    if (!selectedPaths.length) {
      return
    }

    setSkillImporting(true)
    setError("")

    try {
      const result =
        skillImportSource === "upload"
          ? skillImportFiles
            ? await importSkillFolderFiles(skillImportFiles, selectedPaths)
            : null
          : await importSkillCandidatePaths(selectedPaths)

      if (!result) {
        return
      }

      applySkillImportResult(result)

      const importedPaths = new Set(selectedPaths)

      setSkillImportData((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.filter(
                (candidate) => !importedPaths.has(candidate.sourcePath)
              ),
              duplicates: [
                ...current.duplicates,
                ...current.candidates
                  .filter((candidate) => importedPaths.has(candidate.sourcePath))
                  .map((candidate) => ({
                    ...candidate,
                    alreadyInstalled: true,
                  })),
              ],
            }
          : current
      )
      setSkillImportSelected((current) => {
        const next = new Set(current)

        for (const sourcePath of importedPaths) {
          next.delete(sourcePath)
        }

        return next
      })

      if (selectedPaths.length >= candidates.length) {
        setSkillImportOpen(false)
      }
    } catch (importError) {
      if (redirectToLoginIfNeeded(importError)) {
        return
      }

      setError(
        importError instanceof Error ? importError.message : t.requestFailed
      )
    } finally {
      setSkillImporting(false)
    }
  }, [
    applySkillImportResult,
    redirectToLoginIfNeeded,
    skillImportData,
    skillImportFiles,
    skillImportSelected,
    skillImportSource,
    t.requestFailed,
  ])

  const handleImportFolderClick = React.useCallback(() => {
    directoryInputRef.current?.click()
  }, [])

  const handleImportFolderChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.currentTarget.files

      event.currentTarget.value = ""

      if (!files?.length) {
        return
      }

      setSkillImportScanning(true)
      setError("")

      try {
        const data = await parseSkillFolderFiles(files)
        setSkillImportSource("upload")
        setSkillImportFiles(files)
        setSkillImportData(data)
        setSkillImportSelected(
          new Set(data.candidates.map((candidate) => candidate.sourcePath))
        )
        setSkillImportOpen(true)
      } catch (importError) {
        if (redirectToLoginIfNeeded(importError)) {
          return
        }

        setError(
          importError instanceof Error ? importError.message : t.requestFailed
        )
      } finally {
        setSkillImportScanning(false)
      }
    },
    [redirectToLoginIfNeeded, t.requestFailed]
  )

  const handleInstallSkill = React.useCallback(
    async (skill: SkillMeta) => {
      const slug = skill.Slug?.trim()

      if (!slug) {
        return
      }

      setInstallingSlug(slug)
      setError("")

      try {
        const installedSkill = await installSkill(skill)
        upsertInstalledSkill(installedSkill)

        if (selectedSkill?.Slug?.trim() === slug) {
          setDetail({
            skill: installedSkill.skill,
            skillMd: installedSkill.skillMd,
          })
        }
      } catch (installError) {
        if (redirectToLoginIfNeeded(installError)) {
          return
        }

        const message =
          installError instanceof Error ? installError.message : t.requestFailed

        setError(message)
        setDetailError(message)
      } finally {
        setInstallingSlug("")
      }
    },
    [redirectToLoginIfNeeded, selectedSkill, t.requestFailed, upsertInstalledSkill]
  )

  const handleToggleInstalledSkill = React.useCallback(
    async (installedSkill: InstalledSkill, enabled: boolean) => {
      setUpdatingSlug(installedSkill.slug)
      setError("")

      try {
        const updatedSkill = await updateInstalledSkill(
          installedSkill.slug,
          enabled
        )
        upsertInstalledSkill(updatedSkill)
      } catch (updateError) {
        if (redirectToLoginIfNeeded(updateError)) {
          return
        }

        setError(
          updateError instanceof Error ? updateError.message : t.requestFailed
        )
      } finally {
        setUpdatingSlug("")
      }
    },
    [redirectToLoginIfNeeded, t.requestFailed, upsertInstalledSkill]
  )

  const handleRemoveInstalledSkill = React.useCallback(
    async (installedSkill: InstalledSkill) => {
      setRemovingSlug(installedSkill.slug)
      setError("")

      try {
        await removeInstalledSkill(installedSkill.slug)
        setInstalledSkills((current) =>
          current.filter((item) => item.slug !== installedSkill.slug)
        )

        if (selectedSkill?.Slug?.trim() === installedSkill.slug) {
          setDetailOpen(false)
        }
      } catch (removeError) {
        if (redirectToLoginIfNeeded(removeError)) {
          return
        }

        setError(
          removeError instanceof Error ? removeError.message : t.requestFailed
        )
      } finally {
        setRemovingSlug("")
      }
    },
    [redirectToLoginIfNeeded, selectedSkill, t.requestFailed]
  )

  const upsertInstalledMcpServer = React.useCallback(
    (server: InstalledMcpServer) => {
      setInstalledMcpServers((current) => {
        const existingIndex = current.findIndex((item) => item.id === server.id)

        if (existingIndex < 0) {
          return [server, ...current]
        }

        return current.map((item) => (item.id === server.id ? server : item))
      })
    },
    []
  )

  const openManualMcpDialog = React.useCallback((draft?: McpManualFormState) => {
    setMcpEditingId("")
    setMcpManualForm(draft ?? createEmptyMcpForm())
    setMcpManualError("")
    setMcpManualOpen(true)
  }, [])

  const openEditMcpDialog = React.useCallback((server: InstalledMcpServer) => {
    setMcpEditingId(server.id)
    setMcpManualForm(createMcpEditDraft(server))
    setMcpManualError("")
    setMcpManualOpen(true)
  }, [])

  const createMcpPayloadFromForm = React.useCallback((): InstallMcpPayload => {
    const name = mcpManualForm.name.trim()

    if (!name) {
      throw new Error(t.mcpName)
    }

    if (mcpManualForm.transport === "stdio") {
      return {
        id: mcpManualForm.id || normalizeMcpServerId(name),
        name,
        title: mcpManualForm.title.trim() || name,
        description: mcpManualForm.description,
        source: mcpManualForm.source,
        registryName: mcpManualForm.registryName || null,
        registryVersion: mcpManualForm.registryVersion || null,
        enabled: true,
        localCommandConfirmed: mcpManualForm.localCommandConfirmed,
        config: {
          type: "stdio",
          command: mcpManualForm.command.trim(),
          args: parseArgumentLine(mcpManualForm.args),
          env: parseKeyValueLines(mcpManualForm.env),
          cwd: mcpManualForm.cwd.trim() || null,
        },
      }
    }

    return {
      id: mcpManualForm.id || normalizeMcpServerId(name),
      name,
      title: mcpManualForm.title.trim() || name,
      description: mcpManualForm.description,
      source: mcpManualForm.source,
      registryName: mcpManualForm.registryName || null,
      registryVersion: mcpManualForm.registryVersion || null,
      enabled: true,
      config: {
        type: mcpManualForm.transport,
        url: mcpManualForm.url.trim(),
        headers: normalizeKeyValueRows(mcpManualForm.headers),
      },
    }
  }, [mcpManualForm, t.mcpName])

  const handleSaveMcpManual = React.useCallback(async () => {
    setMcpManualError("")
    setMcpBusyId(mcpEditingId || "manual")

    try {
      const payload = createMcpPayloadFromForm()
      const installed = mcpEditingId
        ? await updateInstalledMcp(mcpEditingId, {
            name: payload.name,
            title: payload.title,
            description: payload.description,
            config: payload.config,
            localCommandConfirmed: payload.localCommandConfirmed,
          })
        : await installMcpServer(payload)

      upsertInstalledMcpServer(installed)
      setMcpManualOpen(false)
      setMcpEditingId("")
      toast.success(mcpEditingId ? t.mcpUpdated : t.mcpInstalled)
    } catch (saveError) {
      if (redirectToLoginIfNeeded(saveError)) {
        return
      }

      setMcpManualError(
        saveError instanceof Error ? saveError.message : t.requestFailed
      )
    } finally {
      setMcpBusyId("")
    }
  }, [
    createMcpPayloadFromForm,
    mcpEditingId,
    redirectToLoginIfNeeded,
    t.mcpInstalled,
    t.mcpUpdated,
    t.requestFailed,
    upsertInstalledMcpServer,
  ])

  const handlePreviousMcpPage = React.useCallback(() => {
    const previousCursor = mcpCursorStack.at(-1) ?? ""

    setMcpCursor(previousCursor)
    setMcpCursorStack((current) => current.slice(0, -1))
    setPage((currentPage) => Math.max(0, currentPage - 1))
  }, [mcpCursorStack])

  const handleNextMcpPage = React.useCallback(() => {
    if (!mcpNextCursor) {
      return
    }

    setMcpCursorStack((current) => [...current, mcpCursor])
    setMcpCursor(mcpNextCursor)
    setPage((currentPage) => currentPage + 1)
  }, [mcpCursor, mcpNextCursor])

  const handleInstallMcpFromMarket = React.useCallback(
    async (server: McpRegistryServer) => {
      const remotePayload = createMcpInstallDraft(server)

      if (!remotePayload) {
        openManualMcpDialog(createMcpStdioDraft(server))
        return
      }

      setMcpBusyId(server.id)
      setError("")

      try {
        const installed = await installMcpServer(remotePayload)
        upsertInstalledMcpServer(installed)
      } catch (installError) {
        if (redirectToLoginIfNeeded(installError)) {
          return
        }

        setError(
          installError instanceof Error ? installError.message : t.requestFailed
        )
      } finally {
        setMcpBusyId("")
      }
    },
    [
      openManualMcpDialog,
      redirectToLoginIfNeeded,
      t.requestFailed,
      upsertInstalledMcpServer,
    ]
  )

  const handleToggleInstalledMcp = React.useCallback(
    async (server: InstalledMcpServer, enabled: boolean) => {
      setMcpBusyId(server.id)
      setError("")

      try {
        const updated = await updateInstalledMcp(server.id, { enabled })
        upsertInstalledMcpServer(updated)
      } catch (updateError) {
        if (redirectToLoginIfNeeded(updateError)) {
          return
        }

        setError(
          updateError instanceof Error ? updateError.message : t.requestFailed
        )
      } finally {
        setMcpBusyId("")
      }
    },
    [redirectToLoginIfNeeded, t.requestFailed, upsertInstalledMcpServer]
  )

  const handleTestInstalledMcp = React.useCallback(
    async (server: InstalledMcpServer) => {
      setMcpBusyId(server.id)
      setError("")

      try {
        const updated = await testInstalledMcp(server.id)
        upsertInstalledMcpServer(updated)
        toast.success(t.mcpConnectionOk)
      } catch (testError) {
        if (redirectToLoginIfNeeded(testError)) {
          return
        }

        setError(
          testError instanceof Error ? testError.message : t.mcpConnectionFailed
        )
      } finally {
        setMcpBusyId("")
      }
    },
    [
      redirectToLoginIfNeeded,
      t.mcpConnectionFailed,
      t.mcpConnectionOk,
      upsertInstalledMcpServer,
    ]
  )

  const handleRemoveInstalledMcp = React.useCallback(
    async (server: InstalledMcpServer) => {
      setMcpBusyId(server.id)
      setError("")

      try {
        await removeInstalledMcp(server.id)
        setInstalledMcpServers((current) =>
          current.filter((item) => item.id !== server.id)
        )
      } catch (removeError) {
        if (redirectToLoginIfNeeded(removeError)) {
          return
        }

        setError(
          removeError instanceof Error ? removeError.message : t.requestFailed
        )
      } finally {
        setMcpBusyId("")
      }
    },
    [redirectToLoginIfNeeded, t.requestFailed]
  )

  const handleMcpManualOpenChange = React.useCallback((open: boolean) => {
    setMcpManualOpen(open)

    if (!open) {
      setMcpEditingId("")
      setMcpManualError("")
    }
  }, [])

  function handleCategoryChange(nextCategory: string) {
    setCategory(nextCategory)
    setPage(0)
  }

  function handleOrderChange(nextOrderBy: string) {
    setOrderBy(nextOrderBy as SkillOrderBy)
    setPage(0)
  }

  function handlePluginTypeChange(nextPluginType: PluginType) {
    setPluginType(nextPluginType)
    setView("market")
    setQuery("")
    setDebouncedQuery("")
    setPage(0)
    setMcpCursor("")
    setMcpCursorStack([])
    setMcpNextCursor(null)
  }

  function handleViewChange(nextView: SkillsView) {
    setView(nextView)
    setPage(0)
    setMcpCursor("")
    setMcpCursorStack([])
    setMcpNextCursor(null)
  }

  return (
    <main
      className={cn(
        "overflow-hidden bg-background",
        embedded ? "h-full rounded-4xl" : "h-[calc(100svh-4rem)]"
      )}
    >
      <div
        className={cn(
          "flex h-full min-h-0 flex-col gap-4",
          embedded ? "p-4" : "p-4 lg:p-6"
        )}
      >
        <section className="sticky top-0 z-20 flex shrink-0 flex-col gap-3 rounded-4xl border bg-background/95 p-3 shadow-sm backdrop-blur xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 sm:w-[320px]">
              <RiSearchLine
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 pl-9"
              />
            </div>

            {isSkillsPlugin && view === "market" ? (
              <>
                <Select value={category} onValueChange={handleCategoryChange}>
                  <SelectTrigger
                    size="sm"
                    className="h-9 w-full max-w-full min-w-0 px-2.5 text-xs sm:w-fit sm:max-w-56 sm:text-sm lg:max-w-64"
                    aria-label={t.skillCategory}
                  >
                    <RiFolderLine className="size-4 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder={t.skillCategory} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={allCategoriesValue}>
                        {t.skillAllCategories}
                      </SelectItem>
                      {categories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {categoryLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <Select value={orderBy} onValueChange={handleOrderChange}>
                  <SelectTrigger
                    size="sm"
                    className="h-9 w-full max-w-full min-w-0 px-2.5 text-xs sm:w-fit sm:max-w-44 sm:text-sm lg:max-w-52"
                    aria-label={t.skillSort}
                  >
                    <SelectValue placeholder={t.skillSort} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="popular">
                        {t.skillSortDownloads}
                      </SelectItem>
                      <SelectItem value="recent">
                        {t.skillSortUpdated}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </>
            ) : null}
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2 text-sm text-muted-foreground xl:ml-auto">
            <span className="min-w-0 truncate text-xs sm:text-sm">
              {isMineView
                ? t.mcpEnabledSummary(enabledPluginCount, totalPluginCount)
                : pluginType === "mcp"
                  ? t.mcpMarketSummary(page + 1, mcpServers.length)
                  : t.skillsSummary(visibleStart, visibleEnd, totalCount)}
            </span>
            {isSkillsPlugin || isMineView ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 rounded-full px-3"
                  disabled={skillImporting}
                  onClick={handleImportFolderClick}
                >
                  <RiFolderLine data-icon="inline-start" aria-hidden />
                  <span className="hidden sm:inline">
                    {t.skillImportFolder}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 rounded-full px-3"
                  disabled={skillImportScanning || skillImporting}
                  onClick={handleScanLocalSkills}
                >
                  <RiSearchLine
                    data-icon="inline-start"
                    aria-hidden
                    className={cn(skillImportScanning && "animate-spin")}
                  />
                  <span className="hidden sm:inline">
                    {t.skillScanLocal}
                  </span>
                </Button>
              </>
            ) : null}
            {pluginType === "mcp" || isMineView ? (
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-9 shrink-0 rounded-full px-3"
                onClick={() => openManualMcpDialog()}
              >
                <RiAddLine data-icon="inline-start" aria-hidden />
                <span className="hidden sm:inline">{t.mcpAddManual}</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 rounded-full px-3"
              aria-label={t.refresh}
              onClick={refresh}
              disabled={
                isMineView
                  ? installedLoading || mcpInstalledLoading
                  : pluginType === "mcp"
                    ? mcpLoading
                    : loading
              }
            >
              <RiRefreshLine
                data-icon="inline-start"
                aria-hidden
                className={cn(
                  (isMineView
                    ? installedLoading || mcpInstalledLoading
                    : isSkillsPlugin
                      ? loading
                      : mcpLoading) &&
                    "animate-spin"
                )}
              />
              <span className="hidden sm:inline">{t.refresh}</span>
            </Button>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="sticky top-0 flex h-full min-h-0 flex-col overflow-hidden rounded-4xl border bg-card p-3 shadow-sm">
            <div className="mb-3 pl-3 text-sm font-medium">
              {t.pluginType}
            </div>
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant={
                  !isMineView && pluginType === "skills"
                    ? "secondary"
                    : "ghost"
                }
                className="h-9 justify-start gap-2 px-2 font-normal"
                onClick={() => handlePluginTypeChange("skills")}
              >
                <RiBookOpenLine className="size-4" aria-hidden />
                <span>{t.pluginTypeSkills}</span>
              </Button>
              <Button
                type="button"
                variant={
                  !isMineView && pluginType === "mcp" ? "secondary" : "ghost"
                }
                className="h-9 justify-start gap-2 px-2 font-normal"
                onClick={() => handlePluginTypeChange("mcp")}
              >
                <RiFolderLine className="size-4" aria-hidden />
                <span>{t.pluginTypeMcp}</span>
              </Button>
            </div>

            <div className="mt-auto pt-3">
              <Button
                type="button"
                variant={view === "mine" ? "secondary" : "ghost"}
                className="h-9 w-full justify-start gap-2 px-2 font-normal"
                onClick={() => handleViewChange("mine")}
              >
                <RiUser3Line className="size-4" aria-hidden />
                <span>{t.pluginMine}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {totalPluginCount}
                </span>
              </Button>
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col gap-3">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {error ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertTitle>{t.requestFailed}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {isMineView ? (
                <div className="flex flex-col gap-6">
                  <section className="flex flex-col gap-3">
                    <div className="flex min-w-0 items-center justify-between gap-3 px-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <RiBookOpenLine
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <h2 className="truncate text-base font-semibold">
                          {t.pluginTypeSkills}
                        </h2>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t.skillInstalledSummary(
                          visibleInstalledSkills.length
                        )}
                      </span>
                    </div>

                    {installedLoading ? (
                      <SkillSkeletonGrid size={cardSize} />
                    ) : visibleInstalledSkills.length === 0 ? (
                      <div className="flex min-h-48 items-center justify-center rounded-3xl border border-dashed bg-muted/20 py-12">
                        <div className="flex max-w-sm flex-col items-center text-center">
                          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <RiBookOpenLine className="size-5" aria-hidden />
                          </div>
                          <p className="text-sm font-medium">
                            {t.skillNoInstalled}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className={installedGridClass}>
                        {visibleInstalledSkills.map((installedSkill, index) => (
                          <InstalledSkillCard
                            key={`${installedSkill.slug}-${installedSkill.version}-${index}`}
                            busy={
                              updatingSlug === installedSkill.slug ||
                              removingSlug === installedSkill.slug
                            }
                            installedSkill={installedSkill}
                            locale={locale}
                            onOpen={openInstalledSkill}
                            onRemove={handleRemoveInstalledSkill}
                            onToggle={handleToggleInstalledSkill}
                            size={cardSize}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="flex flex-col gap-3">
                    <div className="flex min-w-0 items-center justify-between gap-3 px-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <RiFolderLine
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <h2 className="truncate text-base font-semibold">
                          {t.pluginTypeMcp}
                        </h2>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t.mcpInstalledSummary(
                          visibleInstalledMcpServers.length
                        )}
                      </span>
                    </div>

                    {mcpInstalledLoading ? (
                      <SkillSkeletonGrid size={cardSize} />
                    ) : visibleInstalledMcpServers.length === 0 ? (
                      <div className="flex min-h-48 items-center justify-center rounded-3xl border border-dashed bg-muted/20 py-12">
                        <div className="flex max-w-sm flex-col items-center text-center">
                          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <RiFolderLine className="size-5" aria-hidden />
                          </div>
                          <p className="text-sm font-medium">
                            {t.mcpNoInstalled}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            className="mt-4"
                            onClick={() => openManualMcpDialog()}
                          >
                            <RiAddLine aria-hidden />
                            {t.mcpAddManual}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className={installedGridClass}>
                        {visibleInstalledMcpServers.map((server) => (
                          <InstalledMcpCard
                            key={server.id}
                            busy={mcpBusyId === server.id}
                            locale={locale}
                            server={server}
                            onEdit={openEditMcpDialog}
                            onRemove={handleRemoveInstalledMcp}
                            onTest={handleTestInstalledMcp}
                            onToggle={handleToggleInstalledMcp}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : !isSkillsPlugin && view === "market" && mcpLoading ? (
                <SkillSkeletonGrid size={cardSize} />
              ) : !isSkillsPlugin && view === "market" && mcpServers.length === 0 ? (
                <div className="flex min-h-full items-center justify-center py-12">
                  <div className="flex max-w-sm flex-col items-center text-center">
                    <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <RiFolderLine className="size-5" aria-hidden />
                    </div>
                    <p className="text-sm font-medium">
                      {debouncedQuery ? t.mcpNoServersFound : t.mcpRegistryEmpty}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-4"
                      disabled={mcpLoading}
                      onClick={refresh}
                    >
                      <RiRefreshLine
                        aria-hidden
                        className={cn(mcpLoading && "animate-spin")}
                      />
                      {t.refresh}
                    </Button>
                  </div>
                </div>
              ) : !isSkillsPlugin && view === "market" ? (
                <div className={installedGridClass}>
                  {mcpServers.map((server) => (
                    <McpMarketCard
                      key={server.id}
                      busy={mcpBusyId === server.id}
                      installed={
                        installedMcpByRegistry.get(
                          `${server.name}@${server.version}`
                        ) ?? installedMcpByRegistry.get(server.name)
                      }
                      locale={locale}
                      server={server}
                      onInstall={handleInstallMcpFromMarket}
                    />
                  ))}
                </div>
              ) : view === "market" && loading ? (
                <SkillSkeletonGrid size={cardSize} />
              ) : view === "market" && visibleSkills.length === 0 ? (
                <div className="flex min-h-full items-center justify-center py-12">
                  <div className="flex max-w-sm flex-col items-center text-center">
                    <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <RiBookOpenLine className="size-5" aria-hidden />
                    </div>
                    <p className="text-sm font-medium">{t.noSkillsFound}</p>
                  </div>
                </div>
              ) : view === "market" ? (
                <div className={skillGridClass}>
                  {visibleSkills.map((skill, index) => (
                    <SkillCard
                      key={`${skill.Slug}-${skill.Version}-${index}`}
                      installedSkill={
                        skill.Slug ? installedBySlug.get(skill.Slug) : undefined
                      }
                      installing={installingSlug === skill.Slug}
                      locale={locale}
                      skill={skill}
                      onInstall={handleInstallSkill}
                      onOpen={openSkill}
                      size={cardSize}
                    />
                  ))}
                </div>
              ) : (
                <div className={skillGridClass}>
                  {visibleInstalledSkills.map((installedSkill, index) => (
                    <InstalledSkillCard
                      key={`${installedSkill.slug}-${installedSkill.version}-${index}`}
                      busy={
                        updatingSlug === installedSkill.slug ||
                        removingSlug === installedSkill.slug
                      }
                      installedSkill={installedSkill}
                      locale={locale}
                      onOpen={openInstalledSkill}
                      onRemove={handleRemoveInstalledSkill}
                      onToggle={handleToggleInstalledSkill}
                      size={cardSize}
                    />
                  ))}
                </div>
              )}
            </div>

            {view === "market" ? (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-4xl border bg-background/95 px-4 py-3 shadow-sm">
                <span className="text-sm text-muted-foreground">
                  {isSkillsPlugin
                    ? t.skillsPage(page + 1, totalPages)
                    : t.mcpPage(page + 1)}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      page <= 0 || (isSkillsPlugin ? loading : mcpLoading)
                    }
                    onClick={
                      isSkillsPlugin
                        ? () => setPage((current) => Math.max(0, current - 1))
                        : handlePreviousMcpPage
                    }
                  >
                    <RiArrowLeftSLine aria-hidden />
                    {t.previous}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      isSkillsPlugin
                        ? page + 1 >= totalPages || loading
                        : !mcpNextCursor || mcpLoading
                    }
                    onClick={
                      isSkillsPlugin
                        ? () =>
                            setPage((current) =>
                              Math.min(totalPages - 1, current + 1)
                            )
                        : handleNextMcpPage
                    }
                  >
                    {t.next}
                    <RiArrowRightSLine aria-hidden />
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <input
        ref={directoryInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={handleImportFolderChange}
        {...({ directory: "", webkitdirectory: "" } as Record<string, string>)}
      />
      <SkillImportDialog
        open={skillImportOpen}
        onOpenChange={setSkillImportOpen}
        data={skillImportData}
        busy={skillImporting}
        selected={skillImportSelected}
        onToggleCandidate={handleToggleImportCandidate}
        onToggleAll={handleToggleAllImportCandidates}
        onImportSelected={handleImportSelectedSkills}
      />
      <SkillDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        skill={selectedSkill}
        detail={detail}
        installedSkill={selectedInstalledSkill}
        installing={Boolean(
          selectedSkill?.Slug && installingSlug === selectedSkill.Slug
        )}
        loading={detailLoading}
        error={detailError}
        onInstall={handleInstallSkill}
        onRemove={handleRemoveInstalledSkill}
        onToggle={handleToggleInstalledSkill}
        removing={Boolean(
          selectedInstalledSkill && removingSlug === selectedInstalledSkill.slug
        )}
        updating={Boolean(
          selectedInstalledSkill && updatingSlug === selectedInstalledSkill.slug
        )}
      />
      <McpManualDialog
        open={mcpManualOpen}
        onOpenChange={handleMcpManualOpenChange}
        mode={mcpEditingId ? "edit" : "create"}
        form={mcpManualForm}
        onChange={setMcpManualForm}
        busy={mcpBusyId === (mcpEditingId || "manual")}
        error={mcpManualError}
        onSubmit={handleSaveMcpManual}
      />
    </main>
  )
}

export { SkillsMarketPage }
