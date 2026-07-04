const PENDING_PROJECT_STORAGE_KEY = "astraflow:pending-project"
const PENDING_PROJECT_MAX_AGE_MS = 30_000

type PendingProjectPayload = {
  projectId: string
  createdAt: number
}

function readPendingProjectPayload(): PendingProjectPayload | null {
  if (typeof window === "undefined") {
    return null
  }

  const raw = window.localStorage.getItem(PENDING_PROJECT_STORAGE_KEY)?.trim()

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PendingProjectPayload>

    if (
      typeof parsed.projectId === "string" &&
      parsed.projectId.trim() &&
      typeof parsed.createdAt === "number"
    ) {
      return {
        projectId: parsed.projectId.trim(),
        createdAt: parsed.createdAt,
      }
    }
  } catch {
    // Legacy string values are stale by definition; remove them below.
  }

  window.localStorage.removeItem(PENDING_PROJECT_STORAGE_KEY)
  return null
}

export function getPendingProjectId() {
  const payload = readPendingProjectPayload()

  if (!payload || Date.now() - payload.createdAt > PENDING_PROJECT_MAX_AGE_MS) {
    setPendingProjectId(null)
    return null
  }

  return payload.projectId
}

export function consumePendingProjectId() {
  const projectId = getPendingProjectId()

  setPendingProjectId(null)
  return projectId
}

export function setPendingProjectId(projectId: string | null) {
  if (typeof window === "undefined") {
    return
  }

  if (projectId) {
    window.localStorage.setItem(
      PENDING_PROJECT_STORAGE_KEY,
      JSON.stringify({ projectId, createdAt: Date.now() })
    )
  } else {
    window.localStorage.removeItem(PENDING_PROJECT_STORAGE_KEY)
  }
}
