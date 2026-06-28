import { NextResponse } from "next/server"
import { z } from "zod"

import { getAppAuthState } from "@/lib/app-auth"
import {
  getImageModelEndpoint,
  getImageModelConstantForRequest,
  getImageModelRegistryEntry,
  type ImageOpenapiRegistryEntry,
} from "@/lib/image-model-openapi"
import { loadImageModelOperationFields } from "@/lib/image-openapi"
import { getStoredModelverseApiKey } from "@/lib/modelverse-openai"
import {
  createStudioImageGeneration,
  createStudioImageOutput,
  getStudioSession,
  listStudioImageGenerations,
  updateStudioImageGeneration,
} from "@/lib/studio-db"
import type {
  StudioImageOutput,
  StudioImageParameterField,
} from "@/lib/studio-types"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

const paramsSchema = z.record(z.string(), z.unknown())

const submitSchema = z.object({
  modelId: z.string().trim().min(1),
  modelName: z.string().trim().min(1),
  operationId: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).max(4_000),
  params: paramsSchema.default({}),
  attachments: z
    .array(
      z.object({
        name: z.string().trim().max(255).optional(),
        mimeType: z.string().trim().max(120).optional(),
        dataUrl: z
          .string()
          .trim()
          .regex(/^data:image\//i)
          .max(20_000_000)
          .optional(),
        url: z.string().trim().url().max(2_000).optional(),
      })
    )
    .default([]),
})

type SubmitInput = z.infer<typeof submitSchema>

type NormalizedOutput = {
  url?: string | null
  dataUrl?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
}

const ASYNC_TASK_MAX_POLLS = 45
const ASYNC_TASK_POLL_INTERVAL_MS = 2_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dataUrlFromBase64(value: string, fallbackMime: string) {
  if (value.startsWith("data:")) {
    return value
  }

  return `data:${fallbackMime};base64,${value}`
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/)

  if (!match) {
    return null
  }

  const mimeType = match[1] || "image/png"
  const isBase64 = Boolean(match[2])
  const raw = match[3] ?? ""
  const bytes = isBase64
    ? Buffer.from(raw, "base64")
    : Buffer.from(decodeURIComponent(raw), "utf8")

  return { bytes, mimeType }
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/gif") return "gif"
  return "png"
}

function attachmentFileName(
  attachment: SubmitInput["attachments"][number],
  index: number,
  mimeType: string
) {
  const normalized = attachment.name?.trim()

  if (normalized) {
    return normalized
  }

  return `reference-${index + 1}.${extensionFromMimeType(mimeType)}`
}

async function attachmentToBlob(
  attachment: SubmitInput["attachments"][number],
  index: number
) {
  if (attachment.dataUrl) {
    const parsed = parseDataUrl(attachment.dataUrl)

    if (!parsed) {
      throw new Error("Invalid reference image data.")
    }

    return {
      blob: new Blob([parsed.bytes], { type: parsed.mimeType }),
      name: attachmentFileName(attachment, index, parsed.mimeType),
    }
  }

  if (attachment.url) {
    const response = await fetch(attachment.url)

    if (!response.ok) {
      throw new Error("Failed to fetch reference image URL.")
    }

    const responseMimeType = response.headers.get("content-type")?.split(";")[0]
    const attachmentMimeType =
      attachment.mimeType && attachment.mimeType !== "image/url"
        ? attachment.mimeType
        : null
    const mimeType = responseMimeType || attachmentMimeType || "image/png"
    const bytes = await response.arrayBuffer()

    return {
      blob: new Blob([bytes], { type: mimeType }),
      name: attachmentFileName(attachment, index, mimeType),
    }
  }

  throw new Error("Reference image is missing data.")
}

function fieldByName(fields: StudioImageParameterField[], name: string) {
  return fields.find((field) => field.name === name)
}

function coerceFieldValue(
  field: StudioImageParameterField,
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

function buildOpenaiPayload(
  modelId: string,
  prompt: string,
  fields: StudioImageParameterField[],
  params: Record<string, unknown>,
  attachments: SubmitInput["attachments"]
) {
  const payload: Record<string, unknown> = {
    model: modelId,
    prompt,
  }

  for (const field of fields) {
    if (field.name === "prompt" || field.name === "model") {
      continue
    }

    if (field.constantValue !== undefined) {
      payload[field.name] = field.constantValue
      continue
    }

    const value = coerceFieldValue(field, params[field.name])

    if (value === undefined) {
      continue
    }

    if (field.options && field.options.length > 0 && field.arrayItemKey !== undefined) {
      const stringValue = String(value)
      payload[field.name] = [
        field.arrayItemKey
          ? { [field.arrayItemKey]: stringValue }
          : stringValue,
      ]
      continue
    }

    payload[field.name] = value
  }

  if (attachments.length > 0) {
    const imageField = fieldByName(fields, "image")
    const imagesField = fieldByName(fields, "images")

    if (imagesField) {
      payload.images = attachments
        .map((attachment) => attachment.url ?? attachment.dataUrl ?? null)
        .filter(Boolean)
    } else if (imageField) {
      const first = attachments[0]
      payload.image = first.url ?? first.dataUrl
    }
  }

  return payload
}

async function buildOpenaiEditPayload(
  modelId: string,
  prompt: string,
  fields: StudioImageParameterField[],
  params: Record<string, unknown>,
  attachments: SubmitInput["attachments"]
) {
  const form = new FormData()
  form.append("model", modelId)
  form.append("prompt", prompt)

  for (const field of fields) {
    if (
      field.name === "prompt" ||
      field.name === "model" ||
      field.name === "image" ||
      field.name === "image[]" ||
      field.name === "mask"
    ) {
      continue
    }

    if (field.constantValue !== undefined) {
      form.append(field.name, String(field.constantValue))
      continue
    }

    const value = coerceFieldValue(field, params[field.name])

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      form.append(field.name, String(value))
    }
  }

  const files = await Promise.all(attachments.map(attachmentToBlob))
  const imageFieldName = files.length > 1 ? "image[]" : "image"

  for (const file of files) {
    form.append(imageFieldName, file.blob, file.name)
  }

  return form
}

function buildGeminiPayload(
  prompt: string,
  fields: StudioImageParameterField[],
  params: Record<string, unknown>,
  attachments: SubmitInput["attachments"]
) {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }]

  for (const attachment of attachments) {
    if (attachment.dataUrl) {
      const match = attachment.dataUrl.match(
        /^data:([^;]+);base64,(.+)$/
      )

      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        })
        continue
      }
    }

    if (attachment.url) {
      parts.push({
        fileData: {
          mimeType: attachment.mimeType ?? "image/png",
          fileUri: attachment.url,
        },
      })
    }
  }

  const aspectRatio = params.aspectRatio
  const imageSize = params.imageSize

  const generationConfig: Record<string, unknown> = {
    responseModalities: ["TEXT", "IMAGE"],
  }

  if (typeof aspectRatio === "string" || typeof imageSize === "string") {
    const imageConfig: Record<string, unknown> = {}
    if (typeof aspectRatio === "string" && aspectRatio) {
      imageConfig.aspectRatio = aspectRatio
    }
    if (typeof imageSize === "string" && imageSize) {
      imageConfig.imageSize = imageSize
    }
    generationConfig.imageConfig = imageConfig
  }

  // Pass through any other simple primitive params for advanced tuning.
  for (const field of fields) {
    if (
      field.name === "prompt" ||
      field.name === "image" ||
      field.name === "aspectRatio" ||
      field.name === "imageSize" ||
      field.name === "responseModalities"
    ) {
      continue
    }
    const value = coerceFieldValue(field, params[field.name])
    if (value !== undefined) {
      generationConfig[field.name] = value
    }
  }

  return {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig,
  }
}

function buildAsyncTaskPayload(modelId: string, prompt: string) {
  if (modelId === "midjourney-fast-imagine") {
    return {
      model: modelId,
      input: {
        prompt,
      },
    }
  }

  return {
    model: modelId,
    input: {},
  }
}

function extractOpenaiOutputs(payload: unknown): NormalizedOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const data = (payload as { data?: Array<Record<string, unknown>> }).data

  if (!Array.isArray(data)) {
    return []
  }

  const outputs: NormalizedOutput[] = []

  for (const item of data) {
    const sizeRaw =
      typeof item.size === "string" ? (item.size as string) : null
    let width: number | null = null
    let height: number | null = null

    if (sizeRaw) {
      const match = sizeRaw.match(/^(\d+)[x*](\d+)$/)
      if (match) {
        width = Number(match[1])
        height = Number(match[2])
      }
    }

    const b64 = item.b64_json
    const url = item.url

    outputs.push({
      url: typeof url === "string" ? url : null,
      dataUrl:
        typeof b64 === "string" ? dataUrlFromBase64(b64, "image/png") : null,
      mimeType: null,
      width,
      height,
    })
  }

  return outputs
}

function extractGeminiOutputs(payload: unknown): NormalizedOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const candidates = (payload as {
    candidates?: Array<Record<string, unknown>>
  }).candidates

  if (!Array.isArray(candidates)) {
    return []
  }

  const outputs: NormalizedOutput[] = []

  for (const candidate of candidates) {
    const content = candidate.content as Record<string, unknown> | undefined
    const parts = Array.isArray(content?.parts)
      ? (content?.parts as Array<Record<string, unknown>>)
      : []

    for (const part of parts) {
      const inline = part.inlineData as
        | { data?: string; mimeType?: string }
        | undefined

      if (inline?.data) {
        const mime = inline.mimeType ?? "image/png"
        outputs.push({
          url: null,
          dataUrl: dataUrlFromBase64(inline.data, mime),
          mimeType: mime,
          width: null,
          height: null,
        })
      }
    }
  }

  return outputs
}

function extractAsyncTaskOutputs(payload: unknown): NormalizedOutput[] {
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
  const urls = Array.isArray(output?.urls) ? output.urls : []

  return urls
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map((url) => ({
      url,
      dataUrl: null,
      mimeType: null,
      width: null,
      height: null,
    }))
}

function extractOutputs(adapter: string, payload: unknown): NormalizedOutput[] {
  if (adapter === "gemini-generate-content") {
    return extractGeminiOutputs(payload)
  }

  if (adapter === "async-task") {
    return extractAsyncTaskOutputs(payload)
  }

  return extractOpenaiOutputs(payload)
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

function getAsyncTaskStatus(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const output = (payload as { output?: Record<string, unknown> }).output
  const status = output?.task_status

  return typeof status === "string" ? status : null
}

async function pollAsyncTask({
  submitUrl,
  taskId,
  apiKey,
}: {
  submitUrl: string
  taskId: string
  apiKey: string
}) {
  const statusUrl = new URL("/v1/tasks/status", submitUrl)
  statusUrl.searchParams.set("task_id", taskId)

  for (let attempt = 0; attempt < ASYNC_TASK_MAX_POLLS; attempt += 1) {
    if (attempt > 0) {
      await sleep(ASYNC_TASK_POLL_INTERVAL_MS)
    }

    const response = await fetch(statusUrl, {
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

    if (taskStatus === "Success") {
      return { ok: true, status: response.status, body: parsed }
    }

    if (taskStatus === "Failure") {
      return { ok: false, status: response.status, body: parsed }
    }
  }

  return {
    ok: false,
    status: 504,
    body: {
      error: {
        message: "Async image task timed out.",
      },
    },
  }
}

async function callProvider({
  url,
  payload,
  apiKey,
  adapter,
}: {
  url: string
  payload: unknown
  apiKey: string
  adapter: string
}) {
  const isMultipart = payload instanceof FormData
  const headers: Record<string, string> = {}

  if (!isMultipart) {
    headers["Content-Type"] = "application/json"
  }

  if (adapter === "gemini-generate-content") {
    headers["x-goog-api-key"] = apiKey
  } else {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: isMultipart ? payload : JSON.stringify(payload),
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

function getOpenapiOperation(
  registry: {
    openapi?: ImageOpenapiRegistryEntry
    editOpenapi?: ImageOpenapiRegistryEntry
  },
  operationId?: string
) {
  const operations = [registry.openapi, registry.editOpenapi].filter(
    (operation): operation is ImageOpenapiRegistryEntry => Boolean(operation)
  )

  if (!operationId) {
    return registry.openapi ?? null
  }

  return (
    operations.find((operation) => operation.operationId === operationId) ??
    null
  )
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
    data: listStudioImageGenerations(sessionId),
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

  if (session.mode !== "image") {
    return NextResponse.json(
      { ok: false, error: "Session is not an image session." },
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

  const registry =
    getImageModelRegistryEntry(parsed.data.modelName) ??
    getImageModelRegistryEntry(parsed.data.modelId)

  if (!registry?.openapi || !registry.supported) {
    return NextResponse.json(
      { ok: false, error: "Model is not supported." },
      { status: 400 }
    )
  }

  const openapi = getOpenapiOperation(registry, parsed.data.operationId)

  if (!openapi) {
    return NextResponse.json(
      { ok: false, error: "Image operation is not supported." },
      { status: 400 }
    )
  }

  if (
    openapi.adapter === "openai-images-edit" &&
    parsed.data.attachments.length === 0
  ) {
    return NextResponse.json(
      { ok: false, error: "Reference image is required for image editing." },
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

  const fields = loadImageModelOperationFields(
    parsed.data.modelName,
    openapi.operationId
  )
  const generation = createStudioImageGeneration({
    sessionId,
    modelSquareId: parsed.data.modelId,
    modelName: parsed.data.modelName,
    openapiFile: openapi.file,
    operationId: openapi.operationId,
    prompt: parsed.data.prompt,
    params: parsed.data.params,
    status: "running",
  })

  const endpointUrl = getImageModelEndpoint(openapi, parsed.data.modelName)
  const modelConstant = getImageModelConstantForRequest(
    openapi,
    parsed.data.modelName
  )

  const payload =
    openapi.adapter === "gemini-generate-content"
      ? buildGeminiPayload(
          parsed.data.prompt,
          fields,
          parsed.data.params,
          parsed.data.attachments
        )
      : openapi.adapter === "async-task"
        ? buildAsyncTaskPayload(modelConstant, parsed.data.prompt)
        : openapi.adapter === "openai-images-edit"
          ? await buildOpenaiEditPayload(
              modelConstant,
              parsed.data.prompt,
              fields,
              parsed.data.params,
              parsed.data.attachments
            )
          : buildOpenaiPayload(
              modelConstant,
              parsed.data.prompt,
              fields,
              parsed.data.params,
              parsed.data.attachments
            )

  try {
    let providerResponse = await callProvider({
      url: endpointUrl,
      payload,
      apiKey,
      adapter: openapi.adapter,
    })

    if (providerResponse.ok && openapi.adapter === "async-task") {
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
        const statusResponse = await pollAsyncTask({
          submitUrl: endpointUrl,
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

      updateStudioImageGeneration(generation.id, {
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

    const outputs = extractOutputs(
      openapi.adapter,
      providerResponse.body
    )

    if (outputs.length === 0) {
      updateStudioImageGeneration(generation.id, {
        status: "error",
        errorMessage: "No image returned by the provider.",
        rawResponse: providerResponse.body,
      })

      return NextResponse.json(
        { ok: false, error: "No image returned by the provider." },
        { status: 502 }
      )
    }

    const stored: StudioImageOutput[] = []

    outputs.forEach((output, index) => {
      stored.push(
        createStudioImageOutput({
          generationId: generation.id,
          index,
          url: output.url ?? null,
          dataUrl: output.dataUrl ?? null,
          mimeType: output.mimeType ?? null,
          width: output.width ?? null,
          height: output.height ?? null,
        })
      )
    })

    updateStudioImageGeneration(generation.id, {
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
      error instanceof Error ? error.message : "Image generation failed."

    updateStudioImageGeneration(generation.id, {
      status: "error",
      errorMessage: message,
    })

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    )
  }
}
