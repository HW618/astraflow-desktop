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
  sessionId: string
  toolName: string
}

export const PERMISSION_REQUEST_TIMEOUT_MS = 10 * 60 * 1000

const pendingPermissions = new Map<string, PendingPermission>()
const sessionPermissionRules = new Map<string, Set<string>>()

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

function getRuleToolName(toolName: string) {
  return toolName.trim()
}

function hasSessionPermissionRule(sessionId: string, toolName: string) {
  const normalizedToolName = getRuleToolName(toolName)

  return (
    normalizedToolName.length > 0 &&
    (sessionPermissionRules.get(sessionId)?.has(normalizedToolName) ?? false)
  )
}

function createSessionPermissionRule(sessionId: string, toolName: string) {
  const normalizedToolName = getRuleToolName(toolName)

  if (!normalizedToolName) {
    return
  }

  let rules = sessionPermissionRules.get(sessionId)

  if (!rules) {
    rules = new Set()
    sessionPermissionRules.set(sessionId, rules)
  }

  rules.add(normalizedToolName)
}

export function isReadOnlyToolKind(toolName: string) {
  // ACP ToolKind values are coarse; only retrieval categories may bypass review.
  return ["read", "search", "fetch"].includes(toolName.trim().toLowerCase())
}

export function requestPermission(input: {
  sessionId: string
  requestId: string
  toolName: string
  inputPreview: string
  options: PermissionOption[]
  signal: AbortSignal
  timeoutMs?: number
}): Promise<PermissionDecision> {
  const session = getStudioSession(input.sessionId)
  const projectId = session?.projectId ?? null
  const permissionMode = session?.permissionMode ?? "ask"

  if (permissionMode === "readonly") {
    const option = findRejectOption(input.options)

    return Promise.resolve(option ? { optionId: option.optionId } : { cancelled: true })
  }

  if (
    hasStudioPermissionRule({
      projectId,
      toolName: input.toolName,
    }) ||
    (projectId === null &&
      hasSessionPermissionRule(input.sessionId, input.toolName))
  ) {
    const option = findAllowOption(input.options)

    return Promise.resolve(option ? { optionId: option.optionId } : { cancelled: true })
  }

  if (permissionMode === "auto" && isReadOnlyToolKind(input.toolName)) {
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
    let timeout: NodeJS.Timeout | null = null
    const settle = (decision: PermissionDecision) => {
      if (pendingPermissions.get(key)?.resolve !== settle) {
        return
      }

      pendingPermissions.delete(key)
      if (timeout) {
        clearTimeout(timeout)
      }
      input.signal.removeEventListener("abort", abort)
      resolve(decision)
    }
    const abort = () => settle({ cancelled: true })

    timeout = setTimeout(
      () => settle({ cancelled: true }),
      input.timeoutMs ?? PERMISSION_REQUEST_TIMEOUT_MS
    )
    timeout.unref()

    pendingPermissions.set(key, {
      options: input.options,
      projectId,
      resolve: settle,
      sessionId: input.sessionId,
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
    if (pending.projectId === null) {
      createSessionPermissionRule(pending.sessionId, pending.toolName)
    } else {
      try {
        createStudioPermissionRule({
          projectId: pending.projectId,
          toolName: pending.toolName,
        })
      } catch (error) {
        console.error("[permission-broker] rule_create_failed", error)
      }
    }
  }

  pending.resolve({ optionId })

  return true
}

export function cancelSessionPermissions(sessionId: string) {
  let cancelled = 0
  const prefix = `${sessionId}:`

  for (const [key, pending] of pendingPermissions) {
    if (!key.startsWith(prefix)) {
      continue
    }

    pending.resolve({ cancelled: true })
    cancelled += 1
  }

  return cancelled
}
