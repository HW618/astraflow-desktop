"use client"

import * as React from "react"
import {
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiDatabase2Line,
  RiFileCopyLine,
  RiFolderLine,
  RiIdCardLine,
  RiKey2Line,
  RiLoader4Line,
  RiLogoutBoxRLine,
  RiMailLine,
  RiMoonLine,
  RiRobot2Line,
  RiSettings3Line,
  RiSunLine,
  RiTeamLine,
  RiTranslate2,
  RiUser3Line,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"
import { toast } from "sonner"

import { AppInfoButton } from "@/components/app-info-button"
import { StudioApiSettingsPage } from "@/components/studio-api-settings-page"
import { StudioAgentModelSettingsPage } from "@/components/studio-agent-model-settings-page"
import { useTheme } from "@/components/theme-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LogoutButton } from "@/components/logout-button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useI18n } from "@/components/i18n-provider"
import {
  readSelectedUCloudProjectId,
  UCLOUD_PROJECT_CHANGED_EVENT,
  type UCloudProjectChangedDetail,
  writeSelectedUCloudProjectId,
} from "@/lib/project-selection"
import { localeLabels, type Locale } from "@/lib/i18n"
import { cn } from "@/lib/utils"

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

type SettingsDialogSection = "account" | "api-keys" | "agents" | "system"

type AccountSettingsDialogProps = {
  open: boolean
  defaultSection: SettingsDialogSection
  user: AccountSettingsUser | null
  loading: boolean
  onOpenChange: (open: boolean) => void
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

function ThemeSegmentedControl() {
  const { resolvedTheme, setTheme } = useTheme()
  const { locale } = useI18n()
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const isDark = mounted && resolvedTheme === "dark"
  const labels =
    locale === "zh"
      ? { light: "浅色", dark: "深色" }
      : { light: "Light", dark: "Dark" }
  const options = [
    { value: "light", label: labels.light, icon: RiSunLine },
    { value: "dark", label: labels.dark, icon: RiMoonLine },
  ] as const

  return (
    <div className="inline-flex rounded-2xl bg-muted p-1">
      {options.map((option) => {
        const Icon = option.icon
        const active = isDark
          ? option.value === "dark"
          : option.value === "light"

        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors",
              active && "bg-background text-foreground shadow-sm"
            )}
            onClick={() => setTheme(option.value)}
          >
            <Icon className="size-4" aria-hidden />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function SettingRow({
  icon: Icon,
  label,
  description,
  children,
}: {
  icon: RemixiconComponentType
  label: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl bg-muted/45 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{label}</div>
          {description ? (
            <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="w-full sm:w-auto sm:shrink-0">{children}</div>
      ) : null}
    </div>
  )
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
    <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-muted/45 px-4 py-3">
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

function AccountSettingsDialog({
  open,
  defaultSection,
  user: initialUser,
  loading,
  onOpenChange,
}: AccountSettingsDialogProps) {
  const { locale, setLocale, t } = useI18n()
  const [activeSection, setActiveSection] =
    React.useState<SettingsDialogSection>(defaultSection)
  const [projects, setProjects] = React.useState<UCloudProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = React.useState("")
  const [user, setUser] = React.useState<AccountSettingsUser | null>(
    initialUser
  )
  const [isLoadingProjects, setIsLoadingProjects] = React.useState(false)
  const [isSavingProject, setIsSavingProject] = React.useState(false)
  const [projectError, setProjectError] = React.useState("")

  const copy =
    locale === "zh"
      ? {
          accountManagement: "账户管理",
          apiKeySettings: "API Key 设置",
          apiKeySettingsDesc:
            "管理 Modelverse API Key、用量配额和本机应用选择。",
          agentSettings: "Agent 设置",
          agentModelSettings: "Agent 模型设置",
          agentModelSettingsDesc:
            "配置每个 Agent 默认使用的 Modelverse 模型，或切回本机 CLI 配置。",
          systemSettings: "系统设置",
          settingsDescription: "管理账户、项目和应用偏好。",
          plan: "体验版",
          upgrade: "升级",
          accountDetails: "账户资料",
          projectSwitch: "项目切换",
          projectSwitchDesc:
            "切换后，模型广场、插件和分析调用会使用该 UCloud 项目。",
          displayLanguage: "显示语言",
          displayLanguageDesc: "设置应用程序界面的显示语言。",
          appearance: "外观",
          appearanceDesc: "切换浅色或深色显示。",
          appUpdate: "检查更新",
          appUpdateDesc: "查看当前版本并安装可用更新。",
          logout: "退出登录",
          logoutDesc: "清除本机登录状态并回到登录页。",
          copied: "已复制账户信息。",
          copyFailed: "复制失败。",
          projectSelected: "项目已切换。",
          defaultProject: "默认项目",
          notDefault: "普通项目",
          projectCount: "项目数",
          members: "成员",
          resources: "资源",
          createdAt: "创建时间",
        }
      : {
          accountManagement: "Account",
          apiKeySettings: "API keys",
          apiKeySettingsDesc:
            "Manage Modelverse API keys, quotas, and local app selection.",
          agentSettings: "Agent settings",
          agentModelSettings: "Agent models",
          agentModelSettingsDesc:
            "Configure each agent's default Modelverse model, or switch back to local CLI settings.",
          systemSettings: "System",
          settingsDescription: "Manage account, project, and app preferences.",
          plan: "Trial",
          upgrade: "Upgrade",
          accountDetails: "Account details",
          projectSwitch: "Project switch",
          projectSwitchDesc:
            "Model, skill, and analysis calls use the selected UCloud project.",
          displayLanguage: "Display language",
          displayLanguageDesc: "Set the application interface language.",
          appearance: "Appearance",
          appearanceDesc: "Switch between light and dark mode.",
          appUpdate: "Check updates",
          appUpdateDesc: "Review the current version and install updates.",
          logout: "Sign out",
          logoutDesc: "Clear the local session and return to login.",
          copied: "Account info copied.",
          copyFailed: "Copy failed.",
          projectSelected: "Project switched.",
          defaultProject: "Default project",
          notDefault: "Standard project",
          projectCount: "Projects",
          members: "Members",
          resources: "Resources",
          createdAt: "Created",
        }

  const sections: Array<{
    id: SettingsDialogSection
    label: string
    title: string
    description: string
    icon: RemixiconComponentType
  }> = [
    {
      id: "account",
      label: copy.accountManagement,
      title: copy.accountManagement,
      description: copy.settingsDescription,
      icon: RiUser3Line,
    },
    {
      id: "api-keys",
      label: copy.apiKeySettings,
      title: copy.apiKeySettings,
      description: copy.apiKeySettingsDesc,
      icon: RiKey2Line,
    },
    {
      id: "agents",
      label: copy.agentSettings,
      title: copy.agentModelSettings,
      description: copy.agentModelSettingsDesc,
      icon: RiRobot2Line,
    },
    {
      id: "system",
      label: copy.systemSettings,
      title: copy.systemSettings,
      description: copy.settingsDescription,
      icon: RiSettings3Line,
    },
  ]

  const loadProjects = React.useCallback(async () => {
    try {
      setIsLoadingProjects(true)
      setProjectError("")

      const next = await fetchProjects()
      const resolvedProjectId = next.selectedProjectId ?? ""
      const previousProjectId = readSelectedUCloudProjectId()

      setProjects(next.items)
      setSelectedProjectId(resolvedProjectId)
      setUser(next.user)

      if (resolvedProjectId && resolvedProjectId !== previousProjectId) {
        emitProjectChanged(resolvedProjectId)
      }
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : t.projectLoadFailed
      )
    } finally {
      setIsLoadingProjects(false)
    }
  }, [t.projectLoadFailed])

  React.useEffect(() => {
    if (!open) {
      return
    }

    queueMicrotask(() => {
      void loadProjects()
    })
  }, [loadProjects, open])

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
    setIsSavingProject(true)
    setProjectError("")

    try {
      const next = await saveSelectedProject(nextProjectId)
      const resolvedProjectId = next.selectedProjectId ?? nextProjectId

      setProjects(next.items)
      setSelectedProjectId(resolvedProjectId)
      setUser(next.user)
      emitProjectChanged(resolvedProjectId)
      toast.success(copy.projectSelected)
    } catch (error) {
      setSelectedProjectId(previousProjectId)
      setProjectError(
        error instanceof Error ? error.message : t.projectSelectFailed
      )
    } finally {
      setIsSavingProject(false)
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

  const displayUser = user ?? initialUser
  const displayName =
    displayUser?.displayName ||
    displayUser?.userName ||
    displayUser?.userEmail ||
    (loading ? t.accountLoading : t.account)
  const displayEmail = displayUser?.userEmail || displayUser?.userName || "-"
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null
  const selectedProjectName =
    selectedProject?.name || (isLoadingProjects ? t.projectLoading : t.project)
  const companyId =
    typeof displayUser?.companyId === "number"
      ? String(displayUser.companyId)
      : "-"
  const activeSectionMeta =
    sections.find((section) => section.id === activeSection) ?? sections[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[min(88vh,820px)] w-[min(94vw,1180px)] max-w-none gap-0 overflow-hidden rounded-[28px] p-0 sm:max-w-none"
        showCloseButton
      >
        <DialogTitle className="sr-only">{t.settings}</DialogTitle>
        <DialogDescription className="sr-only">
          {copy.settingsDescription}
        </DialogDescription>

        <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 border-r bg-muted/70 p-4 md:flex md:flex-col">
            <div className="mb-5 flex min-w-0 items-center gap-3 rounded-2xl bg-background/70 p-3">
              <Avatar className="size-10">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {displayName}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {displayEmail}
                </div>
              </div>
            </div>

            <nav className="grid gap-1.5">
              {sections.map((section) => {
                const Icon = section.icon
                const active = activeSection === section.id

                return (
                  <button
                    key={section.id}
                    type="button"
                    className={cn(
                      "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-muted-foreground transition-colors",
                      active && "bg-background text-foreground shadow-sm"
                    )}
                    onClick={() => setActiveSection(section.id)}
                  >
                    <Icon className="size-4" aria-hidden />
                    <span className="truncate">{section.label}</span>
                  </button>
                )
              })}
            </nav>
          </aside>

          <main className="min-h-0 min-w-0 overflow-y-auto px-5 py-5 md:px-8 md:py-7">
            <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-5">
              <div className="flex min-w-0 items-start justify-between gap-4 border-b pr-12 pb-4">
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold tracking-normal">
                    {activeSectionMeta?.title ?? t.settings}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {activeSectionMeta?.description ?? copy.settingsDescription}
                  </p>
                </div>
                {(isLoadingProjects || isSavingProject) && open ? (
                  <RiLoader4Line
                    className="mt-1 size-5 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : null}
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
                {sections.map((section) => {
                  const Icon = section.icon
                  const active = activeSection === section.id

                  return (
                    <button
                      key={section.id}
                      type="button"
                      className={cn(
                        "flex h-9 shrink-0 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-medium text-muted-foreground",
                        active && "bg-primary text-primary-foreground"
                      )}
                      onClick={() => setActiveSection(section.id)}
                    >
                      <Icon className="size-4" aria-hidden />
                      {section.label}
                    </button>
                  )
                })}
              </div>

              {activeSection === "account" ? (
                <div className="grid gap-4">
                  <section className="flex flex-col gap-4 rounded-3xl bg-muted/45 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <Avatar className="size-14">
                        <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">
                          {getInitials(displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="truncate text-base font-semibold">
                            {displayName}
                          </h3>
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
                      value={formatCount(
                        selectedProject?.memberCount ?? null,
                        locale
                      )}
                    />
                    <StatTile
                      icon={RiDatabase2Line}
                      label={copy.resources}
                      value={formatCount(
                        selectedProject?.resourceCount ?? null,
                        locale
                      )}
                    />
                    <StatTile
                      icon={RiCalendarLine}
                      label={copy.createdAt}
                      value={formatProjectCreatedAt(
                        selectedProject?.createdAt ?? null,
                        locale
                      )}
                    />
                  </section>

                  <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
                    <div className="rounded-3xl bg-muted/45 p-4">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold">
                            {copy.projectSwitch}
                          </h3>
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
                        disabled={isLoadingProjects || isSavingProject}
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
                        <SelectContent
                          align="end"
                          className="max-h-80"
                          position="popper"
                        >
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

                      {projectError ? (
                        <div className="mt-3 text-xs font-medium text-destructive">
                          {projectError}
                        </div>
                      ) : null}

                      <div className="mt-4 grid gap-2 text-sm">
                        <div className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3 py-2">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <RiIdCardLine className="size-4" aria-hidden />
                            {t.projectId}
                          </span>
                          <span className="truncate font-mono text-xs">
                            {selectedProject?.id || "-"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3 py-2">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <RiCheckboxCircleLine
                              className="size-4"
                              aria-hidden
                            />
                            {copy.defaultProject}
                          </span>
                          <span className="font-medium">
                            {selectedProject?.isDefault
                              ? copy.defaultProject
                              : copy.notDefault}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl bg-muted/45 p-4">
                      <h3 className="text-base font-semibold">
                        {copy.accountDetails}
                      </h3>
                      <div className="mt-4 grid gap-2 text-sm">
                        <div className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3 py-2">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <RiUser3Line className="size-4" aria-hidden />
                            {t.accountDisplayName}
                          </span>
                          <span className="truncate font-medium">
                            {displayUser?.displayName || "-"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3 py-2">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <RiMailLine className="size-4" aria-hidden />
                            {t.accountUserEmail}
                          </span>
                          <span className="truncate font-medium">
                            {displayUser?.userEmail || "-"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-2xl bg-background px-3 py-2">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <RiIdCardLine className="size-4" aria-hidden />
                            {t.accountCompanyId}
                          </span>
                          <span className="truncate font-medium">
                            {companyId}
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              ) : null}

              {activeSection === "agents" ? (
                <StudioAgentModelSettingsPage embedded />
              ) : null}

              {activeSection === "api-keys" ? (
                <StudioApiSettingsPage embedded />
              ) : null}

              {activeSection === "system" ? (
                <div className="grid gap-3">
                  <SettingRow
                    icon={RiTranslate2}
                    label={copy.displayLanguage}
                    description={copy.displayLanguageDesc}
                  >
                    <Select
                      value={locale}
                      onValueChange={(value) => setLocale(value as Locale)}
                    >
                      <SelectTrigger className="h-10 min-w-40 rounded-2xl bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end" position="popper">
                        <SelectGroup>
                          <SelectItem value="zh">{localeLabels.zh}</SelectItem>
                          <SelectItem value="en">{localeLabels.en}</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </SettingRow>

                  <SettingRow
                    icon={RiSunLine}
                    label={copy.appearance}
                    description={copy.appearanceDesc}
                  >
                    <ThemeSegmentedControl />
                  </SettingRow>

                  <SettingRow
                    icon={RiSettings3Line}
                    label={copy.appUpdate}
                    description={copy.appUpdateDesc}
                  >
                    <AppInfoButton className="h-9 rounded-2xl bg-background px-3" />
                  </SettingRow>

                  <SettingRow
                    icon={RiLogoutBoxRLine}
                    label={copy.logout}
                    description={copy.logoutDesc}
                  >
                    <LogoutButton className="rounded-2xl border border-border bg-background hover:bg-muted" />
                  </SettingRow>
                </div>
              ) : null}
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { AccountSettingsDialog, type SettingsDialogSection }
