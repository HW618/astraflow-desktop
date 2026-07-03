// Shared pure helpers for the studio media generation routes (image / audio /
// video). Only implementations that are identical (or semantically equivalent
// modulo the concrete parameter-field type) across routes live here. Route-
// specific variants stay in their own route files.

type FieldKeyShape = {
  payloadPath: string[]
  name: string
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parses a strict base64 data URL (`data:<mime>;base64,<data>`). Returns the
 * raw base64 string, not decoded bytes. The image route uses a looser parser
 * that also decodes bytes, so it keeps its own local implementation.
 */
export function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;]+);base64,(.+)$/)

  if (!match) {
    return null
  }

  return {
    mimeType: match[1],
    base64: match[2],
  }
}

export function coerceFieldValue<Field extends { kind: string }>(
  field: Field,
  value: unknown
): unknown {
  if (value === undefined || value === null || value === "") {
    return undefined
  }

  if (field.kind === "boolean") {
    if (typeof value === "boolean") {
      return value
    }
    if (typeof value === "string") {
      if (value === "true") return true
      if (value === "false") return false
    }
    return undefined
  }

  if (field.kind === "number" || field.kind === "slider") {
    const parsed = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(parsed)) {
      return undefined
    }
    return parsed
  }

  return value
}

export function setPayloadValue(
  payload: Record<string, unknown>,
  path: string[],
  value: unknown
) {
  let target: Record<string, unknown> = payload

  for (const segment of path.slice(0, -1)) {
    const current = target[segment]

    if (!current || typeof current !== "object" || Array.isArray(current)) {
      target[segment] = {}
    }

    target = target[segment] as Record<string, unknown>
  }

  target[path[path.length - 1]] = value
}

export function getFieldKey<Field extends FieldKeyShape>(field: Field) {
  return field.payloadPath.join(".") || field.name
}

export function getParamValue<Field extends FieldKeyShape>(
  params: Record<string, unknown>,
  field: Field
) {
  return params[getFieldKey(field)] ?? params[field.name]
}

export function appendFormDataValue(
  formData: FormData,
  key: string,
  value: unknown
) {
  if (value === undefined || value === null || value === "") {
    return
  }

  if (typeof value === "string") {
    formData.append(key, value)
    return
  }

  if (typeof value === "number" || typeof value === "boolean") {
    formData.append(key, String(value))
    return
  }

  formData.append(key, JSON.stringify(value))
}

/**
 * Resolves a provider error message from the common `error.message` /
 * `status.output.error_message` shapes. The audio route additionally inspects
 * `base_resp.status_msg` and resolves the output differently, so it keeps its
 * own local implementation.
 */
export function getProviderErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback
  }

  const error = (payload as { error?: { message?: unknown } }).error
  if (typeof error?.message === "string" && error.message) {
    return error.message
  }

  const statusPayload =
    "status" in payload ? (payload as { status?: unknown }).status : payload

  if (statusPayload && typeof statusPayload === "object") {
    const output = (statusPayload as { output?: Record<string, unknown> })
      .output
    if (typeof output?.error_message === "string" && output.error_message) {
      return output.error_message
    }
  }

  return fallback
}

export function getAsyncTaskId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const output = (payload as { output?: Record<string, unknown> }).output
  const taskId = output?.task_id

  if (typeof taskId === "string" && taskId) {
    return taskId
  }

  if (typeof taskId === "number" && Number.isFinite(taskId)) {
    return String(taskId)
  }

  return null
}

export function getAsyncTaskStatus(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const output = (payload as { output?: Record<string, unknown> }).output
  const status = output?.task_status

  return typeof status === "string" ? status : null
}

export function isTaskSuccess(status: string | null) {
  return ["success", "succeeded", "complete", "completed"].includes(
    status?.toLowerCase() ?? ""
  )
}

export function isTaskFailure(status: string | null) {
  return ["failure", "failed", "error", "cancelled", "canceled"].includes(
    status?.toLowerCase() ?? ""
  )
}

export function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

export function mergeOutputMetadata(
  metadata: unknown,
  extra: Record<string, unknown>
) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return {
      ...metadata,
      ...extra,
    }
  }

  if (metadata === undefined || metadata === null) {
    return extra
  }

  return {
    sourceMetadata: metadata,
    ...extra,
  }
}
