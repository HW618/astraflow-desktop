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
  RiFileCopyLine,
  RiFolderLine,
  RiImageLine,
  RiLoader4Line,
  RiMicLine,
  RiMore2Line,
  RiPencilLine,
  RiPuzzleLine,
  RiSettings3Line,
  RiUser3Line,
  RiVideoLine,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"
import { toast } from "sonner"

import {
  AccountSettingsDialog,
  type SettingsDialogSection,
} from "@/components/account-settings-dialog"
import { AppInfoButton } from "@/components/app-info-button"
import { AstraFlowLogo } from "@/components/astraflow-logo"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { LogoutButton } from "@/components/logout-button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
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

type SidebarAccountUser = {
  userName: string
  displayName: string
  companyName: string
  userEmail: string
  companyId: number | null
}

type SidebarProjectsResponse =
  | {
      ok: true
      data: {
        user: SidebarAccountUser | null
      }
    }
  | {
      ok: false
      message?: string
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

async function fetchSidebarAccount() {
  const response = await fetch("/api/studio/projects", { cache: "no-store" })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SidebarProjectsResponse

  if (!response.ok || !payload.ok) {
    throw new Error("Failed to load account")
  }

  return payload.data.user
}

function getInitials(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return "AF"
  }

  return normalized.slice(0, 2).toUpperCase()
}

function SidebarAccountMenu({
  user,
  loading,
  onOpenSettings,
}: {
  user: SidebarAccountUser | null
  loading: boolean
  onOpenSettings: (section: SettingsDialogSection) => void
}) {
  const { locale, t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const copy =
    locale === "zh"
      ? {
          personalAccount: "个人账户",
          copyAccount: "复制账户信息",
          copied: "已复制账户信息。",
          copyFailed: "复制失败。",
        }
      : {
          personalAccount: "Personal account",
          copyAccount: "Copy account info",
          copied: "Account info copied.",
          copyFailed: "Copy failed.",
        }
  const displayName =
    user?.displayName || user?.userName || user?.userEmail || t.account
  const email = user?.userEmail || user?.userName || displayName

  function openSettings(section: SettingsDialogSection) {
    setOpen(false)
    onOpenSettings(section)
  }

  async function copyAccountInfo() {
    try {
      await window.navigator.clipboard.writeText(
        [displayName, email].filter(Boolean).join(" ")
      )
      toast.success(copy.copied)
    } catch {
      toast.error(copy.copyFailed)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={displayName}
          className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm transition-[background-color,color,width,height,padding] group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {loading ? "..." : getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate font-medium">{displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {email}
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="right"
        className="w-[21.5rem] gap-2 rounded-3xl p-3"
      >
        <div className="flex min-w-0 items-start justify-between gap-3 px-2 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback className="bg-primary text-primary-foreground">
                {loading ? "..." : getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">
                {displayName}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {email}
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={copy.copyAccount}
            title={copy.copyAccount}
            onClick={() => void copyAccountInfo()}
          >
            <RiFileCopyLine />
          </Button>
        </div>

        <div className="mx-2 rounded-2xl bg-primary/10 px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground">
            {copy.personalAccount}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-primary">
            {displayName}
          </div>
        </div>

        <div className="my-1 border-t" />
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start rounded-2xl"
          onClick={() => openSettings("account")}
        >
          <RiUser3Line data-icon="inline-start" />
          {t.profile}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start rounded-2xl"
          onClick={() => openSettings("account")}
        >
          <RiFolderLine data-icon="inline-start" />
          {t.project}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start rounded-2xl"
          onClick={() => openSettings("system")}
        >
          <RiSettings3Line data-icon="inline-start" />
          {t.settings}
        </Button>
        <div className="flex items-center justify-between rounded-2xl px-3 py-2">
          <span className="text-sm font-medium text-muted-foreground">
            {t.appInfo}
          </span>
          <AppInfoButton className="h-8 rounded-xl" />
        </div>
        <div className="my-1 border-t" />
        <LogoutButton className="w-full justify-start rounded-2xl" />
      </PopoverContent>
    </Popover>
  )
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
  const [accountUser, setAccountUser] =
    React.useState<SidebarAccountUser | null>(null)
  const [isAccountLoading, setIsAccountLoading] = React.useState(true)
  const [settingsDialogOpen, setSettingsDialogOpen] = React.useState(false)
  const [settingsDialogSection, setSettingsDialogSection] =
    React.useState<SettingsDialogSection>("account")

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

  const loadAccount = React.useCallback(async () => {
    try {
      setIsAccountLoading(true)
      setAccountUser(await fetchSidebarAccount())
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        setAccountUser(null)
      }
    } finally {
      setIsAccountLoading(false)
    }
  }, [redirectToLogin])

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadAccount()
    })
  }, [loadAccount])

  const openSettingsDialog = React.useCallback(
    (section: SettingsDialogSection) => {
      setSettingsDialogSection(section)
      setSettingsDialogOpen(true)
    },
    []
  )

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

  return (
    <>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-3 pt-0.5">
            <Link
              href="/studio"
              aria-label="AstraFlow"
              className="flex min-w-0 flex-1 items-center overflow-hidden"
            >
              <AstraFlowLogo className="h-7 shrink-0" fetchPriority="high" />
            </Link>
            <AppInfoButton className="h-8 shrink-0 rounded-xl group-data-[collapsible=icon]:hidden" />
          </div>
        </SidebarHeader>

        <SidebarContent className="gap-0.5">
          <SidebarGroup className="py-0.5">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    className="h-8"
                    tooltip={t.studioNewSession}
                  >
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
                        className="h-8"
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

          <SidebarGroup className="py-0.5">
            <SidebarGroupLabel className="h-6">{t.studio}</SidebarGroupLabel>
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
                        className="h-8"
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

          <SidebarGroup className="min-h-0 flex-1 py-0.5">
            <SidebarGroupLabel className="h-6">
              {t.studioSessions}
            </SidebarGroupLabel>
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
                          className="h-8"
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
                <p className="px-3 py-1 text-sm text-muted-foreground">
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

        <SidebarFooter className="gap-1.5 p-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <SidebarAccountMenu
                user={accountUser}
                loading={isAccountLoading}
                onOpenSettings={openSettingsDialog}
              />
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>

      {settingsDialogOpen ? (
        <AccountSettingsDialog
          open={settingsDialogOpen}
          defaultSection={settingsDialogSection}
          user={accountUser}
          loading={isAccountLoading}
          onOpenChange={setSettingsDialogOpen}
        />
      ) : null}

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
