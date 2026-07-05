"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { dispatchStudioSessionsChanged } from "@/lib/studio-session-events"
import { studioModes, type StudioMode } from "@/lib/studio-types"

type StudioShellProps = {
  initialMode?: StudioMode
  initialSessionId?: string
}

type StudioWorkbenchProps = {
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

function StudioWorkbenchLoading() {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center">
      <div
        aria-hidden
        className="size-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/70"
      />
    </div>
  )
}

const StudioChatWorkbench = dynamic<StudioWorkbenchProps>(
  () =>
    import("@/components/studio-chat-workbench").then(
      (mod) => mod.StudioChatWorkbench
    ),
  { loading: StudioWorkbenchLoading }
)

const StudioImageWorkbench = dynamic<StudioWorkbenchProps>(
  () =>
    import("@/components/studio-image-workbench").then(
      (mod) => mod.StudioImageWorkbench
    ),
  { loading: StudioWorkbenchLoading }
)

const StudioVideoWorkbench = dynamic<StudioWorkbenchProps>(
  () =>
    import("@/components/studio-video-workbench").then(
      (mod) => mod.StudioVideoWorkbench
    ),
  { loading: StudioWorkbenchLoading }
)

const StudioAudioWorkbench = dynamic<StudioWorkbenchProps>(
  () =>
    import("@/components/studio-audio-workbench").then(
      (mod) => mod.StudioAudioWorkbench
    ),
  { loading: StudioWorkbenchLoading }
)

function isStudioMode(value: unknown): value is StudioMode {
  return typeof value === "string" && studioModes.includes(value as StudioMode)
}

function getStudioPath(mode: StudioMode, sessionId: string) {
  if (sessionId) {
    return `/studio/${mode}/${encodeURIComponent(sessionId)}`
  }

  return mode === "chat" ? "/studio" : `/studio?mode=${mode}`
}

function StudioShell({
  initialMode = "chat",
  initialSessionId = "",
}: StudioShellProps = {}) {
  const searchParams = useSearchParams()
  const requestedMode = searchParams.get("mode")
  const routeMode = initialSessionId
    ? initialMode
    : isStudioMode(requestedMode)
      ? requestedMode
      : "chat"

  return (
    <StudioShellInner
      key={`${routeMode}:${initialSessionId}`}
      initialMode={routeMode}
      initialSessionId={initialSessionId}
    />
  )
}

function StudioShellInner({
  initialMode,
  initialSessionId,
}: {
  initialMode: StudioMode
  initialSessionId: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedMode, setSelectedMode] =
    React.useState<StudioMode>(initialMode)
  const [selectedSessionId, setSelectedSessionId] =
    React.useState(initialSessionId)

  React.useEffect(() => {
    const nextPath = getStudioPath(selectedMode, selectedSessionId)
    const currentSearch = searchParams.toString()
    const currentPath = currentSearch ? `${pathname}?${currentSearch}` : pathname

    if (currentPath !== nextPath) {
      router.replace(nextPath, { scroll: false })
    }
  }, [pathname, router, searchParams, selectedMode, selectedSessionId])

  const handleSessionChange = React.useCallback(
    (mode: StudioMode, nextSessionId: string) => {
      setSelectedMode(mode)
      setSelectedSessionId(nextSessionId)
      dispatchStudioSessionsChanged()
    },
    []
  )

  return (
    <main className="flex h-full min-h-0 w-full flex-1 overflow-hidden bg-background">
      {selectedMode === "chat" ? (
        <StudioChatWorkbench
          sessionId={selectedSessionId}
          onSessionChange={(nextSessionId) =>
            handleSessionChange("chat", nextSessionId)
          }
          onSessionsChange={dispatchStudioSessionsChanged}
        />
      ) : selectedMode === "image" ? (
        <StudioImageWorkbench
          sessionId={selectedSessionId}
          onSessionChange={(nextSessionId) =>
            handleSessionChange("image", nextSessionId)
          }
          onSessionsChange={dispatchStudioSessionsChanged}
        />
      ) : selectedMode === "video" ? (
        <StudioVideoWorkbench
          sessionId={selectedSessionId}
          onSessionChange={(nextSessionId) =>
            handleSessionChange("video", nextSessionId)
          }
          onSessionsChange={dispatchStudioSessionsChanged}
        />
      ) : (
        <StudioAudioWorkbench
          sessionId={selectedSessionId}
          onSessionChange={(nextSessionId) =>
            handleSessionChange("audio", nextSessionId)
          }
          onSessionsChange={dispatchStudioSessionsChanged}
        />
      )}
    </main>
  )
}

export { StudioShell }
