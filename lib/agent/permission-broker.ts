import {
  createStudioPermissionRule,
  getStudioSession,
  hasStudioPermissionRule,
} from "@/lib/studio-db"

export type PermissionOption = {
  optionId: string
  name: string
  kind: string
}

export type PermissionDecision =
  | { optionId: string }
  | { cancelled: true }

type PendingPermission = {
  options: PermissionOption[]
  projectId: string | null
  resolve: (decision: PermissionDecision) => void
  toolName: string
}

const pendingPermissions = new Map<string, PendingPermission>()

function getPendingKey(sessionId: string, requestId: string) {
  return `${sessionId}:${requestId}`
}

function findAllowOption(options: PermissionOption[]) {
  return (
    options.find((option) => option.kind === "allow_once") ??
    options.find((option) => option.kind.startsWith("allow")) ??
    null
  )
}

function findRejectOption(options: PermissionOption[]) {
  return (
    options.find((option) => option.kind === "reject_once") ??
    options.find((option) => option.kind.startsWith("reject")) ??
    null
  )
}

export function requestPermission(input: {
  sessionId: string
  requestId: string
  toolName: string
  inputPreview: string
  options: PermissionOption[]
  signal: AbortSignal
}): Promise<PermissionDecision> {
  const session = getStudioSession(input.sessionId)
  const projectId = session?.projectId ?? null
  const permissionMode = session?.permissionMode ?? "auto"

  if (permissionMode === "readonly") {
    const option = findRejectOption(input.options)

    return Promise.resolve(option ? { optionId: option.optionId } : { cancelled: true })
  }

  if (
    hasStudioPermissionRule({
      projectId,
      toolName: input.toolName,
    })
  ) {
    const option = findAllowOption(input.options)

    return Promise.resolve(option ? { optionId: option.optionId } : { cancelled: true })
  }

  if (permissionMode === "auto") {
    const option = findAllowOption(input.options)

    return Promise.resolve(option ? { optionId: option.optionId } : { cancelled: true })
  }

  if (input.options.length === 0 || input.signal.aborted) {
    return Promise.resolve({ cancelled: true })
  }

  const key = getPendingKey(input.sessionId, input.requestId)
  const existing = pendingPermissions.get(key)

  if (existing) {
    existing.resolve({ cancelled: true })
  }

  return new Promise<PermissionDecision>((resolve) => {
    const settle = (decision: PermissionDecision) => {
      if (pendingPermissions.get(key)?.resolve !== settle) {
        return
      }

      pendingPermissions.delete(key)
      input.signal.removeEventListener("abort", abort)
      resolve(decision)
    }
    const abort = () => settle({ cancelled: true })

    pendingPermissions.set(key, {
      options: input.options,
      projectId,
      resolve: settle,
      toolName: input.toolName,
    })
    input.signal.addEventListener("abort", abort, { once: true })
  })
}

export function resolvePermission(
  sessionId: string,
  requestId: string,
  optionId: string
) {
  const key = getPendingKey(sessionId, requestId)
  const pending = pendingPermissions.get(key)

  if (!pending) {
    return false
  }

  const option = pending.options.find(
    (candidate) => candidate.optionId === optionId
  )

  if (!option) {
    return false
  }

  if (option.kind === "allow_always") {
    try {
      createStudioPermissionRule({
        projectId: pending.projectId,
        toolName: pending.toolName,
      })
    } catch (error) {
      console.error("[permission-broker] rule_create_failed", error)
    }
  }

  pending.resolve({ optionId })

  return true
}
