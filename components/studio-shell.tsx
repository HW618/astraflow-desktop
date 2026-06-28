"use client"

import * as React from "react"
import {
  RiAddLine,
  RiChat3Line,
  RiImageLine,
  RiMicLine,
  RiVideoLine,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { StudioChatWorkbench } from "@/components/studio-chat-workbench"
import { cn } from "@/lib/utils"
import type { StudioMode, StudioSession } from "@/lib/studio-types"

type SessionsResponse =
  | {
      ok: true
      data: StudioSession[]
    }
  | {
      ok: false
      error: unknown
    }

type StudioModeDefinition = {
  id: StudioMode
  icon: RemixiconComponentType
}

type SessionGroupKey = "today" | "yesterday" | "last-7-days" | "earlier"

const studioModes: StudioModeDefinition[] = [
  { id: "chat", icon: RiChat3Line },
  { id: "image", icon: RiImageLine },
  { id: "video", icon: RiVideoLine },
  { id: "audio", icon: RiMicLine },
]

async function fetchStudioSessions() {
  const response = await fetch("/api/studio/sessions")
  const payload = (await response.json()) as SessionsResponse

  if (!response.ok || !payload.ok) {
    throw new Error("Failed to load sessions")
  }

  return payload.data
}

function getStartOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function getSessionGroupKey(value: string): SessionGroupKey {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "earlier"
  }

  const now = getStartOfDay(new Date())
  const sessionDate = getStartOfDay(date)
  const diffInDays = Math.floor(
    (now.getTime() - sessionDate.getTime()) / 86_400_000
  )

  if (diffInDays <= 0) {
    return "today"
  }

  if (diffInDays === 1) {
    return "yesterday"
  }

  if (diffInDays <= 7) {
    return "last-7-days"
  }

  return "earlier"
}

function StudioShell() {
  const { t } = useI18n()
  const [selectedMode, setSelectedMode] = React.useState<StudioMode>("chat")
  const [selectedSessionId, setSelectedSessionId] = React.useState("")
  const [sessions, setSessions] = React.useState<StudioSession[]>([])
  const [loadFailed, setLoadFailed] = React.useState(false)

  const selectedSession = sessions.find(
    (session) => session.id === selectedSessionId
  )
  const activeMode = selectedSession?.mode ?? selectedMode
  const groupedSessions = React.useMemo(() => {
    const groups: Record<SessionGroupKey, StudioSession[]> = {
      today: [],
      yesterday: [],
      "last-7-days": [],
      earlier: [],
    }

    for (const session of sessions) {
      groups[getSessionGroupKey(session.updatedAt)].push(session)
    }

    return [
      { key: "today", label: t.studioHistoryToday, sessions: groups.today },
      {
        key: "yesterday",
        label: t.studioHistoryYesterday,
        sessions: groups.yesterday,
      },
      {
        key: "last-7-days",
        label: t.studioHistoryLast7Days,
        sessions: groups["last-7-days"],
      },
      {
        key: "earlier",
        label: t.studioHistoryEarlier,
        sessions: groups.earlier,
      },
    ].filter((group) => group.sessions.length > 0)
  }, [sessions, t])

  const reloadSessions = React.useCallback(async () => {
    try {
      setLoadFailed(false)
      setSessions(await fetchStudioSessions())
    } catch {
      setLoadFailed(true)
    }
  }, [])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadSessions()
    })
  }, [reloadSessions])

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
      <aside className="flex w-full min-w-0 flex-col border-r bg-sidebar p-2 text-sidebar-foreground md:w-[168px] md:shrink-0 lg:w-[180px]">
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

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pt-1">
          {groupedSessions.length > 0 ? (
            <div className="flex flex-col gap-2">
              {groupedSessions.map((group) => (
                <section
                  key={group.key}
                  className="flex min-w-0 flex-col gap-1"
                >
                  <div className="flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70">
                    {group.label}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    {group.sessions.map((session) => {
                      const isActive = session.id === selectedSessionId

                      return (
                        <button
                          key={session.id}
                          type="button"
                          className={cn(
                            "flex h-8 w-full items-center overflow-hidden rounded-md px-2 text-left text-sm transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                            isActive &&
                              "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          )}
                          onClick={() => {
                            setSelectedSessionId(session.id)
                            setSelectedMode(session.mode)
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {session.title}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              {loadFailed ? t.studioLoadFailed : t.studioNoSessions}
            </p>
          )}
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
    </main>
  )
}

export { StudioShell }
