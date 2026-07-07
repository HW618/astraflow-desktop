"use client"

import Image from "next/image"
import * as React from "react"
import {
  RiArrowDownSLine,
  RiBookOpenLine,
  RiCheckLine,
  RiCloseLine,
  RiCodeLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiExternalLinkLine,
  RiEyeLine,
  RiFileAddLine,
  RiFileEditLine,
  RiFileTextLine,
  RiFolderOpenLine,
  RiGlobalLine,
  RiImageLine,
  RiQuestionLine,
  RiRobot2Line,
  RiSaveLine,
  RiSearchLine,
  RiSparklingLine,
  RiTerminalLine,
  RiVideoLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { Shimmer } from "@/components/ai-elements/shimmer"
import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "@/components/prompt-kit/code-block"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/prompt-kit/reasoning"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from "@/components/ui/chain-of-thought"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { MessageContent } from "@/components/ui/message"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useI18n } from "@/components/i18n-provider"
import { getMcpToolDisplayName, isMcpToolName } from "@/lib/mcp"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import type {
  StudioMessageActivity,
  StudioMessagePart,
  StudioPermissionOption,
  StudioUserInputAnswer,
  StudioUserInputOption,
} from "@/lib/studio-types"
import { cn } from "@/lib/utils"

type StudioPermissionPart = Extract<StudioMessagePart, { type: "permission" }>
type StudioPermissionStatus = StudioPermissionPart["status"]
type StudioUserInputPart = Extract<StudioMessagePart, { type: "user_input" }>
type StudioUserInputStatus = StudioUserInputPart["status"]
type StudioSubagentPart = Extract<StudioMessagePart, { type: "subagent" }>
type StudioFilePart = Extract<StudioMessagePart, { type: "file" }>
type StudioMediaGenerationPart = Extract<
  StudioMessagePart,
  { type: "media_generation" }
>
type StudioFileGroupPart = {
  id: string
  type: "file_group"
  files: StudioFilePart[]
}
type RenderableStudioMessagePart = StudioMessagePart | StudioFileGroupPart

type MessageRenderEnvironment = "remote" | "local"

const MessageRenderEnvironmentContext =
  React.createContext<MessageRenderEnvironment>("local")

function useMessageRenderEnvironment() {
  return React.useContext(MessageRenderEnvironmentContext)
}

const markdownClassName =
  "prose-sm max-w-none leading-7 text-foreground dark:prose-invert prose-headings:font-heading prose-headings:text-foreground prose-h1:text-xl prose-h2:mt-4 prose-h2:text-lg prose-h3:mt-3 prose-h3:text-base prose-p:my-2 prose-a:text-primary prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-pre:my-3 prose-table:my-3 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2"

const reasoningMarkdownClassName =
  "max-w-none leading-6 prose-p:my-2 prose-headings:my-2 prose-code:rounded-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-pre:my-3"

const assistantTraceContainerClassName = "not-prose my-0 text-muted-foreground"

const assistantTraceTriggerClassName =
  "min-h-7 max-w-full text-sm leading-6 [&>div]:min-w-0 [&>div]:gap-2 [&>div>span:last-child]:min-w-0"

const assistantTraceLabelClassName = "block max-w-full truncate leading-6"

const streamingPulseDotClassName =
  "[&>*:last-child]:after:ml-1.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:size-2.5 [&>*:last-child]:after:translate-y-[1px] [&>*:last-child]:after:rounded-full [&>*:last-child]:after:bg-foreground [&>*:last-child]:after:align-middle [&>*:last-child]:after:content-[''] [&>*:last-child]:after:animate-[studio-pulse-dot_1.1s_ease-in-out_infinite]"

const fileToolNames = new Set([
  "upload_file",
  "list_files",
  "read_file",
  "write_file",
  "download_file",
  "ls",
  "edit_file",
  "glob",
  "grep",
])

const commandToolNames = new Set(["run_command", "execute"])

const skillToolNames = new Set([
  "list_installed_skills",
  "list_installed_mcp_servers",
  "load_skill",
])

const mediaToolNames = new Set([
  "studio_list_image_models",
  "studio_list_video_models",
  "studio_list_media_generation_models",
  "studio_list_media_generations",
  "studio_get_media_generation",
  "studio_generate_image",
  "studio_generate_video",
])

function formatReasoningDuration(locale: "en" | "zh", durationMs: number) {
  const seconds = Math.max(1, Math.round(durationMs / 1000))

  if (locale === "zh") {
    return `思考了 ${seconds} 秒`
  }

  if (seconds <= 3) {
    return "Thought for a few seconds"
  }

  return `Thought for ${seconds} seconds`
}

export function AssistantReasoning({
  content,
  isStreaming = false,
  durationMs,
}: {
  content: string
  isStreaming?: boolean
  durationMs?: number | null
}) {
  const { locale, t } = useI18n()

  if (!content.trim()) {
    return null
  }

  const label =
    durationMs === null || durationMs === undefined
      ? "Reasoning"
      : formatReasoningDuration(locale, durationMs)

  return (
    <Reasoning
      isStreaming={isStreaming}
      className={cn(assistantTraceContainerClassName, "flex flex-col")}
    >
      <ReasoningTrigger
        className={cn(
          "min-h-7 w-fit max-w-full text-sm leading-6",
          "[&>span]:min-w-0 [&>span]:truncate"
        )}
      >
        {isStreaming ? <Shimmer as="span">{t.studioThinking}</Shimmer> : label}
      </ReasoningTrigger>
      <ReasoningContent
        markdown
        streaming={isStreaming}
        className="ml-1.75 border-l border-l-border/70 pb-1 pl-6"
        contentClassName={reasoningMarkdownClassName}
      >
        {content}
      </ReasoningContent>
    </Reasoning>
  )
}

function AssistantPlan({
  todos,
}: {
  todos: Extract<StudioMessagePart, { type: "plan" }>["todos"]
}) {
  if (todos.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        assistantTraceContainerClassName,
        "rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm text-foreground"
      )}
    >
      <ul className="flex flex-col gap-1.5">
        {todos.map((todo) => (
          <li
            key={`${todo.status}-${todo.text}`}
            className={cn(
              "flex min-w-0 items-start gap-2",
              todo.status === "completed" && "text-muted-foreground",
              todo.status === "in_progress" && "text-primary"
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                todo.status === "completed" &&
                  "border-primary bg-primary text-primary-foreground",
                todo.status === "in_progress" &&
                  "border-primary bg-primary/10 text-primary",
                todo.status === "pending" && "border-border bg-background"
              )}
            >
              {todo.status === "completed" ? (
                <RiCheckLine aria-hidden className="size-3" />
              ) : todo.status === "in_progress" ? (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-primary"
                />
              ) : null}
            </span>
            <span
              className={cn(
                "min-w-0 leading-5",
                todo.status === "completed" &&
                  "line-through decoration-muted-foreground/70"
              )}
            >
              {todo.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function getPermissionDecisionStatus(option: StudioPermissionOption) {
  return option.kind.startsWith("allow")
    ? ("approved" as const)
    : ("denied" as const)
}

function getPermissionCommand(part: StudioPermissionPart) {
  if (!commandToolNames.has(part.toolName)) {
    return ""
  }

  return getRunCommandPayload(part.input).command.trim()
}

function getPermissionPreview(part: StudioPermissionPart) {
  const command = getPermissionCommand(part)

  return {
    input: command || part.input.trim(),
    isCommand: Boolean(command),
  }
}

function getDefaultPermissionOption(options: StudioPermissionOption[]) {
  return (
    options.find((option) => option.kind === "allow_once") ??
    options.find((option) => option.kind.startsWith("allow")) ??
    options[0] ??
    null
  )
}

function getRejectPermissionOption(options: StudioPermissionOption[]) {
  return options.find((option) => option.kind.startsWith("reject")) ?? null
}

function getPermissionOptionDisplayName({
  option,
  part,
  t,
}: {
  option: StudioPermissionOption
  part: StudioPermissionPart
  t: ReturnType<typeof useI18n>["t"]
}) {
  const fallback = option.name || option.optionId
  const isZh = t.studioThinking === "正在思考"

  if (!isZh) {
    return fallback
  }

  if (option.kind === "allow_always") {
    return getPermissionCommand(part)
      ? "是，并记住这类命令"
      : "是，并记住这类操作"
  }

  if (option.kind.startsWith("allow")) {
    return "是"
  }

  if (option.kind.startsWith("reject")) {
    return "否，请告诉 AstraFlow 如何调整"
  }

  return fallback
}

export function PendingPermissionApprovalPanel({
  part,
  onDecision,
}: {
  part: StudioPermissionPart
  onDecision: (
    requestId: string,
    option: StudioPermissionOption,
    status: StudioPermissionStatus,
    feedback?: string
  ) => void
}) {
  const { t } = useI18n()
  const defaultOption = getDefaultPermissionOption(part.options)
  const rejectOption = getRejectPermissionOption(part.options)
  const [selection, setSelection] = React.useState(() => ({
    optionId: defaultOption?.optionId ?? "",
    requestId: part.id,
  }))
  const [feedback, setFeedback] = React.useState("")
  const selectedOptionId =
    selection.requestId === part.id
      ? selection.optionId
      : (defaultOption?.optionId ?? "")
  const selectedOption =
    part.options.find((option) => option.optionId === selectedOptionId) ??
    defaultOption
  const preview = getPermissionPreview(part)

  function submitOption(option: StudioPermissionOption | null) {
    if (!option) {
      return
    }

    const normalizedFeedback = feedback.trim()
    const feedbackForDecision = option.kind.startsWith("reject")
      ? normalizedFeedback || undefined
      : undefined

    onDecision(
      part.id,
      option,
      getPermissionDecisionStatus(option),
      feedbackForDecision
    )
  }

  return (
    <div className="animate-in rounded-3xl border bg-background/98 p-3 shadow-xl ring-1 shadow-foreground/10 ring-foreground/5 duration-200 fade-in-0 zoom-in-95 slide-in-from-bottom-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm leading-5 font-semibold text-foreground">
            {preview.isCommand
              ? t.studioPermissionApprovalCommandTitle
              : t.studioPermissionApprovalTitle}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t.studioPermissionApprovalDescription}
          </p>
        </div>
        <Badge
          variant="outline"
          className="h-6 shrink-0 rounded-full px-2 text-xs"
        >
          {part.toolName}
        </Badge>
      </div>

      <pre className="mt-3 max-h-20 min-w-0 overflow-auto rounded-2xl bg-muted/55 px-3 py-2 font-mono text-[13px] leading-5 whitespace-pre-wrap text-foreground">
        {preview.input || t.studioPermissionNoInput}
      </pre>

      <div className="mt-3 flex flex-col gap-1 rounded-2xl bg-muted/45 p-1">
        {part.options.map((option, index) => {
          const selected = option.optionId === selectedOption?.optionId
          const label = getPermissionOptionDisplayName({ option, part, t })
          const isRejectOption = option.kind.startsWith("reject")
          const selectOption = () =>
            setSelection({ optionId: option.optionId, requestId: part.id })

          if (isRejectOption) {
            return (
              <div
                key={option.optionId}
                role="button"
                aria-pressed={selected}
                tabIndex={0}
                title={label}
                className={cn(
                  "flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left transition-all duration-150",
                  selected
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                    : "text-muted-foreground hover:-translate-y-px hover:bg-background/70 hover:text-foreground"
                )}
                onClick={selectOption}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) {
                    return
                  }
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    selectOption()
                  }
                }}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                    selected
                      ? "bg-foreground text-background"
                      : "bg-background text-muted-foreground ring-1 ring-border"
                  )}
                >
                  {index + 1}
                </span>
                <input
                  value={feedback}
                  placeholder={t.studioPermissionFeedbackPlaceholder}
                  className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  onFocus={selectOption}
                  onChange={(event) => {
                    selectOption()
                    setFeedback(event.target.value)
                  }}
                />
              </div>
            )
          }

          return (
            <button
              key={option.optionId}
              type="button"
              aria-pressed={selected}
              title={label}
              className={cn(
                "flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left text-sm transition-all duration-150",
                selected
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                  : "text-muted-foreground hover:-translate-y-px hover:bg-background/70 hover:text-foreground"
              )}
              onClick={() =>
                setSelection({ optionId: option.optionId, requestId: part.id })
              }
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  selected
                    ? "bg-foreground text-background"
                    : "bg-background text-muted-foreground ring-1 ring-border"
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-2">
        {rejectOption ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-xs text-muted-foreground"
            onClick={() => submitOption(rejectOption)}
          >
            {t.studioPermissionSkip}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-full bg-foreground px-4 text-xs text-background hover:bg-foreground/85"
          disabled={!selectedOption}
          onClick={() => submitOption(selectedOption)}
        >
          {t.studioPermissionSubmit}
        </Button>
      </div>
    </div>
  )
}

const USER_INPUT_OTHER_OPTION_ID = "__other__"

type UserInputSelection = {
  optionId: string
  text: string
}

function getDefaultUserInputOption(options: StudioUserInputOption[]) {
  return options[0] ?? null
}

function getUserInputCopy(t: ReturnType<typeof useI18n>["t"]) {
  const isZh = t.studioThinking === "正在思考"

  return isZh
    ? {
        title: "请选择后继续",
        description: "AstraFlow 需要你确认一个偏好后继续。",
        other: "其他",
        otherPlaceholder: "输入你的选择",
        skip: "取消",
      }
    : {
        title: "Choose before continuing",
        description: "AstraFlow needs one preference before it continues.",
        other: "Other",
        otherPlaceholder: "Type your choice",
        skip: "Cancel",
      }
}

function createUserInputSelections(
  part: StudioUserInputPart
): Record<string, UserInputSelection> {
  return Object.fromEntries(
    part.questions.map((question) => {
      const defaultOption = getDefaultUserInputOption(question.options)

      return [
        question.id,
        {
          optionId:
            defaultOption?.optionId ??
            (question.allowOther ? USER_INPUT_OTHER_OPTION_ID : ""),
          text: "",
        },
      ]
    })
  )
}

export function PendingUserInputPanel({
  part,
  onDecision,
}: {
  part: StudioUserInputPart
  onDecision: (
    requestId: string,
    answers: StudioUserInputAnswer[],
    status: StudioUserInputStatus
  ) => void
}) {
  const { t } = useI18n()
  const copy = getUserInputCopy(t)
  const [selections, setSelections] = React.useState(() =>
    createUserInputSelections(part)
  )

  function updateSelection(questionId: string, selection: UserInputSelection) {
    setSelections((current) => ({
      ...current,
      [questionId]: selection,
    }))
  }

  function buildAnswers() {
    return part.questions
      .map((question) => {
        const selection = selections[question.id]
        const isOther = selection?.optionId === USER_INPUT_OTHER_OPTION_ID
        const option = isOther
          ? null
          : question.options.find(
              (candidate) => candidate.optionId === selection?.optionId
            ) ?? null
        const text = isOther ? selection.text.trim() : (option?.label ?? "")

        if (!text) {
          return null
        }

        return {
          questionId: question.id,
          optionId: option?.optionId ?? null,
          label: option?.label ?? null,
          text,
        } satisfies StudioUserInputAnswer
      })
      .filter((answer): answer is StudioUserInputAnswer => Boolean(answer))
  }

  const answers = buildAnswers()
  const canSubmit = answers.length === part.questions.length

  return (
    <div className="animate-in rounded-3xl border bg-background/98 p-3 shadow-xl ring-1 shadow-foreground/10 ring-foreground/5 duration-200 fade-in-0 zoom-in-95 slide-in-from-bottom-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm leading-5 font-semibold text-foreground">
            {copy.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {copy.description}
          </p>
        </div>
        <Badge
          variant="outline"
          className="h-6 shrink-0 rounded-full px-2 text-xs"
        >
          request_user_input
        </Badge>
      </div>

      <div className="mt-3 space-y-3">
        {part.questions.map((question) => {
          const selection = selections[question.id] ?? {
            optionId: "",
            text: "",
          }

          return (
            <section key={question.id} className="space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                  <RiQuestionLine aria-hidden className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-muted-foreground">
                    {question.header}
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {question.question}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1 rounded-2xl bg-muted/45 p-1">
                {question.options.map((option, index) => {
                  const selected = selection.optionId === option.optionId

                  return (
                    <button
                      key={option.optionId}
                      type="button"
                      aria-pressed={selected}
                      title={option.description || option.label}
                      className={cn(
                        "flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left text-sm transition-all duration-150",
                        selected
                          ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                          : "text-muted-foreground hover:-translate-y-px hover:bg-background/70 hover:text-foreground"
                      )}
                      onClick={() =>
                        updateSelection(question.id, {
                          optionId: option.optionId,
                          text: selection.text,
                        })
                      }
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                          selected
                            ? "bg-foreground text-background"
                            : "bg-background text-muted-foreground ring-1 ring-border"
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}

                {question.allowOther ? (
                  <div
                    role="button"
                    aria-pressed={
                      selection.optionId === USER_INPUT_OTHER_OPTION_ID
                    }
                    tabIndex={0}
                    className={cn(
                      "flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-left transition-all duration-150",
                      selection.optionId === USER_INPUT_OTHER_OPTION_ID
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                        : "text-muted-foreground hover:-translate-y-px hover:bg-background/70 hover:text-foreground"
                    )}
                    onClick={() =>
                      updateSelection(question.id, {
                        optionId: USER_INPUT_OTHER_OPTION_ID,
                        text: selection.text,
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) {
                        return
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        updateSelection(question.id, {
                          optionId: USER_INPUT_OTHER_OPTION_ID,
                          text: selection.text,
                        })
                      }
                    }}
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                        selection.optionId === USER_INPUT_OTHER_OPTION_ID
                          ? "bg-foreground text-background"
                          : "bg-background text-muted-foreground ring-1 ring-border"
                      )}
                    >
                      {question.options.length + 1}
                    </span>
                    <input
                      type={question.isSecret ? "password" : "text"}
                      value={selection.text}
                      placeholder={`${copy.other}: ${copy.otherPlaceholder}`}
                      className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                      onFocus={() =>
                        updateSelection(question.id, {
                          optionId: USER_INPUT_OTHER_OPTION_ID,
                          text: selection.text,
                        })
                      }
                      onChange={(event) =>
                        updateSelection(question.id, {
                          optionId: USER_INPUT_OTHER_OPTION_ID,
                          text: event.target.value,
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-3 text-xs text-muted-foreground"
          onClick={() => onDecision(part.id, [], "cancelled")}
        >
          {copy.skip}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-full bg-foreground px-4 text-xs text-background hover:bg-foreground/85"
          disabled={!canSubmit}
          onClick={() => onDecision(part.id, answers, "answered")}
        >
          {t.studioPermissionSubmit}
        </Button>
      </div>
    </div>
  )
}

function getFallbackMessageParts(
  content: string,
  activities: StudioMessageActivity[]
): StudioMessagePart[] {
  const fallbackParts: StudioMessagePart[] = activities.map((activity) => ({
    id: activity.id,
    type: "tool",
    activity,
  }))

  if (content.trim()) {
    fallbackParts.push({
      id: "content",
      type: "text",
      content,
    })
  }

  return fallbackParts
}

export function hasRenderableReasoningParts(parts: StudioMessagePart[]) {
  return parts.some(
    (part) => part.type === "reasoning" && part.content.trim().length > 0
  )
}

function groupFileParts(parts: StudioMessagePart[]): RenderableStudioMessagePart[] {
  const groupedParts: RenderableStudioMessagePart[] = []
  let fileBuffer: StudioFilePart[] = []

  function flushFileBuffer() {
    if (fileBuffer.length === 0) {
      return
    }

    groupedParts.push({
      id: `file-group-${fileBuffer[0]?.id ?? groupedParts.length}`,
      type: "file_group",
      files: fileBuffer,
    })
    fileBuffer = []
  }

  for (const part of parts) {
    if (part.type === "file") {
      fileBuffer.push(part)
      continue
    }

    flushFileBuffer()
    groupedParts.push(part)
  }

  flushFileBuffer()

  return groupedParts
}

function getRenderableMessageParts({
  content,
  activities,
  parts,
}: {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
}) {
  return groupFileParts(
    parts.length > 0 ? parts : getFallbackMessageParts(content, activities)
  )
}

function getWebSearchQuery(input: string) {
  try {
    const parsed = JSON.parse(input) as { query?: unknown }

    if (typeof parsed.query === "string" && parsed.query.trim()) {
      return parsed.query.trim()
    }
  } catch {
    // Fall back to the raw input below.
  }

  return input.trim()
}

function getWebFetchUrl(input: string) {
  try {
    const parsed = JSON.parse(input) as { url?: unknown }

    if (typeof parsed.url === "string" && parsed.url.trim()) {
      return parsed.url.trim()
    }
  } catch {
    // Fall back to the raw input below.
  }

  return input.trim()
}

function getRunCodePayload(input: string) {
  try {
    const parsed = JSON.parse(input) as {
      code?: unknown
      language?: unknown
      auto_pause?: unknown
      sandbox_id?: unknown
    }

    return {
      code: typeof parsed.code === "string" ? parsed.code : input,
      language:
        typeof parsed.language === "string" && parsed.language.trim()
          ? parsed.language.trim()
          : "python",
      autoPause:
        typeof parsed.auto_pause === "boolean" ? parsed.auto_pause : null,
      sandboxId:
        typeof parsed.sandbox_id === "string" && parsed.sandbox_id.trim()
          ? parsed.sandbox_id.trim()
          : null,
    }
  } catch {
    // Fall back to a generic label below.
  }

  return {
    code: input,
    language: "plaintext",
    autoPause: null,
    sandboxId: null,
  }
}

function getRunCommandPayload(input: string) {
  try {
    const parsed = JSON.parse(input) as {
      command?: unknown
      cwd?: unknown
    }

    return {
      command: typeof parsed.command === "string" ? parsed.command : input,
      cwd:
        typeof parsed.cwd === "string" && parsed.cwd.trim()
          ? parsed.cwd.trim()
          : null,
    }
  } catch {
    // Fall back to a generic label below.
  }

  return {
    command: input,
    cwd: null,
  }
}

function formatCommandActivityLabel({
  command,
  running,
  t,
}: {
  command: string
  running: boolean
  t: ReturnType<typeof useI18n>["t"]
}) {
  const isZh = t.studioThinking === "正在思考"
  const fallback = running
    ? isZh
      ? command
        ? `正在执行命令 ${command}`
        : "正在执行命令"
      : command
        ? `Running command ${command}`
        : "Running command"
    : isZh
      ? command
        ? `已执行命令 ${command}`
        : "已执行命令"
      : command
        ? `Ran command ${command}`
        : "Ran command"
  const formatter = running
    ? (t as Partial<typeof t>).studioToolRunningCommand
    : (t as Partial<typeof t>).studioToolRanCommand

  return typeof formatter === "function" ? formatter(command) : fallback
}

function formatGenericToolActivityLabel({
  running,
  toolName,
  t,
}: {
  running: boolean
  toolName: string
  t: ReturnType<typeof useI18n>["t"]
}) {
  const isZh = t.studioThinking === "正在思考"

  if (isZh) {
    return toolName
      ? `${running ? "正在调用工具" : "已调用工具"} ${toolName}`
      : running
        ? "正在调用工具"
        : "已调用工具"
  }

  return toolName
    ? `${running ? "Calling tool" : "Called tool"} ${toolName}`
    : running
      ? "Calling tool"
      : "Called tool"
}

function isZhLocale(t: ReturnType<typeof useI18n>["t"]) {
  return t.studioThinking === "正在思考"
}

function parseToolInputObject(input: string) {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>

    return typeof parsed === "object" && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function getFileToolTarget(input: string) {
  const parsed = parseToolInputObject(input)

  if (!parsed) {
    return input.trim()
  }

  const path = typeof parsed.path === "string" ? parsed.path.trim() : ""
  const filePath =
    typeof parsed.file_path === "string" ? parsed.file_path.trim() : ""
  const camelFilePath =
    typeof parsed.filePath === "string" ? parsed.filePath.trim() : ""
  const absolutePath =
    typeof parsed.absolute_path === "string" ? parsed.absolute_path.trim() : ""
  const camelAbsolutePath =
    typeof parsed.absolutePath === "string" ? parsed.absolutePath.trim() : ""
  const name = typeof parsed.name === "string" ? parsed.name.trim() : ""
  const fileId = typeof parsed.file_id === "string" ? parsed.file_id.trim() : ""
  const pattern =
    typeof parsed.pattern === "string" ? parsed.pattern.trim() : ""
  const query = typeof parsed.query === "string" ? parsed.query.trim() : ""

  return (
    camelAbsolutePath ||
    absolutePath ||
    camelFilePath ||
    filePath ||
    path ||
    name ||
    fileId ||
    pattern ||
    query ||
    ""
  )
}

function getSandboxHostToolPort(input: string) {
  const parsed = parseToolInputObject(input)

  if (!parsed) {
    return input.trim()
  }

  const port = parsed.port

  return typeof port === "number" || typeof port === "string"
    ? String(port).trim()
    : ""
}

function getFileToolOutputTarget(output: string) {
  const parsed = parseToolInputObject(output)
  const parsedTarget = parsed ? getFileToolTarget(output) : ""

  if (parsedTarget) {
    return parsedTarget
  }

  const match = output.match(
    /^(?:Uploaded file|Saved sandbox file for download|Read file|Wrote file|Files in):\s*(.+)$/m
  )

  return match?.[1]?.trim() ?? ""
}

function getFileActivityTarget(activity: StudioMessageActivity) {
  const inputTarget = getFileToolTarget(activity.input)
  const outputTarget = getFileToolOutputTarget(activity.output)

  return activity.status === "complete"
    ? outputTarget || inputTarget
    : inputTarget || outputTarget
}

function getSkillToolSlug(input: string) {
  try {
    const parsed = JSON.parse(input) as unknown

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { slug?: unknown }).slug === "string"
    ) {
      return (parsed as { slug: string }).slug.trim()
    }
  } catch {
    // Tool input can be a plain string in streamed events.
  }

  return input.trim()
}

function getActivityLabel(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  if (activity.status === "error") {
    return t.studioToolError
  }

  if (activity.toolName === "web_fetch") {
    const url = getWebFetchUrl(activity.input)

    return activity.status === "running"
      ? t.studioToolFetching(url)
      : t.studioToolFetched(url)
  }

  if (activity.toolName === "run_code") {
    const { language } = getRunCodePayload(activity.input)

    return activity.status === "running"
      ? t.studioToolRunningCode(language)
      : t.studioToolRanCode(language)
  }

  if (commandToolNames.has(activity.toolName)) {
    const { command } = getRunCommandPayload(activity.input)

    return formatCommandActivityLabel({
      command,
      running: activity.status === "running",
      t,
    })
  }

  if (activity.toolName === "sandbox_get_host") {
    const port = getSandboxHostToolPort(activity.input)

    return activity.status === "running"
      ? t.studioToolResolvingHost(port)
      : t.studioToolResolvedHost(port)
  }

  if (fileToolNames.has(activity.toolName)) {
    const target = getFileActivityTarget(activity)

    if (activity.toolName === "upload_file") {
      return activity.status === "running"
        ? t.studioToolUploadingFile(target)
        : t.studioToolUploadedFile(target)
    }

    if (activity.toolName === "list_files") {
      return activity.status === "running"
        ? t.studioToolListingFiles(target)
        : t.studioToolListedFiles(target)
    }

    if (activity.toolName === "ls" || activity.toolName === "glob") {
      return activity.status === "running"
        ? t.studioToolListingFiles(target)
        : t.studioToolListedFiles(target)
    }

    if (activity.toolName === "read_file") {
      return activity.status === "running"
        ? t.studioToolReadingFile(target)
        : t.studioToolReadFile(target)
    }

    if (activity.toolName === "grep") {
      return activity.status === "running"
        ? t.studioToolSearching(target)
        : t.studioToolAnalyzed(target)
    }

    if (
      activity.toolName === "write_file" ||
      activity.toolName === "edit_file"
    ) {
      return activity.status === "running"
        ? t.studioToolWritingFile(target)
        : t.studioToolWroteFile(target)
    }

    return activity.status === "running"
      ? t.studioToolSavingFile(target)
      : t.studioToolSavedFile(target)
  }

  if (activity.toolName === "list_installed_skills") {
    return activity.status === "running"
      ? t.studioToolListingSkills
      : t.studioToolListedSkills
  }

  if (activity.toolName === "list_installed_mcp_servers") {
    return activity.status === "running"
      ? t.studioToolListingMcpServers
      : t.studioToolListedMcpServers
  }

  if (activity.toolName === "load_skill") {
    const slug = getSkillToolSlug(activity.input)

    return activity.status === "running"
      ? t.studioToolLoadingSkill(slug)
      : t.studioToolLoadedSkill(slug)
  }

  if (
    activity.toolName === "studio_list_image_models" ||
    activity.toolName === "studio_list_video_models" ||
    activity.toolName === "studio_list_media_generation_models"
  ) {
    const isZh = isZhLocale(t)
    const label =
      activity.toolName === "studio_list_image_models"
        ? isZh
          ? "图像模型"
          : "image models"
        : activity.toolName === "studio_list_video_models"
          ? isZh
            ? "视频模型"
            : "video models"
          : isZh
            ? "媒体模型"
            : "media models"

    return activity.status === "running"
      ? isZh
        ? `正在查看${label}`
        : `Listing ${label}`
      : isZh
        ? `已查看${label}`
        : `Listed ${label}`
  }

  if (
    activity.toolName === "studio_list_media_generations" ||
    activity.toolName === "studio_get_media_generation"
  ) {
    const isZh = isZhLocale(t)

    return activity.status === "running"
      ? isZh
        ? "正在查看媒体生成"
        : "Reading media generations"
      : isZh
        ? "已查看媒体生成"
        : "Read media generations"
  }

  if (activity.toolName === "studio_generate_image") {
    const isZh = isZhLocale(t)

    return activity.status === "running"
      ? isZh
        ? "正在生成图像"
        : "Generating image"
      : isZh
        ? "已生成图像"
        : "Generated image"
  }

  if (activity.toolName === "studio_generate_video") {
    const isZh = isZhLocale(t)

    return activity.status === "running"
      ? isZh
        ? "正在提交视频生成"
        : "Submitting video generation"
      : isZh
        ? "已提交视频生成"
        : "Submitted video generation"
  }

  if (isMcpToolName(activity.toolName)) {
    const toolName = getMcpToolDisplayName(activity.toolName)

    return activity.status === "running"
      ? t.studioToolCallingMcpTool(toolName)
      : t.studioToolCalledMcpTool(toolName)
  }

  if (activity.toolName === "web_search") {
    const query = getWebSearchQuery(activity.input)

    return activity.status === "running"
      ? t.studioToolSearching(query)
      : t.studioToolAnalyzed(query)
  }

  return formatGenericToolActivityLabel({
    running: activity.status === "running",
    toolName: activity.toolName,
    t,
  })
}

function renderActivityInlineLabel(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  const label =
    activity.status === "error"
      ? t.studioToolError
      : getActivityLabel(activity, t)

  return (
    <span className={assistantTraceLabelClassName}>
      {activity.status === "running" ? (
        <Shimmer as="span">{label}</Shimmer>
      ) : (
        label
      )}
    </span>
  )
}

function cleanDetectedUrl(value: string) {
  return value.replace(/[),.;\]]+$/g, "")
}

function extractDetectedUrls(text: string) {
  const seen = new Set<string>()
  const urls: string[] = []

  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/g)) {
    const url = cleanDetectedUrl(match[0])

    if (!seen.has(url)) {
      seen.add(url)
      urls.push(url)
    }
  }

  return urls
}

function extractFencedOutputSection(output: string, label: string) {
  const match = output.match(
    new RegExp(`^${label}:\\n\`\`\`[^\\n]*\\n([\\s\\S]*?)\\n\`\`\``, "m")
  )

  return match?.[1]?.trim() ?? ""
}

function extractPlainOutputSection(output: string, label: string) {
  const marker = `${label}:\n`
  const start = output.indexOf(marker)

  if (start < 0) {
    return ""
  }

  const rest = output.slice(start + marker.length)
  const nextSection = rest.search(/\n\n(?:STDOUT|STDERR|RESULTS|ERROR):\n/)

  return (nextSection >= 0 ? rest.slice(0, nextSection) : rest).trim()
}

function parseSandboxToolOutput(output: string) {
  const sectionStart = output.search(/\n\n(?:STDOUT|STDERR|RESULTS|ERROR):\n/)
  const prelude = (
    sectionStart >= 0 ? output.slice(0, sectionStart) : output
  ).trim()
  const fields = new Map<string, string>()
  const title =
    prelude
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.includes(":")) ?? ""

  for (const line of prelude.split("\n")) {
    const match = line.match(/^([^:\n]{2,48}):\s*(.+)$/)

    if (match) {
      fields.set(match[1].trim(), match[2].trim())
    }
  }

  const stdout = extractFencedOutputSection(output, "STDOUT")
  const stderr = extractFencedOutputSection(output, "STDERR")
  const results =
    extractFencedOutputSection(output, "RESULTS") ||
    extractPlainOutputSection(output, "RESULTS")
  const error =
    extractFencedOutputSection(output, "ERROR") ||
    extractPlainOutputSection(output, "ERROR")
  const urls = extractDetectedUrls(output)
  const explicitUrl = fields.get("URL")
  const primaryUrl =
    explicitUrl && /^https?:\/\//i.test(explicitUrl)
      ? cleanDetectedUrl(explicitUrl)
      : (urls[0] ?? null)
  const fieldEntries = [
    "Runtime template",
    "Sandbox ID",
    "Working directory",
    "Exit code",
    "Auto pause",
    "Port",
    "Host",
    "URL",
    "WebSocket URL",
  ]
    .map((label) => [label, fields.get(label)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))

  return {
    title,
    fieldEntries,
    stdout,
    stderr,
    results,
    error,
    primaryUrl,
    isSandboxOutput:
      title.startsWith("AstraFlow Sandbox") ||
      title === "Sandbox host resolved.",
  }
}

function SandboxPreviewCard({ url }: { url: string }) {
  const { t } = useI18n()

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <RiExternalLinkLine
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">
              {t.studioSandboxPreview}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {url}
            </span>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="rounded-2xl">
          <a href={url} target="_blank" rel="noreferrer">
            <RiExternalLinkLine aria-hidden />
            <span>{t.studioSandboxOpenPreview}</span>
          </a>
        </Button>
      </div>
      <div className="h-[min(60vh,420px)] bg-white">
        <iframe
          title={t.studioSandboxPreview}
          src={url}
          className="size-full border-0 bg-white"
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
        />
      </div>
    </div>
  )
}

function SandboxOutputSection({
  title,
  content,
  tone = "default",
}: {
  title: string
  content: string
  tone?: "default" | "destructive"
}) {
  if (!content.trim()) {
    return null
  }

  return (
    <CodeBlock
      className={cn(
        "rounded-2xl shadow-sm",
        tone === "destructive" && "border-destructive/30"
      )}
    >
      <CodeBlockGroup
        className={cn(
          "gap-3 border-b bg-muted/40 px-3 py-2",
          tone === "destructive" && "bg-destructive/5"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <RiCodeLine
            aria-hidden
            className={cn(
              "size-4 text-muted-foreground",
              tone === "destructive" && "text-destructive"
            )}
          />
          <span
            className={cn(
              "truncate text-sm font-medium",
              tone === "destructive" && "text-destructive"
            )}
          >
            {title}
          </span>
        </div>
      </CodeBlockGroup>
      <CodeBlockCode code={content} language="text" />
    </CodeBlock>
  )
}

type ParsedJsonToolOutput = {
  code: string
  summary: string
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getJsonToolOutputSummary(value: unknown) {
  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? "item" : "items"}`
  }

  if (!isJsonRecord(value)) {
    return ""
  }

  const keys = Object.keys(value)

  if (keys.length === 1) {
    const key = keys[0]
    const nestedValue = value[key]

    if (Array.isArray(nestedValue)) {
      return `${key} · ${nestedValue.length}`
    }

    if (isJsonRecord(nestedValue)) {
      return `${key} · ${Object.keys(nestedValue).length}`
    }
  }

  return `${keys.length} ${keys.length === 1 ? "field" : "fields"}`
}

function getJsonToolOutput(output: string): ParsedJsonToolOutput | null {
  const trimmed = output.trim()

  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null
  }

  try {
    const value = JSON.parse(trimmed) as unknown

    if (!Array.isArray(value) && !isJsonRecord(value)) {
      return null
    }

    const code = JSON.stringify(value, null, 2)

    return typeof code === "string"
      ? { code, summary: getJsonToolOutputSummary(value) }
      : null
  } catch {
    return null
  }
}

function JsonToolOutput({ parsed }: { parsed: ParsedJsonToolOutput }) {
  return (
    <CodeBlock className="rounded-2xl shadow-sm">
      <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <RiCodeLine
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="truncate text-sm font-medium">JSON</span>
          {parsed.summary ? (
            <Badge variant="outline" className="shrink-0">
              {parsed.summary}
            </Badge>
          ) : null}
        </div>
      </CodeBlockGroup>
      <CodeBlockCode
        code={parsed.code}
        language="json"
        className="max-h-[520px] overflow-auto"
      />
    </CodeBlock>
  )
}

function SandboxToolOutput({ output }: { output: string }) {
  const { t } = useI18n()
  const jsonOutput = getJsonToolOutput(output)

  if (jsonOutput) {
    return <JsonToolOutput parsed={jsonOutput} />
  }

  const parsed = parseSandboxToolOutput(output)
  const hasStructuredOutput =
    parsed.isSandboxOutput ||
    parsed.primaryUrl ||
    parsed.stdout ||
    parsed.stderr ||
    parsed.results ||
    parsed.error

  if (!hasStructuredOutput) {
    return (
      <MessageContent
        markdown
        className={cn("bg-transparent p-0", markdownClassName)}
      >
        {output}
      </MessageContent>
    )
  }

  return (
    <div className="space-y-3">
      {parsed.fieldEntries.length > 0 ? (
        <div className="rounded-2xl border bg-card p-3 shadow-sm">
          <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
            {t.studioSandboxDetails}
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {parsed.fieldEntries.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd
                  className="truncate font-mono text-foreground"
                  title={value}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {parsed.primaryUrl ? (
        <SandboxPreviewCard url={parsed.primaryUrl} />
      ) : null}

      <SandboxOutputSection
        title={t.studioSandboxStdout}
        content={parsed.stdout}
      />
      <SandboxOutputSection
        title={t.studioSandboxResults}
        content={parsed.results}
      />
      <SandboxOutputSection
        title={t.studioSandboxStderr}
        content={parsed.stderr}
        tone="destructive"
      />
      <SandboxOutputSection
        title={t.studioSandboxError}
        content={parsed.error}
        tone="destructive"
      />
    </div>
  )
}

function getActivityFailureOutput(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  if (activity.status !== "error") {
    return ""
  }

  const explicitError = activity.error?.trim()

  if (explicitError) {
    return explicitError
  }

  const output = activity.output.trim()

  if (!output) {
    return t.studioToolError
  }

  const parsed = parseSandboxToolOutput(output)

  return parsed.error || parsed.stderr || output
}

function getActivityDetailOutput(
  activity: StudioMessageActivity,
  t: ReturnType<typeof useI18n>["t"]
) {
  return activity.status === "error"
    ? getActivityFailureOutput(activity, t)
    : activity.output.trim()
}

function ToolInputBlock({
  icon,
  input,
  language = "json",
  title,
}: {
  icon?: React.ReactNode
  input: string
  language?: string
  title: string
}) {
  const normalizedInput = input.trim()

  if (!normalizedInput) {
    return null
  }

  return (
    <CodeBlock className="rounded-2xl shadow-sm">
      <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon ?? (
            <RiTerminalLine
              aria-hidden
              className="size-4 text-muted-foreground"
            />
          )}
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
      </CodeBlockGroup>
      <CodeBlockCode code={normalizedInput} language={language} />
    </CodeBlock>
  )
}

function ToolActivityDetails({
  activity,
  inputIcon,
  inputLanguage = "json",
  inputTitle,
}: {
  activity: StudioMessageActivity
  inputIcon?: React.ReactNode
  inputLanguage?: string
  inputTitle?: string
}) {
  const { t } = useI18n()
  const output = getActivityDetailOutput(activity, t)

  return (
    <div className="space-y-2 border-l pl-3">
      <ToolInputBlock
        icon={inputIcon}
        input={activity.input}
        language={inputLanguage}
        title={inputTitle ?? `${t.input} · ${activity.toolName}`}
      />

      {activity.status === "running" ? null : output ? (
        <>
          <div
            className={cn(
              "text-xs font-semibold uppercase",
              activity.status === "error"
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {activity.status === "error" ? t.studioToolError : t.output}
          </div>
          <SandboxToolOutput output={output} />
        </>
      ) : (
        <div className="text-sm text-muted-foreground">
          {t.studioToolNoOutput}
        </div>
      )}
    </div>
  )
}

function useLazyToolActivityDetails(defaultOpen: boolean, resetKey: string) {
  const previousResetKeyRef = React.useRef(resetKey)
  const [open, setOpen] = React.useState(defaultOpen)
  const [hasOpened, setHasOpened] = React.useState(defaultOpen)

  React.useEffect(() => {
    if (previousResetKeyRef.current === resetKey) {
      return
    }

    previousResetKeyRef.current = resetKey
    setOpen(defaultOpen)
    setHasOpened(defaultOpen)
  }, [defaultOpen, resetKey])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)

    if (nextOpen) {
      setHasOpened(true)
    }
  }, [])

  return {
    open,
    onOpenChange: handleOpenChange,
    shouldRenderDetails: open || hasOpened,
  }
}

function InlineToolActivity({
  activity,
  leftIcon,
  renderDetails,
}: {
  activity: StudioMessageActivity
  leftIcon: React.ReactNode
  renderDetails?: (activity: StudioMessageActivity) => React.ReactNode
}) {
  const { t } = useI18n()
  const defaultOpen = activity.status === "error"
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, `${activity.id}:${activity.status}`)

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={leftIcon}
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>
        <ChainOfThoughtContent>
          {shouldRenderDetails
            ? renderDetails
              ? renderDetails(activity)
              : <ToolActivityDetails activity={activity} />
            : null}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function FileToolActivity({ activity }: { activity: StudioMessageActivity }) {
  if (
    activity.toolName === "write_file" ||
    activity.toolName === "edit_file"
  ) {
    return <FileWriteActivity activity={activity} />
  }

  return (
    <InlineToolActivity
      activity={activity}
      leftIcon={
        activity.status === "complete" ? (
          <RiCheckLine aria-hidden className="size-4" />
        ) : (
          <RiFileTextLine aria-hidden className="size-4" />
        )
      }
    />
  )
}

const previewableTextExtensions = new Set(["html", "htm", "svg", "md", "markdown"])
const previewableImageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
])

function getFilePathExtension(path: string) {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

  return name.includes(".") ? (name.split(".").at(-1)?.toLowerCase() ?? "") : ""
}

function getFilePathName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function isPreviewableWrittenFile(path: string) {
  const extension = getFilePathExtension(path)

  return (
    previewableTextExtensions.has(extension) ||
    previewableImageExtensions.has(extension)
  )
}

type WrittenFileInfo = {
  path: string
  kind: "create" | "edit"
  oldText: string
  newText: string
}

function getWrittenFileInfo(
  activity: StudioMessageActivity
): WrittenFileInfo | null {
  if (
    activity.toolName !== "write_file" &&
    activity.toolName !== "edit_file"
  ) {
    return null
  }

  const path = getFileToolTarget(activity.input)

  if (!path) {
    return null
  }

  const parsed = parseToolInputObject(activity.input)

  if (activity.toolName === "write_file") {
    const content =
      parsed && typeof parsed.content === "string" ? parsed.content : ""

    return { path, kind: "create", oldText: "", newText: content }
  }

  const oldText =
    parsed && typeof parsed.old_string === "string" ? parsed.old_string : ""
  const newText =
    parsed && typeof parsed.new_string === "string" ? parsed.new_string : ""

  if (!oldText && !newText) {
    return null
  }

  return { path, kind: "edit", oldText, newText }
}

function getWrittenFileTypeLabel(
  path: string,
  t: ReturnType<typeof useI18n>["t"]
) {
  const extension = getFilePathExtension(path)

  if (extension === "html" || extension === "htm" || extension === "svg") {
    return t.studioFileWebsiteLabel
  }

  if (previewableImageExtensions.has(extension)) {
    return t.studioFileImageLabel
  }

  return t.studioFileDocumentLabel
}

type DiffLine = { type: "add" | "del" | "context"; text: string }

const MAX_DIFF_LINES = 600

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.length ? oldText.split("\n") : []
  const newLines = newText.length ? newText.split("\n") : []

  if (oldLines.length === 0) {
    return newLines.map((text) => ({ type: "add", text }))
  }

  if (newLines.length === 0) {
    return oldLines.map((text) => ({ type: "del", text }))
  }

  // Guard against an oversized DP matrix for very large edits.
  if (oldLines.length * newLines.length > 2_000_000) {
    return [
      ...oldLines.map((text): DiffLine => ({ type: "del", text })),
      ...newLines.map((text): DiffLine => ({ type: "add", text })),
    ]
  }

  const n = oldLines.length
  const m = newLines.length
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  )

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: "context", text: oldLines[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "del", text: oldLines[i] })
      i++
    } else {
      result.push({ type: "add", text: newLines[j] })
      j++
    }
  }

  while (i < n) {
    result.push({ type: "del", text: oldLines[i] })
    i++
  }

  while (j < m) {
    result.push({ type: "add", text: newLines[j] })
    j++
  }

  return result
}

function FileDiffView({
  info,
}: {
  info: WrittenFileInfo
}) {
  const { t } = useI18n()
  const lines = React.useMemo(
    () => computeLineDiff(info.oldText, info.newText),
    [info.oldText, info.newText]
  )
  const additions = lines.filter((line) => line.type === "add").length
  const deletions = lines.filter((line) => line.type === "del").length
  const visibleLines = lines.slice(0, MAX_DIFF_LINES)
  const hiddenCount = lines.length - visibleLines.length

  return (
    <CodeBlock className="overflow-hidden rounded-2xl shadow-sm">
      <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {info.kind === "create" ? (
            <RiFileAddLine
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          ) : (
            <RiFileEditLine
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          )}
          <span className="truncate font-mono text-sm font-medium">
            {getFilePathName(info.path)}
          </span>
          {info.kind === "create" ? (
            <Badge variant="outline" className="shrink-0">
              {t.studioFileNewFile}
            </Badge>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {t.studioFileDiffChanges(additions, deletions)}
        </span>
      </CodeBlockGroup>
      <div className="max-h-[420px] overflow-auto py-1 font-mono text-[12px] leading-5">
        {visibleLines.map((line, index) => (
          <div
            key={index}
            className={cn(
              "flex gap-2 px-3 whitespace-pre",
              line.type === "add" &&
                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              line.type === "del" &&
                "bg-red-500/10 text-red-700 dark:text-red-300",
              line.type === "context" && "text-muted-foreground"
            )}
          >
            <span className="w-3 shrink-0 text-center opacity-60 select-none">
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
            </span>
            <span className="min-w-0">{line.text || "​"}</span>
          </div>
        ))}
      </div>
      {hiddenCount > 0 ? (
        <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
          {`+${hiddenCount}`}
        </div>
      ) : null}
    </CodeBlock>
  )
}

function dispatchOpenFilePreview(path: string) {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(
    new CustomEvent<StudioOpenMarkdownTargetDetail>(
      STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
      { detail: { href: path, source: "link" } }
    )
  )
}

function WrittenFileOpenCardMenuItem({
  icon,
  label,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

function WrittenFileOpenCard({ info }: { info: WrittenFileInfo }) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const bridge = typeof window !== "undefined" ? window.astraflowDesktop : undefined
  const canOpenInBrowser = Boolean(bridge?.sidePanelOpenPath)
  const canReveal = Boolean(bridge?.sidePanelShowItem)
  const extension = getFilePathExtension(info.path)
  const isImage = previewableImageExtensions.has(extension)

  const handlePreview = () => {
    setMenuOpen(false)
    dispatchOpenFilePreview(info.path)
  }

  const handleOpenInBrowser = () => {
    setMenuOpen(false)
    void bridge?.sidePanelOpenPath?.(info.path)
  }

  const handleReveal = () => {
    setMenuOpen(false)
    void bridge?.sidePanelShowItem?.(info.path)
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-3 py-2 shadow-sm">
      <button
        type="button"
        onClick={handlePreview}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {isImage ? (
            <RiImageLine aria-hidden className="size-5" />
          ) : (
            <RiGlobalLine aria-hidden className="size-5" />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {getFilePathName(info.path)}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {getWrittenFileTypeLabel(info.path, t)}
          </span>
        </span>
      </button>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0 rounded-2xl">
            <span>{t.studioFileOpenIn}</span>
            <RiArrowDownSLine aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 gap-0.5 rounded-2xl p-1">
          <WrittenFileOpenCardMenuItem
            icon={<RiEyeLine aria-hidden className="size-4" />}
            label={t.studioFileOpenPreview}
            onSelect={handlePreview}
          />
          {canOpenInBrowser ? (
            <WrittenFileOpenCardMenuItem
              icon={<RiExternalLinkLine aria-hidden className="size-4" />}
              label={t.studioFileOpenBrowser}
              onSelect={handleOpenInBrowser}
            />
          ) : null}
          {canReveal ? (
            <WrittenFileOpenCardMenuItem
              icon={<RiFolderOpenLine aria-hidden className="size-4" />}
              label={t.studioFileRevealInFolder}
              onSelect={handleReveal}
            />
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function FileWriteActivity({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const { t } = useI18n()
  const environment = useMessageRenderEnvironment()
  const info = getWrittenFileInfo(activity)

  if (!info) {
    return (
      <InlineToolActivity
        activity={activity}
        leftIcon={
          activity.status === "complete" ? (
            <RiCheckLine aria-hidden className="size-4" />
          ) : (
            <RiFileTextLine aria-hidden className="size-4" />
          )
        }
      />
    )
  }

  const showOpenCard =
    environment === "local" &&
    activity.status === "complete" &&
    isPreviewableWrittenFile(info.path)
  const failureOutput =
    activity.status === "error" ? getActivityDetailOutput(activity, t) : ""

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <InlineToolActivity
        activity={activity}
        leftIcon={
          activity.status === "complete" ? (
            <RiCheckLine aria-hidden className="size-4" />
          ) : (
            <RiFileTextLine aria-hidden className="size-4" />
          )
        }
        renderDetails={() => (
          <div className="space-y-2 border-l pl-3">
            <FileDiffView info={info} />
            {failureOutput ? (
              <>
                <div className="text-xs font-semibold text-destructive uppercase">
                  {t.studioToolError}
                </div>
                <SandboxToolOutput output={failureOutput} />
              </>
            ) : null}
          </div>
        )}
      />
      {showOpenCard ? <WrittenFileOpenCard info={info} /> : null}
    </div>
  )
}

function GenericToolActivity({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const { t } = useI18n()
  const defaultOpen = activity.status === "error"
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, `${activity.id}:${activity.status}`)

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={
            activity.status === "complete" ? (
              <RiCheckLine aria-hidden className="size-4" />
            ) : (
              <RiTerminalLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          {shouldRenderDetails ? (
            <ToolActivityDetails activity={activity} />
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function getCommandTranscriptOutput(output: string) {
  const parsed = parseSandboxToolOutput(output)
  const structuredOutput = [
    parsed.stdout,
    parsed.results,
    parsed.stderr,
    parsed.error,
  ]
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n")

  return (structuredOutput || output.trim())
    .replace(/^\[Command (?:succeeded|failed) with exit code \d+\]\s*/i, "")
    .replace(/\n+\[Command (?:succeeded|failed) with exit code \d+\]\s*$/i, "")
    .trim()
}

function ShellTranscriptCard({
  command,
  output,
  status,
}: {
  command: string
  output: string
  status: StudioMessageActivity["status"]
}) {
  const { t } = useI18n()
  const transcriptOutput = getCommandTranscriptOutput(output)
  const failed = status === "error"

  return (
    <div className="relative min-h-[92px] overflow-hidden rounded-[14px] bg-muted px-3.5 pt-2.5 pb-8 text-foreground/90">
      <div className="mb-3 text-xs leading-none text-muted-foreground">
        Shell
      </div>
      <pre className="m-0 overflow-x-auto font-mono text-[13px] leading-6 whitespace-pre-wrap">
        <span className="text-foreground">$</span>{" "}
        <span className="text-foreground">{command || "command"}</span>
        {transcriptOutput ? (
          <>
            {"\n"}
            <span className="text-muted-foreground">{transcriptOutput}</span>
          </>
        ) : null}
      </pre>
      {status === "running" ? null : (
        <div
          className={cn(
            "absolute right-3.5 bottom-2.5 flex items-center gap-1.5 text-xs font-medium",
            failed ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {failed ? (
            <RiCloseLine aria-hidden className="size-3.5" />
          ) : (
            <RiCheckLine aria-hidden className="size-3.5" />
          )}
          <span>{failed ? t.studioToolFailed : t.studioToolSucceeded}</span>
        </div>
      )}
    </div>
  )
}

function RunCommandActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const payload = getRunCommandPayload(activity.input)
  const output =
    activity.status === "error"
      ? getActivityFailureOutput(activity, t)
      : activity.output.trim()
  const defaultOpen = activity.status === "error"
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, `${activity.id}:${activity.status}`)

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={cn(assistantTraceTriggerClassName, "w-fit")}
          leftIcon={<RiTerminalLine aria-hidden className="size-4" />}
          swapIconOnHover={false}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {renderActivityInlineLabel(activity, t)}
            <RiArrowDownSLine
              aria-hidden
              className="size-4 shrink-0 text-current transition-transform group-data-[state=open]:rotate-180"
            />
          </span>
        </ChainOfThoughtTrigger>

        <CollapsibleContent className="mt-3 overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          {shouldRenderDetails ? (
            <ShellTranscriptCard
              command={payload.command}
              output={output}
              status={activity.status}
            />
          ) : null}
        </CollapsibleContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function RunCodeActivity({ activity }: { activity: StudioMessageActivity }) {
  const { t } = useI18n()
  const payload = getRunCodePayload(activity.input)
  const output =
    activity.status === "error"
      ? getActivityFailureOutput(activity, t)
      : activity.output.trim()
  const lifecycleLabel =
    payload.autoPause === null
      ? null
      : payload.autoPause
        ? t.studioToolAutoPause
        : t.studioToolKillAfterRun
  const defaultOpen = activity.status === "error"
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, `${activity.id}:${activity.status}`)

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={
            activity.status === "complete" ? (
              <RiCheckLine aria-hidden className="size-4" />
            ) : (
              <RiCodeLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          {shouldRenderDetails ? (
            <>
              <CodeBlock className="rounded-2xl shadow-sm">
                <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <RiCodeLine
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                    <span className="truncate text-sm font-medium">
                      {t.input} · {payload.language}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {lifecycleLabel ? <span>{lifecycleLabel}</span> : null}
                    {payload.sandboxId ? (
                      <span className="max-w-40 truncate">
                        {payload.sandboxId}
                      </span>
                    ) : null}
                  </div>
                </CodeBlockGroup>
                <CodeBlockCode
                  code={payload.code}
                  language={payload.language}
                />
              </CodeBlock>

              {activity.status === "running" ? null : (
                <div className="space-y-2 border-l pl-3">
                  <div
                    className={cn(
                      "text-xs font-semibold uppercase",
                      activity.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    )}
                  >
                    {activity.status === "error" ? t.studioToolError : t.output}
                  </div>
                  {output ? (
                    <SandboxToolOutput output={output} />
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {t.studioToolNoOutput}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function SandboxHostActivity({
  activity,
}: {
  activity: StudioMessageActivity
}) {
  const { t } = useI18n()
  const defaultOpen = activity.status === "error"
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, `${activity.id}:${activity.status}`)

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${activity.id}-${activity.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={
            activity.status === "complete" ? (
              <RiExternalLinkLine aria-hidden className="size-4" />
            ) : (
              <RiTerminalLine aria-hidden className="size-4" />
            )
          }
        >
          {renderActivityInlineLabel(activity, t)}
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          {shouldRenderDetails ? (
            <ToolActivityDetails
              activity={activity}
              inputIcon={
                <RiTerminalLine
                  aria-hidden
                  className="size-4 text-muted-foreground"
                />
              }
            />
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

type ToolActivityRendererEntry = {
  matches: (toolName: string) => boolean
  render: (activity: StudioMessageActivity) => React.ReactNode
}

function getCompletedAwareToolIcon(
  activity: StudioMessageActivity,
  pendingIcon: React.ReactNode
) {
  return activity.status === "complete" ? (
    <RiCheckLine aria-hidden className="size-4" />
  ) : (
    pendingIcon
  )
}

const toolActivityRendererRegistry: ToolActivityRendererEntry[] = [
  {
    matches: (toolName) => toolName === "run_code",
    render: (activity) => <RunCodeActivity activity={activity} />,
  },
  {
    matches: (toolName) => commandToolNames.has(toolName),
    render: (activity) => <RunCommandActivity activity={activity} />,
  },
  {
    matches: (toolName) => toolName === "sandbox_get_host",
    render: (activity) => <SandboxHostActivity activity={activity} />,
  },
  {
    matches: (toolName) => fileToolNames.has(toolName),
    render: (activity) => <FileToolActivity activity={activity} />,
  },
  {
    matches: (toolName) => skillToolNames.has(toolName),
    render: (activity) => (
      <InlineToolActivity
        activity={activity}
        leftIcon={getCompletedAwareToolIcon(
          activity,
          <RiBookOpenLine aria-hidden className="size-4" />
        )}
      />
    ),
  },
  {
    matches: (toolName) => mediaToolNames.has(toolName),
    render: (activity) => (
      <InlineToolActivity
        activity={activity}
        leftIcon={getCompletedAwareToolIcon(
          activity,
          activity.toolName === "studio_generate_image" ? (
            <RiImageLine aria-hidden className="size-4" />
          ) : activity.toolName === "studio_generate_video" ? (
            <RiVideoLine aria-hidden className="size-4" />
          ) : (
            <RiSparklingLine aria-hidden className="size-4" />
          )
        )}
      />
    ),
  },
  {
    matches: isMcpToolName,
    render: (activity) => (
      <InlineToolActivity
        activity={activity}
        leftIcon={getCompletedAwareToolIcon(
          activity,
          <RiExternalLinkLine aria-hidden className="size-4" />
        )}
      />
    ),
  },
  {
    matches: (toolName) =>
      toolName === "web_search" || toolName === "web_fetch",
    render: (activity) => (
      <InlineToolActivity
        activity={activity}
        leftIcon={getCompletedAwareToolIcon(
          activity,
          activity.toolName === "web_fetch" ? (
            <RiFileTextLine aria-hidden className="size-4" />
          ) : (
            <RiSearchLine aria-hidden className="size-4" />
          )
        )}
      />
    ),
  },
]

function AssistantActivity({ activity }: { activity: StudioMessageActivity }) {
  const renderer = toolActivityRendererRegistry.find((entry) =>
    entry.matches(activity.toolName)
  )

  return renderer ? (
    renderer.render(activity)
  ) : (
    <GenericToolActivity activity={activity} />
  )
}

function getSubagentLabel(
  part: StudioSubagentPart,
  t: ReturnType<typeof useI18n>["t"]
) {
  const isZh = isZhLocale(t)

  if (part.status === "running") {
    return isZh
      ? `正在运行子代理 ${part.name}`
      : `Running subagent ${part.name}`
  }

  if (part.status === "error") {
    return isZh ? `子代理失败 ${part.name}` : `Subagent failed ${part.name}`
  }

  if (part.status === "cancelled") {
    return isZh
      ? `已取消子代理 ${part.name}`
      : `Cancelled subagent ${part.name}`
  }

  return isZh ? `已完成子代理 ${part.name}` : `Completed subagent ${part.name}`
}

function AssistantSubagent({ part }: { part: StudioSubagentPart }) {
  const { t } = useI18n()
  const defaultOpen =
    part.status === "running" ||
    part.status === "error" ||
    part.activities.some((activity) => activity.status === "error")
  const { open, onOpenChange, shouldRenderDetails } =
    useLazyToolActivityDetails(defaultOpen, part.id)
  const body = part.summary?.trim() || part.content.trim()
  const error = part.error?.trim()

  return (
    <ChainOfThought className={assistantTraceContainerClassName}>
      <ChainOfThoughtStep
        key={`${part.id}-${part.status}`}
        open={open}
        onOpenChange={onOpenChange}
      >
        <ChainOfThoughtTrigger
          className={assistantTraceTriggerClassName}
          leftIcon={
            part.status === "complete" ? (
              <RiCheckLine aria-hidden className="size-4" />
            ) : part.status === "error" ? (
              <RiCloseLine aria-hidden className="size-4" />
            ) : (
              <RiRobot2Line aria-hidden className="size-4" />
            )
          }
        >
          <span className={assistantTraceLabelClassName}>
            {part.status === "running" ? (
              <Shimmer as="span">{getSubagentLabel(part, t)}</Shimmer>
            ) : (
              getSubagentLabel(part, t)
            )}
          </span>
        </ChainOfThoughtTrigger>

        <ChainOfThoughtContent>
          {shouldRenderDetails ? (
            <div className="space-y-2 border-l pl-3">
              {part.taskInput.trim() ? (
                <pre className="max-h-28 overflow-auto rounded-xl bg-muted/45 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
                  {part.taskInput.trim()}
                </pre>
              ) : null}

              {part.todos.length > 0 ? (
                <AssistantPlan todos={part.todos} />
              ) : null}

              {part.activities.length > 0 ? (
                <div className="space-y-1.5">
                  {part.activities.map((activity) => (
                    <AssistantActivity key={activity.id} activity={activity} />
                  ))}
                </div>
              ) : null}

              {body ? (
                <MessageContent
                  markdown
                  streaming={part.status === "running"}
                  className={cn(
                    "bg-transparent p-0",
                    markdownClassName,
                    part.status === "running" && streamingPulseDotClassName
                  )}
                >
                  {body}
                </MessageContent>
              ) : null}

              {error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
            </div>
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  )
}

function getFilePartIcon(part: StudioFilePart) {
  if (part.status === "error") {
    return <RiCloseLine aria-hidden className="size-4" />
  }

  if (part.kind === "create") {
    return <RiFileAddLine aria-hidden className="size-4" />
  }

  if (part.kind === "delete") {
    return <RiDeleteBinLine aria-hidden className="size-4" />
  }

  return <RiFileEditLine aria-hidden className="size-4" />
}

function getFilePartLabel(
  part: StudioFilePart,
  t: ReturnType<typeof useI18n>["t"]
) {
  const isZh = isZhLocale(t)

  if (part.status === "error") {
    return isZh
      ? `文件变更失败 ${part.path}`
      : `File change failed ${part.path}`
  }

  if (part.kind === "create") {
    return isZh ? `已创建 ${part.path}` : `Created ${part.path}`
  }

  if (part.kind === "delete") {
    return isZh ? `已删除 ${part.path}` : `Deleted ${part.path}`
  }

  return isZh ? `已编辑 ${part.path}` : `Edited ${part.path}`
}

type DiffViewMode = "summary" | "diff"

type ParsedDiffLine = {
  id: string
  kind: "context" | "add" | "delete" | "meta"
  oldLine: number | null
  newLine: number | null
  content: string
}

function getFilePartStats(part: StudioFilePart) {
  if (part.stats) {
    return part.stats
  }

  if (!part.diff) {
    return { additions: 0, deletions: 0 }
  }

  let additions = 0
  let deletions = 0

  for (const line of part.diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue
    }

    if (line.startsWith("+")) {
      additions += 1
      continue
    }

    if (line.startsWith("-")) {
      deletions += 1
    }
  }

  return { additions, deletions }
}

function getFileGroupStats(files: StudioFilePart[]) {
  return files.reduce(
    (stats, file) => {
      const fileStats = getFilePartStats(file)

      return {
        additions: stats.additions + fileStats.additions,
        deletions: stats.deletions + fileStats.deletions,
      }
    },
    { additions: 0, deletions: 0 }
  )
}

function parseUnifiedDiff(diff: string): ParsedDiffLine[] {
  const parsedLines: ParsedDiffLine[] = []
  let oldLine: number | null = null
  let newLine: number | null = null

  diff.split(/\r?\n/).forEach((line, index) => {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)

    if (hunkMatch) {
      oldLine = Number.parseInt(hunkMatch[1], 10)
      newLine = Number.parseInt(hunkMatch[2], 10)
      parsedLines.push({
        id: `${index}:meta`,
        kind: "meta",
        oldLine: null,
        newLine: null,
        content: line,
      })
      return
    }

    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("\\")
    ) {
      parsedLines.push({
        id: `${index}:meta`,
        kind: "meta",
        oldLine: null,
        newLine: null,
        content: line,
      })
      return
    }

    if (line.startsWith("+")) {
      parsedLines.push({
        id: `${index}:add`,
        kind: "add",
        oldLine: null,
        newLine,
        content: line,
      })
      newLine = newLine === null ? null : newLine + 1
      return
    }

    if (line.startsWith("-")) {
      parsedLines.push({
        id: `${index}:delete`,
        kind: "delete",
        oldLine,
        newLine: null,
        content: line,
      })
      oldLine = oldLine === null ? null : oldLine + 1
      return
    }

    parsedLines.push({
      id: `${index}:context`,
      kind: "context",
      oldLine,
      newLine,
      content: line,
    })
    oldLine = oldLine === null ? null : oldLine + 1
    newLine = newLine === null ? null : newLine + 1
  })

  return parsedLines
}

function getDiffLineClassName(kind: ParsedDiffLine["kind"]) {
  if (kind === "add") {
    return "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
  }

  if (kind === "delete") {
    return "bg-destructive/10 text-destructive"
  }

  if (kind === "meta") {
    return "bg-muted/70 text-muted-foreground"
  }

  return "text-foreground"
}

function FileDiffStats({ part }: { part: StudioFilePart }) {
  const stats = getFilePartStats(part)

  return (
    <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
      <span className="text-emerald-600">+{stats.additions}</span>
      <span className="text-destructive">-{stats.deletions}</span>
    </span>
  )
}

function FileDiffCode({ part }: { part: StudioFilePart }) {
  const { t } = useI18n()
  const lines = React.useMemo(
    () => (part.diff ? parseUnifiedDiff(part.diff) : []),
    [part.diff]
  )
  const isZh = isZhLocale(t)

  if (!part.diff || lines.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {isZh ? "没有可展示的 diff。" : "No diff available."}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/40 px-3 py-2">
        <div className="min-w-0 truncate font-mono text-xs text-foreground">
          {part.path}
        </div>
        <FileDiffStats part={part} />
      </div>
      <div className="max-h-[440px] overflow-auto text-[12px] leading-5">
        {lines.map((line) => (
          <div
            key={line.id}
            className={cn(
              "grid min-w-max grid-cols-[3.25rem_3.25rem_1fr] font-mono",
              getDiffLineClassName(line.kind)
            )}
          >
            <span className="select-none border-r border-border/50 px-2 text-right text-muted-foreground">
              {line.oldLine ?? ""}
            </span>
            <span className="select-none border-r border-border/50 px-2 text-right text-muted-foreground">
              {line.newLine ?? ""}
            </span>
            <span className="whitespace-pre px-3">{line.content || " "}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AssistantFileChangeSummaryRow({
  active,
  part,
  onSelect,
}: {
  active: boolean
  part: StudioFilePart
  onSelect: () => void
}) {
  const { t } = useI18n()
  const label = getFilePartLabel(part, t)

  return (
    <button
      type="button"
      className={cn(
        "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/60",
        active && "bg-muted text-foreground",
        part.status === "error" && "text-destructive"
      )}
      title={part.error ?? label}
      onClick={onSelect}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center text-muted-foreground",
          part.status === "error" && "text-destructive"
        )}
      >
        {getFilePartIcon(part)}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      <FileDiffStats part={part} />
    </button>
  )
}

function getFileGroupLabel({
  count,
  isZh,
}: {
  count: number
  isZh: boolean
}) {
  if (isZh) {
    return count > 1 ? `${count} 个文件变更` : "1 个文件变更"
  }

  return count > 1 ? `${count} file changes` : "1 file change"
}

function AssistantFileChangeGroup({ files }: { files: StudioFilePart[] }) {
  const { t } = useI18n()
  const isZh = isZhLocale(t)
  const [open, setOpen] = React.useState(true)
  const [query, setQuery] = React.useState("")
  const [view, setView] = React.useState<DiffViewMode>("summary")
  const [activeFileId, setActiveFileId] = React.useState(files[0]?.id ?? "")
  const stats = React.useMemo(() => getFileGroupStats(files), [files])
  const normalizedQuery = query.trim().toLowerCase()
  const visibleFiles = React.useMemo(() => {
    if (!normalizedQuery) {
      return files
    }

    return files.filter((file) => {
      const haystack = `${file.path}\n${file.content}\n${file.diff ?? ""}`
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [files, normalizedQuery])
  const selectedActiveFileId = visibleFiles.some(
    (file) => file.id === activeFileId
  )
    ? activeFileId
    : (visibleFiles[0]?.id ?? "")
  const activeFile =
    visibleFiles.find((file) => file.id === selectedActiveFileId) ?? null

  if (files.length === 0) {
    return null
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        assistantTraceContainerClassName,
        "overflow-hidden rounded-xl border border-border/70 bg-muted/30 text-sm text-foreground",
        files.some((file) => file.status === "error") &&
          "border-destructive/30 bg-destructive/5"
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0 rounded-lg"
            aria-label={open ? (isZh ? "收起" : "Collapse") : isZh ? "展开" : "Expand"}
            title={open ? (isZh ? "收起" : "Collapse") : isZh ? "展开" : "Expand"}
          >
            <RiArrowDownSLine
              aria-hidden
              className={cn("size-4 transition-transform", !open && "-rotate-90")}
            />
          </Button>
        </CollapsibleTrigger>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
          <RiFileEditLine aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {getFileGroupLabel({ count: files.length, isZh })}
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
          <span className="text-emerald-600">+{stats.additions}</span>
          <span className="text-destructive">-{stats.deletions}</span>
        </span>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-3 border-t border-border/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-40 flex-1">
              <RiSearchLine
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={isZh ? "搜索文件或 diff" : "Search files or diff"}
                className="h-8 rounded-lg pl-8 text-xs"
              />
            </div>
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(value) => {
                if (value === "summary" || value === "diff") {
                  setView(value)
                }
              }}
              size="sm"
              variant="outline"
              spacing={0}
              className="shrink-0"
            >
              <ToggleGroupItem value="summary">
                {isZh ? "摘要" : "Summary"}
              </ToggleGroupItem>
              <ToggleGroupItem value="diff">
                {isZh ? "Diff" : "Diff"}
              </ToggleGroupItem>
            </ToggleGroup>
            <Badge variant="secondary" className="shrink-0">
              {visibleFiles.length}/{files.length}
            </Badge>
          </div>

          {visibleFiles.length === 0 ? (
            <div className="rounded-lg border border-border/70 bg-background px-3 py-4 text-sm text-muted-foreground">
              {isZh ? "没有匹配的文件。" : "No matching files."}
            </div>
          ) : view === "summary" ? (
            <div className="flex flex-col gap-1 rounded-lg border border-border/70 bg-background p-1">
              {visibleFiles.map((file) => (
                <AssistantFileChangeSummaryRow
                  key={file.id}
                  active={file.id === activeFile?.id}
                  part={file}
                  onSelect={() => {
                    setActiveFileId(file.id)
                    setView("diff")
                  }}
                />
              ))}
            </div>
          ) : activeFile ? (
            <div className="flex flex-col gap-2">
              {visibleFiles.length > 1 ? (
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {visibleFiles.map((file) => (
                    <Button
                      key={file.id}
                      type="button"
                      variant={file.id === activeFile.id ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 max-w-56 shrink-0 rounded-lg px-2 text-xs"
                      title={file.path}
                      onClick={() => setActiveFileId(file.id)}
                    >
                      <span className="truncate">{file.path}</span>
                    </Button>
                  ))}
                </div>
              ) : null}
              <FileDiffCode part={activeFile} />
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function getMediaGenerationLabel(
  part: StudioMediaGenerationPart,
  t: ReturnType<typeof useI18n>["t"]
) {
  const isZh = isZhLocale(t)
  const media =
    part.kind === "image" ? (isZh ? "图像" : "image") : isZh ? "视频" : "video"

  if (
    part.status === "running" ||
    part.status === "queued" ||
    part.status === "polling"
  ) {
    return isZh ? `正在生成${media}` : `Generating ${media}`
  }

  if (part.status === "cancelled") {
    return isZh
      ? `${media}生成已取消`
      : `${media[0].toUpperCase()}${media.slice(1)} generation cancelled`
  }

  if (part.status === "error") {
    return isZh
      ? `${media}生成失败`
      : `${media[0].toUpperCase()}${media.slice(1)} generation failed`
  }

  if (part.status === "partial") {
    return isZh
      ? `${media}部分生成完成`
      : `${media[0].toUpperCase()}${media.slice(1)} partially generated`
  }

  return isZh ? `已生成${media}` : `Generated ${media}`
}

function withDownloadParam(href: string) {
  try {
    const url = new URL(href, window.location.href)
    url.searchParams.set("download", "1")

    return href.startsWith("/") ? `${url.pathname}${url.search}` : url.toString()
  } catch {
    const separator = href.includes("?") ? "&" : "?"
    return `${href}${separator}download=1`
  }
}

function getMediaOutputExtension(
  kind: StudioMediaGenerationPart["kind"],
  mimeType: string | null
) {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/gif") return "gif"
  if (mimeType === "video/webm") return "webm"
  if (mimeType === "video/quicktime") return "mov"

  return kind === "image" ? "png" : "mp4"
}

function getMediaOutputSaveUrl(
  kind: StudioMediaGenerationPart["kind"],
  outputId: string
) {
  const segment = kind === "image" ? "image-outputs" : "video-outputs"

  return `/api/studio/${segment}/${encodeURIComponent(outputId)}/save`
}

function MediaOutputActions({
  kind,
  output,
}: {
  kind: StudioMediaGenerationPart["kind"]
  output: StudioMediaGenerationPart["outputs"][number]
}) {
  const { t } = useI18n()
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(Boolean(output.storagePath))
  const downloadUrl = withDownloadParam(output.contentUrl)
  const filename = `${kind}-${output.index + 1}-${output.id}.${getMediaOutputExtension(
    kind,
    output.mimeType
  )}`

  async function handleSave(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (saving || saved) {
      return
    }

    setSaving(true)

    try {
      const response = await fetch(getMediaOutputSaveUrl(kind, output.id), {
        method: "POST",
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? t.requestFailed)
      }

      setSaved(true)
      toast.success(t.studioImageSaved)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.requestFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <Button
        asChild
        variant="secondary"
        size="icon-sm"
        className="size-8 rounded-full bg-background/90 text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
        aria-label={t.fileLibraryDownload}
        title={t.fileLibraryDownload}
      >
        <a
          href={downloadUrl}
          download={filename}
          onClick={(event) => event.stopPropagation()}
        >
          <RiDownloadLine aria-hidden className="size-4" />
        </a>
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="size-8 rounded-full bg-background/90 text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
        aria-label={saved ? t.studioImageSaved : t.studioImageSave}
        title={saved ? t.studioImageSaved : t.studioImageSave}
        disabled={saving || saved}
        onClick={handleSave}
      >
        {saved ? (
          <RiCheckLine aria-hidden className="size-4" />
        ) : (
          <RiSaveLine aria-hidden className="size-4" />
        )}
      </Button>
      <Button
        asChild
        variant="secondary"
        size="icon-sm"
        className="size-8 rounded-full bg-background/90 text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
        aria-label={t.codeboxOpen}
        title={t.codeboxOpen}
      >
        <a
          href={output.contentUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          <RiExternalLinkLine aria-hidden className="size-4" />
        </a>
      </Button>
    </div>
  )
}

function getMediaUrlMapKeys(url: string) {
  const keys = [url]

  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const parsed = new URL(url, baseUrl)

    keys.push(parsed.toString(), `${parsed.origin}${parsed.pathname}`)

    if (url.startsWith("/")) {
      keys.push(parsed.pathname)
    }
  } catch {
    // Use the raw URL only.
  }

  return keys
}

function createMediaUrlMap(parts: RenderableStudioMessagePart[]) {
  const urlMap: Record<string, string> = {}

  for (const part of parts) {
    if (part.type !== "media_generation") {
      continue
    }

    for (const output of part.outputs) {
      for (const key of getMediaUrlMapKeys(output.contentUrl)) {
        urlMap[key] = output.contentUrl
      }

      if (!output.url) {
        continue
      }

      for (const key of getMediaUrlMapKeys(output.url)) {
        urlMap[key] = output.contentUrl
      }
    }
  }

  return urlMap
}

function AssistantMediaGeneration({
  part,
}: {
  part: StudioMediaGenerationPart
}) {
  const { t } = useI18n()
  const label = getMediaGenerationLabel(part, t)
  const running =
    part.status === "queued" ||
    part.status === "running" ||
    part.status === "polling"
  const failed = part.status === "error"
  const Icon = part.kind === "image" ? RiImageLine : RiVideoLine
  const taskRef = part.providerTaskId || part.providerRequestId
  const progress =
    typeof part.progress === "number"
      ? Math.min(Math.max(part.progress, 0), 1)
      : null
  const progressLabel =
    progress === null ? null : `${Math.round(progress * 100)}%`
  const headerLabel =
    part.status === "complete" || part.status === "partial"
      ? part.modelName || label
      : label

  return (
    <div
      className={cn(
        assistantTraceContainerClassName,
        "overflow-hidden rounded-xl border border-border/70 bg-muted/30 text-sm text-foreground",
        failed && "border-destructive/30 bg-destructive/5"
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center text-muted-foreground",
            failed && "text-destructive"
          )}
        >
          {failed ? (
            <RiCloseLine aria-hidden className="size-4" />
          ) : part.status === "complete" ? (
            <RiCheckLine aria-hidden className="size-4" />
          ) : (
            <Icon aria-hidden className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {running ? <Shimmer as="span">{headerLabel}</Shimmer> : headerLabel}
        </span>
      </div>

      <div className="border-t border-border/60 px-3 py-2">
        <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
          {part.prompt}
        </div>

        {taskRef ? (
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">
            {taskRef}
          </div>
        ) : null}

        {running && (progressLabel || part.phase || part.rawStatus) ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="min-w-0 truncate">
                {part.phase ?? part.rawStatus ?? label}
              </span>
              {progressLabel ? (
                <span className="shrink-0 tabular-nums">{progressLabel}</span>
              ) : null}
            </div>
            {progress !== null ? (
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.max(progress * 100, 4)}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {part.outputs.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {part.outputs.map((output) => (
              <div
                key={output.id}
                className="group relative block overflow-hidden rounded-lg border bg-background"
              >
                <a
                  href={output.contentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                >
                  {part.kind === "image" ? (
                    <Image
                      src={output.contentUrl}
                      alt={part.prompt}
                      className="aspect-video w-full object-cover"
                      width={640}
                      height={360}
                      sizes="(min-width: 640px) 50vw, 100vw"
                      unoptimized
                    />
                  ) : (
                    <video
                      src={output.contentUrl}
                      className="aspect-video w-full bg-black object-contain"
                      controls
                      preload="metadata"
                    />
                  )}
                </a>
                <MediaOutputActions kind={part.kind} output={output} />
              </div>
            ))}
          </div>
        ) : null}

        {failed && part.errorMessage ? (
          <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {part.errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const MessagePartsRenderer = React.memo(function MessagePartsRenderer({
  content,
  activities,
  parts,
  sessionId,
  streaming = false,
  environment = "local",
}: {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
  sessionId?: string | null
  streaming?: boolean
  environment?: MessageRenderEnvironment
}) {
  const renderableParts = getRenderableMessageParts({
    content,
    activities,
    parts,
  })
  const lastTextPartIndex = renderableParts.findLastIndex(
    (part) => part.type === "text" && part.content.trim()
  )
  const lastReasoningPartIndex = renderableParts.findLastIndex(
    (part) => part.type === "reasoning" && part.content.trim()
  )
  const mediaUrlMap = React.useMemo(
    () => createMediaUrlMap(renderableParts),
    [renderableParts]
  )

  return (
    <MessageRenderEnvironmentContext.Provider value={environment}>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        {renderableParts.map((part, index) => {
          if (part.type === "tool") {
            return <AssistantActivity key={part.id} activity={part.activity} />
          }

          if (part.type === "reasoning") {
            return (
              <AssistantReasoning
                key={part.id}
                content={part.content}
                durationMs={part.durationMs}
                isStreaming={
                  streaming &&
                  index === lastReasoningPartIndex &&
                  part.durationMs === null
                }
              />
            )
          }

          if (part.type === "plan") {
            return <AssistantPlan key={part.id} todos={part.todos} />
          }

          if (part.type === "permission") {
            return null
          }

          if (part.type === "user_input") {
            return null
          }

          if (part.type === "subagent") {
            return <AssistantSubagent key={part.id} part={part} />
          }

          if (part.type === "file_group") {
            return <AssistantFileChangeGroup key={part.id} files={part.files} />
          }

          if (part.type === "file") {
            return <AssistantFileChangeGroup key={part.id} files={[part]} />
          }

          if (part.type === "media_generation") {
            return <AssistantMediaGeneration key={part.id} part={part} />
          }

          if (!part.content.trim()) {
            return null
          }

          return (
            <MessageContent
              key={part.id}
              markdown
              mediaSaveSessionId={sessionId}
              mediaUrlMap={mediaUrlMap}
              streaming={streaming && index === lastTextPartIndex}
              className={cn(
                "bg-transparent p-0",
                markdownClassName,
                streaming &&
                  index === lastTextPartIndex &&
                  streamingPulseDotClassName
              )}
            >
              {part.content}
            </MessageContent>
          )
        })}
      </div>
    </MessageRenderEnvironmentContext.Provider>
  )
})
