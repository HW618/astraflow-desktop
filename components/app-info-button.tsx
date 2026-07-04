"use client"

import * as React from "react"
import {
  RiInformationLine,
  RiLoader4Line,
  RiRefreshLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { AstraFlowLogo } from "@/components/astraflow-logo"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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

function AppInfoButton({ className }: { className?: string }) {
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
            hasUpdate
              ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
              : "text-muted-foreground hover:text-foreground",
            className
          )}
        >
          <RiInformationLine />
          {hasUpdate ? <span>{t.appUpdateBadge}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3" side="bottom">
        <div className="flex items-start justify-between gap-3">
          <AstraFlowLogo className="h-7 min-w-0 shrink" />
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

export { AppInfoButton }
