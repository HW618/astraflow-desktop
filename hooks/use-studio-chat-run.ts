"use client"

import * as React from "react"

import type { StudioChatRunLiveSnapshot } from "@/lib/studio-types"

function parseLiveSnapshot(event: MessageEvent<string>) {
  try {
    return JSON.parse(event.data) as StudioChatRunLiveSnapshot
  } catch {
    return null
  }
}

function useLatestRef<T>(value: T) {
  const ref = React.useRef(value)

  React.useEffect(() => {
    ref.current = value
  }, [value])

  return ref
}

export function useStudioChatRunLiveStream({
  enabled,
  onConnectionChange,
  onDone,
  onError,
  onSnapshot,
  sessionId,
}: {
  enabled: boolean
  onConnectionChange: (connected: boolean) => void
  onDone: () => void
  onError: () => void
  onSnapshot: (snapshot: StudioChatRunLiveSnapshot) => void
  sessionId: string
}) {
  const onConnectionChangeRef = useLatestRef(onConnectionChange)
  const onDoneRef = useLatestRef(onDone)
  const onErrorRef = useLatestRef(onError)
  const onSnapshotRef = useLatestRef(onSnapshot)

  React.useEffect(() => {
    if (!sessionId || !enabled) {
      return
    }

    if (typeof window === "undefined" || !("EventSource" in window)) {
      return
    }

    const source = new EventSource(
      `/api/studio/chat/events?sessionId=${encodeURIComponent(sessionId)}`
    )
    let closed = false
    let pendingSnapshot: StudioChatRunLiveSnapshot | null = null
    let pendingSnapshotFrame: number | null = null

    const flushPendingSnapshot = () => {
      pendingSnapshotFrame = null
      const snapshot = pendingSnapshot
      pendingSnapshot = null

      if (snapshot) {
        onSnapshotRef.current(snapshot)
      }
    }

    const scheduleSnapshot = (
      snapshot: StudioChatRunLiveSnapshot,
      force = false
    ) => {
      pendingSnapshot = snapshot

      if (force) {
        if (pendingSnapshotFrame !== null) {
          window.cancelAnimationFrame(pendingSnapshotFrame)
        }

        flushPendingSnapshot()
        return
      }

      if (pendingSnapshotFrame !== null) {
        return
      }

      pendingSnapshotFrame = window.requestAnimationFrame(flushPendingSnapshot)
    }

    let close = () => {}

    const handleOpen = () => {
      if (!closed) {
        onConnectionChangeRef.current(true)
      }
    }

    const handleSnapshot = (event: Event) => {
      const snapshot = parseLiveSnapshot(event as MessageEvent<string>)

      if (snapshot) {
        scheduleSnapshot(snapshot)
      }
    }

    const handleDone = (event: Event) => {
      const snapshot = parseLiveSnapshot(event as MessageEvent<string>)

      if (snapshot) {
        scheduleSnapshot(snapshot, true)
      }

      close()
      onDoneRef.current()
    }

    const handleError = () => {
      onConnectionChangeRef.current(false)
      close()
      onErrorRef.current()
    }

    close = () => {
      if (closed) {
        return
      }

      closed = true
      source.removeEventListener("open", handleOpen)
      source.removeEventListener("snapshot", handleSnapshot)
      source.removeEventListener("done", handleDone)
      if (pendingSnapshotFrame !== null) {
        window.cancelAnimationFrame(pendingSnapshotFrame)
        pendingSnapshotFrame = null
      }
      pendingSnapshot = null
      source.close()
    }

    source.addEventListener("open", handleOpen)
    source.addEventListener("snapshot", handleSnapshot)
    source.addEventListener("done", handleDone)
    source.onerror = handleError

    const handleCleanupConnectionChange = onConnectionChangeRef.current

    return () => {
      handleCleanupConnectionChange(false)
      close()
    }
  }, [
    enabled,
    onConnectionChangeRef,
    onDoneRef,
    onErrorRef,
    onSnapshotRef,
    sessionId,
  ])
}
