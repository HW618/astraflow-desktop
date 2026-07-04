import { randomUUID } from "node:crypto"

import type { ChatReasoningEffort, SupportedChatModel } from "@/lib/chat-models"
import {
  createStudioMessage,
  getStudioMessage,
  getStudioSession,
  updateStudioMessageSnapshot,
} from "@/lib/studio-db"
import type {
  StudioChatRunLiveSnapshot,
  StudioChatRunSnapshot,
  StudioChatRunStatus,
  StudioMessageActivity,
  StudioMessagePart,
  StudioMessageStatus,
} from "@/lib/studio-types"
import type { AgentEvent } from "@/lib/agent/events"
import type { AgentRunInput, AgentRuntime } from "@/lib/agent/runtime"

const STUDIO_CHAT_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"
const LIVE_SNAPSHOT_INTERVAL_MS = 150
const SNAPSHOT_PERSIST_INTERVAL_MS = 350
const COMPLETED_RUN_RETENTION_MS = 5 * 60_000

type ChatStreamSnapshot = {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
  reasoningContent: string
  reasoningDurationMs: number | null
}

type StudioChatRunRecord = StudioChatRunSnapshot & {
  abortController: AbortController
  cleanupTimer: ReturnType<typeof setTimeout> | null
  latestSnapshot: ChatStreamSnapshot
  liveMessageBase: ReturnType<typeof getStudioMessage>
  livePublishTimer: ReturnType<typeof setTimeout> | null
  lastLivePublishedAt: number
  promise: Promise<void> | null
}

export type StudioChatRunListener = (
  snapshot: StudioChatRunLiveSnapshot
) => void

declare global {
  var astraflowStudioChatRuns: Map<string, StudioChatRunRecord> | undefined
  var astraflowStudioChatRunListeners:
    Map<string, Set<StudioChatRunListener>> | undefined
}

function getStudioChatRuns() {
  if (!globalThis.astraflowStudioChatRuns) {
    globalThis.astraflowStudioChatRuns = new Map()
  }

  return globalThis.astraflowStudioChatRuns
}

function getStudioChatRunListeners() {
  if (!globalThis.astraflowStudioChatRunListeners) {
    globalThis.astraflowStudioChatRunListeners = new Map()
  }

  return globalThis.astraflowStudioChatRunListeners
}

function nowIso() {
  return new Date().toISOString()
}

function toRunSnapshot(record: StudioChatRunRecord): StudioChatRunSnapshot {
  return {
    runId: record.runId,
    sessionId: record.sessionId,
    assistantMessageId: record.assistantMessageId,
    status: record.status,
    error: record.error,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  }
}

function getLiveMessageStatus(
  record: StudioChatRunRecord
): StudioMessageStatus {
  if (record.status === "error") {
    return "error"
  }

  if (record.status === "complete" || record.status === "cancelled") {
    return "complete"
  }

  return "streaming"
}

function toRunLiveSnapshot(
  record: StudioChatRunRecord
): StudioChatRunLiveSnapshot {
  if (!record.liveMessageBase) {
    record.liveMessageBase = getStudioMessage(record.assistantMessageId)
  }

  const message = record.liveMessageBase
  const latest = record.latestSnapshot

  return {
    ...toRunSnapshot(record),
    message: message
      ? {
          ...message,
          content: latest.content,
          activities: latest.activities,
          parts: latest.parts,
          reasoningContent: latest.reasoningContent,
          reasoningDurationMs: latest.reasoningDurationMs,
          status: getLiveMessageStatus(record),
        }
      : null,
  }
}

function emitRunLiveSnapshot(record: StudioChatRunRecord) {
  record.lastLivePublishedAt = Date.now()

  const listeners = getStudioChatRunListeners().get(record.sessionId)

  if (!listeners || listeners.size === 0) {
    return
  }

  const snapshot = toRunLiveSnapshot(record)

  for (const listener of listeners) {
    try {
      listener(snapshot)
    } catch (error) {
      console.error("[studio-chat] live_listener_failed", error)
    }
  }
}

function scheduleRunLiveSnapshot(record: StudioChatRunRecord, force = false) {
  if (force) {
    if (record.livePublishTimer) {
      clearTimeout(record.livePublishTimer)
      record.livePublishTimer = null
    }

    emitRunLiveSnapshot(record)
    return
  }

  const elapsed = Date.now() - record.lastLivePublishedAt

  if (elapsed >= LIVE_SNAPSHOT_INTERVAL_MS) {
    emitRunLiveSnapshot(record)
    return
  }

  if (record.livePublishTimer) {
    return
  }

  record.livePublishTimer = setTimeout(() => {
    record.livePublishTimer = null
    emitRunLiveSnapshot(record)
  }, LIVE_SNAPSHOT_INTERVAL_MS - elapsed)
}

function setRunStatus(
  record: StudioChatRunRecord,
  status: StudioChatRunStatus,
  error: string | null = record.error
) {
  record.status = status
  record.error = error
  record.updatedAt = nowIso()
}

function scheduleRunCleanup(record: StudioChatRunRecord) {
  if (record.cleanupTimer) {
    clearTimeout(record.cleanupTimer)
  }

  record.cleanupTimer = setTimeout(() => {
    if (record.livePublishTimer) {
      clearTimeout(record.livePublishTimer)
      record.livePublishTimer = null
    }

    const runs = getStudioChatRuns()

    if (runs.get(record.sessionId)?.runId === record.runId) {
      runs.delete(record.sessionId)
    }
  }, COMPLETED_RUN_RETENTION_MS)
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function isAbortLikeError(error: unknown, signal?: AbortSignal) {
  const record = getRecord(error)
  const name = typeof record?.name === "string" ? record.name : ""
  const message = error instanceof Error ? error.message : String(error)

  return (
    Boolean(signal?.aborted) ||
    name === "AbortError" ||
    name === "ResponseAborted" ||
    message.includes("ResponseAborted") ||
    message.includes("aborted")
  )
}

function debugIgnoredAgentEvent(
  label: string,
  payload: Record<string, unknown>
) {
  if (!STUDIO_CHAT_DEBUG) {
    return
  }

  console.debug(`[studio-chat:event] ${label}`, payload)
}

function createInitialSnapshot(): ChatStreamSnapshot {
  return {
    content: "",
    activities: [],
    parts: [],
    reasoningContent: "",
    reasoningDurationMs: null,
  }
}

function createSnapshotAccumulator() {
  let snapshot = createInitialSnapshot()
  let activeReasoningPartId: string | null = null
  let activeReasoningStartedAt: number | null = null
  let totalReasoningDurationMs = 0

  function markReasoningDone() {
    if (!activeReasoningPartId || activeReasoningStartedAt === null) {
      return false
    }

    const durationMs = Math.max(
      1000,
      Math.round(Date.now() - activeReasoningStartedAt)
    )
    totalReasoningDurationMs += durationMs
    snapshot = {
      ...snapshot,
      reasoningDurationMs: totalReasoningDurationMs,
      parts: snapshot.parts.map((part) =>
        part.type === "reasoning" && part.id === activeReasoningPartId
          ? { ...part, durationMs }
          : part
      ),
    }
    activeReasoningPartId = null
    activeReasoningStartedAt = null

    return true
  }

  function appendReasoningPart(delta: string) {
    if (!delta) {
      return false
    }

    const lastPart = snapshot.parts.at(-1)

    if (lastPart?.type === "reasoning" && lastPart.durationMs === null) {
      if (!activeReasoningPartId) {
        activeReasoningPartId = lastPart.id
      }

      if (activeReasoningStartedAt === null) {
        activeReasoningStartedAt = Date.now()
      }

      snapshot = {
        ...snapshot,
        reasoningContent: snapshot.reasoningContent + delta,
        parts: [
          ...snapshot.parts.slice(0, -1),
          { ...lastPart, content: lastPart.content + delta },
        ],
      }
      return true
    }

    const partId = randomUUID()
    activeReasoningPartId = partId
    activeReasoningStartedAt = Date.now()
    snapshot = {
      ...snapshot,
      reasoningContent: snapshot.reasoningContent + delta,
      parts: [
        ...snapshot.parts,
        {
          id: partId,
          type: "reasoning",
          content: delta,
          durationMs: null,
        },
      ],
    }

    return true
  }

  function appendTextPart(delta: string) {
    if (!delta) {
      return false
    }

    const lastPart = snapshot.parts.at(-1)

    if (lastPart?.type === "text") {
      snapshot = {
        ...snapshot,
        content: snapshot.content + delta,
        parts: [
          ...snapshot.parts.slice(0, -1),
          { ...lastPart, content: lastPart.content + delta },
        ],
      }
      return true
    }

    snapshot = {
      ...snapshot,
      content: snapshot.content + delta,
      parts: [
        ...snapshot.parts,
        {
          id: randomUUID(),
          type: "text",
          content: delta,
        },
      ],
    }

    return true
  }

  function upsertToolPart(activity: StudioMessageActivity) {
    const existingIndex = snapshot.parts.findIndex(
      (part) => part.type === "tool" && part.activity.id === activity.id
    )

    if (existingIndex < 0) {
      snapshot = {
        ...snapshot,
        parts: [
          ...snapshot.parts,
          {
            id: activity.id,
            type: "tool",
            activity,
          },
        ],
      }
      return
    }

    snapshot = {
      ...snapshot,
      parts: snapshot.parts.map((part, index) =>
        index === existingIndex && part.type === "tool"
          ? { ...part, activity }
          : part
      ),
    }
  }

  function upsertPlanPart(
    todos: Extract<AgentEvent, { type: "plan_update" }>["todos"]
  ) {
    markReasoningDone()

    const existingIndex = snapshot.parts.findIndex(
      (part) => part.type === "plan"
    )
    const part: StudioMessagePart = {
      id: existingIndex >= 0 ? snapshot.parts[existingIndex].id : randomUUID(),
      type: "plan",
      content: "",
      todos,
    }

    snapshot = {
      ...snapshot,
      parts:
        existingIndex >= 0
          ? snapshot.parts.map((candidate, index) =>
              index === existingIndex ? part : candidate
            )
          : [...snapshot.parts, part],
    }

    return true
  }

  function handleEvent(event: AgentEvent) {
    switch (event.type) {
      case "reasoning_delta":
        return appendReasoningPart(event.delta)
      case "text_delta": {
        const marked = markReasoningDone()
        const appended = appendTextPart(event.delta)

        return marked || appended
      }
      case "tool_call": {
        markReasoningDone()
        const existingById = snapshot.activities.find(
          (activity) => activity.id === event.id
        )
        const activity: StudioMessageActivity = existingById
          ? {
              ...existingById,
              input: existingById.input || event.input,
            }
          : {
              id: event.id,
              toolName: event.name,
              status: "running",
              input: event.input,
              output: "",
              error: null,
            }

        snapshot = {
          ...snapshot,
          activities: existingById
            ? snapshot.activities.map((candidate) =>
                candidate.id === event.id ? activity : candidate
              )
            : [
                ...snapshot.activities.filter(
                  (candidate) => candidate.id !== event.id
                ),
                activity,
              ],
        }
        upsertToolPart(activity)
        return true
      }
      case "tool_result": {
        markReasoningDone()
        let activityIndex = snapshot.activities.findIndex(
          (activity) => activity.id === event.id
        )

        if (activityIndex < 0) {
          for (
            let index = snapshot.activities.length - 1;
            index >= 0;
            index--
          ) {
            const activity = snapshot.activities[index]

            if (
              activity.toolName === event.name &&
              activity.status === "running"
            ) {
              activityIndex = index
              break
            }
          }
        }

        const nextActivity: StudioMessageActivity =
          activityIndex >= 0
            ? {
                ...snapshot.activities[activityIndex],
                status: event.status,
                output: event.output ?? "",
                error: event.error ?? null,
              }
            : {
                id: event.id,
                toolName: event.name,
                status: event.status,
                input: "",
                output: event.output ?? "",
                error: event.error ?? null,
              }

        snapshot = {
          ...snapshot,
          activities:
            activityIndex >= 0
              ? snapshot.activities.map((activity, index) =>
                  index === activityIndex ? nextActivity : activity
                )
              : [...snapshot.activities, nextActivity],
        }
        upsertToolPart(nextActivity)
        return true
      }
      case "plan_update":
        return upsertPlanPart(event.todos)
      case "subagent_start":
        debugIgnoredAgentEvent("subagent_start_ignored", {
          taskId: event.taskId,
          name: event.name,
        })
        return false
      case "subagent_end":
        debugIgnoredAgentEvent("subagent_end_ignored", {
          taskId: event.taskId,
          name: event.name,
        })
        return false
      case "file_change":
        debugIgnoredAgentEvent("file_change_ignored", {
          path: event.path,
          kind: event.kind,
        })
        return false
      case "permission_request":
        debugIgnoredAgentEvent("permission_request_ignored", {
          requestId: event.requestId,
          toolName: event.toolName,
          decisionCount: event.decisions.length,
        })
        return false
      case "run_meta":
        debugIgnoredAgentEvent("run_meta_ignored", {
          sessionRef: event.sessionRef,
          hasUsage: Boolean(event.usage),
        })
        return false
      case "error":
        debugIgnoredAgentEvent("error_event_ignored", {
          message: event.message,
        })
        return false
    }
  }

  function getSnapshot() {
    return snapshot
  }

  function completeReasoning() {
    markReasoningDone()
    return snapshot
  }

  function finalizeStopped() {
    markReasoningDone()
    const completedActivities = snapshot.activities.filter(
      (activity) => activity.status !== "running"
    )
    const completedActivityIds = new Set(
      completedActivities.map((activity) => activity.id)
    )

    snapshot = {
      ...snapshot,
      activities: completedActivities,
      parts: snapshot.parts.filter((part) => {
        if (
          part.type === "text" ||
          part.type === "reasoning" ||
          part.type === "plan"
        ) {
          return true
        }

        return completedActivityIds.has(part.activity.id)
      }),
    }

    return snapshot
  }

  function finalizeFailed(message: string) {
    markReasoningDone()

    const activities = snapshot.activities.map((activity) =>
      activity.status === "running"
        ? {
            ...activity,
            status: "error" as const,
            error: message,
          }
        : activity
    )

    const parts = snapshot.parts.map((part) =>
      part.type === "tool"
        ? {
            ...part,
            activity:
              activities.find((activity) => activity.id === part.activity.id) ??
              part.activity,
          }
        : part
    )

    if (
      !snapshot.content.trim() &&
      !snapshot.reasoningContent.trim() &&
      activities.length === 0
    ) {
      snapshot = {
        ...snapshot,
        content: message,
        activities,
        parts: [
          ...parts,
          {
            id: randomUUID(),
            type: "text",
            content: message,
          },
        ],
      }
      return snapshot
    }

    snapshot = {
      ...snapshot,
      activities,
      parts,
    }

    return snapshot
  }

  return {
    completeReasoning,
    finalizeFailed,
    finalizeStopped,
    getSnapshot,
    handleEvent,
  }
}

function persistAssistantSnapshot({
  assistantMessageId,
  sessionId,
  snapshot,
  status,
}: {
  assistantMessageId: string
  sessionId: string
  snapshot: ChatStreamSnapshot
  status: StudioMessageStatus
}) {
  updateStudioMessageSnapshot({
    messageId: assistantMessageId,
    sessionId,
    content: snapshot.content,
    activities: snapshot.activities,
    parts: snapshot.parts,
    reasoningContent: snapshot.reasoningContent,
    reasoningDurationMs: snapshot.reasoningDurationMs,
    status,
  })
}

async function executeAgentRun({
  messages,
  model,
  reasoningEffort,
  record,
  runtime,
  sessionId,
}: {
  messages: AgentRunInput["messages"]
  model: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
  record: StudioChatRunRecord
  runtime: AgentRuntime
  sessionId: string
}) {
  const accumulator = createSnapshotAccumulator()
  let lastPersistAt = 0

  const persistSnapshot = (
    status: StudioMessageStatus = "streaming",
    force = false
  ) => {
    record.latestSnapshot = accumulator.getSnapshot()

    const timestamp = Date.now()

    if (!force && timestamp - lastPersistAt < SNAPSHOT_PERSIST_INTERVAL_MS) {
      scheduleRunLiveSnapshot(record, force)
      return
    }

    lastPersistAt = timestamp
    persistAssistantSnapshot({
      assistantMessageId: record.assistantMessageId,
      sessionId,
      snapshot: record.latestSnapshot,
      status,
    })
    scheduleRunLiveSnapshot(record, force)
  }

  try {
    setRunStatus(record, "running")
    persistSnapshot("streaming", true)

    for await (const event of runtime.startRun({
      sessionId,
      messages,
      model,
      reasoningEffort,
      signal: record.abortController.signal,
    })) {
      if (accumulator.handleEvent(event)) {
        persistSnapshot()
      }
    }

    if (record.abortController.signal.aborted) {
      accumulator.finalizeStopped()
      setRunStatus(record, "cancelled")
      persistSnapshot("complete", true)
      return
    }

    accumulator.completeReasoning()
    setRunStatus(record, "complete")
    persistSnapshot("complete", true)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Chat request failed."

    if (isAbortLikeError(error, record.abortController.signal)) {
      accumulator.finalizeStopped()
      setRunStatus(record, "cancelled")
      persistSnapshot("complete", true)
      return
    }

    console.error("[studio-chat] run_failed", error)
    accumulator.finalizeFailed(message)
    setRunStatus(record, "error", message)
    persistSnapshot("error", true)
  }
}

export function getAgentRun(sessionId: string) {
  const record = getStudioChatRuns().get(sessionId)

  return record ? toRunSnapshot(record) : null
}

export function cancelAgentRun(sessionId: string) {
  const record = getStudioChatRuns().get(sessionId)

  if (!record || record.status === "complete" || record.status === "error") {
    return null
  }

  record.abortController.abort()
  setRunStatus(record, "cancelled")

  return toRunSnapshot(record)
}

export function getAgentRunLiveSnapshot(sessionId: string) {
  const record = getStudioChatRuns().get(sessionId)

  return record ? toRunLiveSnapshot(record) : null
}

export function subscribeAgentRun(
  sessionId: string,
  listener: StudioChatRunListener
) {
  const listenersBySession = getStudioChatRunListeners()
  const listeners =
    listenersBySession.get(sessionId) ?? new Set<StudioChatRunListener>()

  listeners.add(listener)
  listenersBySession.set(sessionId, listeners)

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0) {
      listenersBySession.delete(sessionId)
    }
  }
}

export function startAgentRun({
  createMessages,
  model,
  reasoningEffort,
  retryMessageId,
  runtime,
  sessionId,
}: {
  createMessages: () => AgentRunInput["messages"]
  model: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
  retryMessageId?: string
  runtime: AgentRuntime
  sessionId: string
}) {
  const existing = getStudioChatRuns().get(sessionId)

  if (
    existing &&
    (existing.status === "queued" || existing.status === "running")
  ) {
    return toRunSnapshot(existing)
  }

  if (!getStudioSession(sessionId)) {
    throw new Error("Session not found")
  }

  const messages = createMessages()
  const assistantMessage = createStudioMessage({
    sessionId,
    role: "assistant",
    content: "",
    model,
    replacesMessageId: retryMessageId ?? null,
    status: "streaming",
  })
  const timestamp = nowIso()
  const record: StudioChatRunRecord = {
    runId: randomUUID(),
    sessionId,
    assistantMessageId: assistantMessage.id,
    status: "queued",
    error: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    abortController: new AbortController(),
    cleanupTimer: null,
    latestSnapshot: createInitialSnapshot(),
    liveMessageBase: assistantMessage,
    livePublishTimer: null,
    lastLivePublishedAt: 0,
    promise: null,
  }

  getStudioChatRuns().set(sessionId, record)

  record.promise = executeAgentRun({
    messages,
    model,
    reasoningEffort,
    record,
    runtime,
    sessionId,
  }).finally(() => {
    scheduleRunCleanup(record)
  })

  return toRunSnapshot(record)
}
