import { NextResponse } from "next/server"
import { z } from "zod"

import { getAppAuthState } from "@/lib/app-auth"
import { getStoredModelverseApiKey } from "@/lib/modelverse-openai"
import { getStudioSession } from "@/lib/studio-db"
import {
  createStudioVideoGeneration,
  createStudioVideoOutput,
  listStudioVideoGenerations,
  recordStudioVideoGenerationTask,
  updateStudioVideoGeneration,
} from "@/lib/studio-video-db"
import { downloadVideoAsDataUrl } from "@/lib/studio-video-storage"
import type {
  StudioVideoModelOpenapi,
  StudioVideoOutput,
  StudioVideoParameterField,
} from "@/lib/studio-video-types"
import {
  getVideoModelEndpoint,
  getVideoTaskStatusEndpoint,
} from "@/lib/video-openapi"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

type NormalizedOutput = {
  url?: string | null
  dataUrl?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  metadata?: unknown
}

const ASYNC_TASK_MAX_POLLS = 180
const ASYNC_TASK_POLL_INTERVAL_MS = 2_000

const paramsSchema = z.record(z.string(), z.unknown())
const mediaAttachmentSchema = z.object({
  name: z.string().trim().max(255).optional(),
  mimeType: z.string().trim().max(120).optional(),
  dataUrl: z
    .string()
    .trim()
    .regex(/^data:image\//i)
    .max(80_000_000)
    .optional(),
  url: z.string().trim().url().max(4_000).optional(),
})

const submitSchema = z.object({
  modelId: z.string().trim().min(1),
  modelName: z.string().trim().min(1),
  prompt: z.string().trim().min(1).max(8_000),
  params: paramsSchema.default({}),
  openapi: z.object({
    file: z.string().trim().min(1),
    title: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    method: z.literal("POST"),
    path: z.string().trim().min(1),
    statusPath: z.string().trim().min(1),
    contentType: z.enum(["application/json", "multipart/form-data"]),
    adapter: z.enum(["async-task", "openai-video"]),
    modelValues: z.array(z.string()),
    modelConstant: z.string().trim().min(1),
  }),
  fields: z.array(z.custom<StudioVideoParameterField>()).default([]),
  media: z.record(z.string(), z.array(mediaAttachmentSchema)).default({}),
  attachments: z.array(mediaAttachmentSchema).default([]),
})

type SubmitInput = z.infer<typeof submitSchema>
type SubmitAttachment = z.infer<typeof mediaAttachmentSchema>

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;]+);base64,(.+)$/)

  if (!match) {
    return null
  }

  return {
    mimeType: match[1],
    base64: match[2],
  }
}

function coerceFieldValue(
  field: StudioVideoParameterField,
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

function setPayloadValue(
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

function getVideoFieldKey(field: StudioVideoParameterField) {
  return field.payloadPath.join(".") || field.name
}

function getParamValue(
  params: Record<string, unknown>,
  field: StudioVideoParameterField
) {
  return params[getVideoFieldKey(field)] ?? params[field.name]
}

function mediaForField({
  media,
  attachments,
  field,
}: {
  media: SubmitInput["media"]
  attachments: SubmitAttachment[]
  field: StudioVideoParameterField
}) {
  const specific =
    media[getVideoFieldKey(field)] ??
    media[field.name] ??
    media[field.payloadPath.at(-1) ?? ""]

  if (specific) {
    return specific
  }

  return Object.keys(media).length > 0 ? [] : attachments
}

function allMediaAttachments({
  media,
  attachments,
}: {
  media: SubmitInput["media"]
  attachments: SubmitAttachment[]
}) {
  const values = Object.values(media).flat()

  return values.length > 0 ? values : attachments
}

function firstMediaValue(
  attachments: SubmitAttachment[],
  paramsValue: unknown
) {
  if (typeof paramsValue === "string" && paramsValue.trim()) {
    return paramsValue.trim()
  }

  const first = attachments[0]
  return first?.url ?? first?.dataUrl ?? undefined
}

function mediaValueForField(
  field: StudioVideoParameterField,
  attachments: SubmitAttachment[],
  paramsValue: unknown
) {
  const values = attachments
    .map((attachment) => attachment.url ?? attachment.dataUrl ?? null)
    .filter((value): value is string => Boolean(value))

  if (typeof paramsValue === "string" && paramsValue.trim()) {
    values.unshift(paramsValue.trim())
  }

  if (values.length === 0) {
    return undefined
  }

  const first = values[0]
  const parsed = first.startsWith("data:") ? parseDataUrl(first) : null

  if (parsed && field.mediaShape === "object-base64") {
    return {
      bytesBase64Encoded: parsed.base64,
      mimeType: parsed.mimeType,
    }
  }

  if (field.mediaShape === "array-object") {
    const payloadKey = field.mediaPayloadKey ?? field.name

    return values.map((value, index) => {
      const item: Record<string, unknown> = { [payloadKey]: value }
      const roleValue = field.mediaRoleValues?.[index]

      if (field.mediaRoleKey && roleValue) {
        item[field.mediaRoleKey] = roleValue
      }

      return item
    })
  }

  if (field.acceptMultiple) {
    return values
  }

  return first
}

function buildContentItems(
  prompt: string,
  attachments: SubmitAttachment[]
) {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: prompt,
    },
  ]

  attachments.forEach((attachment, index) => {
    const value = attachment.url ?? attachment.dataUrl
    if (!value) return

    content.push({
      type: "image_url",
      image_url: { url: value },
      role:
        index === 0
          ? "first_frame"
          : index === 1
            ? "last_frame"
            : "reference_image",
    })
  })

  return content
}

function buildVideoPayload({
  openapi,
  fields,
  prompt,
  params,
  media,
  attachments,
}: {
  openapi: StudioVideoModelOpenapi
  fields: StudioVideoParameterField[]
  prompt: string
  params: Record<string, unknown>
  media: SubmitInput["media"]
  attachments: SubmitAttachment[]
}) {
  const payload: Record<string, unknown> = {
    model: openapi.modelConstant,
    input: {},
    parameters: {},
  }

  for (const field of fields) {
    if (field.name === "model") {
      continue
    }

    const fieldAttachments = mediaForField({ media, attachments, field })
    const paramValue = getParamValue(params, field)
    let value: unknown

    if (field.name === "prompt" || field.name === "text") {
      value = prompt
    } else if (field.mediaShape === "content-item") {
      value = buildContentItems(prompt, fieldAttachments)
    } else if (field.name === "content") {
      value =
        coerceFieldValue(field, paramValue) ??
        buildContentItems(prompt, fieldAttachments)
    } else if (field.kind === "image") {
      value = mediaValueForField(field, fieldAttachments, paramValue)
    } else if (field.constantValue !== undefined) {
      value = field.constantValue
    } else {
      value = coerceFieldValue(field, paramValue)
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
        field.arrayItemKey ? { [field.arrayItemKey]: stringValue } : stringValue,
      ]
    }

    setPayloadValue(payload, field.payloadPath, value)
  }

  const knownPaths = new Set(fields.map((field) => field.payloadPath.join(".")))

  if (!knownPaths.has("input.prompt") && !knownPaths.has("input.content")) {
    setPayloadValue(payload, ["input", "prompt"], prompt)
  }

  const firstAttachment = firstMediaValue(
    allMediaAttachments({ media, attachments }),
    undefined
  )
  if (firstAttachment) {
    for (const name of ["img_url", "image_url", "first_frame_url"]) {
      const hasPath = knownPaths.has(`input.${name}`)
      const current = (payload.input as Record<string, unknown>)[name]
      if (hasPath && current === undefined) {
        setPayloadValue(payload, ["input", name], firstAttachment)
        break
      }
    }
  }

  return payload
}

function getProviderErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback
  }

  const error = (payload as { error?: { message?: unknown } }).error
  if (typeof error?.message === "string" && error.message) {
    return error.message
  }

  const statusPayload =
    "status" in payload
      ? (payload as { status?: unknown }).status
      : payload

  if (statusPayload && typeof statusPayload === "object") {
    const output = (statusPayload as { output?: Record<string, unknown> })
      .output
    if (typeof output?.error_message === "string" && output.error_message) {
      return output.error_message
    }
  }

  return fallback
}

function getAsyncTaskId(payload: unknown) {
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

function getProviderRequestId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const requestId = (payload as { request_id?: unknown }).request_id

  if (typeof requestId === "string" && requestId) {
    return requestId
  }

  if (typeof requestId === "number" && Number.isFinite(requestId)) {
    return String(requestId)
  }

  return null
}

function getAsyncTaskStatus(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const output = (payload as { output?: Record<string, unknown> }).output
  const status = output?.task_status

  return typeof status === "string" ? status : null
}

function isTaskSuccess(status: string | null) {
  return ["success", "succeeded", "complete", "completed"].includes(
    status?.toLowerCase() ?? ""
  )
}

function isTaskFailure(status: string | null) {
  return ["failure", "failed", "error", "cancelled", "canceled"].includes(
    status?.toLowerCase() ?? ""
  )
}

async function callProvider({
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

  const text = await response.text()
  let parsed: unknown = null

  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }

  return { ok: response.ok, status: response.status, body: parsed }
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
    blob: new Blob([bytes], { type: parsed.mimeType }),
    mimeType: parsed.mimeType,
    name:
      attachment.name?.trim() ||
      `reference.${parsed.mimeType.split("/")[1] ?? "jpg"}`,
  }
}

function appendFormDataValue(
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

function buildOpenAiVideoFormData({
  openapi,
  fields,
  prompt,
  params,
  media,
  attachments,
}: {
  openapi: StudioVideoModelOpenapi
  fields: StudioVideoParameterField[]
  prompt: string
  params: Record<string, unknown>
  media: SubmitInput["media"]
  attachments: SubmitAttachment[]
}) {
  const formData = new FormData()
  const appended = new Set<string>()

  for (const field of fields) {
    const key = field.payloadPath.at(-1) ?? field.name

    if (!key || appended.has(key)) {
      continue
    }

    if (field.kind === "image") {
      const first = mediaForField({ media, attachments, field })[0]

      if (!first) {
        continue
      }

      const file = attachmentToBlob(first)

      if (!file) {
        throw new Error(`${field.label} requires a local image file.`)
      }

      formData.append(key, file.blob, file.name)
      appended.add(key)
      continue
    }

    const value =
      field.name === "prompt" || field.name === "text"
        ? prompt
        : field.name === "model"
          ? field.constantValue ?? openapi.modelConstant
          : field.constantValue ?? coerceFieldValue(field, getParamValue(params, field))

    appendFormDataValue(formData, key, value)
    appended.add(key)
  }

  if (!appended.has("model")) {
    formData.append("model", openapi.modelConstant)
  }

  if (!appended.has("prompt")) {
    formData.append("prompt", prompt)
  }

  return formData
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
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

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
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    const text = await response.text()
    let parsed: unknown = null

    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!response.ok) {
      return { ok: false, status: response.status, body: parsed }
    }

    const taskStatus = getAsyncTaskStatus(parsed)

    if (isTaskSuccess(taskStatus)) {
      return { ok: true, status: response.status, body: parsed }
    }

    if (isTaskFailure(taskStatus)) {
      return { ok: false, status: response.status, body: parsed }
    }
  }

  return {
    ok: false,
    status: 504,
    body: {
      error: {
        message: "Async video task timed out.",
      },
    },
  }
}

function getOpenAiVideoTaskId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const id = (payload as { id?: unknown }).id

  return typeof id === "string" && id ? id : null
}

function getOpenAiVideoTaskStatus(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const status = (payload as { status?: unknown }).status

  return typeof status === "string" ? status : null
}

async function pollOpenAiVideoTask({
  statusUrl,
  taskId,
  apiKey,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
}) {
  const url = statusUrl.replace("{task_id}", encodeURIComponent(taskId))

  for (let attempt = 0; attempt < ASYNC_TASK_MAX_POLLS; attempt += 1) {
    if (attempt > 0) {
      await sleep(ASYNC_TASK_POLL_INTERVAL_MS)
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    const text = await response.text()
    let parsed: unknown = null

    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!response.ok) {
      return { ok: false, status: response.status, body: parsed }
    }

    const taskStatus = getOpenAiVideoTaskStatus(parsed)

    if (isTaskSuccess(taskStatus)) {
      return { ok: true, status: response.status, body: parsed }
    }

    if (isTaskFailure(taskStatus)) {
      return { ok: false, status: response.status, body: parsed }
    }
  }

  return {
    ok: false,
    status: 504,
    body: {
      error: {
        message: "OpenAI video task timed out.",
      },
    },
  }
}

async function downloadOpenAiVideoContent({
  statusUrl,
  taskId,
  apiKey,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
}): Promise<NormalizedOutput> {
  const contentUrl = `${statusUrl.replace(
    "{task_id}",
    encodeURIComponent(taskId)
  )}/content`
  const response = await fetch(contentUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Provider content download returned ${response.status}`)
  }

  const mimeType = response.headers.get("content-type") ?? "video/mp4"
  const arrayBuffer = await response.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString("base64")

  return {
    url: null,
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
    width: null,
    height: null,
    durationSeconds: null,
    metadata: { contentUrl },
  }
}

function readNumber(value: unknown) {
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

function extractVideoOutputs(payload: unknown): NormalizedOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const finalPayload =
    "status" in payload
      ? (payload as { status?: unknown }).status
      : payload

  if (!finalPayload || typeof finalPayload !== "object") {
    return []
  }

  const output = (finalPayload as { output?: Record<string, unknown> }).output
  const usage = (finalPayload as { usage?: Record<string, unknown> }).usage
  const urls = Array.isArray(output?.urls) ? output.urls : []
  const durationSeconds =
    readNumber(usage?.duration) ??
    readNumber(usage?.output_video_duration) ??
    readNumber(output?.duration)

  return urls
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map((url) => ({
      url,
      dataUrl: null,
      mimeType: null,
      width: null,
      height: null,
      durationSeconds,
      metadata: output ?? null,
    }))
}

function mergeOutputMetadata(
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

async function prepareAutoSavedOutput(
  output: NormalizedOutput
): Promise<NormalizedOutput> {
  if (output.dataUrl || !output.url) {
    return output
  }

  try {
    const saved = await downloadVideoAsDataUrl(output.url)

    return {
      ...output,
      dataUrl: saved.dataUrl,
      mimeType: output.mimeType ?? saved.mimeType,
      metadata: mergeOutputMetadata(output.metadata, {
        sourceUrl: output.url,
        autoSaved: true,
      }),
    }
  } catch (error) {
    return {
      ...output,
      metadata: mergeOutputMetadata(output.metadata, {
        autoSaved: true,
        autoSaveDownloadError:
          error instanceof Error ? error.message : "Failed to download video.",
      }),
    }
  }
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
    data: listStudioVideoGenerations(sessionId),
  })
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  const { sessionId } = await context.params
  const session = getStudioSession(sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  if (session.mode !== "video") {
    return NextResponse.json(
      { ok: false, error: "Session is not a video session." },
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

  const apiKey = getStoredModelverseApiKey()

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Modelverse API key is not configured locally." },
      { status: 400 }
    )
  }

  const generation = createStudioVideoGeneration({
    sessionId,
    modelSquareId: parsed.data.modelId,
    modelName: parsed.data.modelName,
    openapiFile: parsed.data.openapi.file,
    operationId: parsed.data.openapi.operationId,
    prompt: parsed.data.prompt,
    params: parsed.data.params,
    status: "running",
  })

  const endpointUrl = getVideoModelEndpoint(parsed.data.openapi)
  const statusUrl = getVideoTaskStatusEndpoint(parsed.data.openapi)
  let providerTaskId: string | null = null
  let providerRequestId: string | null = null

  try {
    let providerResponse: { ok: boolean; status: number; body: unknown }
    let outputs: NormalizedOutput[] = []

    if (parsed.data.openapi.adapter === "openai-video") {
      const formData = buildOpenAiVideoFormData({
        openapi: parsed.data.openapi,
        fields: parsed.data.fields,
        prompt: parsed.data.prompt,
        params: parsed.data.params,
        media: parsed.data.media,
        attachments: parsed.data.attachments,
      })

      providerResponse = await callProviderFormData({
        url: endpointUrl,
        formData,
        apiKey,
      })

      providerRequestId = getProviderRequestId(providerResponse.body)

      if (providerResponse.ok) {
        const taskId = getOpenAiVideoTaskId(providerResponse.body)

        if (!taskId) {
          providerResponse = {
            ok: false,
            status: 502,
            body: {
              submit: providerResponse.body,
              error: {
                message: "No video task id returned by the provider.",
              },
            },
          }
        } else {
          providerTaskId = taskId
          recordStudioVideoGenerationTask(generation.id, {
            providerTaskId,
            providerRequestId,
          })

          const statusResponse = await pollOpenAiVideoTask({
            statusUrl,
            taskId,
            apiKey,
          })

          providerResponse = {
            ok: statusResponse.ok,
            status: statusResponse.status,
            body: {
              task_id: taskId,
              request_id: providerRequestId,
              submit: providerResponse.body,
              status: statusResponse.body,
            },
          }

          if (statusResponse.ok) {
            outputs = [
              await downloadOpenAiVideoContent({
                statusUrl,
                taskId,
                apiKey,
              }),
            ]
          }
        }
      }
    } else {
      const payload = buildVideoPayload({
        openapi: parsed.data.openapi,
        fields: parsed.data.fields,
        prompt: parsed.data.prompt,
        params: parsed.data.params,
        media: parsed.data.media,
        attachments: parsed.data.attachments,
      })

      providerResponse = await callProvider({
        url: endpointUrl,
        payload,
        apiKey,
      })

      providerRequestId = getProviderRequestId(providerResponse.body)

      if (providerResponse.ok) {
        const taskId = getAsyncTaskId(providerResponse.body)

        if (!taskId) {
          providerResponse = {
            ok: false,
            status: 502,
            body: {
              submit: providerResponse.body,
              error: {
                message: "No async task id returned by the provider.",
              },
            },
          }
        } else {
          providerTaskId = taskId
          recordStudioVideoGenerationTask(generation.id, {
            providerTaskId,
            providerRequestId,
          })

          const statusResponse = await pollAsyncTask({
            statusUrl,
            taskId,
            apiKey,
          })

          providerResponse = {
            ok: statusResponse.ok,
            status: statusResponse.status,
            body: {
              task_id: taskId,
              request_id: providerRequestId,
              submit: providerResponse.body,
              status: statusResponse.body,
            },
          }
        }
      }

      if (providerResponse.ok) {
        outputs = extractVideoOutputs(providerResponse.body)
      }
    }

    if (!providerResponse.ok) {
      const message = getProviderErrorMessage(
        providerResponse.body,
        `Provider returned ${providerResponse.status}`
      )

      updateStudioVideoGeneration(generation.id, {
        status: "error",
        errorMessage: String(message),
        rawResponse: providerResponse.body,
        providerTaskId,
        providerRequestId,
      })

      return NextResponse.json(
        {
          ok: false,
          error: String(message),
          data: {
            ...generation,
            status: "error",
            errorMessage: message,
            providerTaskId,
            providerRequestId,
          },
        },
        { status: 502 }
      )
    }

    if (outputs.length === 0) {
      updateStudioVideoGeneration(generation.id, {
        status: "error",
        errorMessage: "No video returned by the provider.",
        rawResponse: providerResponse.body,
        providerTaskId,
        providerRequestId,
      })

      return NextResponse.json(
        { ok: false, error: "No video returned by the provider." },
        { status: 502 }
      )
    }

    const stored: StudioVideoOutput[] = []

    const autoSavedOutputs = await Promise.all(
      outputs.map((output) => prepareAutoSavedOutput(output))
    )

    autoSavedOutputs.forEach((output, index) => {
      stored.push(
        createStudioVideoOutput({
          generationId: generation.id,
          index,
          url: output.url ?? null,
          dataUrl: output.dataUrl ?? null,
          mimeType: output.mimeType ?? null,
          width: output.width ?? null,
          height: output.height ?? null,
          durationSeconds: output.durationSeconds ?? null,
          metadata: output.metadata,
          autoSave: true,
        })
      )
    })

    updateStudioVideoGeneration(generation.id, {
      status: "complete",
      rawResponse: providerResponse.body,
      providerTaskId,
      providerRequestId,
    })

    return NextResponse.json(
      {
        ok: true,
        data: {
          ...generation,
          status: "complete",
          providerTaskId,
          providerRequestId,
          outputs: stored,
          completedAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Video generation failed."

    updateStudioVideoGeneration(generation.id, {
      status: "error",
      errorMessage: message,
      providerTaskId: null,
      providerRequestId: null,
    })

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    )
  }
}
