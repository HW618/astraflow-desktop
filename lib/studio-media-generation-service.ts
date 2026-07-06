import { randomUUID } from "node:crypto"

import {
  getImageModelConstantForRequest,
  getImageModelEndpoint,
  getImageModelRegistryEntry,
  type ImageOpenapiRegistryEntry,
} from "@/lib/image-model-openapi"
import { loadImageModelOperationFields } from "@/lib/image-openapi"
import { readStudioFile } from "@/lib/studio-file-storage"
import {
  appendFormDataValue,
  coerceFieldValue,
  getAsyncTaskId,
  getAsyncTaskStatus,
  getFieldKey,
  getParamValue,
  getProviderErrorMessage,
  isTaskFailure,
  isTaskSuccess,
  mergeOutputMetadata,
  parseDataUrl as parseStrictDataUrl,
  readNumber,
  setPayloadValue,
  sleep,
} from "@/lib/studio-generation-shared"
import {
  createStudioImageGeneration,
  createStudioImageOutput,
  getGeneratedMediaSessionFileId,
  getStudioImageOutput,
  getStudioSession,
  getStudioSessionFile,
  listStudioImageGenerations,
  updateStudioImageGeneration,
} from "@/lib/studio-db"
import {
  downloadUrlToStudioMediaFile,
  writeDataUrlToStudioMediaFile,
} from "@/lib/studio-media-storage"
import type {
  StudioImageGeneration,
  StudioImageOutput,
  StudioImageParameterField,
  StudioImageStatus,
} from "@/lib/studio-types"
import {
  createStudioVideoGeneration,
  createStudioVideoOutput,
  getStudioVideoOutput,
  listStudioVideoGenerations,
  recordStudioVideoGenerationTask,
  updateStudioVideoGeneration,
} from "@/lib/studio-video-db"
import type {
  StudioVideoGeneration,
  StudioVideoModelOpenapi,
  StudioVideoOutput,
  StudioVideoParameterField,
  StudioVideoStatus,
} from "@/lib/studio-video-types"
import {
  getVideoOpenapiEntry,
  getVideoModelEndpoint,
  getVideoTaskStatusEndpoint,
  resolveVideoModelOperation,
} from "@/lib/video-openapi"

export type StudioMediaAttachment = {
  name?: string
  mimeType?: string
  dataUrl?: string
  url?: string
}

export type StudioMediaReference =
  | { type: "session_file"; id: string; name?: string }
  | { type: "image_output"; id: string; name?: string }
  | { type: "video_output"; id: string; name?: string }
  | { type: "url"; url: string; name?: string; mimeType?: string }

export type StudioMediaOutputResult = {
  id: string
  index: number
  sessionFileId: string | null
  contentUrl: string
  url: string | null
  storagePath: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  durationSeconds?: number | null
}

export type StudioImageGenerationResult = {
  kind: "image"
  generationId: string
  status: StudioImageStatus
  model: {
    id: string
    name: string
    openapiFile: string | null
    operationId: string | null
  }
  prompt: string
  phase: string | null
  progress: number | null
  rawStatus: string | null
  attempt: number
  lastPolledAt: string | null
  nextPollAt: string | null
  outputs: StudioMediaOutputResult[]
  errorMessage: string | null
}

export type StudioVideoGenerationResult = {
  kind: "video"
  generationId: string
  status: StudioVideoStatus
  model: {
    id: string
    name: string
    openapiFile: string | null
    operationId: string | null
  }
  prompt: string
  phase: string | null
  progress: number | null
  rawStatus: string | null
  attempt: number
  lastPolledAt: string | null
  nextPollAt: string | null
  providerTaskId: string | null
  providerRequestId: string | null
  outputs: StudioMediaOutputResult[]
  errorMessage: string | null
}

export type GenerateStudioImageInput = {
  sessionId: string
  apiKey: string
  modelId?: string
  modelName: string
  operationId?: string
  prompt: string
  params?: Record<string, unknown>
  attachments?: StudioMediaAttachment[]
  references?: StudioMediaReference[]
}

export type GenerateStudioVideoInput = {
  sessionId: string
  apiKey: string
  modelId?: string
  modelName: string
  operationId?: string
  openapiFile?: string
  prompt: string
  params?: Record<string, unknown>
  media?: Record<string, StudioMediaAttachment[]>
  attachments?: StudioMediaAttachment[]
  references?: StudioMediaReference[]
  mediaReferences?: Record<string, StudioMediaReference[]>
}

type ProviderResponse = {
  ok: boolean
  status: number
  body: unknown
}

type NormalizedImageOutput = {
  url?: string | null
  dataUrl?: string | null
  storagePath?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  metadata?: unknown
}

type NormalizedVideoOutput = {
  url?: string | null
  dataUrl?: string | null
  storagePath?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  metadata?: unknown
}

const IMAGE_ASYNC_TASK_MAX_POLLS = 45
const IMAGE_ASYNC_TASK_POLL_INTERVAL_MS = 2_000
const VIDEO_ASYNC_TASK_MAX_POLLS = 720
const VIDEO_ASYNC_TASK_POLL_INTERVAL_MS = 5_000
const TRANSIENT_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const MEDIA_JOB_LEASE_MS = 5 * 60 * 1000
const activeVideoGenerationTasks = new Set<string>()

function createMediaJobLeaseOwner() {
  return `studio-media:${process.pid}:${randomUUID()}`
}

function isoAfter(ms: number) {
  return new Date(Date.now() + ms).toISOString()
}

function mediaJobLeaseExpiresAt() {
  return isoAfter(MEDIA_JOB_LEASE_MS)
}

function dataUrlFromBase64(value: string, fallbackMime: string) {
  if (value.startsWith("data:")) {
    return value
  }

  return `data:${fallbackMime};base64,${value}`
}

function dataUrlFromBuffer(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`
}

function parseImageDataUrl(value: string) {
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

function extensionFromContentMimeType(mimeType: string) {
  if (mimeType.startsWith("image/")) return extensionFromMimeType(mimeType)
  if (mimeType === "video/mp4") return "mp4"
  if (mimeType === "video/webm") return "webm"
  if (mimeType === "video/quicktime") return "mov"
  return "bin"
}

function mediaReferenceName({
  fallbackId,
  fallbackPrefix,
  fallbackMimeType,
  name,
}: {
  fallbackId: string
  fallbackPrefix: string
  fallbackMimeType: string
  name?: string
}) {
  const normalized = name?.trim()

  if (normalized) {
    return normalized
  }

  const extension = extensionFromContentMimeType(fallbackMimeType)
  return `${fallbackPrefix}-${fallbackId}.${extension}`
}

function storedMediaAttachment({
  dataUrl,
  fallbackMimeType,
  name,
  storagePath,
  url,
}: {
  dataUrl?: string | null
  fallbackMimeType: string
  name: string
  storagePath?: string | null
  url?: string | null
}): StudioMediaAttachment {
  if (storagePath) {
    const bytes = readStudioFile(storagePath)
    return {
      dataUrl: dataUrlFromBuffer(bytes, fallbackMimeType),
      mimeType: fallbackMimeType,
      name,
    }
  }

  if (dataUrl) {
    return {
      dataUrl,
      mimeType: fallbackMimeType,
      name,
    }
  }

  if (url) {
    return {
      mimeType: fallbackMimeType,
      name,
      url,
    }
  }

  throw new Error("Referenced media output has no readable content.")
}

function imageOutputBelongsToSession(sessionId: string, outputId: string) {
  return listStudioImageGenerations(sessionId).some((generation) =>
    generation.outputs.some((output) => output.id === outputId)
  )
}

function videoOutputBelongsToSession(sessionId: string, outputId: string) {
  return listStudioVideoGenerations(sessionId).some((generation) =>
    generation.outputs.some((output) => output.id === outputId)
  )
}

function resolveStudioMediaReference({
  reference,
  sessionId,
}: {
  reference: StudioMediaReference
  sessionId: string
}): StudioMediaAttachment {
  if (reference.type === "url") {
    return {
      mimeType: reference.mimeType,
      name: reference.name,
      url: reference.url,
    }
  }

  if (reference.type === "session_file") {
    const file = getStudioSessionFile(reference.id)

    if (!file || file.sessionId !== sessionId) {
      throw new Error("Referenced session file was not found.")
    }

    const mimeType = file.mimeType ?? "application/octet-stream"
    const name = reference.name?.trim() || file.originalName

    return {
      dataUrl: dataUrlFromBuffer(readStudioFile(file.storagePath), mimeType),
      mimeType,
      name,
    }
  }

  if (reference.type === "image_output") {
    if (!imageOutputBelongsToSession(sessionId, reference.id)) {
      throw new Error("Referenced image output was not found.")
    }

    const output = getStudioImageOutput(reference.id)

    if (!output) {
      throw new Error("Referenced image output was not found.")
    }

    const fallbackMimeType = output.mimeType ?? "image/png"
    const name = mediaReferenceName({
      fallbackId: output.id,
      fallbackMimeType,
      fallbackPrefix: "image-output",
      name: reference.name,
    })

    return storedMediaAttachment({
      dataUrl: output.dataUrl,
      fallbackMimeType,
      name,
      storagePath: output.storagePath,
      url: output.url,
    })
  }

  if (!videoOutputBelongsToSession(sessionId, reference.id)) {
    throw new Error("Referenced video output was not found.")
  }

  const output = getStudioVideoOutput(reference.id)

  if (!output) {
    throw new Error("Referenced video output was not found.")
  }

  const fallbackMimeType = output.mimeType ?? "video/mp4"
  const name = mediaReferenceName({
    fallbackId: output.id,
    fallbackMimeType,
    fallbackPrefix: "video-output",
    name: reference.name,
  })

  return storedMediaAttachment({
    dataUrl: output.dataUrl,
    fallbackMimeType,
    name,
    storagePath: output.storagePath,
    url: output.url,
  })
}

function mergeReferenceAttachments({
  attachments,
  references,
  sessionId,
}: {
  attachments: StudioMediaAttachment[]
  references: StudioMediaReference[]
  sessionId: string
}) {
  if (references.length === 0) {
    return attachments
  }

  return [
    ...attachments,
    ...references.map((reference) =>
      resolveStudioMediaReference({ reference, sessionId })
    ),
  ]
}

function mergeMediaReferenceAttachments({
  media,
  mediaReferences,
  sessionId,
}: {
  media: Record<string, StudioMediaAttachment[]>
  mediaReferences: Record<string, StudioMediaReference[]>
  sessionId: string
}) {
  if (Object.keys(mediaReferences).length === 0) {
    return media
  }

  const merged: Record<string, StudioMediaAttachment[]> = { ...media }

  for (const [key, references] of Object.entries(mediaReferences)) {
    merged[key] = mergeReferenceAttachments({
      attachments: merged[key] ?? [],
      references,
      sessionId,
    })
  }

  return merged
}

function attachmentFileName(
  attachment: StudioMediaAttachment,
  index: number,
  mimeType: string
) {
  const normalized = attachment.name?.trim()

  if (normalized) {
    return normalized
  }

  return `reference-${index + 1}.${extensionFromMimeType(mimeType)}`
}

async function imageAttachmentToBlob(
  attachment: StudioMediaAttachment,
  index: number
) {
  if (attachment.dataUrl) {
    const parsed = parseImageDataUrl(attachment.dataUrl)

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

function isVideoParameterField(
  field: StudioImageParameterField | StudioVideoParameterField
): field is StudioVideoParameterField {
  return "payloadPath" in field && Array.isArray(field.payloadPath)
}

function mediaFieldParamKeys(
  field: StudioImageParameterField | StudioVideoParameterField
) {
  const keys = [field.name]

  if (isVideoParameterField(field)) {
    const key = getFieldKey(field)

    if (key && key !== field.name) {
      keys.unshift(key)
    }
  }

  return keys
}

function hasParamValue(params: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => {
    const value = params[key]

    return value !== undefined && value !== null && value !== ""
  })
}

function shouldApplyFieldDefault(
  field: StudioImageParameterField | StudioVideoParameterField
) {
  if (
    field.defaultValue === undefined ||
    field.hidden ||
    field.kind === "image"
  ) {
    return false
  }

  return (
    field.name !== "prompt" &&
    field.name !== "text" &&
    field.name !== "model" &&
    field.name !== "content"
  )
}

function mergeFieldDefaultParams<
  Field extends StudioImageParameterField | StudioVideoParameterField,
>(fields: Field[], params: Record<string, unknown>) {
  const merged = { ...params }

  for (const field of fields) {
    if (!shouldApplyFieldDefault(field)) {
      continue
    }

    const keys = mediaFieldParamKeys(field)

    if (hasParamValue(merged, keys)) {
      continue
    }

    merged[keys[0]] = field.defaultValue
  }

  return merged
}

function buildOpenaiImagePayload({
  modelId,
  prompt,
  fields,
  params,
  attachments,
}: {
  modelId: string
  prompt: string
  fields: StudioImageParameterField[]
  params: Record<string, unknown>
  attachments: StudioMediaAttachment[]
}) {
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

    if (
      field.options &&
      field.options.length > 0 &&
      field.arrayItemKey !== undefined
    ) {
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

async function buildOpenaiImageEditPayload({
  modelId,
  prompt,
  fields,
  params,
  attachments,
}: {
  modelId: string
  prompt: string
  fields: StudioImageParameterField[]
  params: Record<string, unknown>
  attachments: StudioMediaAttachment[]
}) {
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

  const files = await Promise.all(attachments.map(imageAttachmentToBlob))
  const imageFieldName = files.length > 1 ? "image[]" : "image"

  for (const file of files) {
    form.append(imageFieldName, file.blob, file.name)
  }

  return form
}

function buildGeminiImagePayload({
  prompt,
  fields,
  params,
  attachments,
}: {
  prompt: string
  fields: StudioImageParameterField[]
  params: Record<string, unknown>
  attachments: StudioMediaAttachment[]
}) {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }]

  for (const attachment of attachments) {
    if (attachment.dataUrl) {
      const match = attachment.dataUrl.match(/^data:([^;]+);base64,(.+)$/)

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

function buildAsyncImageTaskPayload(modelId: string, prompt: string) {
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

async function callImageProvider({
  url,
  payload,
  apiKey,
  adapter,
}: {
  url: string
  payload: unknown
  apiKey: string
  adapter: string
}): Promise<ProviderResponse> {
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

async function pollImageAsyncTask({
  submitUrl,
  taskId,
  apiKey,
}: {
  submitUrl: string
  taskId: string
  apiKey: string
}): Promise<ProviderResponse> {
  const statusUrl = new URL("/v1/tasks/status", submitUrl)
  statusUrl.searchParams.set("task_id", taskId)

  for (let attempt = 0; attempt < IMAGE_ASYNC_TASK_MAX_POLLS; attempt += 1) {
    if (attempt > 0) {
      await sleep(IMAGE_ASYNC_TASK_POLL_INTERVAL_MS)
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
        message: "Async image task timed out.",
      },
    },
  }
}

function extractOpenaiImageOutputs(payload: unknown): NormalizedImageOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const data = (payload as { data?: Array<Record<string, unknown>> }).data

  if (!Array.isArray(data)) {
    return []
  }

  const outputs: NormalizedImageOutput[] = []

  for (const item of data) {
    const sizeRaw = typeof item.size === "string" ? item.size : null
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

function extractGeminiImageOutputs(payload: unknown): NormalizedImageOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const candidates = (
    payload as {
      candidates?: Array<Record<string, unknown>>
    }
  ).candidates

  if (!Array.isArray(candidates)) {
    return []
  }

  const outputs: NormalizedImageOutput[] = []

  for (const candidate of candidates) {
    const content = candidate.content as Record<string, unknown> | undefined
    const parts = Array.isArray(content?.parts)
      ? (content?.parts as Array<Record<string, unknown>>)
      : []

    for (const part of parts) {
      const inline = part.inlineData as
        { data?: string; mimeType?: string } | undefined

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

function extractAsyncImageTaskOutputs(
  payload: unknown
): NormalizedImageOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const finalPayload =
    "status" in payload ? (payload as { status?: unknown }).status : payload

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

function extractImageOutputs(
  adapter: string,
  payload: unknown
): NormalizedImageOutput[] {
  if (adapter === "gemini-generate-content") {
    return extractGeminiImageOutputs(payload)
  }

  if (adapter === "async-task") {
    return extractAsyncImageTaskOutputs(payload)
  }

  return extractOpenaiImageOutputs(payload)
}

async function prepareAutoSavedImageOutput({
  output,
  generationId,
  outputId,
}: {
  output: NormalizedImageOutput
  generationId: string
  outputId: string
}): Promise<NormalizedImageOutput> {
  if (output.storagePath) {
    return output
  }

  try {
    const saved = output.dataUrl
      ? writeDataUrlToStudioMediaFile({
          kind: "image",
          generationId,
          outputId,
          dataUrl: output.dataUrl,
          fallbackMimeType: output.mimeType,
        })
      : output.url
        ? await downloadUrlToStudioMediaFile({
            kind: "image",
            generationId,
            outputId,
            url: output.url,
            fallbackMimeType: output.mimeType,
          })
        : null

    if (!saved) {
      return output
    }

    return {
      ...output,
      dataUrl: null,
      storagePath: saved.storagePath,
      mimeType: output.mimeType ?? saved.mimeType,
      metadata: mergeOutputMetadata(output.metadata, {
        sourceUrl: output.url ?? null,
        autoSaved: true,
      }),
    }
  } catch (error) {
    return {
      ...output,
      dataUrl: output.url ? null : (output.dataUrl ?? null),
      metadata: mergeOutputMetadata(output.metadata, {
        autoSaved: true,
        autoSaveDownloadError:
          error instanceof Error ? error.message : "Failed to save image.",
      }),
    }
  }
}

function getOpenapiImageOperation(
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

function outputSessionFileId({
  kind,
  outputId,
  storagePath,
}: {
  kind: "image" | "video"
  outputId: string
  storagePath: string | null
}) {
  if (!storagePath) {
    return null
  }

  const fileId = getGeneratedMediaSessionFileId(kind, outputId)
  return getStudioSessionFile(fileId) ? fileId : null
}

function toImageOutputResult(
  output: StudioImageOutput
): StudioMediaOutputResult {
  return {
    id: output.id,
    index: output.index,
    sessionFileId: outputSessionFileId({
      kind: "image",
      outputId: output.id,
      storagePath: output.storagePath,
    }),
    contentUrl: `/api/studio/image-outputs/${encodeURIComponent(
      output.id
    )}/content`,
    url: output.url,
    storagePath: output.storagePath,
    mimeType: output.mimeType,
    width: output.width,
    height: output.height,
  }
}

function toImageGenerationResult(
  generation: StudioImageGeneration
): StudioImageGenerationResult {
  return {
    kind: "image",
    generationId: generation.id,
    status: generation.status,
    model: {
      id: generation.modelSquareId,
      name: generation.modelName,
      openapiFile: generation.openapiFile,
      operationId: generation.operationId,
    },
    prompt: generation.prompt,
    phase: generation.phase,
    progress: generation.progress,
    rawStatus: generation.rawStatus,
    attempt: generation.attempt,
    lastPolledAt: generation.lastPolledAt,
    nextPollAt: generation.nextPollAt,
    outputs: generation.outputs.map(toImageOutputResult),
    errorMessage: generation.errorMessage,
  }
}

export async function generateStudioImage(
  input: GenerateStudioImageInput
): Promise<StudioImageGenerationResult> {
  const session = getStudioSession(input.sessionId)

  if (!session) {
    throw new Error("Session not found.")
  }

  const modelId = input.modelId?.trim() || input.modelName
  const modelName = input.modelName.trim()
  const prompt = input.prompt.trim()
  const rawParams = input.params ?? {}
  const attachments = mergeReferenceAttachments({
    attachments: input.attachments ?? [],
    references: input.references ?? [],
    sessionId: input.sessionId,
  })
  const registry =
    getImageModelRegistryEntry(modelName) ?? getImageModelRegistryEntry(modelId)

  if (!registry?.openapi || !registry.supported) {
    throw new Error("Image model is not supported.")
  }

  const openapi = getOpenapiImageOperation(registry, input.operationId)

  if (!openapi) {
    throw new Error("Image operation is not supported.")
  }

  if (openapi.adapter === "openai-images-edit" && attachments.length === 0) {
    throw new Error("Reference image is required for image editing.")
  }

  const fields = loadImageModelOperationFields(modelName, openapi.operationId)
  const params = mergeFieldDefaultParams(fields, rawParams)
  const leaseOwner = createMediaJobLeaseOwner()
  const generation = createStudioImageGeneration({
    sessionId: input.sessionId,
    modelSquareId: modelId,
    modelName,
    openapiFile: openapi.file,
    operationId: openapi.operationId,
    prompt,
    params,
    status: "running",
    phase: "submitting",
    progress: 0,
    attempt: 0,
    leaseOwner,
    leaseExpiresAt: mediaJobLeaseExpiresAt(),
  })
  const endpointUrl = getImageModelEndpoint(openapi, modelName)
  const modelConstant = getImageModelConstantForRequest(openapi, modelName)
  const payload =
    openapi.adapter === "gemini-generate-content"
      ? buildGeminiImagePayload({ prompt, fields, params, attachments })
      : openapi.adapter === "async-task"
        ? buildAsyncImageTaskPayload(modelConstant, prompt)
        : openapi.adapter === "openai-images-edit"
          ? await buildOpenaiImageEditPayload({
              modelId: modelConstant,
              prompt,
              fields,
              params,
              attachments,
            })
          : buildOpenaiImagePayload({
              modelId: modelConstant,
              prompt,
              fields,
              params,
              attachments,
            })

  try {
    let providerResponse = await callImageProvider({
      url: endpointUrl,
      payload,
      apiKey: input.apiKey,
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
        const pollingStartedAt = new Date().toISOString()

        updateStudioImageGeneration(generation.id, {
          status: "polling",
          phase: "polling",
          progress: 0.1,
          rawStatus: getAsyncTaskStatus(providerResponse.body) ?? "submitted",
          attempt: generation.attempt + 1,
          lastPolledAt: pollingStartedAt,
          nextPollAt: isoAfter(IMAGE_ASYNC_TASK_POLL_INTERVAL_MS),
          leaseOwner,
          leaseExpiresAt: mediaJobLeaseExpiresAt(),
          rawResponse: providerResponse.body,
        })

        const statusResponse = await pollImageAsyncTask({
          submitUrl: endpointUrl,
          taskId,
          apiKey: input.apiKey,
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
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus:
          getTaskRawStatus(providerResponse.body) ??
          getProviderErrorMessage(providerResponse.body, "error"),
        errorMessage: String(message),
        rawResponse: providerResponse.body,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toImageGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus:
          getTaskRawStatus(providerResponse.body) ??
          getProviderErrorMessage(providerResponse.body, "error"),
        errorMessage: String(message),
      }
    }

    const outputs = extractImageOutputs(openapi.adapter, providerResponse.body)

    if (outputs.length === 0) {
      const message = "No image returned by the provider."

      updateStudioImageGeneration(generation.id, {
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "empty_output",
        errorMessage: message,
        rawResponse: providerResponse.body,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toImageGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "empty_output",
        errorMessage: message,
      }
    }

    const autoSavedOutputs = await Promise.all(
      outputs.map(async (output, index) => {
        const outputId = randomUUID()

        return {
          index,
          outputId,
          output: await prepareAutoSavedImageOutput({
            output,
            generationId: generation.id,
            outputId,
          }),
        }
      })
    )
    const stored: StudioImageOutput[] = []

    autoSavedOutputs.forEach(({ output, outputId, index }) => {
      stored.push(
        createStudioImageOutput({
          id: outputId,
          generationId: generation.id,
          index,
          url: output.url ?? null,
          dataUrl: output.dataUrl ?? null,
          storagePath: output.storagePath ?? null,
          mimeType: output.mimeType ?? null,
          width: output.width ?? null,
          height: output.height ?? null,
          metadata: output.metadata,
          autoSave: Boolean(output.storagePath || output.url || output.dataUrl),
        })
      )
    })

    updateStudioImageGeneration(generation.id, {
      status: "complete",
      phase: "complete",
      progress: 1,
      rawStatus: "complete",
      rawResponse: providerResponse.body,
      leaseOwner,
      leaseExpiresAt: new Date().toISOString(),
    })

    const completedAt = new Date().toISOString()

    return toImageGenerationResult({
      ...generation,
      status: "complete",
      phase: "complete",
      progress: 1,
      rawStatus: "complete",
      outputs: stored,
      completedAt,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image generation failed."

    updateStudioImageGeneration(generation.id, {
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      errorMessage: message,
      leaseOwner,
      leaseExpiresAt: new Date().toISOString(),
    })

    return {
      ...toImageGenerationResult(generation),
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      errorMessage: message,
    }
  }
}

function mediaForField({
  media,
  attachments,
  field,
}: {
  media: Record<string, StudioMediaAttachment[]>
  attachments: StudioMediaAttachment[]
  field: StudioVideoParameterField
}) {
  const specific =
    media[getFieldKey(field)] ??
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
  media: Record<string, StudioMediaAttachment[]>
  attachments: StudioMediaAttachment[]
}) {
  const values = Object.values(media).flat()

  return values.length > 0 ? values : attachments
}

function firstMediaValue(
  attachments: StudioMediaAttachment[],
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
  attachments: StudioMediaAttachment[],
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
  const parsed = first.startsWith("data:") ? parseStrictDataUrl(first) : null

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
  attachments: StudioMediaAttachment[]
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
  media: Record<string, StudioMediaAttachment[]>
  attachments: StudioMediaAttachment[]
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
        field.arrayItemKey
          ? { [field.arrayItemKey]: stringValue }
          : stringValue,
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
      const inputPayload = payload.input as Record<string, unknown>
      const current = inputPayload[name]

      if (hasPath && current === undefined) {
        setPayloadValue(payload, ["input", name], firstAttachment)
        break
      }
    }
  }

  return payload
}

function videoAttachmentToBlob(attachment: StudioMediaAttachment) {
  if (!attachment.dataUrl) {
    return null
  }

  const parsed = parseStrictDataUrl(attachment.dataUrl)

  if (!parsed) {
    return null
  }

  const bytes = Buffer.from(parsed.base64, "base64")

  return {
    blob: new Blob([bytes], { type: parsed.mimeType }),
    name:
      attachment.name?.trim() ||
      `reference.${parsed.mimeType.split("/")[1] ?? "jpg"}`,
  }
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
  media: Record<string, StudioMediaAttachment[]>
  attachments: StudioMediaAttachment[]
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

      const file = videoAttachmentToBlob(first)

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
          ? (field.constantValue ?? openapi.modelConstant)
          : (field.constantValue ??
            coerceFieldValue(field, getParamValue(params, field)))

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

async function callVideoProvider({
  url,
  payload,
  apiKey,
}: {
  url: string
  payload: unknown
  apiKey: string
}): Promise<ProviderResponse> {
  const isMultipart = payload instanceof FormData
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  }

  if (!isMultipart) {
    headers["Content-Type"] = "application/json"
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

function getTaskRawStatus(payload: unknown): string | null {
  const direct =
    getAsyncTaskStatus(payload) ?? getOpenAiVideoTaskStatus(payload)

  if (direct) {
    return direct
  }

  if (!payload || typeof payload !== "object") {
    return null
  }

  const nested = (payload as { status?: unknown }).status

  if (typeof nested === "string" && nested) {
    return nested
  }

  if (nested && nested !== payload) {
    return getTaskRawStatus(nested)
  }

  return null
}

function isTransientProviderStatus(status: number) {
  return TRANSIENT_PROVIDER_STATUSES.has(status)
}

async function pollVideoAsyncTask({
  statusUrl,
  taskId,
  apiKey,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
}): Promise<ProviderResponse> {
  const url = new URL(statusUrl)
  url.searchParams.set("task_id", taskId)
  let lastTransientError: ProviderResponse | null = null

  for (let attempt = 0; attempt < VIDEO_ASYNC_TASK_MAX_POLLS; attempt += 1) {
    if (attempt > 0) {
      await sleep(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS)
    }

    let response: Response

    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
    } catch (error) {
      lastTransientError = {
        ok: false,
        status: 0,
        body: {
          error: {
            message:
              error instanceof Error
                ? error.message
                : "Task status request failed.",
          },
        },
      }
      continue
    }

    const text = await response.text()
    let parsed: unknown = null

    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!response.ok) {
      if (isTransientProviderStatus(response.status)) {
        lastTransientError = {
          ok: false,
          status: response.status,
          body: parsed,
        }
        continue
      }

      return { ok: false, status: response.status, body: parsed }
    }

    lastTransientError = null
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
        message: "Async video task polling window expired.",
      },
      lastTransientError,
    },
  }
}

async function pollOpenAiVideoTask({
  statusUrl,
  taskId,
  apiKey,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
}): Promise<ProviderResponse> {
  const url = statusUrl.replace("{task_id}", encodeURIComponent(taskId))
  let lastTransientError: ProviderResponse | null = null

  for (let attempt = 0; attempt < VIDEO_ASYNC_TASK_MAX_POLLS; attempt += 1) {
    if (attempt > 0) {
      await sleep(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS)
    }

    let response: Response

    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
    } catch (error) {
      lastTransientError = {
        ok: false,
        status: 0,
        body: {
          error: {
            message:
              error instanceof Error
                ? error.message
                : "Video status request failed.",
          },
        },
      }
      continue
    }

    const text = await response.text()
    let parsed: unknown = null

    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!response.ok) {
      if (isTransientProviderStatus(response.status)) {
        lastTransientError = {
          ok: false,
          status: response.status,
          body: parsed,
        }
        continue
      }

      return { ok: false, status: response.status, body: parsed }
    }

    lastTransientError = null
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
        message: "OpenAI video task polling window expired.",
      },
      lastTransientError,
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
}): Promise<NormalizedVideoOutput> {
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

function extractVideoOutputs(payload: unknown): NormalizedVideoOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const finalPayload =
    "status" in payload ? (payload as { status?: unknown }).status : payload

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

async function prepareAutoSavedVideoOutput({
  output,
  generationId,
  outputId,
}: {
  output: NormalizedVideoOutput
  generationId: string
  outputId: string
}): Promise<NormalizedVideoOutput> {
  if (output.storagePath) {
    return output
  }

  try {
    const saved = output.dataUrl
      ? writeDataUrlToStudioMediaFile({
          kind: "video",
          generationId,
          outputId,
          dataUrl: output.dataUrl,
          fallbackMimeType: output.mimeType,
        })
      : output.url
        ? await downloadUrlToStudioMediaFile({
            kind: "video",
            generationId,
            outputId,
            url: output.url,
            fallbackMimeType: output.mimeType,
          })
        : null

    if (!saved) {
      return output
    }

    return {
      ...output,
      dataUrl: null,
      storagePath: saved.storagePath,
      mimeType: output.mimeType ?? saved.mimeType,
      metadata: mergeOutputMetadata(output.metadata, {
        sourceUrl: output.url ?? null,
        autoSaved: true,
      }),
    }
  } catch (error) {
    return {
      ...output,
      dataUrl: null,
      metadata: mergeOutputMetadata(output.metadata, {
        autoSaved: true,
        autoSaveDownloadError:
          error instanceof Error ? error.message : "Failed to download video.",
      }),
    }
  }
}

function toVideoOutputResult(
  output: StudioVideoOutput
): StudioMediaOutputResult {
  return {
    id: output.id,
    index: output.index,
    sessionFileId: outputSessionFileId({
      kind: "video",
      outputId: output.id,
      storagePath: output.storagePath,
    }),
    contentUrl: `/api/studio/video-outputs/${encodeURIComponent(
      output.id
    )}/content`,
    url: output.url,
    storagePath: output.storagePath,
    mimeType: output.mimeType,
    width: output.width,
    height: output.height,
    durationSeconds: output.durationSeconds,
  }
}

function toVideoGenerationResult(
  generation: StudioVideoGeneration
): StudioVideoGenerationResult {
  return {
    kind: "video",
    generationId: generation.id,
    status: generation.status,
    model: {
      id: generation.modelSquareId,
      name: generation.modelName,
      openapiFile: generation.openapiFile,
      operationId: generation.operationId,
    },
    prompt: generation.prompt,
    phase: generation.phase,
    progress: generation.progress,
    rawStatus: generation.rawStatus,
    attempt: generation.attempt,
    lastPolledAt: generation.lastPolledAt,
    nextPollAt: generation.nextPollAt,
    providerTaskId: generation.providerTaskId,
    providerRequestId: generation.providerRequestId,
    outputs: generation.outputs.map(toVideoOutputResult),
    errorMessage: generation.errorMessage,
  }
}

function shouldResumeStudioVideoGeneration(generation: StudioVideoGeneration) {
  if (
    !generation.providerTaskId ||
    generation.status === "complete" ||
    generation.status === "partial" ||
    generation.status === "error" ||
    generation.status === "cancelled"
  ) {
    return false
  }

  return (
    generation.status === "queued" ||
    generation.status === "running" ||
    generation.status === "polling"
  )
}

export async function resumeStudioVideoGeneration({
  generation,
  apiKey,
}: {
  generation: StudioVideoGeneration
  apiKey: string
}): Promise<StudioVideoGenerationResult> {
  if (!shouldResumeStudioVideoGeneration(generation)) {
    return toVideoGenerationResult(generation)
  }

  const entry = getVideoOpenapiEntry(
    generation.openapiFile,
    generation.operationId
  )
  const taskId = generation.providerTaskId

  if (!entry || !taskId) {
    return toVideoGenerationResult(generation)
  }

  const statusUrl = getVideoTaskStatusEndpoint(entry)
  let providerRequestId = generation.providerRequestId
  const leaseOwner = createMediaJobLeaseOwner()
  const pollingStartedAt = new Date().toISOString()
  const nextAttempt = generation.attempt + 1

  updateStudioVideoGeneration(generation.id, {
    status: "polling",
    phase: "polling",
    progress: Math.max(generation.progress ?? 0, 0.1),
    rawStatus: generation.rawStatus ?? "polling",
    attempt: nextAttempt,
    lastPolledAt: pollingStartedAt,
    nextPollAt: isoAfter(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS),
    leaseOwner,
    leaseExpiresAt: mediaJobLeaseExpiresAt(),
    providerTaskId: taskId,
    providerRequestId,
  })

  try {
    let providerResponse: ProviderResponse
    let outputs: NormalizedVideoOutput[] = []

    if (entry.adapter === "openai-video") {
      const statusResponse = await pollOpenAiVideoTask({
        statusUrl,
        taskId,
        apiKey,
      })

      providerRequestId =
        getProviderRequestId(statusResponse.body) ?? providerRequestId
      providerResponse = {
        ok: statusResponse.ok,
        status: statusResponse.status,
        body: {
          task_id: taskId,
          request_id: providerRequestId,
          status: statusResponse.body,
          resumed: true,
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
    } else {
      const statusResponse = await pollVideoAsyncTask({
        statusUrl,
        taskId,
        apiKey,
      })

      providerRequestId =
        getProviderRequestId(statusResponse.body) ?? providerRequestId
      providerResponse = {
        ok: statusResponse.ok,
        status: statusResponse.status,
        body: {
          task_id: taskId,
          request_id: providerRequestId,
          status: statusResponse.body,
          resumed: true,
        },
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
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: getTaskRawStatus(providerResponse.body) ?? "error",
        errorMessage: String(message),
        rawResponse: providerResponse.body,
        providerTaskId: taskId,
        providerRequestId,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toVideoGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: getTaskRawStatus(providerResponse.body) ?? "error",
        attempt: nextAttempt,
        lastPolledAt: pollingStartedAt,
        providerTaskId: taskId,
        providerRequestId,
        errorMessage: String(message),
      }
    }

    if (outputs.length === 0) {
      const message = "No video returned by the provider."

      updateStudioVideoGeneration(generation.id, {
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "empty_output",
        errorMessage: message,
        rawResponse: providerResponse.body,
        providerTaskId: taskId,
        providerRequestId,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toVideoGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "empty_output",
        attempt: nextAttempt,
        lastPolledAt: pollingStartedAt,
        providerTaskId: taskId,
        providerRequestId,
        errorMessage: message,
      }
    }

    const autoSavedOutputs = await Promise.all(
      outputs.map(async (output, index) => {
        const outputId = randomUUID()

        return {
          outputId,
          index,
          output: await prepareAutoSavedVideoOutput({
            output,
            generationId: generation.id,
            outputId,
          }),
        }
      })
    )
    const storedOutputs: StudioVideoOutput[] = []

    autoSavedOutputs.forEach(({ output, outputId, index }) => {
      storedOutputs.push(
        createStudioVideoOutput({
          id: outputId,
          generationId: generation.id,
          index,
          url: output.url ?? null,
          dataUrl: null,
          storagePath: output.storagePath ?? null,
          mimeType: output.mimeType ?? null,
          width: output.width ?? null,
          height: output.height ?? null,
          durationSeconds: output.durationSeconds ?? null,
          metadata: output.metadata,
          autoSave: true,
        })
      )
    })

    const completedAt = new Date().toISOString()

    updateStudioVideoGeneration(generation.id, {
      status: "complete",
      phase: "complete",
      progress: 1,
      rawStatus: getTaskRawStatus(providerResponse.body) ?? "complete",
      rawResponse: providerResponse.body,
      providerTaskId: taskId,
      providerRequestId,
      completedAt,
      leaseOwner,
      leaseExpiresAt: completedAt,
    })

    return toVideoGenerationResult({
      ...generation,
      status: "complete",
      phase: "complete",
      progress: 1,
      rawStatus: getTaskRawStatus(providerResponse.body) ?? "complete",
      attempt: nextAttempt,
      lastPolledAt: pollingStartedAt,
      providerTaskId: taskId,
      providerRequestId,
      completedAt,
      outputs: storedOutputs,
      errorMessage: null,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Video generation failed."

    updateStudioVideoGeneration(generation.id, {
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      errorMessage: message,
      providerTaskId: taskId,
      providerRequestId,
      leaseOwner,
      leaseExpiresAt: new Date().toISOString(),
    })

    return {
      ...toVideoGenerationResult(generation),
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      attempt: nextAttempt,
      lastPolledAt: pollingStartedAt,
      providerTaskId: taskId,
      providerRequestId,
      errorMessage: message,
    }
  }
}

export function scheduleStudioVideoGenerationResume({
  generation,
  apiKey,
}: {
  generation: StudioVideoGeneration
  apiKey: string
}) {
  if (!shouldResumeStudioVideoGeneration(generation)) {
    return
  }

  if (activeVideoGenerationTasks.has(generation.id)) {
    return
  }

  activeVideoGenerationTasks.add(generation.id)
  void (async () => {
    try {
      await resumeStudioVideoGeneration({ generation, apiKey })
    } finally {
      activeVideoGenerationTasks.delete(generation.id)
    }
  })()
}

export function scheduleStudioVideoGenerationResumesForSession({
  sessionId,
  apiKey,
}: {
  sessionId: string
  apiKey: string
}) {
  for (const generation of listStudioVideoGenerations(sessionId)) {
    scheduleStudioVideoGenerationResume({ generation, apiKey })
  }
}

export async function submitStudioVideoGeneration(
  input: GenerateStudioVideoInput
): Promise<StudioVideoGenerationResult> {
  const session = getStudioSession(input.sessionId)

  if (!session) {
    throw new Error("Session not found.")
  }

  const modelId = input.modelId?.trim() || input.modelName
  const modelName = input.modelName.trim()
  const prompt = input.prompt.trim()
  const rawParams = input.params ?? {}
  const media = mergeMediaReferenceAttachments({
    media: input.media ?? {},
    mediaReferences: input.mediaReferences ?? {},
    sessionId: input.sessionId,
  })
  const attachments = mergeReferenceAttachments({
    attachments: input.attachments ?? [],
    references: input.references ?? [],
    sessionId: input.sessionId,
  })
  const resolvedOperation = resolveVideoModelOperation({
    modelId,
    modelName,
    file: input.openapiFile,
    operationId: input.operationId,
  })

  if (!resolvedOperation) {
    throw new Error("Video operation is not supported for this model.")
  }

  if (resolvedOperation.fields.length === 0) {
    throw new Error("Video operation fields are not available.")
  }

  const params = mergeFieldDefaultParams(resolvedOperation.fields, rawParams)
  const leaseOwner = createMediaJobLeaseOwner()
  const generation = createStudioVideoGeneration({
    sessionId: input.sessionId,
    modelSquareId: modelId,
    modelName,
    openapiFile: resolvedOperation.openapi.file,
    operationId: resolvedOperation.openapi.operationId,
    prompt,
    params,
    status: "running",
    phase: "submitting",
    progress: 0,
    attempt: 0,
    leaseOwner,
    leaseExpiresAt: mediaJobLeaseExpiresAt(),
  })
  const endpointUrl = getVideoModelEndpoint(resolvedOperation.openapi)
  const payload =
    resolvedOperation.openapi.adapter === "openai-video"
      ? buildOpenAiVideoFormData({
          openapi: resolvedOperation.openapi,
          fields: resolvedOperation.fields,
          prompt,
          params,
          media,
          attachments,
        })
      : buildVideoPayload({
          openapi: resolvedOperation.openapi,
          fields: resolvedOperation.fields,
          prompt,
          params,
          media,
          attachments,
        })

  try {
    const providerResponse = await callVideoProvider({
      url: endpointUrl,
      payload,
      apiKey: input.apiKey,
    })
    const providerRequestId = getProviderRequestId(providerResponse.body)

    if (!providerResponse.ok) {
      const message = getProviderErrorMessage(
        providerResponse.body,
        `Provider returned ${providerResponse.status}`
      )

      updateStudioVideoGeneration(generation.id, {
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: getTaskRawStatus(providerResponse.body) ?? "error",
        errorMessage: String(message),
        rawResponse: providerResponse.body,
        providerRequestId,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toVideoGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: getTaskRawStatus(providerResponse.body) ?? "error",
        providerRequestId,
        errorMessage: String(message),
      }
    }

    const providerTaskId =
      resolvedOperation.openapi.adapter === "openai-video"
        ? getOpenAiVideoTaskId(providerResponse.body)
        : getAsyncTaskId(providerResponse.body)

    if (!providerTaskId) {
      const message = "No async task id returned by the provider."

      updateStudioVideoGeneration(generation.id, {
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "missing_task_id",
        errorMessage: message,
        rawResponse: providerResponse.body,
        providerRequestId,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toVideoGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "missing_task_id",
        providerRequestId,
        errorMessage: message,
      }
    }

    recordStudioVideoGenerationTask(generation.id, {
      providerTaskId,
      providerRequestId,
    })
    updateStudioVideoGeneration(generation.id, {
      status: "polling",
      phase: "polling",
      progress: 0.05,
      rawStatus: getTaskRawStatus(providerResponse.body) ?? "submitted",
      rawResponse: providerResponse.body,
      providerTaskId,
      providerRequestId,
      nextPollAt: isoAfter(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS),
      leaseOwner,
      leaseExpiresAt: mediaJobLeaseExpiresAt(),
      completedAt: null,
    })

    const runningGeneration: StudioVideoGeneration = {
      ...generation,
      providerTaskId,
      providerRequestId,
      status: "polling",
      phase: "polling",
      progress: 0.05,
      rawStatus: getTaskRawStatus(providerResponse.body) ?? "submitted",
      nextPollAt: isoAfter(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS),
    }

    scheduleStudioVideoGenerationResume({
      generation: runningGeneration,
      apiKey: input.apiKey,
    })

    return toVideoGenerationResult(runningGeneration)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Video generation failed."

    updateStudioVideoGeneration(generation.id, {
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      errorMessage: message,
      leaseOwner,
      leaseExpiresAt: new Date().toISOString(),
    })

    return {
      ...toVideoGenerationResult(generation),
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      errorMessage: message,
    }
  }
}

export function formatMediaGenerationResult(
  result: StudioImageGenerationResult | StudioVideoGenerationResult
) {
  return JSON.stringify(result, null, 2)
}
