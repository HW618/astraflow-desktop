"use client"

import Link from "next/link"
import * as React from "react"
import {
  RiExternalLinkLine,
  RiInformationLine,
  RiLoader4Line,
  RiRefreshLine,
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
  SelectValue,
} from "@/components/ui/select"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  readSelectedUCloudProjectId,
  UCLOUD_PROJECT_CHANGED_EVENT,
  type UCloudProjectChangedDetail,
  writeSelectedUCloudProjectId,
} from "@/lib/project-selection"
import { cn } from "@/lib/utils"

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

  const loadInfo = React.useCallback(async (checkUpdates = false) => {
    try {
      setIsLoading(true)
      setError("")
      setInfo(await fetchAppInfo(checkUpdates))
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t.appUpdateCheckFailed
      )
    } finally {
      setIsLoading(false)
    }
  }, [t.appUpdateCheckFailed])

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
    queueMicrotask(() => {
      void loadInfo(true)
    })
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
  const statusTone =
    hasUpdate
      ? "text-emerald-600"
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
              ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-800"
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
          {update?.releaseUrl ? (
            <Button variant="ghost" size="sm" asChild>
              <a href={update.releaseUrl} target="_blank" rel="noreferrer">
                <RiExternalLinkLine data-icon="inline-start" />
                {t.appUpdateOpenRelease}
              </a>
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ProjectSwitcher() {
  const { t } = useI18n()
  const [projects, setProjects] = React.useState<UCloudProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = React.useState("")
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

  if (!isLoading && projects.length === 0 && error) {
    return null
  }

  return (
    <div className="flex min-w-0 items-center">
      {isSaving || isLoading ? (
        <RiLoader4Line
          className="mr-1 size-4 shrink-0 animate-spin text-muted-foreground"
          aria-hidden
        />
      ) : null}
      <Select
        value={selectedProjectId || undefined}
        onValueChange={(value) => void selectProject(value)}
        disabled={isLoading || isSaving}
      >
        <SelectTrigger
          className="h-9 max-w-48 justify-start border-border bg-background px-3 hover:bg-background"
          aria-label={t.project}
          title={error || t.project}
        >
          <SelectValue
            placeholder={isLoading ? t.projectLoading : t.project}
          />
        </SelectTrigger>
        <SelectContent align="end" className="max-h-80" position="popper">
          <SelectGroup>
            {projects.length === 0 ? (
              <SelectItem value="__empty" disabled>
                {t.projectEmpty}
              </SelectItem>
            ) : (
              projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))
            )}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
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

        <nav className="flex items-center gap-1 sm:gap-2">
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

          <ProjectSwitcher />

          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

          <ThemeToggle />
          <LanguageToggle />
          <LogoutButton />
        </nav>
      </div>
    </header>
  )
}

export { Navbar }
