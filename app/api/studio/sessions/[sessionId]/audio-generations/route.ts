import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { z } from "zod"

import {
  getAudioModelEndpoint,
  getAudioTaskStatusEndpoint,
  resolveAudioModelOperation,
} from "@/lib/audio-openapi"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getStoredModelverseApiKey } from "@/lib/modelverse-openai"
import {
  createStudioAudioGeneration,
  createStudioAudioOutput,
  listStudioAudioGenerations,
  updateStudioAudioGeneration,
} from "@/lib/studio-audio-db"
import type {
  StudioAudioModelOpenapi,
  StudioAudioOutput,
  StudioAudioParameterField,
} from "@/lib/studio-audio-types"
import { getStudioSession } from "@/lib/studio-db"
import {
  appendFormDataValue,
  getAsyncTaskId,
  getAsyncTaskStatus,
  getFieldKey,
  getParamValue,
  isTaskFailure,
  isTaskSuccess,
  parseDataUrl,
  readNumber,
  setPayloadValue,
  sleep,
} from "@/lib/studio-generation-shared"
import { writeDataUrlToStudioMediaFile } from "@/lib/studio-media-storage"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

type NormalizedOutput = {
  url?: string | null
  dataUrl?: string | null
  mimeType?: string | null
  durationSeconds?: number | null
  metadata?: unknown
}

const ASYNC_TASK_MAX_POLLS = 180
const ASYNC_TASK_POLL_INTERVAL_MS = 2_000

const attachmentSchema = z.object({
  name: z.string().trim().max(255).optional(),
  mimeType: z.string().trim().max(120).optional(),
  dataUrl: z
    .string()
    .trim()
    .regex(/^data:audio\//i)
    .max(80_000_000)
    .optional(),
})

const openapiMetadataSchema = z
  .object({
    file: z.string().trim().min(1).optional(),
    operationId: z.string().trim().min(1).optional(),
  })
  .passthrough()

const submitSchema = z.object({
  modelId: z.string().trim().min(1),
  modelName: z.string().trim().min(1),
  operationId: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).max(10_000),
  params: z.record(z.string(), z.unknown()).default({}),
  openapi: openapiMetadataSchema.optional(),
  fields: z.array(z.custom<StudioAudioParameterField>()).default([]),
  promptFieldKey: z.string().trim().min(1).nullable().optional(),
  attachments: z.record(z.string(), z.array(attachmentSchema)).default({}),
})

type SubmitInput = z.infer<typeof submitSchema>
type SubmitAttachment = z.infer<typeof attachmentSchema>

function getDefaultFieldValue(field: StudioAudioParameterField) {
  if (field.defaultValue !== undefined) {
    return field.defaultValue
  }

  if (!field.required) {
    return undefined
  }

  if (
    (field.kind === "number" || field.kind === "slider") &&
    typeof field.min === "number"
  ) {
    return field.min
  }

  if (field.kind === "select") {
    return field.options?.[0]?.value
  }

  if (field.kind === "boolean") {
    return false
  }

  return undefined
}

function getActivePromptFieldKey(
  fields: StudioAudioParameterField[],
  promptFieldKey?: string | null
) {
  return (
    promptFieldKey ??
    fields.find((field) => field.kind === "prompt")?.payloadPath.join(".") ??
    null
  )
}

function validatePromptFieldKey(
  fields: StudioAudioParameterField[],
  promptFieldKey?: string | null
) {
  if (!promptFieldKey) {
    return null
  }

  return fields.some(
    (field) => field.kind === "prompt" && getFieldKey(field) === promptFieldKey
  )
    ? promptFieldKey
    : undefined
}

function coerceFieldValue(
  field: StudioAudioParameterField,
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
    return Number.isFinite(parsed) ? parsed : undefined
  }

  if (field.kind === "textarea" && typeof value === "string") {
    const trimmed = value.trim()

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.parse(trimmed) as unknown
      } catch {
        return trimmed
      }
    }
  }

  return value
}

function buildJsonPayload({
  openapi,
  fields,
  prompt,
  params,
  promptFieldKey,
}: {
  openapi: StudioAudioModelOpenapi
  fields: StudioAudioParameterField[]
  prompt: string
  params: Record<string, unknown>
  promptFieldKey?: string | null
}) {
  const payload: Record<string, unknown> = {
    model: openapi.modelConstant,
  }
  const activePromptFieldKey = getActivePromptFieldKey(fields, promptFieldKey)

  for (const field of fields) {
    if (field.kind === "audio" || field.name === "model") {
      continue
    }

    let value: unknown

    if (
      field.kind === "prompt" &&
      getFieldKey(field) === activePromptFieldKey
    ) {
      value = prompt
    } else if (field.constantValue !== undefined) {
      value = field.constantValue
    } else {
      value =
        coerceFieldValue(field, getParamValue(params, field)) ??
        getDefaultFieldValue(field)
    }

    if (value === undefined) {
      continue
    }

    if (
      field.options &&
      field.options.length > 0 &&
      field.arrayItemKey !== undefined
    ) {
      const stringValue = String(value)
      value = [
        field.arrayItemKey
          ? { [field.arrayItemKey]: stringValue }
          : stringValue,
      ]
    }

    setPayloadValue(payload, field.payloadPath, value)
  }

  return payload
}

function attachmentToBlob(attachment: SubmitAttachment) {
  if (!attachment.dataUrl) {
    return null
  }

  const parsed = parseDataUrl(attachment.dataUrl)

  if (!parsed) {
    return null
  }

  const bytes = Buffer.from(parsed.base64, "base64")

  return {
    blob: new Blob([new Uint8Array(bytes)], { type: parsed.mimeType }),
    name:
      attachment.name?.trim() ||
      `reference.${parsed.mimeType.split("/")[1] ?? "mp3"}`,
  }
}

function buildFormData({
  openapi,
  fields,
  prompt,
  params,
  promptFieldKey,
  attachments,
}: {
  openapi: StudioAudioModelOpenapi
  fields: StudioAudioParameterField[]
  prompt: string
  params: Record<string, unknown>
  promptFieldKey?: string | null
  attachments: SubmitInput["attachments"]
}) {
  const formData = new FormData()
  const activePromptFieldKey = getActivePromptFieldKey(fields, promptFieldKey)

  for (const field of fields) {
    const key = field.payloadPath.at(-1) ?? field.name

    if (field.kind === "audio") {
      const first = attachments[getFieldKey(field)]?.[0]

      if (!first) {
        continue
      }

      const file = attachmentToBlob(first)

      if (!file) {
        throw new Error(`${field.label} requires a local audio file.`)
      }

      formData.append(key, file.blob, file.name)
      continue
    }

    const value =
      field.kind === "prompt" && getFieldKey(field) === activePromptFieldKey
        ? prompt
        : field.name === "model"
          ? (field.constantValue ?? openapi.modelConstant)
          : (field.constantValue ??
            coerceFieldValue(field, getParamValue(params, field)) ??
            getDefaultFieldValue(field))

    appendFormDataValue(formData, key, value)
  }

  if (!fields.some((field) => field.name === "model")) {
    formData.append("model", openapi.modelConstant)
  }

  return formData
}

function getProviderErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback
  }

  const error = (payload as { error?: { message?: unknown } }).error
  if (typeof error?.message === "string" && error.message) {
    return error.message
  }

  const baseResp = (payload as { base_resp?: Record<string, unknown> })
    .base_resp
  if (typeof baseResp?.status_msg === "string" && baseResp.status_msg) {
    return baseResp.status_msg
  }

  const output =
    "status" in payload
      ? ((payload as { status?: { output?: Record<string, unknown> } }).status
          ?.output ?? null)
      : (payload as { output?: Record<string, unknown> }).output

  if (typeof output?.error_message === "string" && output.error_message) {
    return output.error_message
  }

  return fallback
}

async function callProviderJson({
  url,
  payload,
  apiKey,
}: {
  url: string
  payload: unknown
  apiKey: string
}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  return readProviderResponse(response)
}

async function callProviderFormData({
  url,
  formData,
  apiKey,
}: {
  url: string
  formData: FormData
  apiKey: string
}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  return readProviderResponse(response)
}

function getMultipartBoundary(contentType: string) {
  const match = contentType.match(/boundary="?([^";]+)"?/i)
  return match?.[1] ?? null
}

function parsePartHeaders(value: string) {
  const headers: Record<string, string> = {}

  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf(":")

    if (separator <= 0) {
      continue
    }

    headers[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim()
  }

  return headers
}

function trimTrailingNewline(buffer: Buffer) {
  if (
    buffer.length >= 2 &&
    buffer[buffer.length - 2] === 13 &&
    buffer[buffer.length - 1] === 10
  ) {
    return buffer.subarray(0, -2)
  }

  if (buffer.length >= 1 && buffer[buffer.length - 1] === 10) {
    return buffer.subarray(0, -1)
  }

  return buffer
}

function parseMultipartAudio(buffer: Buffer, contentType: string) {
  const boundary = getMultipartBoundary(contentType)

  if (!boundary) {
    return null
  }

  const marker = Buffer.from(`--${boundary}`)
  let cursor = buffer.indexOf(marker)
  let audioBuffer: Buffer | null = null
  let audioMimeType = "audio/mpeg"
  let metadata: unknown = null

  while (cursor >= 0) {
    let partStart = cursor + marker.length

    if (buffer.subarray(partStart, partStart + 2).toString() === "--") {
      break
    }

    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) {
      partStart += 2
    } else if (buffer[partStart] === 10) {
      partStart += 1
    }

    const next = buffer.indexOf(marker, partStart)

    if (next < 0) {
      break
    }

    const part = trimTrailingNewline(buffer.subarray(partStart, next))
    const crlfSeparator = part.indexOf(Buffer.from("\r\n\r\n"))
    const lfSeparator = part.indexOf(Buffer.from("\n\n"))
    const separator = crlfSeparator >= 0 ? crlfSeparator : lfSeparator

    if (separator >= 0) {
      const separatorLength = crlfSeparator >= 0 ? 4 : 2
      const headers = parsePartHeaders(part.subarray(0, separator).toString())
      const partContentType =
        headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? ""
      const body = part.subarray(separator + separatorLength)

      if (
        partContentType.startsWith("audio/") ||
        partContentType === "application/octet-stream"
      ) {
        audioBuffer = Buffer.from(body)
        audioMimeType =
          partContentType === "application/octet-stream"
            ? "audio/mpeg"
            : partContentType
      } else if (partContentType === "application/json") {
        try {
          metadata = JSON.parse(body.toString("utf8")) as unknown
        } catch {
          metadata = body.toString("utf8")
        }
      }
    }

    cursor = next
  }

  if (!audioBuffer) {
    return null
  }

  return {
    dataUrl: `data:${audioMimeType};base64,${audioBuffer.toString("base64")}`,
    mimeType: audioMimeType,
    metadata,
  }
}

async function readProviderResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? ""

  if (contentType.startsWith("multipart/")) {
    const buffer = Buffer.from(await response.arrayBuffer())
    const multipartAudio = parseMultipartAudio(buffer, contentType)

    if (multipartAudio) {
      return {
        ok: response.ok,
        status: response.status,
        body: multipartAudio,
      }
    }
  }

  if (
    contentType.startsWith("audio/") ||
    contentType.includes("application/octet-stream")
  ) {
    const mimeType = contentType.split(";")[0]?.trim() || "audio/mpeg"
    const buffer = Buffer.from(await response.arrayBuffer())

    return {
      ok: response.ok,
      status: response.status,
      body: {
        dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
        mimeType,
      },
    }
  }

  const text = await response.text()
  let parsed: unknown = null

  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }

  return { ok: response.ok, status: response.status, body: parsed }
}

async function pollAsyncTask({
  statusUrl,
  taskId,
  apiKey,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
}) {
  const url = new URL(statusUrl)
  url.searchParams.set("task_id", taskId)

  for (let attempt = 0; attempt < ASYNC_TASK_MAX_POLLS; attempt += 1) {
    if (attempt > 0) {
      await sleep(ASYNC_TASK_POLL_INTERVAL_MS)
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const parsed = await readProviderResponse(response)

    if (!parsed.ok) {
      return parsed
    }

    const taskStatus = getAsyncTaskStatus(parsed.body)

    if (isTaskSuccess(taskStatus)) {
      return parsed
    }

    if (isTaskFailure(taskStatus)) {
      return { ...parsed, ok: false }
    }
  }

  return {
    ok: false,
    status: 504,
    body: { error: { message: "Async audio task timed out." } },
  }
}

function isHexAudio(value: string) {
  return (
    value.length > 100 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)
  )
}

function findAudioUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const stack = [payload]

  while (stack.length > 0) {
    const current = stack.pop()

    if (!current || typeof current !== "object") {
      continue
    }

    for (const [key, value] of Object.entries(current)) {
      if (
        typeof value === "string" &&
        (key === "url" || key === "audio") &&
        /^https?:\/\//i.test(value)
      ) {
        return value
      }

      if (value && typeof value === "object") {
        stack.push(value)
      }
    }
  }

  return null
}

function extractAudioOutputs(payload: unknown): NormalizedOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const directData = payload as {
    dataUrl?: unknown
    metadata?: unknown
    mimeType?: unknown
  }

  if (typeof directData.dataUrl === "string") {
    return [
      {
        dataUrl: directData.dataUrl,
        url: null,
        mimeType:
          typeof directData.mimeType === "string"
            ? directData.mimeType
            : "audio/mpeg",
        durationSeconds: null,
        metadata: directData.metadata ?? null,
      },
    ]
  }

  const finalPayload =
    "status" in payload ? (payload as { status?: unknown }).status : payload

  if (!finalPayload || typeof finalPayload !== "object") {
    return []
  }

  const output = (finalPayload as { output?: Record<string, unknown> }).output
  const urls = Array.isArray(output?.urls) ? output.urls : []
  const rawDurationSeconds =
    readNumber(output?.duration) ??
    readNumber(
      (finalPayload as { extra_info?: Record<string, unknown> }).extra_info
        ?.audio_length
    )
  const durationSeconds =
    rawDurationSeconds && rawDurationSeconds > 1000
      ? rawDurationSeconds / 1000
      : rawDurationSeconds

  if (urls.length > 0) {
    return urls
      .filter((url): url is string => typeof url === "string" && url.length > 0)
      .map((url) => ({
        url,
        dataUrl: null,
        mimeType: null,
        durationSeconds: Number.isFinite(durationSeconds)
          ? durationSeconds
          : null,
        metadata: output ?? null,
      }))
  }

  const directUrl = findAudioUrl(finalPayload)

  if (directUrl) {
    return [
      {
        url: directUrl,
        dataUrl: null,
        mimeType: null,
        durationSeconds: Number.isFinite(durationSeconds)
          ? durationSeconds
          : null,
        metadata: finalPayload,
      },
    ]
  }

  const data = (finalPayload as { data?: Record<string, unknown> }).data
  const audio = data?.audio

  if (typeof audio === "string" && isHexAudio(audio)) {
    const format =
      (finalPayload as { extra_info?: Record<string, unknown> }).extra_info
        ?.audio_format ?? "mp3"
    const mimeType = `audio/${format === "mp3" ? "mpeg" : String(format)}`
    const buffer = Buffer.from(audio, "hex")

    return [
      {
        dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
        url: null,
        mimeType,
        durationSeconds: Number.isFinite(durationSeconds)
          ? durationSeconds
          : null,
        metadata: finalPayload,
      },
    ]
  }

  return []
}

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params
  const session = getStudioSession(sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: listStudioAudioGenerations(sessionId),
  })
}

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params
  const session = getStudioSession(sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  if (session.mode !== "audio") {
    return NextResponse.json(
      { ok: false, error: "Session is not an audio session." },
      { status: 400 }
    )
  }

  const parsed = submitSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const resolvedOperation = resolveAudioModelOperation({
    modelId: parsed.data.modelId,
    modelName: parsed.data.modelName,
    file: parsed.data.openapi?.file,
    operationId: parsed.data.operationId ?? parsed.data.openapi?.operationId,
  })

  if (!resolvedOperation) {
    return NextResponse.json(
      { ok: false, error: "Audio operation is not supported for this model." },
      { status: 400 }
    )
  }

  if (resolvedOperation.fields.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Audio operation fields are not available." },
      { status: 400 }
    )
  }

  const promptFieldKey = validatePromptFieldKey(
    resolvedOperation.fields,
    parsed.data.promptFieldKey
  )

  if (promptFieldKey === undefined) {
    return NextResponse.json(
      { ok: false, error: "Audio prompt field is not supported." },
      { status: 400 }
    )
  }

  const apiKey = getStoredModelverseApiKey()

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Modelverse API key is not configured locally." },
      { status: 400 }
    )
  }

  const generation = createStudioAudioGeneration({
    sessionId,
    modelSquareId: parsed.data.modelId,
    modelName: parsed.data.modelName,
    openapiFile: resolvedOperation.openapi.file,
    operationId: resolvedOperation.openapi.operationId,
    prompt: parsed.data.prompt,
    params: parsed.data.params,
    status: "running",
  })

  const endpointUrl = getAudioModelEndpoint(resolvedOperation.openapi)

  try {
    let providerResponse: { ok: boolean; status: number; body: unknown }

    if (resolvedOperation.openapi.contentType === "multipart/form-data") {
      const formData = buildFormData({
        openapi: resolvedOperation.openapi,
        fields: resolvedOperation.fields,
        prompt: parsed.data.prompt,
        params: parsed.data.params,
        promptFieldKey,
        attachments: parsed.data.attachments,
      })

      providerResponse = await callProviderFormData({
        url: endpointUrl,
        formData,
        apiKey,
      })
    } else {
      const payload = buildJsonPayload({
        openapi: resolvedOperation.openapi,
        fields: resolvedOperation.fields,
        prompt: parsed.data.prompt,
        params: parsed.data.params,
        promptFieldKey,
      })

      providerResponse = await callProviderJson({
        url: endpointUrl,
        payload,
        apiKey,
      })
    }

    if (
      providerResponse.ok &&
      resolvedOperation.openapi.adapter === "async-task"
    ) {
      const taskId = getAsyncTaskId(providerResponse.body)
      const statusUrl = getAudioTaskStatusEndpoint(resolvedOperation.openapi)

      if (!taskId || !statusUrl) {
        providerResponse = {
          ok: false,
          status: 502,
          body: {
            submit: providerResponse.body,
            error: { message: "No async task id returned by the provider." },
          },
        }
      } else {
        const statusResponse = await pollAsyncTask({
          statusUrl,
          taskId,
          apiKey,
        })

        providerResponse = {
          ok: statusResponse.ok,
          status: statusResponse.status,
          body: {
            submit: providerResponse.body,
            status: statusResponse.body,
          },
        }
      }
    }

    if (!providerResponse.ok) {
      const message = getProviderErrorMessage(
        providerResponse.body,
        `Provider returned ${providerResponse.status}`
      )

      updateStudioAudioGeneration(generation.id, {
        status: "error",
        errorMessage: String(message),
        rawResponse: providerResponse.body,
      })

      return NextResponse.json(
        {
          ok: false,
          error: String(message),
          data: { ...generation, status: "error", errorMessage: message },
        },
        { status: 502 }
      )
    }

    const outputs = extractAudioOutputs(providerResponse.body)

    if (outputs.length === 0) {
      updateStudioAudioGeneration(generation.id, {
        status: "error",
        errorMessage: "No audio returned by the provider.",
        rawResponse: providerResponse.body,
      })

      return NextResponse.json(
        { ok: false, error: "No audio returned by the provider." },
        { status: 502 }
      )
    }

    const stored: StudioAudioOutput[] = []

    outputs.forEach((output, index) => {
      const outputId = randomUUID()
      const storedMedia = output.dataUrl
        ? writeDataUrlToStudioMediaFile({
            kind: "audio",
            generationId: generation.id,
            outputId,
            dataUrl: output.dataUrl,
            fallbackMimeType: output.mimeType,
          })
        : null

      stored.push(
        createStudioAudioOutput({
          id: outputId,
          generationId: generation.id,
          index,
          url: output.url ?? null,
          dataUrl: null,
          storagePath: storedMedia?.storagePath ?? null,
          mimeType: storedMedia?.mimeType ?? output.mimeType ?? null,
          durationSeconds: output.durationSeconds ?? null,
          metadata: output.metadata,
        })
      )
    })

    updateStudioAudioGeneration(generation.id, {
      status: "complete",
      rawResponse: providerResponse.body,
    })

    return NextResponse.json(
      {
        ok: true,
        data: {
          ...generation,
          status: "complete",
          outputs: stored,
          completedAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Audio generation failed."

    updateStudioAudioGeneration(generation.id, {
      status: "error",
      errorMessage: message,
    })

    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
