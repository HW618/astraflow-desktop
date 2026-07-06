"use client"

import * as React from "react"
import {
  RiCalendarLine,
  RiBuilding2Line,
  RiCheckboxCircleLine,
  RiDatabase2Line,
  RiFileCopyLine,
  RiFolderLine,
  RiIdCardLine,
  RiLoader4Line,
  RiMailLine,
  RiSettings3Line,
  RiTeamLine,
  RiTranslate2,
  RiUser3Line,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"
import { toast } from "sonner"

import { AppInfoButton } from "@/components/app-info-button"
import { LanguageToggle } from "@/components/language-toggle"
import { LogoutButton } from "@/components/logout-button"
import { ThemeToggle } from "@/components/theme-toggle"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { useI18n } from "@/components/i18n-provider"
import {
  readSelectedUCloudProjectId,
  UCLOUD_PROJECT_CHANGED_EVENT,
  type UCloudProjectChangedDetail,
  writeSelectedUCloudProjectId,
} from "@/lib/project-selection"

type AccountSettingsUser = {
  userName: string
  displayName: string
  companyName: string
  userEmail: string
  companyId: number | null
}

type UCloudProjectOption = {
  id: string
  name: string
  memberCount: number | null
  resourceCount: number | null
  createdAt: number | null
  isDefault: boolean | null
}

type ProjectsPayload = {
  items: UCloudProjectOption[]
  selectedProjectId: string | null
  user: AccountSettingsUser | null
}

type ProjectsResponse =
  | {
      ok: true
      data: ProjectsPayload
    }
  | {
      ok: false
      message?: string
    }

async function fetchProjects() {
  const response = await fetch("/api/studio/projects", { cache: "no-store" })
  const payload = (await response.json()) as ProjectsResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to load projects."
    )
  }

  return payload.data
}

async function saveSelectedProject(projectId: string) {
  const response = await fetch("/api/studio/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  })
  const payload = (await response.json()) as ProjectsResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to select project."
    )
  }

  return payload.data
}

function emitProjectChanged(projectId: string) {
  writeSelectedUCloudProjectId(projectId)
  window.dispatchEvent(
    new CustomEvent<UCloudProjectChangedDetail>(UCLOUD_PROJECT_CHANGED_EVENT, {
      detail: { projectId },
    })
  )
}

function getInitials(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return "AF"
  }

  return normalized.slice(0, 2).toUpperCase()
}

function formatCount(value: number | null, locale: string) {
  return typeof value === "number"
    ? new Intl.NumberFormat(locale).format(value)
    : "-"
}

function formatProjectCreatedAt(value: number | null, locale: string) {
  if (!value) {
    return "-"
  }

  const timestamp = value > 1_000_000_000_000 ? value : value * 1000
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date)
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: RemixiconComponentType
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border bg-card px-4 py-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <div className="truncate text-base font-semibold">{value}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  )
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: RemixiconComponentType
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  )
}

function SettingsAccountPage() {
  const { locale, t } = useI18n()
  const [projects, setProjects] = React.useState<UCloudProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = React.useState("")
  const [user, setUser] = React.useState<AccountSettingsUser | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState("")

  const copy =
    locale === "zh"
      ? {
          title: "账号",
          description: "管理账户、项目和应用偏好。",
          plan: "体验版",
          upgrade: "升级",
          copied: "已复制账户信息。",
          copyFailed: "复制失败。",
          projectSelected: "项目已切换。",
          accountDetails: "账户资料",
          projectSwitch: "项目切换",
          projectSwitchDesc:
            "切换后，模型广场、插件和分析调用会使用该 UCloud 项目。",
          defaultProject: "默认项目",
          notDefault: "普通项目",
          projectCount: "项目数",
          members: "成员",
          resources: "资源",
          createdAt: "创建时间",
          preferences: "应用偏好",
          appearance: "外观",
          language: "语言",
          appInfo: "应用信息",
          session: "会话",
          logout: "退出登录",
        }
      : {
          title: "Account",
          description: "Manage account, project, and app preferences.",
          plan: "Trial",
          upgrade: "Upgrade",
          copied: "Account info copied.",
          copyFailed: "Copy failed.",
          projectSelected: "Project switched.",
          accountDetails: "Account details",
          projectSwitch: "Project switch",
          projectSwitchDesc:
            "Model, skill, and analysis calls use the selected UCloud project.",
          defaultProject: "Default project",
          notDefault: "Standard project",
          projectCount: "Projects",
          members: "Members",
          resources: "Resources",
          createdAt: "Created",
          preferences: "App preferences",
          appearance: "Appearance",
          language: "Language",
          appInfo: "App info",
          session: "Session",
          logout: "Sign out",
        }

  const loadProjects = React.useCallback(async () => {
    try {
      setIsLoading(true)
      setError("")

      const next = await fetchProjects()
      const resolvedProjectId = next.selectedProjectId ?? ""
      const previousProjectId = readSelectedUCloudProjectId()

      setProjects(next.items)
      setSelectedProjectId(resolvedProjectId)
      setUser(next.user)

      if (resolvedProjectId && resolvedProjectId !== previousProjectId) {
        emitProjectChanged(resolvedProjectId)
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t.projectLoadFailed
      )
    } finally {
      setIsLoading(false)
    }
  }, [t.projectLoadFailed])

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadProjects()
    })
  }, [loadProjects])

  async function selectProject(projectId: string) {
    const nextProjectId = projectId.trim()

    if (
      !nextProjectId ||
      nextProjectId === "__empty" ||
      nextProjectId === selectedProjectId
    ) {
      return
    }

    const previousProjectId = selectedProjectId

    setSelectedProjectId(nextProjectId)
    setIsSaving(true)
    setError("")

    try {
      const next = await saveSelectedProject(nextProjectId)
      const resolvedProjectId = next.selectedProjectId ?? nextProjectId

      setProjects(next.items)
      setSelectedProjectId(resolvedProjectId)
      setUser(next.user)
      emitProjectChanged(resolvedProjectId)
      toast.success(copy.projectSelected)
    } catch (selectError) {
      setSelectedProjectId(previousProjectId)
      setError(
        selectError instanceof Error
          ? selectError.message
          : t.projectSelectFailed
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function copyAccountInfo() {
    const text = [displayName, displayEmail].filter(Boolean).join(" ")

    try {
      await window.navigator.clipboard.writeText(text)
      toast.success(copy.copied)
    } catch {
      toast.error(copy.copyFailed)
    }
  }

  const displayName =
    user?.displayName ||
    user?.userName ||
    user?.userEmail ||
    (isLoading ? t.accountLoading : t.account)
  const displayEmail = user?.userEmail || user?.userName || "-"
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null
  const selectedProjectName =
    selectedProject?.name || (isLoading ? t.projectLoading : t.project)
  const companyId = typeof user?.companyId === "number" ? user.companyId : "-"

  return (
    <section className="flex flex-col gap-6">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-4xl font-semibold tracking-normal">
            {copy.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {copy.description}
          </p>
        </div>
        {isLoading || isSaving ? (
          <RiLoader4Line
            className="mt-2 size-5 shrink-0 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-base font-semibold">
                {displayName}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={copy.copied}
                onClick={() => void copyAccountInfo()}
              >
                <RiFileCopyLine />
              </Button>
            </div>
            <div className="truncate text-sm text-muted-foreground">
              {displayEmail}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{copy.plan}</Badge>
          <Button type="button" size="sm" disabled>
            {copy.upgrade}
          </Button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={RiFolderLine}
          label={copy.projectCount}
          value={formatCount(projects.length, locale)}
        />
        <StatTile
          icon={RiTeamLine}
          label={copy.members}
          value={formatCount(selectedProject?.memberCount ?? null, locale)}
        />
        <StatTile
          icon={RiDatabase2Line}
          label={copy.resources}
          value={formatCount(selectedProject?.resourceCount ?? null, locale)}
        />
        <StatTile
          icon={RiCalendarLine}
          label={copy.createdAt}
          value={formatProjectCreatedAt(selectedProject?.createdAt ?? null, locale)}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{copy.projectSwitch}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {copy.projectSwitchDesc}
              </p>
            </div>
            {selectedProject?.isDefault ? (
              <Badge variant="outline">{copy.defaultProject}</Badge>
            ) : null}
          </div>

          <Select
            value={selectedProjectId}
            onValueChange={(value) => void selectProject(value)}
            disabled={isLoading || isSaving}
          >
            <SelectTrigger className="h-11 w-full rounded-2xl bg-background px-4">
              <span className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <RiFolderLine
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {selectedProjectName}
                </span>
                {selectedProject ? (
                  <span className="max-w-40 shrink-0 truncate font-mono text-xs text-muted-foreground">
                    {selectedProject.id}
                  </span>
                ) : null}
              </span>
            </SelectTrigger>
            <SelectContent align="end" className="max-h-80" position="popper">
              <SelectGroup>
                {projects.length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    {t.projectEmpty}
                  </SelectItem>
                ) : (
                  projects.map((project) => (
                    <SelectItem
                      className="[&>span:last-child]:w-full"
                      key={project.id}
                      textValue={`${project.name} ${project.id}`}
                      value={project.id}
                    >
                      <span className="flex w-full min-w-0 items-center justify-between gap-3 py-1">
                        <span className="min-w-0 truncate text-sm font-medium">
                          {project.name}
                        </span>
                        <span className="max-w-36 shrink-0 truncate font-mono text-xs text-muted-foreground">
                          {project.id}
                        </span>
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectGroup>
            </SelectContent>
          </Select>

          {error ? (
            <div className="mt-3 text-xs font-medium text-destructive">
              {error}
            </div>
          ) : null}

          <div className="mt-4 grid gap-2 text-sm">
            <DetailRow
              icon={RiIdCardLine}
              label={t.projectId}
              value={selectedProject?.id || "-"}
            />
            <DetailRow
              icon={RiCheckboxCircleLine}
              label={copy.defaultProject}
              value={
                selectedProject?.isDefault
                  ? copy.defaultProject
                  : copy.notDefault
              }
            />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-4">
          <h2 className="text-base font-semibold">{copy.accountDetails}</h2>
          <div className="mt-4 grid gap-2 text-sm">
            <DetailRow
              icon={RiUser3Line}
              label={t.accountDisplayName}
              value={user?.displayName || "-"}
            />
            <DetailRow
              icon={RiBuilding2Line}
              label={t.accountCompanyName}
              value={user?.companyName || "-"}
            />
            <DetailRow
              icon={RiMailLine}
              label={t.accountUserEmail}
              value={user?.userEmail || "-"}
            />
            <DetailRow
              icon={RiIdCardLine}
              label={t.accountCompanyId}
              value={companyId}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <RiSettings3Line
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            <h2 className="text-base font-semibold">{copy.preferences}</h2>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <RiSettings3Line className="size-4 text-muted-foreground" />
                {copy.appearance}
              </span>
              <ThemeToggle />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <RiTranslate2 className="size-4 text-muted-foreground" />
                {copy.language}
              </span>
              <LanguageToggle />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <RiSettings3Line className="size-4 text-muted-foreground" />
                {copy.appInfo}
              </span>
              <AppInfoButton className="h-8 rounded-xl" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <RiUser3Line className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="text-base font-semibold">{copy.session}</h2>
          </div>
          <div className="rounded-2xl bg-background px-3 py-3">
            <div className="text-sm font-medium">{displayName}</div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {displayEmail}
            </div>
            <div className="mt-3">
              <LogoutButton className="justify-start rounded-2xl" />
            </div>
          </div>
        </div>
      </section>
    </section>
  )
}

export { SettingsAccountPage }
