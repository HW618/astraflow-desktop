"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArrowUpLine,
  RiCloseLine,
  RiFileCopyLine,
  RiStopFill,
  RiThumbDownLine,
  RiThumbUpLine,
} from "@remixicon/react"

import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ui/message"
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { TextShimmer } from "@/components/ui/text-shimmer"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL,
  type SupportedChatModel,
} from "@/lib/chat-models"
import type {
  StudioAttachment,
  StudioMessage,
  StudioSession,
} from "@/lib/studio-types"
import { cn } from "@/lib/utils"

type StudioChatWorkbenchProps = {
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

type PendingAttachment = StudioAttachment & { id: string }

const MAX_ATTACHMENTS = 6
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
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

const CHAT_MODEL_STORAGE_KEY = "astraflow:chat-model"

const chatModelListeners = new Set<() => void>()

function getStoredChatModel(): SupportedChatModel {
  if (typeof window === "undefined") {
    return DEFAULT_CHAT_MODEL
  }

  const stored = window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY)

  if (stored && CHAT_MODEL_OPTIONS.some((option) => option.value === stored)) {
    return stored as SupportedChatModel
  }

  return DEFAULT_CHAT_MODEL
}

function setStoredChatModel(model: SupportedChatModel) {
  window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, model)
  chatModelListeners.forEach((listener) => listener())
}

function subscribeChatModel(listener: () => void) {
  chatModelListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    chatModelListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

// Read the persisted model through an external store so SSR and the first
// client render agree (DEFAULT), then sync to localStorage after hydration
// without a mismatch warning.
function useChatModel() {
  const model = React.useSyncExternalStore(
    subscribeChatModel,
    getStoredChatModel,
    () => DEFAULT_CHAT_MODEL
  )

  return [model, setStoredChatModel] as const
}

function getChatModelLabel(model: SupportedChatModel) {
  return (
    CHAT_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model
  )
}

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
  content: string,
  attachments: StudioAttachment[] = []
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role,
      content,
      status: "complete",
      attachments,
    }),
  })

  return readJson<StudioMessage>(response)
}

async function generateSessionTitle(sessionId: string, prompt: string) {
  await fetch(`/api/studio/sessions/${sessionId}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })
}

async function streamAssistantResponse({
  sessionId,
  model,
  signal,
  onFirstChunk,
  onChunk,
}: {
  sessionId: string
  model: SupportedChatModel
  signal: AbortSignal
  onFirstChunk?: () => void
  onChunk: (content: string) => void
}) {
  const response = await fetch("/api/studio/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      model,
    }),
    signal,
  })

  if (!response.ok) {
    let message = "Request failed"

    try {
      const payload = (await response.json()) as {
        error?: string
        message?: string
      }
      message = payload.error || payload.message || message
    } catch {
      // Ignore JSON parsing failures and fall back to the generic message.
    }

    throw new Error(message)
  }

  if (!response.body) {
    throw new Error("Response body is missing.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let content = ""
  let receivedFirstChunk = false

  while (true) {
    const { value, done } = await reader.read()

    if (done) {
      break
    }

    const chunk = decoder.decode(value, { stream: true })

    if (!chunk) {
      continue
    }

    if (!receivedFirstChunk) {
      receivedFirstChunk = true
      onFirstChunk?.()
    }

    content += chunk
    onChunk(content)
  }

  content += decoder.decode()

  return content
}

function StudioChatWorkbench({
  sessionId,
  onSessionChange,
  onSessionsChange,
}: StudioChatWorkbenchProps) {
  const { t } = useI18n()
  const [input, setInput] = React.useState("")
  const [selectedModel, setSelectedModel] = useChatModel()
  const [messages, setMessages] = React.useState<StudioMessage[]>([])
  const [pendingAttachments, setPendingAttachments] = React.useState<
    PendingAttachment[]
  >([])
  const [phase, setPhase] = React.useState<ChatPhase>("idle")
  const [streamContent, setStreamContent] = React.useState("")
  const [error, setError] = React.useState("")
  const abortControllerRef = React.useRef<AbortController | null>(null)

  const isBusy = phase !== "idle"
  const hasMessages = messages.length > 0 || isBusy
  const canSubmit =
    (input.trim().length > 0 || pendingAttachments.length > 0) && !isBusy

  const addFiles = React.useCallback((files: FileList | null) => {
    if (!files || files.length === 0) {
      return
    }

    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    )

    void Promise.all(
      imageFiles
        .filter((file) => file.size <= MAX_ATTACHMENT_BYTES)
        .map(async (file) => ({
          id: crypto.randomUUID(),
          type: "image" as const,
          name: file.name,
          mimeType: file.type,
          dataUrl: await readFileAsDataUrl(file),
        }))
    ).then((next) => {
      if (next.length === 0) {
        return
      }

      setPendingAttachments((current) =>
        [...current, ...next].slice(0, MAX_ATTACHMENTS)
      )
    })
  }, [])

  const removeAttachment = React.useCallback((id: string) => {
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    )
  }, [])

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
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
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
        setPhase("idle")
        onSessionsChange()
      } catch {
        setPhase("idle")
        setError("chat-failed")
      }
    },
    [onSessionsChange]
  )

  async function handleSubmit() {
    const prompt = input.trim()
    const attachments = pendingAttachments

    if ((!prompt && attachments.length === 0) || isBusy) {
      return
    }

    setInput("")
    setPendingAttachments([])
    setError("")
    setPhase("thinking")

    const isNewSession = !sessionId

    try {
      const activeSession =
        sessionId.length > 0
          ? { id: sessionId }
          : await createSession(prompt || attachments[0]?.name || "New chat")
      const activeSessionId = activeSession.id

      if (!sessionId) {
        onSessionChange(activeSessionId)
      }

      const userMessage = await createMessage(
        activeSessionId,
        "user",
        prompt,
        attachments.map((attachment) => ({
          type: attachment.type,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
        }))
      )
      setMessages((current) => [...current, userMessage])
      setStreamContent("")
      onSessionsChange()

      if (isNewSession && prompt) {
        void generateSessionTitle(activeSessionId, prompt)
          .then(() => onSessionsChange())
          .catch(() => {
            // Keep the prompt-based fallback title on failure.
          })
      }

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      const assistantContent = await streamAssistantResponse({
        sessionId: activeSessionId,
        model: selectedModel,
        signal: abortController.signal,
        onFirstChunk() {
          setPhase("streaming")
        },
        onChunk(content) {
          setStreamContent(content)
        },
      })

      abortControllerRef.current = null

      if (assistantContent.trim()) {
        await persistAssistantMessage(activeSessionId, assistantContent)
      } else {
        setStreamContent("")
        setPhase("idle")
      }
    } catch (nextError) {
      abortControllerRef.current = null
      setStreamContent("")
      setPhase("idle")

      if (!(
        nextError instanceof DOMException && nextError.name === "AbortError"
      )) {
        setError("chat-failed")
      }
    }
  }

  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStreamContent("")
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
                <StreamingAssistantMessage content={streamContent} />
              ) : null}

              {error ? (
                <p className="text-sm text-muted-foreground">
                  {error === "chat-failed"
                    ? t.studioChatFailed
                    : t.studioLoadFailed}
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
                model={selectedModel}
                attachments={pendingAttachments}
                onModelChange={setSelectedModel}
                onValueChange={setInput}
                onAddFiles={addFiles}
                onRemoveAttachment={removeAttachment}
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
              model={selectedModel}
              attachments={pendingAttachments}
              onModelChange={setSelectedModel}
              onValueChange={setInput}
              onAddFiles={addFiles}
              onRemoveAttachment={removeAttachment}
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
  model: SupportedChatModel
  attachments: PendingAttachment[]
  onModelChange: (model: SupportedChatModel) => void
  onValueChange: (value: string) => void
  onAddFiles: (files: FileList | null) => void
  onRemoveAttachment: (id: string) => void
  onSubmit: () => void
  onStop: () => void
  canSubmit: boolean
  isBusy: boolean
}

function ChatComposer({
  value,
  model,
  attachments,
  onModelChange,
  onValueChange,
  onAddFiles,
  onRemoveAttachment,
  onSubmit,
  onStop,
  canSubmit,
  isBusy,
}: ChatComposerProps) {
  const { t } = useI18n()
  const [isTextareaFocused, setIsTextareaFocused] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const showCustomCaret = isTextareaFocused && value.length === 0

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = event.clipboardData?.files

    if (
      files &&
      files.length > 0 &&
      Array.from(files).some((file) => file.type.startsWith("image/"))
    ) {
      // Pasted an image/file (e.g. a screenshot) — attach it instead of
      // letting the textarea insert a placeholder. Plain text still pastes
      // normally because clipboardData.files is empty for text.
      event.preventDefault()
      onAddFiles(files)
    }
  }

  return (
    <PromptInput
      value={value}
      onValueChange={onValueChange}
      onSubmit={onSubmit}
      isLoading={isBusy}
      className="w-full rounded-4xl border bg-background/95 px-3.5 py-3 shadow-lg shadow-foreground/5"
    >
      {attachments.length > 0 ? (
        <div
          className="mb-2 flex flex-wrap gap-2 px-1"
          onClick={(event) => event.stopPropagation()}
        >
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group relative size-16 overflow-hidden rounded-2xl border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.dataUrl}
                alt={attachment.name}
                className="size-full object-cover"
              />
              <button
                type="button"
                aria-label={t.studioRemoveAttachment}
                className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-foreground/70 text-background opacity-0 transition group-hover:opacity-100 [&_svg]:size-3.5"
                onClick={(event) => {
                  event.stopPropagation()
                  onRemoveAttachment(attachment.id)
                }}
              >
                <RiCloseLine aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="relative min-w-0 px-1">
        {showCustomCaret ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-2 left-1 z-10 h-5 w-px animate-[studio-caret-blink_1.05s_steps(1,end)_infinite] rounded-full bg-foreground"
          />
        ) : null}

        <PromptInputTextarea
          placeholder={t.studioPromptPlaceholder}
          onFocus={() => setIsTextareaFocused(true)}
          onBlur={() => setIsTextareaFocused(false)}
          onPaste={handlePaste}
          className={cn(
            "max-h-40 min-h-9 w-full px-0 py-1.5 text-base text-foreground placeholder:text-muted-foreground md:text-base",
            showCustomCaret && "caret-transparent"
          )}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div
          className="flex items-center gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              onAddFiles(event.target.files)
              event.target.value = ""
            }}
          />
          <PromptInputAction tooltip={t.studioAttach}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isBusy}
              className="size-8 rounded-full p-0 [&_svg]:size-5"
              onClick={() => fileInputRef.current?.click()}
            >
              <RiAddLine aria-hidden />
            </Button>
          </PromptInputAction>

          <Select
            value={model}
            onValueChange={(nextValue) =>
              onModelChange(nextValue as SupportedChatModel)
            }
            disabled={isBusy}
          >
            <SelectTrigger
              size="sm"
              className="h-8 max-w-44 rounded-full bg-background px-3 text-sm"
              aria-label={t.studioChatModel}
            >
              <span>{getChatModelLabel(model)}</span>
            </SelectTrigger>
            <SelectContent position="popper" side="top" align="start">
              <SelectGroup>
                {CHAT_MODEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
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
      <Message className="justify-end">
        <div className="flex max-w-[70%] flex-col items-end gap-2">
          {message.attachments.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2">
              {message.attachments.map((attachment, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${message.id}-${index}`}
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  className="max-h-60 max-w-full rounded-2xl border object-contain"
                />
              ))}
            </div>
          ) : null}
          {message.content ? (
            <MessageContent className="rounded-full bg-foreground px-5 py-3 text-base text-background">
              {message.content}
            </MessageContent>
          ) : null}
        </div>
      </Message>
    )
  }

  return <AssistantMessage content={message.content} />
}

const markdownClassName =
  "max-w-none text-base leading-8 text-foreground [&_a]:text-primary [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_h1]:font-heading [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-medium [&_li]:my-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_pre]:my-3 [&_ul]:ml-5 [&_ul]:list-disc"

const streamingPulseDotClassName =
  "[&>*:last-child]:after:ml-1.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:size-2.5 [&>*:last-child]:after:translate-y-[1px] [&>*:last-child]:after:rounded-full [&>*:last-child]:after:bg-foreground [&>*:last-child]:after:align-middle [&>*:last-child]:after:content-[''] [&>*:last-child]:after:animate-[studio-pulse-dot_1.1s_ease-in-out_infinite]"

function StreamingAssistantMessage({ content }: { content: string }) {
  return (
    <Message className="justify-start">
      <div className="flex w-full flex-col gap-2">
        <MessageContent
          markdown
          className={cn(
            "bg-transparent p-0",
            markdownClassName,
            streamingPulseDotClassName
          )}
        >
          {content}
        </MessageContent>
      </div>
    </Message>
  )
}

function AssistantMessage({ content }: { content: string }) {
  const [liked, setLiked] = React.useState<boolean | null>(null)
  const [copied, setCopied] = React.useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Message className="justify-start">
      <div className="flex w-full flex-col gap-2">
        <MessageContent
          markdown
          className={cn("bg-transparent p-0", markdownClassName)}
        >
          {content}
        </MessageContent>
        <MessageActions className="gap-1.5">
          <MessageAction tooltip="Copy to clipboard">
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              onClick={handleCopy}
            >
              <RiFileCopyLine
                className={cn(copied && "text-emerald-500")}
                aria-hidden
              />
            </Button>
          </MessageAction>

          <MessageAction tooltip="Helpful">
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "rounded-full",
                liked === true && "bg-emerald-50 text-emerald-600"
              )}
              onClick={() => setLiked(true)}
            >
              <RiThumbUpLine aria-hidden />
            </Button>
          </MessageAction>

          <MessageAction tooltip="Not helpful">
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "rounded-full",
                liked === false && "bg-red-50 text-red-600"
              )}
              onClick={() => setLiked(false)}
            >
              <RiThumbDownLine aria-hidden />
            </Button>
          </MessageAction>
        </MessageActions>
      </div>
    </Message>
  )
}

export { StudioChatWorkbench }
