"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import {
  RiAddLine,
  RiApps2Line,
  RiChat3Line,
  RiCheckLine,
  RiCodeBoxLine,
  RiDeleteBinLine,
  RiFileListLine,
  RiImageLine,
  RiLoader4Line,
  RiMicLine,
  RiMore2Line,
  RiPencilLine,
  RiPlayCircleLine,
  RiPuzzleLine,
  RiSettings3Line,
  RiStore2Line,
  RiUser3Line,
  RiVideoLine,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"

import { AstraFlowLogo } from "@/components/astraflow-logo"
import { useI18n } from "@/components/i18n-provider"
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
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import {
  dispatchStudioSessionsChanged,
  STUDIO_SESSIONS_CHANGED_EVENT,
} from "@/lib/studio-session-events"
import {
  studioModes,
  type StudioMode,
  type StudioSession,
} from "@/lib/studio-types"

type SessionsResponse =
  | {
      ok: true
      data: StudioSession[]
    }
  | {
      ok: false
      error: unknown
    }

type NavItem = {
  href: string
  label: string
  icon: RemixiconComponentType
  isActive: (pathname: string) => boolean
}

type StudioModeDefinition = {
  id: StudioMode
  icon: RemixiconComponentType
}

const studioModeDefinitions: StudioModeDefinition[] = [
  { id: "chat", icon: RiChat3Line },
  { id: "image", icon: RiImageLine },
  { id: "video", icon: RiVideoLine },
  { id: "audio", icon: RiMicLine },
]

class LoginRequiredError extends Error {
  constructor() {
    super("Login required.")
    this.name = "LoginRequiredError"
  }
}

function throwIfUnauthorized(response: Response) {
  if (response.status === 401) {
    throw new LoginRequiredError()
  }
}

function isLoginRequiredError(error: unknown) {
  return error instanceof LoginRequiredError
}

function isStudioMode(value: unknown): value is StudioMode {
  return typeof value === "string" && studioModes.includes(value as StudioMode)
}

function getStudioModeHref(mode: StudioMode) {
  return mode === "chat" ? "/studio" : `/studio?mode=${mode}`
}

function getStudioSessionHref(session: StudioSession) {
  return `/studio/${session.mode}/${encodeURIComponent(session.id)}`
}

function parseActiveStudioRoute(
  pathname: string,
  modeQuery: string | null
): {
  mode: StudioMode | null
  sessionId: string
} {
  const match = pathname.match(/^\/studio(?:\/([^/]+)(?:\/([^/]+))?)?/)
  const pathMode = match?.[1]
  const pathSessionId = match?.[2] ? decodeURIComponent(match[2]) : ""

  if (isStudioMode(pathMode)) {
    return {
      mode: pathMode,
      sessionId: pathSessionId,
    }
  }

  if (pathname === "/studio" && isStudioMode(modeQuery)) {
    return {
      mode: modeQuery,
      sessionId: "",
    }
  }

  if (pathname === "/studio") {
    return {
      mode: "chat",
      sessionId: "",
    }
  }

  return {
    mode: null,
    sessionId: "",
  }
}

async function fetchStudioSessions() {
  const response = await fetch("/api/studio/sessions", { cache: "no-store" })
  throwIfUnauthorized(response)

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
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to rename session")
  }
}

async function deleteStudioSessionRequest(sessionId: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "DELETE",
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to delete session")
  }
}

function AppSidebar() {
  const { t } = useI18n()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeStudio = parseActiveStudioRoute(
    pathname,
    searchParams.get("mode")
  )
  const [sessions, setSessions] = React.useState<StudioSession[]>([])
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = React.useState(true)
  const [menuSessionId, setMenuSessionId] = React.useState<string | null>(null)
  const [renameTarget, setRenameTarget] = React.useState<StudioSession | null>(
    null
  )
  const [renameValue, setRenameValue] = React.useState("")
  const [renameSaving, setRenameSaving] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<StudioSession | null>(
    null
  )
  const [deleteSaving, setDeleteSaving] = React.useState(false)

  const redirectToLogin = React.useCallback(() => {
    window.location.replace("/login")
  }, [])

  const reloadSessions = React.useCallback(async () => {
    try {
      setLoadFailed(false)
      setIsLoadingSessions(true)
      setSessions(await fetchStudioSessions())
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
        return
      }

      setLoadFailed(true)
    } finally {
      setIsLoadingSessions(false)
    }
  }, [redirectToLogin])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadSessions()
    })
  }, [reloadSessions])

  React.useEffect(() => {
    function handleSessionsChanged() {
      void reloadSessions()
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
  }, [reloadSessions])

  const navItems: NavItem[] = [
    {
      href: "/explore",
      label: t.explore,
      icon: RiApps2Line,
      isActive: (currentPathname) => currentPathname.startsWith("/explore"),
    },
    {
      href: "/skills",
      label: t.skills,
      icon: RiPuzzleLine,
      isActive: (currentPathname) => currentPathname.startsWith("/skills"),
    },
    {
      href: "/studio",
      label: t.studio,
      icon: RiPlayCircleLine,
      isActive: (currentPathname) => currentPathname.startsWith("/studio"),
    },
    {
      href: "/codebox",
      label: t.codebox,
      icon: RiCodeBoxLine,
      isActive: (currentPathname) => currentPathname.startsWith("/codebox"),
    },
    {
      href: "/files",
      label: t.files,
      icon: RiFileListLine,
      isActive: (currentPathname) => currentPathname.startsWith("/files"),
    },
  ]

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
      dispatchStudioSessionsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      }
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

      if (activeStudio.sessionId === target.id) {
        router.replace(getStudioModeHref(target.mode))
      }

      setDeleteTarget(null)
      await reloadSessions()
      dispatchStudioSessionsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      }
    } finally {
      setDeleteSaving(false)
    }
  }

  const settingsActive = pathname.startsWith("/settings")

  return (
    <>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader>
          <div className="flex items-center gap-1.5 px-1 pt-1">
            <Link
              href="/explore"
              aria-label="AstraFlow"
              className="flex min-w-0 items-center overflow-hidden"
            >
              <AstraFlowLogo className="h-6 shrink-0" fetchPriority="high" />
            </Link>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={t.studioNewSession}>
                    <Link href="/studio">
                      <RiAddLine aria-hidden />
                      <span>{t.studioNewSession}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {navItems.map((item) => {
                  const Icon = item.icon
                  const isActive = item.isActive(pathname)

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.label}
                      >
                        <Link href={item.href}>
                          <Icon aria-hidden />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>{t.studio}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {studioModeDefinitions.map((mode) => {
                  const Icon = mode.icon
                  const label = getModeLabel(mode.id)
                  const isActive =
                    activeStudio.mode === mode.id && !activeStudio.sessionId

                  return (
                    <SidebarMenuItem key={mode.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={label}
                      >
                        <Link href={getStudioModeHref(mode.id)}>
                          <Icon aria-hidden />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="min-h-0 flex-1">
            <SidebarGroupLabel>{t.studioSessions}</SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0">
              {sessions.length > 0 ? (
                <SidebarMenu>
                  {sessions.map((session) => {
                    const isActive = activeStudio.sessionId === session.id
                    const Icon =
                      studioModeDefinitions.find(
                        (mode) => mode.id === session.mode
                      )?.icon ?? RiChat3Line

                    return (
                      <SidebarMenuItem key={session.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={session.title}
                        >
                          <Link href={getStudioSessionHref(session)}>
                            <Icon aria-hidden />
                            <span>{session.title}</span>
                          </Link>
                        </SidebarMenuButton>

                        <Popover
                          open={menuSessionId === session.id}
                          onOpenChange={(open) =>
                            setMenuSessionId(open ? session.id : null)
                          }
                        >
                          <PopoverTrigger asChild>
                            <SidebarMenuAction
                              aria-label={t.studioSessionActions}
                              showOnHover
                              onClick={(event) => event.stopPropagation()}
                            >
                              <RiMore2Line aria-hidden />
                            </SidebarMenuAction>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            side="right"
                            className="w-40 gap-0.5 p-1"
                          >
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-2.5 py-2 text-sm hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
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
                              className="flex w-full items-center gap-2 px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10 [&_svg]:size-4"
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
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              ) : (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  {loadFailed
                    ? t.studioLoadFailed
                    : isLoadingSessions
                      ? t.studioThinking
                      : t.studioNoSessions}
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={settingsActive}
                tooltip={t.settings}
              >
                <Link href="/settings/profile">
                  <RiSettings3Line aria-hidden />
                  <span>{t.settings}</span>
                </Link>
              </SidebarMenuButton>

              {settingsActive ? (
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      asChild
                      isActive={pathname === "/settings/profile"}
                    >
                      <Link href="/settings/profile">
                        <RiUser3Line aria-hidden />
                        <span>{t.profile}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      asChild
                      isActive={pathname === "/settings/api-keys"}
                    >
                      <Link href="/settings/api-keys">
                        <RiStore2Line aria-hidden />
                        <span>{t.studioApiSettings}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              ) : null}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

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
              onClick={() => void handleRenameSubmit()}
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
              onClick={() => void handleDeleteConfirm()}
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
    </>
  )
}

export { AppSidebar }
