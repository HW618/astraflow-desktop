"use client"

import * as React from "react"
import {
  RiBuilding2Line,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiDatabase2Line,
  RiFolderLine,
  RiIdCardLine,
  RiLoader4Line,
  RiMailLine,
  RiSettings3Line,
  RiTeamLine,
  RiUser3Line,
} from "@remixicon/react"

import { AppInfoButton } from "@/components/app-info-button"
import { LanguageToggle } from "@/components/language-toggle"
import { LogoutButton } from "@/components/logout-button"
import { ThemeToggle } from "@/components/theme-toggle"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
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

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-background px-3 py-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  )
}

function StatCell({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-3 py-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <div className="truncate text-base font-semibold">{value}</div>
        <div className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
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

function formatHandle(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return "-"
  }

  return normalized.startsWith("@") ? normalized : `@${normalized}`
}

function SettingsProfilePage() {
  const { locale, t } = useI18n()
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
          projectCount: "项目数",
          members: "成员",
          resources: "资源",
          createdAt: "创建时间",
          defaultProject: "默认项目",
          accountDetails: "账户资料",
          project: "项目",
          preferences: "应用偏好",
          appearance: "外观",
          language: "语言",
          appInfo: "应用信息",
          session: "会话",
          notDefault: "普通项目",
        }
      : {
          handle: "Account handle",
          projectCount: "Projects",
          members: "Members",
          resources: "Resources",
          createdAt: "Created",
          defaultProject: "Default project",
          accountDetails: "Account details",
          project: "Project",
          preferences: "App preferences",
          appearance: "Appearance",
          language: "Language",
          appInfo: "App info",
          session: "Session",
          notDefault: "Standard project",
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
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null
  const companyId =
    typeof user?.companyId === "number" ? String(user.companyId) : "-"
  const handle = formatHandle(
    user?.userName || user?.userEmail?.split("@")[0] || ""
  )
  const selectedProjectName =
    selectedProject?.name || (isLoading ? t.projectLoading : t.project)

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl [zoom:0.9] flex-col gap-4 px-4 py-4 lg:px-6 lg:py-5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h1 className="font-heading text-lg font-semibold">{t.profile}</h1>
            {isLoading || isSaving ? (
              <RiLoader4Line
                className="size-4 shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </div>

          <section className="flex flex-col items-center pt-2 text-center">
            <Avatar className="size-20">
              <AvatarFallback className="bg-primary text-2xl font-medium text-primary-foreground">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <h2 className="mt-3 max-w-full truncate text-2xl font-semibold">
              {displayName}
            </h2>
            <div className="mt-1.5 flex max-w-full flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{handle}</span>
              <span aria-hidden>·</span>
              <span className="truncate">{user?.userEmail || "-"}</span>
            </div>
          </section>

          <section className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            <StatCell icon={RiUser3Line} label={copy.handle} value={handle} />
            <StatCell
              icon={RiFolderLine}
              label={copy.projectCount}
              value={formatCount(projects.length, locale)}
            />
            <StatCell
              icon={RiTeamLine}
              label={copy.members}
              value={formatCount(selectedProject?.memberCount ?? null, locale)}
            />
            <StatCell
              icon={RiDatabase2Line}
              label={copy.resources}
              value={formatCount(
                selectedProject?.resourceCount ?? null,
                locale
              )}
            />
            <StatCell
              icon={RiCalendarLine}
              label={copy.createdAt}
              value={formatProjectCreatedAt(
                selectedProject?.createdAt ?? null,
                locale
              )}
            />
          </section>

          <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-lg border bg-card p-3">
              <div className="mb-3 flex items-center gap-2">
                <RiUser3Line
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                <h2 className="font-heading text-base font-semibold">
                  {copy.accountDetails}
                </h2>
              </div>
              <div className="grid gap-2.5">
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

            <div className="rounded-lg border bg-card p-3">
              <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <RiFolderLine
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                    <h2 className="font-heading text-base font-semibold">
                      {copy.project}
                    </h2>
                  </div>
                </div>
                {selectedProject?.isDefault ? (
                  <Badge variant="outline">{copy.defaultProject}</Badge>
                ) : null}
              </div>

              <div className="grid gap-3">
                <Select
                  value={selectedProjectId}
                  onValueChange={(value) => void selectProject(value)}
                  disabled={isLoading || isSaving}
                >
                  <SelectTrigger
                    aria-label={t.project}
                    className="!h-10 w-full justify-start rounded-lg border-border bg-background px-3 hover:bg-muted/60"
                    title={error || t.project}
                  >
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
                      <span className="flex min-w-0 items-center gap-2">
                        <RiFolderLine
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 truncate text-sm font-medium">
                          {selectedProjectName}
                        </span>
                      </span>
                      {selectedProject ? (
                        <span className="max-w-32 shrink-0 truncate font-mono text-xs text-muted-foreground">
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

                {error ? (
                  <div className="text-xs font-medium text-destructive">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-2.5 sm:grid-cols-2">
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
                  <DetailRow
                    icon={RiTeamLine}
                    label={copy.members}
                    value={formatCount(
                      selectedProject?.memberCount ?? null,
                      locale
                    )}
                  />
                  <DetailRow
                    icon={RiCalendarLine}
                    label={copy.createdAt}
                    value={formatProjectCreatedAt(
                      selectedProject?.createdAt ?? null,
                      locale
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-3">
              <div className="mb-3 flex items-center gap-2">
                <RiSettings3Line
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                <h2 className="font-heading text-base font-semibold">
                  {copy.preferences}
                </h2>
              </div>
              <div className="grid gap-2.5">
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{copy.appearance}</div>
                  </div>
                  <ThemeToggle />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{copy.language}</div>
                  </div>
                  <LanguageToggle />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{copy.appInfo}</div>
                  </div>
                  <AppInfoButton />
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-3">
              <div className="mb-3 flex items-center gap-2">
                <RiUser3Line
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                <h2 className="font-heading text-base font-semibold">
                  {copy.session}
                </h2>
              </div>
              <div className="rounded-lg border bg-background px-3 py-2.5">
                <div className="text-sm font-medium">{displayName}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {user?.userEmail || "-"}
                </div>
                <div className="mt-3">
                  <LogoutButton className="justify-start" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </section>
  )
}

export { SettingsProfilePage }
