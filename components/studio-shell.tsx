"use client"

import * as React from "react"
import {
  RiAddLine,
  RiChat3Line,
  RiCheckLine,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiImageLine,
  RiKey2Line,
  RiLoader4Line,
  RiMicLine,
  RiMore2Line,
  RiPencilLine,
  RiVideoLine,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { StudioChatWorkbench } from "@/components/studio-chat-workbench"
import { StudioImageWorkbench } from "@/components/studio-image-workbench"
import { StudioVideoWorkbench } from "@/components/studio-video-workbench"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  StudioMode,
  StudioModelverseApiKeyOption,
  StudioOAuthFlowSnapshot,
  StudioOAuthStatus,
  StudioSession,
} from "@/lib/studio-types"
import { navigateOAuthPopup, openOAuthPopupShell } from "@/lib/oauth-popup"
import { cn } from "@/lib/utils"

type SessionsResponse =
  | {
      ok: true
      data: StudioSession[]
    }
  | {
      ok: false
      error: unknown
    }

type OAuthStatusPayload = {
  auth: StudioOAuthStatus
  flow: StudioOAuthFlowSnapshot | null
}

type OAuthStatusResponse =
  | {
      ok: true
      data: OAuthStatusPayload
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }

type OAuthStartResponse =
  | {
      ok: true
      data: StudioOAuthFlowSnapshot
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }

type ModelverseApiKeysPayload = {
  projectId: string
  items: StudioModelverseApiKeyOption[]
  selected: StudioModelverseApiKeyOption | null
}

type ModelverseApiKeysResponse =
  | {
      ok: true
      data: ModelverseApiKeysPayload
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }

type SaveModelverseApiKeyResponse =
  | {
      ok: true
      data: {
        projectId: string
        selected: StudioModelverseApiKeyOption
      }
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }

type StudioModeDefinition = {
  id: StudioMode
  icon: RemixiconComponentType
}

function isOAuthStartFailure(
  payload: OAuthStartResponse
): payload is Extract<OAuthStartResponse, { ok: false }> {
  return payload.ok === false
}

const studioModes: StudioModeDefinition[] = [
  { id: "chat", icon: RiChat3Line },
  { id: "image", icon: RiImageLine },
  { id: "video", icon: RiVideoLine },
  { id: "audio", icon: RiMicLine },
]

const STUDIO_MODE_STORAGE_KEY = "astraflow:studio-mode"
const STUDIO_SESSION_STORAGE_KEY = "astraflow:studio-session"

function isStudioMode(value: unknown): value is StudioMode {
  return (
    typeof value === "string" &&
    studioModes.some((mode) => mode.id === value)
  )
}

function readStoredStudioMode(): StudioMode {
  if (typeof window === "undefined") {
    return "chat"
  }
  const stored = window.localStorage.getItem(STUDIO_MODE_STORAGE_KEY)
  return isStudioMode(stored) ? stored : "chat"
}

function readStoredStudioSessionId(): string {
  if (typeof window === "undefined") {
    return ""
  }
  return window.localStorage.getItem(STUDIO_SESSION_STORAGE_KEY) ?? ""
}

async function fetchStudioSessions() {
  const response = await fetch("/api/studio/sessions")
  const payload = (await response.json()) as SessionsResponse

  if (!response.ok || !payload.ok) {
    throw new Error("Failed to load sessions")
  }

  return payload.data
}

async function renameStudioSession(sessionId: string, title: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  })

  if (!response.ok) {
    throw new Error("Failed to rename session")
  }
}

async function deleteStudioSessionRequest(sessionId: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "DELETE",
  })

  if (!response.ok) {
    throw new Error("Failed to delete session")
  }
}

async function fetchStudioOAuthStatus(state?: string) {
  const search = state ? `?state=${encodeURIComponent(state)}` : ""
  const response = await fetch(`/api/studio/oauth/status${search}`)
  const payload = (await response.json()) as OAuthStatusResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to load OAuth status"
    )
  }

  return payload.data
}

async function startStudioOAuth() {
  const response = await fetch("/api/studio/oauth/start", {
    method: "POST",
  })
  const payload = (await response.json()) as OAuthStartResponse

  if (!response.ok) {
    throw new Error(
      isOAuthStartFailure(payload)
        ? payload.message || "Failed to start OAuth"
        : "Failed to start OAuth"
    )
  }

  if (isOAuthStartFailure(payload)) {
    throw new Error(payload.message || "Failed to start OAuth")
  }

  return payload.data
}

async function fetchModelverseApiKeys(projectId?: string) {
  const search = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
  const response = await fetch(`/api/studio/modelverse-api-keys${search}`)
  const payload = (await response.json()) as ModelverseApiKeysResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to load Modelverse API keys"
    )
  }

  return payload.data
}

async function saveModelverseApiKey(apiKeyId: string, projectId: string) {
  const response = await fetch("/api/studio/modelverse-api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKeyId, projectId }),
  })
  const payload = (await response.json()) as SaveModelverseApiKeyResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to save Modelverse API key"
    )
  }

  return payload.data
}

function formatExpiry(expiresAt: number | null) {
  if (!expiresAt) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(expiresAt)
}

function StudioShell() {
  const { t } = useI18n()
  const [selectedMode, setSelectedMode] = React.useState<StudioMode>("chat")
  const modeHydratedRef = React.useRef(false)
  const sessionHydratedRef = React.useRef(false)
  const [selectedSessionId, setSelectedSessionId] = React.useState("")
  const [sessions, setSessions] = React.useState<StudioSession[]>([])
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [menuSessionId, setMenuSessionId] = React.useState<string | null>(null)
  const [renameTarget, setRenameTarget] =
    React.useState<StudioSession | null>(null)
  const [renameValue, setRenameValue] = React.useState("")
  const [renameSaving, setRenameSaving] = React.useState(false)
  const [deleteTarget, setDeleteTarget] =
    React.useState<StudioSession | null>(null)
  const [deleteSaving, setDeleteSaving] = React.useState(false)
  const [oauthStatus, setOauthStatus] = React.useState<StudioOAuthStatus>({
    configured: false,
    email: null,
    expiresAt: null,
    updatedAt: null,
  })
  const [oauthDialogOpen, setOauthDialogOpen] = React.useState(false)
  const [oauthFlow, setOauthFlow] =
    React.useState<StudioOAuthFlowSnapshot | null>(null)
  const [oauthError, setOauthError] = React.useState("")
  const [oauthStarting, setOauthStarting] = React.useState(false)
  const [projectId, setProjectId] = React.useState("")
  const [modelverseApiKeys, setModelverseApiKeys] = React.useState<
    StudioModelverseApiKeyOption[]
  >([])
  const [selectedModelverseApiKeyId, setSelectedModelverseApiKeyId] =
    React.useState("")
  const [savedModelverseApiKeyId, setSavedModelverseApiKeyId] =
    React.useState("")
  const [modelverseApiKeyLoading, setModelverseApiKeyLoading] =
    React.useState(false)
  const [modelverseApiKeySaving, setModelverseApiKeySaving] =
    React.useState(false)
  const [modelverseApiKeyError, setModelverseApiKeyError] = React.useState("")

  const selectedSession = sessions.find(
    (session) => session.id === selectedSessionId
  )
  const activeMode = selectedSession?.mode ?? selectedMode
  const oauthExpiry = formatExpiry(oauthStatus.expiresAt)
  const studioConfigured =
    oauthStatus.configured && Boolean(savedModelverseApiKeyId)

  const reloadSessions = React.useCallback(async () => {
    try {
      setLoadFailed(false)
      setSessions(await fetchStudioSessions())
    } catch {
      setLoadFailed(true)
    }
  }, [])

  const reloadOAuthStatus = React.useCallback(
    async (state?: string, openDialogOnMissing = true) => {
      const next = await fetchStudioOAuthStatus(state)

      setOauthStatus(next.auth)
      setOauthFlow(next.flow)

      if (next.flow?.status === "error") {
        setOauthError(next.flow.message ?? t.studioOAuthFailed)
        setOauthDialogOpen(true)
      } else if (next.auth.configured) {
        setOauthError("")
      } else if (!next.auth.configured && openDialogOnMissing) {
        setProjectId("")
        setModelverseApiKeys([])
        setSelectedModelverseApiKeyId("")
        setSavedModelverseApiKeyId("")
        setModelverseApiKeyError("")
        setOauthDialogOpen(true)
      }

      return next
    },
    [t.studioOAuthFailed]
  )

  const reloadModelverseApiKeys = React.useCallback(
    async (preferredProjectId?: string) => {
      try {
        setModelverseApiKeyLoading(true)
        setModelverseApiKeyError("")

        const next = await fetchModelverseApiKeys(
          preferredProjectId || projectId
        )

        setProjectId(next.projectId)
        setModelverseApiKeys(next.items)
        setSavedModelverseApiKeyId(next.selected?.id ?? "")
        setSelectedModelverseApiKeyId(
          next.selected?.id ?? next.items[0]?.id ?? ""
        )

        if (!next.selected) {
          setOauthDialogOpen(true)
        }

        return next
      } catch (error) {
        setModelverseApiKeyError(
          error instanceof Error ? error.message : t.studioModelverseApiKeyEmpty
        )
        setOauthDialogOpen(true)
        return null
      } finally {
        setModelverseApiKeyLoading(false)
      }
    },
    [projectId, t.studioModelverseApiKeyEmpty]
  )

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadSessions()
      void reloadOAuthStatus()
      const storedMode = readStoredStudioMode()
      setSelectedMode(storedMode)
      modeHydratedRef.current = true
    })
  }, [reloadOAuthStatus, reloadSessions])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!modeHydratedRef.current) return
    window.localStorage.setItem(STUDIO_MODE_STORAGE_KEY, selectedMode)
  }, [selectedMode])

  React.useEffect(() => {
    if (sessionHydratedRef.current) return
    if (sessions.length === 0) return

    const storedSessionId = readStoredStudioSessionId()
    sessionHydratedRef.current = true

    if (!storedSessionId) return

    const stored = sessions.find((session) => session.id === storedSessionId)
    if (!stored) return

    queueMicrotask(() => {
      setSelectedSessionId(stored.id)
      setSelectedMode(stored.mode)
    })
  }, [sessions])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!sessionHydratedRef.current) return
    if (selectedSessionId) {
      window.localStorage.setItem(STUDIO_SESSION_STORAGE_KEY, selectedSessionId)
    } else {
      window.localStorage.removeItem(STUDIO_SESSION_STORAGE_KEY)
    }
  }, [selectedSessionId])

  React.useEffect(() => {
    if (oauthStatus.configured) {
      const timer = window.setTimeout(() => {
        void reloadModelverseApiKeys()
      }, 0)

      return () => {
        window.clearTimeout(timer)
      }
    }
  }, [oauthStatus.configured, reloadModelverseApiKeys])

  React.useEffect(() => {
    if (!oauthFlow || oauthFlow.status !== "pending") {
      return
    }

    const timer = window.setInterval(() => {
      void reloadOAuthStatus(oauthFlow.state, false)
    }, 1200)

    return () => {
      window.clearInterval(timer)
    }
  }, [oauthFlow, reloadOAuthStatus])

  async function handleOAuthStart() {
    try {
      setOauthStarting(true)
      setOauthError("")

      const popup = openOAuthPopupShell()
      const nextFlow = await startStudioOAuth()

      setOauthFlow(nextFlow)
      setOauthDialogOpen(true)

      navigateOAuthPopup(popup, nextFlow.authorizationUrl)
    } catch (error) {
      setOauthError(
        error instanceof Error ? error.message : t.studioOAuthFailed
      )
    } finally {
      setOauthStarting(false)
    }
  }

  async function handleModelverseApiKeySave() {
    if (!selectedModelverseApiKeyId) {
      setModelverseApiKeyError(t.studioModelverseApiKeyRequired)
      return
    }

    try {
      setModelverseApiKeySaving(true)
      setModelverseApiKeyError("")

      const next = await saveModelverseApiKey(
        selectedModelverseApiKeyId,
        projectId
      )

      setProjectId(next.projectId)
      setSavedModelverseApiKeyId(next.selected.id)
      setSelectedModelverseApiKeyId(next.selected.id)
      setOauthDialogOpen(false)
    } catch (error) {
      setModelverseApiKeyError(
        error instanceof Error ? error.message : t.studioModelverseApiKeyEmpty
      )
    } finally {
      setModelverseApiKeySaving(false)
    }
  }

  async function handleRenameSubmit() {
    const target = renameTarget
    const nextTitle = renameValue.trim()

    if (!target || !nextTitle) {
      return
    }

    try {
      setRenameSaving(true)
      await renameStudioSession(target.id, nextTitle)
      setRenameTarget(null)
      setRenameValue("")
      await reloadSessions()
    } catch {
      // Keep the dialog open so the user can retry.
    } finally {
      setRenameSaving(false)
    }
  }

  async function handleDeleteConfirm() {
    const target = deleteTarget

    if (!target) {
      return
    }

    try {
      setDeleteSaving(true)
      await deleteStudioSessionRequest(target.id)

      if (selectedSessionId === target.id) {
        setSelectedSessionId("")
      }

      setDeleteTarget(null)
      await reloadSessions()
    } catch {
      // Keep the dialog open so the user can retry.
    } finally {
      setDeleteSaving(false)
    }
  }

  function getModeLabel(mode: StudioMode) {
    switch (mode) {
      case "chat":
        return t.studioModeChat
      case "image":
        return t.studioModeImage
      case "video":
        return t.studioModeVideo
      case "audio":
        return t.studioModeAudio
    }
  }

  return (
    <main className="flex h-[calc(100svh-4rem)] min-h-0 overflow-hidden bg-background">
      <aside className="flex w-full min-w-0 flex-col border-r bg-background p-2 text-sidebar-foreground md:w-[168px] md:shrink-0 lg:w-[180px]">
        <div className="shrink-0">
          <Button
            type="button"
            className="mb-2 h-9 w-full justify-start text-sm"
            onClick={() => {
              setSelectedMode("chat")
              setSelectedSessionId("")
            }}
          >
            <RiAddLine data-icon="inline-start" aria-hidden />
            <span>{t.studioNewSession}</span>
          </Button>

          <nav aria-label={t.studioModes} className="flex flex-col gap-1">
            {studioModes.map((mode) => {
              const Icon = mode.icon
              const isActive = mode.id === activeMode

              return (
                <Button
                  key={mode.id}
                  type="button"
                  variant={isActive ? "secondary" : "ghost"}
                  className="h-8 justify-start gap-2 rounded-md px-2 text-sm font-normal"
                  aria-pressed={isActive}
                  onClick={() => {
                    setSelectedMode(mode.id)
                    setSelectedSessionId("")
                  }}
                >
                  <Icon data-icon="inline-start" aria-hidden />
                  <span className="truncate">{getModeLabel(mode.id)}</span>
                </Button>
              )
            })}
          </nav>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden pt-1">
          <div className="px-2 pb-2 text-xs font-medium text-sidebar-foreground/70">
            {t.studioSessions}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sessions.length > 0 ? (
              <div className="flex flex-col gap-1">
                {sessions.map((session) => {
                  const isActive = session.id === selectedSessionId

                  return (
                    <div
                      key={session.id}
                      className={cn(
                        "group/session relative flex items-center rounded-md transition-colors hover:bg-sidebar-accent",
                        isActive && "bg-sidebar-accent"
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          "flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-md px-2 text-left text-sm outline-none hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                          isActive &&
                            "font-medium text-sidebar-accent-foreground"
                        )}
                        onClick={() => {
                          setSelectedSessionId(session.id)
                          setSelectedMode(session.mode)
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate pr-5">
                          {session.title}
                        </span>
                      </button>

                      <Popover
                        open={menuSessionId === session.id}
                        onOpenChange={(open) =>
                          setMenuSessionId(open ? session.id : null)
                        }
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label={t.studioSessionActions}
                            className={cn(
                              "absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/70 opacity-0 transition hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground focus-visible:opacity-100 group-hover/session:opacity-100 [&_svg]:size-4",
                              menuSessionId === session.id && "opacity-100"
                            )}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <RiMore2Line aria-hidden />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          side="right"
                          className="w-40 gap-0.5 rounded-2xl p-1.5"
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
                            onClick={() => {
                              setMenuSessionId(null)
                              setRenameValue(session.title)
                              setRenameTarget(session)
                            }}
                          >
                            <RiPencilLine aria-hidden />
                            {t.studioRename}
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10 [&_svg]:size-4"
                            onClick={() => {
                              setMenuSessionId(null)
                              setDeleteTarget(session)
                            }}
                          >
                            <RiDeleteBinLine aria-hidden />
                            {t.studioDelete}
                          </button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="px-2 py-2 text-sm text-muted-foreground">
                {loadFailed ? t.studioLoadFailed : t.studioNoSessions}
              </p>
            )}
          </div>
        </div>

        <div className="mt-2 shrink-0 border-t pt-2">
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start gap-2 rounded-md px-2 text-sm font-normal"
            onClick={() => {
              setOauthError("")
              setModelverseApiKeyError("")
              setOauthDialogOpen(true)
              if (oauthStatus.configured) {
                void reloadModelverseApiKeys()
              }
            }}
          >
            <RiKey2Line data-icon="inline-start" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {t.studioApiSettings}
            </span>
            {studioConfigured ? (
              <RiCheckLine data-icon="inline-end" aria-hidden />
            ) : null}
          </Button>
        </div>
      </aside>

      <section className="hidden min-w-0 flex-1 flex-col overflow-hidden bg-background md:flex">
        {activeMode === "chat" ? (
          <StudioChatWorkbench
            sessionId={selectedSessionId}
            onSessionChange={(nextSessionId) => {
              setSelectedMode("chat")
              setSelectedSessionId(nextSessionId)
            }}
            onSessionsChange={reloadSessions}
          />
        ) : activeMode === "image" ? (
          <StudioImageWorkbench
            sessionId={selectedSessionId}
            onSessionChange={(nextSessionId) => {
              setSelectedMode("image")
              setSelectedSessionId(nextSessionId)
            }}
            onSessionsChange={reloadSessions}
          />
        ) : activeMode === "video" ? (
          <StudioVideoWorkbench
            sessionId={selectedSessionId}
            onSessionChange={(nextSessionId) => {
              setSelectedMode("video")
              setSelectedSessionId(nextSessionId)
            }}
            onSessionsChange={reloadSessions}
          />
        ) : (
          <div className="flex h-full min-h-0 items-center justify-center px-10">
            <div className="flex max-w-md flex-col items-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <RiChat3Line aria-hidden />
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="font-heading text-2xl font-semibold">
                  {getModeLabel(activeMode)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t.studioModePending}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      <Dialog
        open={oauthDialogOpen}
        onOpenChange={(open) => {
          if (!oauthStatus.configured) {
            setOauthDialogOpen(true)
            return
          }

          setOauthDialogOpen(open)
        }}
      >
        <DialogContent
          showCloseButton={oauthStatus.configured}
          className="supports-backdrop-filter:bg-popover/96"
        >
          <DialogHeader>
            <DialogTitle>{t.studioApiSettingsTitle}</DialogTitle>
            <DialogDescription>
              {t.studioApiSettingsDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-sm">
            {oauthStatus.email ? (
              <p className="text-foreground">
                {t.studioOAuthSignedInAs}: {oauthStatus.email}
              </p>
            ) : null}

            {oauthExpiry ? (
              <p className="text-muted-foreground">{oauthExpiry}</p>
            ) : null}

            {oauthFlow ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground">
                <div className="font-medium text-foreground">
                  {t.studioOAuthLocalCallback}: {oauthFlow.redirectUri}
                </div>
                {oauthFlow.message ? (
                  <p className="mt-1">{oauthFlow.message}</p>
                ) : oauthFlow.status === "pending" ? (
                  <p className="mt-1">{t.studioOAuthWaiting}</p>
                ) : null}
              </div>
            ) : null}

            {oauthError ? (
              <p className="text-sm text-destructive">{oauthError}</p>
            ) : null}

            {oauthStatus.configured ? (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-foreground">
                  {t.studioModelverseApiKeyLabel}
                </label>
                <Select
                  value={selectedModelverseApiKeyId}
                  onValueChange={(value) => {
                    setSelectedModelverseApiKeyId(value)
                    setModelverseApiKeyError("")
                  }}
                  disabled={modelverseApiKeyLoading || modelverseApiKeySaving}
                >
                  <SelectTrigger className="w-full rounded-2xl">
                    <SelectValue
                      placeholder={t.studioModelverseApiKeyPlaceholder}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {modelverseApiKeys.map((apiKey) => (
                      <SelectItem key={apiKey.id} value={apiKey.id}>
                        {apiKey.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {modelverseApiKeyLoading ? (
                  <p className="text-xs text-muted-foreground">
                    {t.studioModelverseApiKeyLoading}
                  </p>
                ) : null}

                {!modelverseApiKeyLoading && modelverseApiKeys.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t.studioModelverseApiKeyEmpty}
                  </p>
                ) : null}

                {savedModelverseApiKeyId ? (
                  <p className="text-xs text-muted-foreground">
                    {t.studioModelverseApiKeySaved}
                  </p>
                ) : null}

                {modelverseApiKeyError ? (
                  <p className="text-xs text-destructive">
                    {modelverseApiKeyError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {!oauthStatus.configured && oauthFlow ? (
              <Button
                type="button"
                variant="outline"
                asChild
                className="sm:mr-auto"
              >
                <a
                  href={oauthFlow.authorizationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <RiExternalLinkLine aria-hidden />
                  <span>{t.studioOAuthOpenBrowser}</span>
                </a>
              </Button>
            ) : (
              <span />
            )}

            {!oauthStatus.configured ? (
              <Button
                type="button"
                onClick={handleOAuthStart}
                disabled={oauthStarting}
              >
                {oauthStarting ? (
                  <RiLoader4Line className="animate-spin" aria-hidden />
                ) : (
                  <RiKey2Line aria-hidden />
                )}
                <span>
                  {oauthStarting
                    ? t.studioOAuthConnecting
                    : t.studioOAuthConnect}
                </span>
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleModelverseApiKeySave}
                disabled={
                  modelverseApiKeyLoading ||
                  modelverseApiKeySaving ||
                  modelverseApiKeys.length === 0
                }
              >
                {modelverseApiKeySaving ? (
                  <RiLoader4Line className="animate-spin" aria-hidden />
                ) : (
                  <RiCheckLine aria-hidden />
                )}
                <span>
                  {modelverseApiKeySaving
                    ? t.studioModelverseApiKeySaving
                    : t.studioModelverseApiKeySave}
                </span>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null)
            setRenameValue("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioRenameTitle}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            placeholder={t.studioRenamePlaceholder}
            maxLength={120}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void handleRenameSubmit()
              }
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRenameTarget(null)
                setRenameValue("")
              }}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              onClick={handleRenameSubmit}
              disabled={renameSaving || renameValue.trim().length === 0}
            >
              {renameSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiCheckLine aria-hidden />
              )}
              <span>{t.studioSave}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioDeleteTitle}</DialogTitle>
            <DialogDescription>{t.studioDeleteConfirm}</DialogDescription>
          </DialogHeader>
          {deleteTarget ? (
            <p className="truncate text-sm font-medium text-foreground">
              {deleteTarget.title}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteSaving}
            >
              {deleteSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiDeleteBinLine aria-hidden />
              )}
              <span>{t.studioDelete}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

export { StudioShell }
