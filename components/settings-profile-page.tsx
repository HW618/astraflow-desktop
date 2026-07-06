"use client"

import * as React from "react"

import { AppInfoButton } from "@/components/app-info-button"
import { LogoutButton } from "@/components/logout-button"
import { useI18n } from "@/components/i18n-provider"
import { useTheme } from "@/components/theme-provider"
import {
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsValueRow,
} from "@/components/settings-ui"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  readSelectedUCloudProjectId,
  UCLOUD_PROJECT_CHANGED_EVENT,
  type UCloudProjectChangedDetail,
  writeSelectedUCloudProjectId,
} from "@/lib/project-selection"

type UCloudProjectOption = {
  id: string
  name: string
  memberCount: number | null
  resourceCount: number | null
  createdAt: number | null
  isDefault: boolean | null
}

type UCloudUserInfoPayload = {
  userName: string
  displayName: string
  companyName: string
  userEmail: string
  companyId: number | null
}

type ProjectsPayload = {
  items: UCloudProjectOption[]
  selectedProjectId: string | null
  user: UCloudUserInfoPayload | null
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

function formatHandle(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return "-"
  }

  return normalized.startsWith("@") ? normalized : `@${normalized}`
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

function SettingsProfilePage() {
  const { locale, setLocale, t } = useI18n()
  const { theme, setTheme } = useTheme()
  const [projects, setProjects] = React.useState<UCloudProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = React.useState("")
  const [user, setUser] = React.useState<UCloudUserInfoPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState("")

  const copy =
    locale === "zh"
      ? {
          handle: "账户标识",
          company: "企业",
          companyId: "企业 ID",
          currentProject: "当前项目",
          currentProjectHint: "模型广场、API 密钥和用量都基于该 UCloud 项目。",
          projectId: "项目 ID",
          projectMeta: "项目信息",
          defaultProject: "默认",
          members: "成员",
          resources: "资源",
          createdAt: "创建于",
          appearance: "外观",
          appearanceHint: "跟随系统或固定使用浅色 / 深色主题。",
          themeSystem: "系统",
          themeLight: "浅色",
          themeDark: "深色",
          language: "语言",
          appInfo: "应用信息",
          appInfoHint: "查看当前版本并检查更新。",
          signOut: "退出登录",
          signOutHint: "结束当前会话并返回登录页。",
        }
      : {
          handle: "Handle",
          company: "Organization",
          companyId: "Organization ID",
          currentProject: "Current project",
          currentProjectHint:
            "Model square, API keys, and usage are scoped to this UCloud project.",
          projectId: "Project ID",
          projectMeta: "Project details",
          defaultProject: "Default",
          members: "members",
          resources: "resources",
          createdAt: "created",
          appearance: "Appearance",
          appearanceHint: "Follow the system or force light / dark mode.",
          themeSystem: "System",
          themeLight: "Light",
          themeDark: "Dark",
          language: "Language",
          appInfo: "App info",
          appInfoHint: "Check the current version and updates.",
          signOut: "Sign out",
          signOutHint: "End this session and return to the login screen.",
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

  const displayName =
    user?.displayName ||
    user?.userName ||
    user?.userEmail ||
    (isLoading ? t.accountLoading : t.account)
  const email = user?.userEmail || user?.userName || "-"
  const handle = formatHandle(
    user?.userName || user?.userEmail?.split("@")[0] || ""
  )
  const companyId =
    typeof user?.companyId === "number" ? String(user.companyId) : "-"
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null
  const selectedProjectName =
    selectedProject?.name || (isLoading ? t.projectLoading : t.project)
  const projectMeta = selectedProject
    ? [
        `${formatCount(selectedProject.memberCount, locale)} ${copy.members}`,
        `${formatCount(selectedProject.resourceCount, locale)} ${copy.resources}`,
        `${copy.createdAt} ${formatProjectCreatedAt(selectedProject.createdAt, locale)}`,
      ].join(" · ")
    : "-"

  return (
    <SettingsPage>
      <SettingsPageHeader
        busy={isLoading || isSaving}
        description={t.settingsProfileDescription}
        title={t.profile}
      />

      <div className="flex min-w-0 items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback className="bg-primary text-lg font-medium text-primary-foreground">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{displayName}</div>
          <div className="truncate text-sm text-muted-foreground select-text">
            {email}
          </div>
        </div>
      </div>

      <SettingsSection title={t.settingsAccountDetailsSection}>
        <SettingsValueRow label={copy.handle} value={handle} />
        <SettingsValueRow
          label={copy.company}
          value={user?.companyName || "-"}
        />
        <SettingsValueRow label={copy.companyId} value={companyId} mono />
      </SettingsSection>

      <SettingsSection title={t.settingsProjectSection}>
        <SettingsRow
          description={copy.currentProjectHint}
          label={copy.currentProject}
        >
          <Select
            disabled={isLoading || isSaving}
            onValueChange={(value) => void selectProject(value)}
            value={selectedProjectId}
          >
            <SelectTrigger
              aria-label={t.project}
              className="w-56 justify-between"
            >
              <span className="min-w-0 truncate text-left">
                {selectedProjectName}
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
                      <span className="flex w-full min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0 truncate">{project.name}</span>
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
        </SettingsRow>
        <SettingsValueRow
          label={copy.projectId}
          mono
          value={
            selectedProject ? (
              <span className="inline-flex min-w-0 items-center gap-2">
                {selectedProject.isDefault ? (
                  <Badge variant="secondary">{copy.defaultProject}</Badge>
                ) : null}
                <span className="truncate">{selectedProject.id}</span>
              </span>
            ) : (
              "-"
            )
          }
        />
        <SettingsValueRow label={copy.projectMeta} value={projectMeta} />
        {error ? (
          <div className="px-4 py-2.5 text-[0.8125rem] font-medium text-destructive">
            {error}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t.settingsPreferencesSection}>
        <SettingsRow description={copy.appearanceHint} label={copy.appearance}>
          <ToggleGroup
            onValueChange={(value) => {
              if (value) {
                setTheme(value as "light" | "dark" | "system")
              }
            }}
            size="sm"
            spacing={0}
            type="single"
            value={theme}
            variant="outline"
          >
            <ToggleGroupItem value="system">{copy.themeSystem}</ToggleGroupItem>
            <ToggleGroupItem value="light">{copy.themeLight}</ToggleGroupItem>
            <ToggleGroupItem value="dark">{copy.themeDark}</ToggleGroupItem>
          </ToggleGroup>
        </SettingsRow>
        <SettingsRow label={copy.language}>
          <ToggleGroup
            onValueChange={(value) => {
              if (value === "en" || value === "zh") {
                setLocale(value)
              }
            }}
            size="sm"
            spacing={0}
            type="single"
            value={locale}
            variant="outline"
          >
            <ToggleGroupItem value="zh">中文</ToggleGroupItem>
            <ToggleGroupItem value="en">English</ToggleGroupItem>
          </ToggleGroup>
        </SettingsRow>
        <SettingsRow description={copy.appInfoHint} label={copy.appInfo}>
          <AppInfoButton className="h-8 rounded-lg" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t.settingsSessionSection}>
        <SettingsRow description={copy.signOutHint} label={copy.signOut}>
          <LogoutButton variant="outline" />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}

export { SettingsProfilePage }
