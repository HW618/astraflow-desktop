"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"

import { StudioAudioWorkbench } from "@/components/studio-audio-workbench"
import { StudioChatWorkbench } from "@/components/studio-chat-workbench"
import { StudioImageWorkbench } from "@/components/studio-image-workbench"
import { StudioVideoWorkbench } from "@/components/studio-video-workbench"
import { dispatchStudioSessionsChanged } from "@/lib/studio-session-events"
import { studioModes, type StudioMode } from "@/lib/studio-types"

type StudioShellProps = {
  initialMode?: StudioMode
  initialSessionId?: string
}

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
  const [selectedMode, setSelectedMode] =
    React.useState<StudioMode>(initialMode)
  const [selectedSessionId, setSelectedSessionId] =
    React.useState(initialSessionId)

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const nextPath = getStudioPath(selectedMode, selectedSessionId)
    const currentPath = `${window.location.pathname}${window.location.search}`

    if (currentPath !== nextPath) {
      window.history.replaceState(null, "", nextPath)
    }
  }, [selectedMode, selectedSessionId])

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
