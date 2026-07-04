"use client"

import Link from "next/link"
import * as React from "react"
import {
  RiArrowDownSLine,
  RiBuilding2Line,
  RiFolderLine,
  RiIdCardLine,
  RiInformationLine,
  RiLoader4Line,
  RiMailLine,
  RiRefreshLine,
  RiUser3Line,
} from "@remixicon/react"
import { toast } from "sonner"

import { AstraFlowLogo } from "@/components/astraflow-logo"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { LanguageToggle } from "@/components/language-toggle"
import { LogoutButton } from "@/components/logout-button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  readSelectedUCloudProjectId,
  UCLOUD_PROJECT_CHANGED_EVENT,
  type UCloudProjectChangedDetail,
  writeSelectedUCloudProjectId,
} from "@/lib/project-selection"
import { cn } from "@/lib/utils"

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

type AppInfoPayload = {
  name: string
  currentVersion: string
  update: {
    checkedAt: string
    latestVersion: string | null
    releaseDate: string | null
    releaseName: string | null
    releaseUrl: string | null
    updateAvailable: boolean | null
    message: string | null
  } | null
}

type AppInfoResponse =
  | {
      ok: true
      data: AppInfoPayload
    }
  | {
      ok: false
      message?: string
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
  user: UCloudUserInfoPayload | null
}

type UCloudUserInfoPayload = {
  userName: string
  displayName: string
  companyName: string
  userEmail: string
  companyId: number | null
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

async function fetchAppInfo(checkUpdates = false) {
  const response = await fetch(
    `/api/app-info${checkUpdates ? "?check=1" : ""}`,
    { cache: "no-store" }
  )
  const payload = (await response.json()) as AppInfoResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to load app info."
    )
  }

  return payload.data
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

function AppInfoButton() {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const [info, setInfo] = React.useState<AppInfoPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isInstalling, setIsInstalling] = React.useState(false)
  const [error, setError] = React.useState("")

  const loadInfo = React.useCallback(
    async (checkUpdates = false) => {
      try {
        setIsLoading(true)
        setError("")
        setInfo(await fetchAppInfo(checkUpdates))
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t.appUpdateCheckFailed
        )
      } finally {
        setIsLoading(false)
      }
    },
    [t.appUpdateCheckFailed]
  )

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)

      if (nextOpen && !info && !isLoading) {
        void loadInfo(false)
      }
    },
    [info, isLoading, loadInfo]
  )

  React.useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (!cancelled) {
        void loadInfo(true)
      }
    })

    const interval = window.setInterval(() => {
      void loadInfo(true)
    }, UPDATE_CHECK_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [loadInfo])

  async function installUpdate() {
    if (!window.astraflowDesktop?.installUpdate) {
      toast.error(t.appUpdateInstallUnavailable)
      return
    }

    const toastId = toast.loading(t.appUpdateInstalling)

    try {
      setIsInstalling(true)
      await window.astraflowDesktop.installUpdate()
      toast.success(t.appUpdateInstallRestarting, { id: toastId })
    } catch (installError) {
      toast.error(
        installError instanceof Error
          ? installError.message
          : t.appUpdateInstallFailed,
        { id: toastId }
      )
    } finally {
      setIsInstalling(false)
    }
  }

  const update = info?.update ?? null
  const hasUpdate = update?.updateAvailable === true
  const updateStatus = error
    ? error
    : isLoading && !update
      ? t.appUpdateChecking
      : hasUpdate && update.latestVersion
        ? t.appUpdateAvailable(update.latestVersion)
        : update?.updateAvailable === false
          ? t.appUpdateCurrent
          : update?.message
            ? t.appUpdateCheckFailed
            : update?.latestVersion
              ? t.appUpdateLatest(update.latestVersion)
              : t.appUpdateStatus
  const statusTone = hasUpdate
    ? "text-primary"
    : error || update?.message
      ? "text-destructive"
      : "text-muted-foreground"

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={hasUpdate ? "sm" : "icon-xs"}
          aria-label={t.appInfo}
          title={t.appInfo}
          className={cn(
            "ml-1",
            hasUpdate
              ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <RiInformationLine />
          {hasUpdate ? <span>{t.appUpdateBadge}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3" side="bottom">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">AstraFlow</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              v{info?.currentVersion ?? "..."}
            </span>
            {isLoading ? (
              <RiLoader4Line
                className="size-4 shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl bg-muted/50 px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground">
            {t.appUpdateStatus}
          </div>
          <div className={cn("mt-1 text-sm font-medium", statusTone)}>
            {updateStatus}
          </div>
          {update?.message ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {update.message}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {hasUpdate ? (
            <Button
              size="sm"
              onClick={() => void installUpdate()}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiRefreshLine />
              )}
              {t.appUpdateInstallNow}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadInfo(true)}
            disabled={isLoading}
          >
            <RiRefreshLine className={cn(isLoading && "animate-spin")} />
            {t.appUpdateCheck}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function AccountInfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-muted/45 px-3 py-2">
      <Icon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  )
}

function AccountMenu() {
  const { t } = useI18n()
  const [projects, setProjects] = React.useState<UCloudProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = React.useState("")
  const [user, setUser] = React.useState<UCloudUserInfoPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState("")

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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={t.account}
          className="max-w-56 justify-start"
          size="sm"
          title={displayName}
          type="button"
          variant="ghost"
        >
          {isLoading || isSaving ? (
            <RiLoader4Line className="animate-spin" />
          ) : (
            <RiUser3Line />
          )}
          <span className="min-w-0 truncate">{displayName}</span>
          <RiArrowDownSLine className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(44rem,calc(100vw-2rem))] gap-4"
        side="bottom"
      >
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.9fr)]">
          <div className="min-w-0 space-y-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <RiUser3Line className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {user?.displayName || t.account}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {user?.userEmail || "-"}
                </div>
              </div>
            </div>

            <div className="grid gap-2">
              <AccountInfoRow
                icon={RiUser3Line}
                label={t.accountDisplayName}
                value={user?.displayName || "-"}
              />
              <AccountInfoRow
                icon={RiBuilding2Line}
                label={t.accountCompanyName}
                value={user?.companyName || "-"}
              />
              <AccountInfoRow
                icon={RiMailLine}
                label={t.accountUserEmail}
                value={user?.userEmail || "-"}
              />
              <AccountInfoRow
                icon={RiIdCardLine}
                label={t.accountCompanyId}
                value={companyId}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3 rounded-3xl border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <RiFolderLine
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              {t.project}
            </div>
            <Select
              value={selectedProjectId}
              onValueChange={(value) => void selectProject(value)}
              disabled={isLoading || isSaving}
            >
              <SelectTrigger
                aria-label={t.project}
                className="!h-12 w-full justify-start rounded-2xl border-border bg-muted/45 px-4 hover:bg-muted/60"
                title={error || t.project}
              >
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {selectedProject?.name ||
                      (isLoading ? t.projectLoading : t.project)}
                  </span>
                  {selectedProject ? (
                    <span className="max-w-32 shrink-0 truncate font-mono text-xs text-muted-foreground">
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
                        <span className="flex min-w-0 w-full items-center justify-between gap-3 py-1">
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
              <div className="text-xs text-destructive">{error}</div>
            ) : null}
            <LogoutButton className="mt-auto w-full justify-start" />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Navbar() {
  const { t } = useI18n()

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 w-full items-center justify-between gap-4 px-4">
        <div className="flex items-center lg:pl-2">
          <AstraFlowLogo fetchPriority="high" />
          <AppInfoButton />
        </div>

        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto sm:gap-2 [&>*]:shrink-0">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/explore">{t.explore}</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/skills">{t.skills}</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/studio">{t.studio}</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/codebox">{t.codebox}</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/files">{t.files}</Link>
          </Button>

          <ThemeToggle />
          <LanguageToggle />
          <AccountMenu />
        </nav>
      </div>
    </header>
  )
}

export { Navbar }
