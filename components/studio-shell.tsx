"use client"

import * as React from "react"
import {
  RiChat3Line,
  RiImageLine,
  RiMicLine,
  RiSparklingLine,
  RiTimeLine,
  RiVideoLine,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"
import type { Locale } from "@/lib/i18n"

type StudioMode = "chat" | "image" | "video" | "audio"

type StudioModeDefinition = {
  id: StudioMode
  icon: RemixiconComponentType
}

type LocalizedText = Record<Locale, string>

type StudioSession = {
  id: string
  mode: StudioMode
  title: LocalizedText
  description: LocalizedText
  time: LocalizedText
}

const studioModes: StudioModeDefinition[] = [
  { id: "chat", icon: RiChat3Line },
  { id: "image", icon: RiImageLine },
  { id: "video", icon: RiVideoLine },
  { id: "audio", icon: RiMicLine },
]

const studioSessions: StudioSession[] = [
  {
    id: "chat-market-copy",
    mode: "chat",
    title: {
      en: "Model launch talking points",
      zh: "模型发布沟通要点",
    },
    description: {
      en: "8 messages · Drafting",
      zh: "8 条消息 · 草稿中",
    },
    time: {
      en: "Just now",
      zh: "刚刚",
    },
  },
  {
    id: "image-hero-visual",
    mode: "image",
    title: {
      en: "Landing hero visual",
      zh: "首页主视觉",
    },
    description: {
      en: "4 images · 16:9",
      zh: "4 张图像 · 16:9",
    },
    time: {
      en: "12 min",
      zh: "12 分钟",
    },
  },
  {
    id: "video-product-demo",
    mode: "video",
    title: {
      en: "Product demo sequence",
      zh: "产品演示分镜",
    },
    description: {
      en: "2 clips · 6 seconds",
      zh: "2 段视频 · 6 秒",
    },
    time: {
      en: "Today",
      zh: "今天",
    },
  },
  {
    id: "audio-narration",
    mode: "audio",
    title: {
      en: "Narration voiceover",
      zh: "旁白配音",
    },
    description: {
      en: "3 takes · Mandarin",
      zh: "3 个版本 · 中文",
    },
    time: {
      en: "Today",
      zh: "今天",
    },
  },
  {
    id: "chat-eval-notes",
    mode: "chat",
    title: {
      en: "Evaluation notes",
      zh: "模型评测记录",
    },
    description: {
      en: "15 messages · Comparison",
      zh: "15 条消息 · 对比分析",
    },
    time: {
      en: "Yesterday",
      zh: "昨天",
    },
  },
  {
    id: "image-icon-set",
    mode: "image",
    title: {
      en: "Feature icon set",
      zh: "功能图标组",
    },
    description: {
      en: "12 images · Transparent",
      zh: "12 张图像 · 透明底",
    },
    time: {
      en: "Yesterday",
      zh: "昨天",
    },
  },
  {
    id: "video-social-cut",
    mode: "video",
    title: {
      en: "Social teaser cut",
      zh: "社媒预告短片",
    },
    description: {
      en: "1 clip · Vertical",
      zh: "1 段视频 · 竖屏",
    },
    time: {
      en: "Jun 26",
      zh: "6月26日",
    },
  },
  {
    id: "audio-brand-sound",
    mode: "audio",
    title: {
      en: "Brand sound mark",
      zh: "品牌提示音",
    },
    description: {
      en: "5 variants · WAV",
      zh: "5 个变体 · WAV",
    },
    time: {
      en: "Jun 25",
      zh: "6月25日",
    },
  },
]

function StudioShell() {
  const { locale, t } = useI18n()
  const [selectedMode, setSelectedMode] = React.useState<StudioMode>("chat")
  const [selectedSessionId, setSelectedSessionId] = React.useState<string>(
    studioSessions[0]?.id ?? ""
  )

  const selectedSession = studioSessions.find(
    (session) => session.id === selectedSessionId
  )
  const activeMode = selectedSession?.mode ?? selectedMode

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
      <aside className="flex w-full min-w-0 flex-col border-r bg-sidebar text-sidebar-foreground md:w-[344px] md:shrink-0">
        <div className="flex shrink-0 flex-col gap-5 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t.studioTitle}
              </p>
              <h1 className="truncate font-heading text-2xl font-semibold">
                {t.studioModes}
              </h1>
            </div>
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <RiSparklingLine aria-hidden />
            </div>
          </div>

          <nav aria-label={t.studioModes} className="flex flex-col gap-1">
            {studioModes.map((mode) => {
              const Icon = mode.icon
              const isActive = mode.id === activeMode

              return (
                <Button
                  key={mode.id}
                  type="button"
                  variant={isActive ? "secondary" : "ghost"}
                  className="h-11 justify-start px-3 text-base"
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

        <div className="flex min-h-0 flex-1 flex-col border-t">
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">
                {t.studioSessions}
              </h2>
              <p className="truncate text-sm text-muted-foreground">
                {t.studioRecent}
              </p>
            </div>
            <Badge variant="secondary">{studioSessions.length}</Badge>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            <div className="flex flex-col gap-1">
              {studioSessions.map((session) => {
                const mode = studioModes.find(
                  (item) => item.id === session.mode
                )
                const Icon = mode?.icon ?? RiChat3Line
                const isActive = session.id === selectedSessionId

                return (
                  <button
                    key={session.id}
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      isActive &&
                        "bg-sidebar-accent text-sidebar-accent-foreground"
                    )}
                    onClick={() => {
                      setSelectedSessionId(session.id)
                      setSelectedMode(session.mode)
                    }}
                  >
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
                      <Icon aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {session.title[locale]}
                        </span>
                        <Badge
                          variant={isActive ? "default" : "outline"}
                          className="shrink-0"
                        >
                          {getModeLabel(session.mode)}
                        </Badge>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {session.description[locale]}
                      </span>
                    </span>
                    <span className="mt-1 shrink-0 text-xs text-muted-foreground">
                      {session.time[locale]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </aside>

      <section className="hidden min-w-0 flex-1 flex-col md:flex">
        <div className="flex h-full min-h-0 items-center justify-center px-10">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <RiTimeLine aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-2xl font-semibold">
                {selectedSession?.title[locale] ?? t.studioWorkspace}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t.studioWorkspaceHint}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export { StudioShell }
