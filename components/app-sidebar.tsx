"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import {
  RiApps2Line,
  RiChat3Line,
  RiCheckLine,
  RiCodeBoxLine,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiFileListLine,
  RiImageLine,
  RiLoader4Line,
  RiLogoutBoxRLine,
  RiMicLine,
  RiMore2Line,
  RiPencilLine,
  RiPuzzleLine,
  RiQuestionLine,
  RiSettings3Line,
  RiUser3Line,
  RiVideoLine,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"
import {
  Archive,
  ArchiveRestore,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  MessageCirclePlus,
  Pin,
} from "lucide-react"
import { toast } from "sonner"

import { AppInfoButton } from "@/components/app-info-button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useI18n } from "@/components/i18n-provider"
import { requestStudioOnboardingTour } from "@/components/onboarding-tour"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { logout } from "@/components/logout-button"
import { Titlebar } from "@/components/titlebar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
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
  dispatchStudioLocalProjectsChanged,
  dispatchStudioSessionsChanged,
  STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
  STUDIO_SESSIONS_CHANGED_EVENT,
} from "@/lib/studio-session-events"
import { setPendingProjectId } from "@/lib/studio-pending-project"
import {
  studioModes,
  type StudioLocalProjectWithGitInfo,
  type StudioMode,
  type StudioSession,
} from "@/lib/studio-types"
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

type LocalProjectsResponse =
  | {
      ok: true
      data: StudioLocalProjectWithGitInfo[]
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
const CHAT_ENVIRONMENT_STORAGE_KEY = "astraflow:chat-environment"

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

function formatSessionRelativeTime(value: string) {
  const timestamp = new Date(value).getTime()

  if (!Number.isFinite(timestamp)) {
    return ""
  }

  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))

  if (diffMinutes < 1) return "now"
  if (diffMinutes < 60) return `${diffMinutes}m`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d`
  if (diffDays < 35) return `${Math.floor(diffDays / 7)}w`

  return `${Math.floor(diffDays / 30)}mo`
}

function formatProjectGitSummary(project: StudioLocalProjectWithGitInfo) {
  const changedFiles = project.git.changedFiles
  const additions = project.git.additions
  const deletions = project.git.deletions

  if (!changedFiles && !additions && !deletions) {
    return ""
  }

  const fileSummary =
    typeof changedFiles === "number" && changedFiles > 0
      ? `${changedFiles}`
      : ""
  const diffSummary =
    typeof additions === "number" && typeof deletions === "number"
      ? `+${additions} -${deletions}`
      : ""

  return [fileSummary, diffSummary].filter(Boolean).join(" · ")
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

async function fetchLocalProjects() {
  const response = await fetch("/api/studio/local-projects", {
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as LocalProjectsResponse

  if (!response.ok || !payload.ok) {
    throw new Error("Failed to load local projects")
  }

  return payload.data
}

async function fetchSidebarAccount() {
  const response = await fetch("/api/studio/projects", { cache: "no-store" })

  if (response.status === 401 || response.status === 403) {
    return null
  }

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
  onOpenSettings: (href: string) => void
}) {
  const { t } = useI18n()
  const [loggingOut, setLoggingOut] = React.useState(false)
  const displayName =
    user?.displayName || user?.userName || user?.userEmail || t.account
  const email = user?.userEmail || user?.userName || displayName

  async function handleLogout() {
    try {
      setLoggingOut(true)
      await logout()
    } catch (error) {
      console.warn("Logout request failed.", error)
    } finally {
      window.location.replace("/login")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={displayName}
          className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm transition-[background-color,color,width,height,padding] group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
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
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6}>
        <DropdownMenuLabel className="truncate py-1.5">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => onOpenSettings("/settings/profile")}
          >
            <RiUser3Line aria-hidden />
            {t.profile}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenSettings("/settings")}>
            <RiSettings3Line aria-hidden />
            {t.settings}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={loggingOut}
          onSelect={(event) => {
            event.preventDefault()
            void handleLogout()
          }}
        >
          {loggingOut ? (
            <RiLoader4Line className="animate-spin" aria-hidden />
          ) : (
            <RiLogoutBoxRLine aria-hidden />
          )}
          {t.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

async function updateStudioSessionPinnedRequest(
  sessionId: string,
  pinned: boolean
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to update session pin")
  }
}

async function updateStudioSessionArchivedRequest(
  sessionId: string,
  archived: boolean
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to update session archive state")
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

async function createLocalProjectRequest(path: string) {
  const response = await fetch("/api/studio/local-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to add project")
  }
}

async function deleteLocalProjectRequest(projectId: string) {
  const response = await fetch("/api/studio/local-projects", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: projectId }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to remove project")
  }
}

async function clearProjectPermissionRulesRequest(projectId: string) {
  const response = await fetch("/api/studio/local-projects", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: projectId, action: "clearPermissionRules" }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to clear permission rules")
  }

  const payload = (await response.json()) as
    | {
        ok: true
        data: { deleted: number }
      }
    | {
        ok: false
        error: unknown
      }

  if (!payload.ok) {
    throw new Error("Failed to clear permission rules")
  }

  return payload.data.deleted
}

async function openLocalProjectRequest(projectId: string) {
  const response = await fetch("/api/studio/local-projects/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: projectId }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to open project")
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
  const [localProjects, setLocalProjects] = React.useState<
    StudioLocalProjectWithGitInfo[]
  >([])
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = React.useState(true)
  const [projectsLoadFailed, setProjectsLoadFailed] = React.useState(false)
  const [isLoadingProjects, setIsLoadingProjects] = React.useState(true)
  const [lastSelectedProjectId, setLastSelectedProjectId] = React.useState<
    string | null
  >(null)
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<
    Set<string>
  >(() => new Set())
  const [showArchived, setShowArchived] = React.useState(false)
  const [renameTarget, setRenameTarget] = React.useState<StudioSession | null>(
    null
  )
  const [renameValue, setRenameValue] = React.useState("")
  const [renameSaving, setRenameSaving] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<StudioSession | null>(
    null
  )
  const [deleteSaving, setDeleteSaving] = React.useState(false)
  const [deleteProjectTarget, setDeleteProjectTarget] =
    React.useState<StudioLocalProjectWithGitInfo | null>(null)
  const [deleteProjectSaving, setDeleteProjectSaving] = React.useState(false)
  const [clearPermissionTarget, setClearPermissionTarget] =
    React.useState<StudioLocalProjectWithGitInfo | null>(null)
  const [clearPermissionSaving, setClearPermissionSaving] =
    React.useState(false)
  const [pathDialogOpen, setPathDialogOpen] = React.useState(false)
  const [pathInputValue, setPathInputValue] = React.useState("")
  const [pathSaving, setPathSaving] = React.useState(false)
  const [accountUser, setAccountUser] =
    React.useState<SidebarAccountUser | null>(null)
  const [isAccountLoading, setIsAccountLoading] = React.useState(true)

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

  const reloadLocalProjects = React.useCallback(async () => {
    try {
      setProjectsLoadFailed(false)
      setIsLoadingProjects(true)
      setLocalProjects(await fetchLocalProjects())
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
        return
      }

      setProjectsLoadFailed(true)
    } finally {
      setIsLoadingProjects(false)
    }
  }, [redirectToLogin])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadSessions()
    })
  }, [reloadSessions])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadLocalProjects()
    })
  }, [reloadLocalProjects])

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

  React.useEffect(() => {
    function handleLocalProjectsChanged() {
      void reloadLocalProjects()
    }

    window.addEventListener(
      STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
      handleLocalProjectsChanged
    )

    return () => {
      window.removeEventListener(
        STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
        handleLocalProjectsChanged
      )
    }
  }, [reloadLocalProjects])

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

  const openSettingsPage = React.useCallback(
    (href: string) => {
      router.push(href)
    },
    [router]
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

  async function handleToggleSessionPinned(session: StudioSession) {
    const pinned = !session.pinnedAt

    setSessions((current) =>
      current
        .map((candidate) =>
          candidate.id === session.id
            ? {
                ...candidate,
                pinnedAt: pinned ? new Date().toISOString() : null,
              }
            : candidate
        )
        .sort((a, b) => {
          if (a.pinnedAt && !b.pinnedAt) return -1
          if (!a.pinnedAt && b.pinnedAt) return 1
          return (
            new Date(b.pinnedAt ?? b.updatedAt).getTime() -
            new Date(a.pinnedAt ?? a.updatedAt).getTime()
          )
        })
    )

    try {
      await updateStudioSessionPinnedRequest(session.id, pinned)
      await reloadSessions()
      dispatchStudioSessionsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        await reloadSessions()
      }
    }
  }

  async function handleToggleSessionArchived(session: StudioSession) {
    const archived = !session.archivedAt

    setSessions((current) =>
      current.map((candidate) =>
        candidate.id === session.id
          ? {
              ...candidate,
              archivedAt: archived ? new Date().toISOString() : null,
            }
          : candidate
      )
    )

    try {
      await updateStudioSessionArchivedRequest(session.id, archived)
      await reloadSessions()
      dispatchStudioSessionsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        await reloadSessions()
      }
    }
  }

  function toggleProject(projectId: string) {
    setExpandedProjectIds((current) => {
      const next = new Set(current)

      if (next.has(projectId)) {
        next.delete(projectId)
        setLastSelectedProjectId((selected) =>
          selected === projectId ? null : selected
        )
      } else {
        next.add(projectId)
        setLastSelectedProjectId(projectId)
      }

      return next
    })
  }

  function prepareNewSession(projectId: string | null) {
    setPendingProjectId(projectId ?? null)
    window.localStorage.setItem(CHAT_ENVIRONMENT_STORAGE_KEY, "local")
    window.dispatchEvent(new Event("storage"))
    dispatchStudioSessionsChanged()
  }

  function handleNewSessionClick() {
    // Bind only when the user explicitly selected a project in the sidebar.
    prepareNewSession(lastSelectedProjectId)
  }

  const isMac = React.useMemo(() => {
    if (typeof document !== "undefined") {
      const platform = document.documentElement.dataset.astraflowPlatform

      if (platform) {
        return platform === "darwin"
      }
    }

    return (
      typeof navigator !== "undefined" &&
      /Mac|iP(hone|ad|od)/i.test(navigator.platform || navigator.userAgent)
    )
  }, [])
  const newTaskShortcutRef = React.useRef(() => {})

  React.useEffect(() => {
    newTaskShortcutRef.current = () => {
      handleNewSessionClick()
      router.push("/studio")
    }
  })

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault()
        newTaskShortcutRef.current()
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  function handleNewProjectSession(projectId: string) {
    setLastSelectedProjectId(projectId)
    setExpandedProjectIds((current) => {
      const next = new Set(current)
      next.add(projectId)
      return next
    })
    prepareNewSession(projectId)
    router.push("/studio")
  }

  function getProjectSessions(projectId: string) {
    return sessions
      .filter(
        (session) =>
          session.projectId === projectId &&
          (showArchived || !session.archivedAt)
      )
      .slice(0, 5)
  }

  function renderSessionContent(session: StudioSession) {
    return (
      <>
        {session.isRunning ? (
          <RiLoader4Line className="animate-spin text-primary" aria-hidden />
        ) : session.archivedAt ? (
          <Archive aria-hidden className="size-3.5 opacity-60" />
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            session.archivedAt && "opacity-60"
          )}
        >
          {session.title}
        </span>
      </>
    )
  }

  function renderSessionTime(session: StudioSession) {
    // Sits right of the pinned indicator (right-8); hides whenever the row
    // actions show (hover, focus, or an expanded row menu).
    return (
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-normal text-sidebar-foreground/50 transition-opacity group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0 group-has-[[aria-expanded=true]]/menu-item:opacity-0">
        {formatSessionRelativeTime(session.updatedAt)}
      </span>
    )
  }

  function renderSessionPinAction(session: StudioSession) {
    return (
      <SidebarMenuAction
        type="button"
        aria-label={session.pinnedAt ? t.studioSessionUnpin : t.studioSessionPin}
        title={session.pinnedAt ? t.studioSessionUnpin : t.studioSessionPin}
        className={cn(
          "top-1/2! right-8! -translate-y-1/2 rounded-lg",
          session.pinnedAt &&
            "text-sidebar-accent-foreground md:opacity-100"
        )}
        showOnHover
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void handleToggleSessionPinned(session)
        }}
      >
        <Pin
          aria-hidden
          className={cn(session.pinnedAt && "fill-current")}
        />
      </SidebarMenuAction>
    )
  }

  function renderSessionActions(session: StudioSession) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            aria-label={t.studioSessionActions}
            className="top-1/2! right-2! -translate-y-1/2 rounded-lg"
            showOnHover
            onClick={(event) => event.stopPropagation()}
          >
            <RiMore2Line aria-hidden />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                setRenameValue(session.title)
                setRenameTarget(session)
              }}
            >
              <RiPencilLine aria-hidden />
              {t.studioRename}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void handleToggleSessionArchived(session)}
            >
              {session.archivedAt ? (
                <ArchiveRestore aria-hidden />
              ) : (
                <Archive aria-hidden />
              )}
              {session.archivedAt ? t.studioUnarchive : t.studioArchive}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteTarget(session)}
            >
              <RiDeleteBinLine aria-hidden />
              {t.studioDelete}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function renderSessionContextMenuContent(session: StudioSession) {
    return (
      <ContextMenuContent className="w-44">
        <ContextMenuItem
          onSelect={() => {
            setRenameValue(session.title)
            setRenameTarget(session)
          }}
        >
          <RiPencilLine aria-hidden />
          {t.studioRename}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void handleToggleSessionPinned(session)}
        >
          <Pin aria-hidden className={cn(session.pinnedAt && "fill-current")} />
          {session.pinnedAt ? t.studioSessionUnpin : t.studioSessionPin}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void handleToggleSessionArchived(session)}
        >
          {session.archivedAt ? (
            <ArchiveRestore aria-hidden />
          ) : (
            <Archive aria-hidden />
          )}
          {session.archivedAt ? t.studioUnarchive : t.studioArchive}
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          onSelect={() => setDeleteTarget(session)}
        >
          <RiDeleteBinLine aria-hidden />
          {t.studioDelete}
        </ContextMenuItem>
      </ContextMenuContent>
    )
  }

  async function saveLocalProject(path: string) {
    const normalizedPath = path.trim()

    if (!normalizedPath) {
      toast.error(t.studioLocalProjectPathRequired)
      return
    }

    try {
      setPathSaving(true)
      await createLocalProjectRequest(normalizedPath)
      setPathDialogOpen(false)
      setPathInputValue("")
      toast.success(t.studioLocalProjectCreated)
      await reloadLocalProjects()
      dispatchStudioLocalProjectsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        toast.error(t.studioLocalProjectCreateFailed)
      }
    } finally {
      setPathSaving(false)
    }
  }

  async function handleAddProject() {
    if (window.astraflowDesktop?.pickFolder) {
      try {
        const path = await window.astraflowDesktop.pickFolder()

        if (path) {
          await saveLocalProject(path)
        }
      } catch {
        toast.error(t.studioLocalProjectCreateFailed)
      }
      return
    }

    setPathDialogOpen(true)
  }

  async function handleDeleteProjectConfirm() {
    const target = deleteProjectTarget

    if (!target) {
      return
    }

    try {
      setDeleteProjectSaving(true)
      await deleteLocalProjectRequest(target.id)
      setDeleteProjectTarget(null)
      toast.success(t.studioLocalProjectRemoved)
      await Promise.all([reloadLocalProjects(), reloadSessions()])
      dispatchStudioLocalProjectsChanged()
      dispatchStudioSessionsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        toast.error(t.studioLocalProjectRemoveFailed)
      }
    } finally {
      setDeleteProjectSaving(false)
    }
  }

  async function handleClearPermissionConfirm() {
    const target = clearPermissionTarget

    if (!target) {
      return
    }

    try {
      setClearPermissionSaving(true)
      const deleted = await clearProjectPermissionRulesRequest(target.id)

      setClearPermissionTarget(null)
      toast.success(t.studioPermissionClearSuccess(deleted))
      await reloadLocalProjects()
      dispatchStudioLocalProjectsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        toast.error(t.studioPermissionClearFailed)
      }
    } finally {
      setClearPermissionSaving(false)
    }
  }

  async function handleOpenProject(projectId: string) {
    try {
      await openLocalProjectRequest(projectId)
      await reloadLocalProjects()
      dispatchStudioLocalProjectsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        toast.error(t.studioLocalProjectOpenFailed)
      }
    }
  }

  const activeProjectId =
    sessions.find((session) => session.id === activeStudio.sessionId)
      ?.projectId ?? null
  const visibleSessions = showArchived
    ? sessions
    : sessions.filter((session) => !session.archivedAt)
  const unboundSessions = visibleSessions.filter(
    (session) => session.projectId === null
  )
  const sortedProjects = React.useMemo(() => {
    const latestBySessionProject = new Map<string, number>()

    for (const session of visibleSessions) {
      if (!session.projectId) {
        continue
      }

      const timestamp = new Date(session.updatedAt).getTime()

      if (
        Number.isFinite(timestamp) &&
        timestamp > (latestBySessionProject.get(session.projectId) ?? 0)
      ) {
        latestBySessionProject.set(session.projectId, timestamp)
      }
    }

    return [...localProjects].sort(
      (a, b) =>
        (latestBySessionProject.get(b.id) ?? 0) -
        (latestBySessionProject.get(a.id) ?? 0)
    )
  }, [localProjects, visibleSessions])

  function handleStartOnboarding() {
    requestStudioOnboardingTour()

    if (!pathname.startsWith("/studio")) {
      router.push("/studio")
    }
  }

  return (
    <>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="p-0">
          <Titlebar showSidebarToggle>
            <div className="contents group-data-[collapsible=icon]:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t.studioOnboardingOpen}
                title={t.studioOnboardingOpen}
                className="h-8 shrink-0 rounded-xl text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={handleStartOnboarding}
              >
                <RiQuestionLine aria-hidden />
              </Button>
              <AppInfoButton className="h-8 shrink-0 rounded-xl" />
            </div>
          </Titlebar>
        </SidebarHeader>

        <SidebarContent className="gap-0.5">
          <SidebarGroup className="py-0.5">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    className="h-8"
                    tooltip={t.studioNewTask}
                  >
                    <Link
                      href="/studio"
                      data-tour-id="studio-new-session"
                      onClick={handleNewSessionClick}
                    >
                      <MessageCirclePlus aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {t.studioNewTask}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] font-normal text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
                        {isMac ? "⌘N" : "Ctrl+N"}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    type="button"
                    className="h-8"
                    tooltip={t.studioOpenWorkspace}
                    onClick={() => void handleAddProject()}
                  >
                    <FolderPlus aria-hidden />
                    <span>{t.studioOpenWorkspace}</span>
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

          <SidebarGroup
            data-tour-id="studio-local-projects"
            className="gap-0.5 py-0.5"
          >
            <SidebarGroupLabel className="h-6">
              {t.studioTasks}
            </SidebarGroupLabel>
            <SidebarGroupAction
              type="button"
              aria-label={t.studioToggleArchived}
              title={t.studioToggleArchived}
              aria-pressed={showArchived}
              className={cn(
                "top-0.5 right-2 size-6 rounded-md border border-sidebar-border text-sidebar-foreground/70",
                showArchived &&
                  "bg-sidebar-accent text-sidebar-accent-foreground"
              )}
              onClick={() => setShowArchived((current) => !current)}
            >
              <Archive aria-hidden className="size-3.5" />
            </SidebarGroupAction>
            <SidebarGroupContent>
              {sortedProjects.length > 0 ? (
                <SidebarMenu>
                  {sortedProjects.map((project) => {
                    const isExpanded =
                      expandedProjectIds.has(project.id) ||
                      activeProjectId === project.id
                    const projectSessions = getProjectSessions(project.id)
                    const Icon = isExpanded
                      ? FolderOpen
                      : project.git.branch
                        ? FolderGit2
                        : Folder
                    const gitSummary = formatProjectGitSummary(project)

                    return (
                      <SidebarMenuItem key={project.id}>
                        <SidebarMenuButton
                          type="button"
                          isActive={
                            lastSelectedProjectId === project.id ||
                            activeProjectId === project.id
                          }
                          className="h-8 rounded-lg px-2.5 pr-14"
                          tooltip={project.name}
                          title={
                            gitSummary
                              ? `${project.path} · ${gitSummary}`
                              : project.path
                          }
                          onClick={() => toggleProject(project.id)}
                        >
                          <Icon
                            aria-hidden
                            className="text-sidebar-foreground/70"
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-sidebar-foreground/80">
                            {project.name}
                          </span>
                        </SidebarMenuButton>

                        <SidebarMenuAction
                          type="button"
                          aria-label={t.studioNewProjectSession}
                          title={t.studioNewProjectSession}
                          className="top-1.5! right-7 rounded-lg"
                          showOnHover
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            handleNewProjectSession(project.id)
                          }}
                        >
                          <MessageCirclePlus aria-hidden />
                        </SidebarMenuAction>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction
                              aria-label={t.studioSessionActions}
                              className="top-1.5! right-1.5 rounded-lg"
                              showOnHover
                              onClick={(event) => event.stopPropagation()}
                            >
                              <RiMore2Line aria-hidden />
                            </SidebarMenuAction>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="start"
                            side="right"
                            className="w-64"
                          >
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                onSelect={() =>
                                  void handleOpenProject(project.id)
                                }
                              >
                                <RiExternalLinkLine aria-hidden />
                                {t.studioLocalProjectOpen}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={project.permissionRuleCount === 0}
                                onSelect={() =>
                                  setClearPermissionTarget(project)
                                }
                              >
                                <RiCheckLine aria-hidden />
                                {t.studioPermissionClearAllowedWithCount(
                                  project.permissionRuleCount
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setDeleteProjectTarget(project)}
                              >
                                <RiDeleteBinLine aria-hidden />
                                {t.studioDelete}
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        {isExpanded ? (
                          <SidebarMenuSub className="mx-3.5 mt-0.5 border-none px-1.5 py-0.5">
                            {projectSessions.length > 0 ? (
                              projectSessions.map((session) => (
                                <ContextMenu key={session.id}>
                                  <ContextMenuTrigger asChild>
                                    <SidebarMenuSubItem className="group/menu-item relative">
                                      <SidebarMenuSubButton
                                        asChild
                                        isActive={
                                          activeStudio.sessionId === session.id
                                        }
                                        className="pr-14"
                                      >
                                        <Link
                                          href={getStudioSessionHref(session)}
                                        >
                                          {renderSessionContent(session)}
                                        </Link>
                                      </SidebarMenuSubButton>
                                      {renderSessionTime(session)}
                                      {renderSessionPinAction(session)}
                                      {renderSessionActions(session)}
                                    </SidebarMenuSubItem>
                                  </ContextMenuTrigger>
                                  {renderSessionContextMenuContent(session)}
                                </ContextMenu>
                              ))
                            ) : (
                              <SidebarMenuSubItem>
                                <p className="px-3 py-1 text-xs text-muted-foreground">
                                  {t.studioLocalProjectNoSessions}
                                </p>
                              </SidebarMenuSubItem>
                            )}
                          </SidebarMenuSub>
                        ) : null}
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              ) : (
                <p className="px-3 py-1 text-sm text-muted-foreground">
                  {projectsLoadFailed
                    ? t.studioLocalProjectLoadFailed
                    : isLoadingProjects
                      ? t.studioThinking
                      : t.studioLocalProjectEmpty}
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="min-h-0 flex-1 py-0.5">
            <SidebarGroupLabel className="h-6">
              {t.studioSessions}
            </SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0">
              {unboundSessions.length > 0 ? (
                <SidebarMenu>
                  {unboundSessions.map((session) => {
                    const isActive = activeStudio.sessionId === session.id

                    return (
                      <ContextMenu key={session.id}>
                        <ContextMenuTrigger asChild>
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              asChild
                              isActive={isActive}
                              className="h-8 pr-14"
                              tooltip={session.title}
                            >
                              <Link href={getStudioSessionHref(session)}>
                                {renderSessionContent(session)}
                              </Link>
                            </SidebarMenuButton>

                            {renderSessionTime(session)}
                            {renderSessionPinAction(session)}
                            {renderSessionActions(session)}
                          </SidebarMenuItem>
                        </ContextMenuTrigger>
                        {renderSessionContextMenuContent(session)}
                      </ContextMenu>
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
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1">
              <SidebarAccountMenu
                user={accountUser}
                loading={isAccountLoading}
                onOpenSettings={openSettingsPage}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.settings}
              title={t.settings}
              className="size-8 shrink-0 rounded-xl text-sidebar-foreground/75 group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => openSettingsPage("/settings")}
            >
              <RiSettings3Line aria-hidden />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <Dialog
        open={pathDialogOpen}
        onOpenChange={(open) => {
          setPathDialogOpen(open)

          if (!open) {
            setPathInputValue("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioLocalProjectAddTitle}</DialogTitle>
            <DialogDescription>
              {t.studioLocalProjectAddDescription}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={pathInputValue}
            placeholder={t.studioLocalProjectPathPlaceholder}
            onChange={(event) => setPathInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void saveLocalProject(pathInputValue)
              }
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPathDialogOpen(false)
                setPathInputValue("")
              }}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              onClick={() => void saveLocalProject(pathInputValue)}
              disabled={pathSaving || pathInputValue.trim().length === 0}
            >
              {pathSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiCheckLine aria-hidden />
              )}
              <span>{t.studioLocalProjectAdd}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteProjectTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteProjectTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioLocalProjectRemoveTitle}</DialogTitle>
            <DialogDescription>
              {t.studioLocalProjectRemoveConfirm}
            </DialogDescription>
          </DialogHeader>
          {deleteProjectTarget ? (
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium text-foreground">
                {deleteProjectTarget.name}
              </p>
              <p className="truncate text-muted-foreground">
                {deleteProjectTarget.path}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteProjectTarget(null)}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteProjectConfirm()}
              disabled={deleteProjectSaving}
            >
              {deleteProjectSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiDeleteBinLine aria-hidden />
              )}
              <span>{t.studioDelete}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={clearPermissionTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setClearPermissionTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioPermissionClearTitle}</DialogTitle>
            <DialogDescription>
              {clearPermissionTarget
                ? t.studioPermissionClearConfirm(
                    clearPermissionTarget.name,
                    clearPermissionTarget.permissionRuleCount
                  )
                : t.studioPermissionClearAllowed}
            </DialogDescription>
          </DialogHeader>
          {clearPermissionTarget ? (
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium text-foreground">
                {clearPermissionTarget.name}
              </p>
              <p className="truncate text-muted-foreground">
                {clearPermissionTarget.path}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearPermissionTarget(null)}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleClearPermissionConfirm()}
              disabled={clearPermissionSaving}
            >
              {clearPermissionSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiDeleteBinLine aria-hidden />
              )}
              <span>{t.studioPermissionClearAllowed}</span>
            </Button>
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
