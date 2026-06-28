"use client"

import * as React from "react"
import { RiAddLine, RiArrowUpLine, RiStopFill } from "@remixicon/react"

import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container"
import { Markdown } from "@/components/ui/markdown"
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input"
import { TextShimmer } from "@/components/ui/text-shimmer"
import { Button } from "@/components/ui/button"
import { useTextStream } from "@/components/ui/response-stream"
import { useI18n } from "@/components/i18n-provider"
import type { Locale } from "@/lib/i18n"
import type { StudioMessage, StudioSession } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

type StudioChatWorkbenchProps = {
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

type ApiResponse<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: unknown
    }

type ChatPhase = "idle" | "thinking" | "streaming"

const mockDelayMs = 650

async function readJson<T>(response: Response) {
  const data = (await response.json()) as ApiResponse<T>

  if (!response.ok || !data.ok) {
    throw new Error("Request failed")
  }

  return data.data
}

async function createSession(title: string) {
  const response = await fetch("/api/studio/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "chat",
      title,
    }),
  })

  return readJson<StudioSession>(response)
}

async function listMessages(sessionId: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}/messages`)

  return readJson<StudioMessage[]>(response)
}

async function createMessage(
  sessionId: string,
  role: StudioMessage["role"],
  content: string
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role,
      content,
      status: "complete",
    }),
  })

  return readJson<StudioMessage>(response)
}

function createMockMarkdown(prompt: string, locale: Locale) {
  if (locale === "zh") {
    return `可以。下面是一个围绕「${prompt}」的初步计划：\n\n## 建议安排\n\n1. **先明确目标**：把今天最重要的一件事写下来，避免任务列表太散。\n2. **拆成 3 个阶段**：准备、执行、复盘，每个阶段只保留必要动作。\n3. **预留缓冲**：给不确定任务留 20% 的时间，避免后面连锁延迟。\n\n### 今天可以先做\n\n- 梳理输入材料和约束\n- 产出第一版可验证结果\n- 记录下一步需要补齐的信息\n\n如果你愿意，我可以继续把它整理成更具体的时间表。`
  }

  return `Absolutely. Here is a lightweight plan for "${prompt}":\n\n## Suggested Flow\n\n1. **Clarify the goal**: name the one result that would make today feel successful.\n2. **Split the work into three phases**: prepare, execute, review.\n3. **Keep a buffer**: reserve 20% of the schedule for unknowns.\n\n### Start Here\n\n- Gather the key inputs and constraints\n- Produce a first testable version\n- Note what information is still missing\n\nI can turn this into a more concrete schedule next.`
}

function StudioChatWorkbench({
  sessionId,
  onSessionChange,
  onSessionsChange,
}: StudioChatWorkbenchProps) {
  const { locale, t } = useI18n()
  const [input, setInput] = React.useState("")
  const [messages, setMessages] = React.useState<StudioMessage[]>([])
  const [phase, setPhase] = React.useState<ChatPhase>("idle")
  const [streamContent, setStreamContent] = React.useState("")
  const [streamSessionId, setStreamSessionId] = React.useState("")
  const [error, setError] = React.useState("")
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const isBusy = phase !== "idle"
  const hasMessages = messages.length > 0 || isBusy
  const canSubmit = input.trim().length > 0 && !isBusy

  React.useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => (sessionId ? listMessages(sessionId) : []))
      .then((nextMessages) => {
        if (!cancelled) {
          setMessages(nextMessages)
          setError("")
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("load-failed")
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const persistAssistantMessage = React.useCallback(
    async (activeSessionId: string, content: string) => {
      try {
        const savedMessage = await createMessage(
          activeSessionId,
          "assistant",
          content
        )
        setMessages((current) => [...current, savedMessage])
        setStreamContent("")
        setStreamSessionId("")
        setPhase("idle")
        onSessionsChange()
      } catch {
        setPhase("idle")
        setError("save-failed")
      }
    },
    [onSessionsChange]
  )

  async function handleSubmit() {
    const prompt = input.trim()

    if (!prompt || isBusy) {
      return
    }

    setInput("")
    setError("")
    setPhase("thinking")

    try {
      const activeSession =
        sessionId.length > 0 ? { id: sessionId } : await createSession(prompt)
      const activeSessionId = activeSession.id

      if (!sessionId) {
        onSessionChange(activeSessionId)
      }

      const userMessage = await createMessage(activeSessionId, "user", prompt)
      setMessages((current) => [...current, userMessage])
      setStreamSessionId(activeSessionId)
      onSessionsChange()

      timeoutRef.current = setTimeout(() => {
        setStreamContent(createMockMarkdown(prompt, locale))
        setPhase("streaming")
      }, mockDelayMs)
    } catch {
      setPhase("idle")
      setError("save-failed")
    }
  }

  function handleStop() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setStreamContent("")
    setStreamSessionId("")
    setPhase("idle")
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1">
        {hasMessages ? (
          <ChatContainerRoot className="h-full min-h-0">
            <ChatContainerContent className="mx-auto flex min-h-full w-full max-w-5xl gap-6 px-8 py-10">
              {messages.map((message) => (
                <ChatMessageBubble key={message.id} message={message} />
              ))}

              {phase === "thinking" ? (
                <div className="flex w-full justify-start">
                  <TextShimmer className="text-sm" duration={2}>
                    {t.studioThinking}
                  </TextShimmer>
                </div>
              ) : null}

              {phase === "streaming" && streamContent ? (
                <StreamingAssistantMessage
                  content={streamContent}
                  onComplete={() => {
                    if (streamSessionId) {
                      void persistAssistantMessage(
                        streamSessionId,
                        streamContent
                      )
                    }
                  }}
                />
              ) : null}

              {error ? (
                <p className="text-sm text-muted-foreground">
                  {t.studioLoadFailed}
                </p>
              ) : null}

              <ChatContainerScrollAnchor />
            </ChatContainerContent>
          </ChatContainerRoot>
        ) : (
          <div className="flex h-full items-center justify-center px-8 pb-24">
            <div className="flex w-full max-w-3xl flex-col items-center gap-6">
              <h1 className="font-heading text-2xl font-semibold">
                {t.studioChatGreeting}
              </h1>
              <ChatComposer
                value={input}
                onValueChange={setInput}
                onSubmit={handleSubmit}
                onStop={handleStop}
                canSubmit={canSubmit}
                isBusy={isBusy}
              />
            </div>
          </div>
        )}
      </div>

      {hasMessages ? (
        <div className="shrink-0 px-8 pb-5">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
            <ChatComposer
              value={input}
              onValueChange={setInput}
              onSubmit={handleSubmit}
              onStop={handleStop}
              canSubmit={canSubmit}
              isBusy={isBusy}
            />
            <p className="text-center text-xs text-muted-foreground">
              {t.studioDisclaimer}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}

type ChatComposerProps = {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  canSubmit: boolean
  isBusy: boolean
}

function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  canSubmit,
  isBusy,
}: ChatComposerProps) {
  const { t } = useI18n()
  const [isTextareaFocused, setIsTextareaFocused] = React.useState(false)
  const showCustomCaret = isTextareaFocused && value.length === 0

  return (
    <PromptInput
      value={value}
      onValueChange={onValueChange}
      onSubmit={onSubmit}
      isLoading={isBusy}
      className="w-full rounded-4xl border bg-background/95 p-2 shadow-lg shadow-foreground/5"
    >
      <div className="flex items-center gap-2">
        <PromptInputAction tooltip={t.studioAttach}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 rounded-full p-0 [&_svg]:size-5"
          >
            <RiAddLine aria-hidden />
          </Button>
        </PromptInputAction>

        <div className="relative min-w-0 flex-1">
          {showCustomCaret ? (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-0 z-10 h-5 w-px -translate-y-1/2 animate-[studio-caret-blink_1.05s_steps(1,end)_infinite] rounded-full bg-foreground"
            />
          ) : null}

          <PromptInputTextarea
            placeholder={t.studioPromptPlaceholder}
            onFocus={() => setIsTextareaFocused(true)}
            onBlur={() => setIsTextareaFocused(false)}
            className={cn(
              "max-h-40 min-h-9 flex-1 px-0 py-1.5 text-base text-foreground placeholder:text-muted-foreground md:text-base",
              showCustomCaret && "caret-transparent"
            )}
          />
        </div>

        <PromptInputActions className="shrink-0">
          <Button
            type="button"
            size="icon-sm"
            className="size-8 rounded-full bg-foreground p-0 text-background hover:bg-foreground/85 [&_svg]:size-4"
            disabled={!canSubmit && !isBusy}
            aria-label={isBusy ? t.studioStop : t.studioSend}
            onClick={(event) => {
              event.stopPropagation()
              if (isBusy) {
                onStop()
              } else {
                onSubmit()
              }
            }}
          >
            {isBusy ? (
              <RiStopFill aria-hidden />
            ) : (
              <RiArrowUpLine aria-hidden />
            )}
          </Button>
        </PromptInputActions>
      </div>
    </PromptInput>
  )
}

function ChatMessageBubble({ message }: { message: StudioMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[70%] rounded-full bg-foreground px-5 py-3 text-sm text-background">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full justify-start">
      <Markdown className={markdownClassName}>{message.content}</Markdown>
    </div>
  )
}

const markdownClassName =
  "max-w-[78ch] text-sm leading-7 text-foreground [&_a]:text-primary [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_h1]:font-heading [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-medium [&_li]:my-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_pre]:my-3 [&_ul]:ml-5 [&_ul]:list-disc"

function StreamingAssistantMessage({
  content,
  onComplete,
}: {
  content: string
  onComplete: () => void
}) {
  const completedRef = React.useRef(false)
  const { displayedText, isComplete } = useTextStream({
    textStream: content,
    speed: 78,
    characterChunkSize: 3,
  })

  React.useEffect(() => {
    if (isComplete && !completedRef.current) {
      completedRef.current = true
      onComplete()
    }
  }, [isComplete, onComplete])

  return (
    <div className="flex w-full justify-start">
      <Markdown className={markdownClassName}>{displayedText}</Markdown>
    </div>
  )
}

export { StudioChatWorkbench }
