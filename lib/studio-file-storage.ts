import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, extname, join, normalize } from "node:path"
import { randomUUID } from "node:crypto"

const DEFAULT_STORAGE_ROOT_DIRECTORY = ".data"
const DEFAULT_STORAGE_ROOT_NAME = "studio-files"

export type ParsedDataUrl = {
  mimeType: string
  buffer: Buffer
}

function getConfiguredStorageRoot() {
  return process.env.ASTRAFLOW_STUDIO_FILES_PATH?.trim() || null
}

export function safeFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/[^\w\u4e00-\u9fa5 .@()+\-[\]]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 160)

  return cleaned || "file"
}

export function resolveStudioStoragePath(storagePath: string) {
  const normalized = normalize(storagePath).replace(/^(\.\.(\/|\\|$))+/, "")

  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error("Invalid storage path.")
  }

  const configuredStorageRoot = getConfiguredStorageRoot()

  if (configuredStorageRoot) {
    return join(/* turbopackIgnore: true */ configuredStorageRoot, normalized)
  }

  return join(
    process.cwd(),
    DEFAULT_STORAGE_ROOT_DIRECTORY,
    DEFAULT_STORAGE_ROOT_NAME,
    normalized
  )
}

function extensionFromMimeType(mimeType: string | null | undefined) {
  const extension = mimeType?.split("/")[1]?.split("+")[0]?.trim()

  if (!extension) {
    return "bin"
  }

  if (extension === "jpeg") {
    return "jpg"
  }

  if (extension === "mpeg") {
    return "mp3"
  }

  if (extension === "quicktime") {
    return "mov"
  }

  return extension.replace(/[^\w.-]+/g, "-") || "bin"
}

export function parseDataUrl(dataUrl: string): ParsedDataUrl {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/)

  if (!match) {
    throw new Error("Invalid data URL.")
  }

  const mimeType = match[1] || "application/octet-stream"
  const isBase64 = Boolean(match[2])
  const payload = match[3] ?? ""
  const buffer = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8")

  return { mimeType, buffer }
}

export function bufferToArrayBuffer(buffer: Buffer) {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(arrayBuffer).set(buffer)

  return arrayBuffer
}

export function createAttachmentStoragePath({
  sessionId,
  messageId,
  attachmentId,
  name,
}: {
  sessionId: string
  messageId: string
  attachmentId: string
  name: string
}) {
  return join(
    "attachments",
    safeFileName(sessionId),
    safeFileName(messageId),
    `${safeFileName(attachmentId)}-${safeFileName(name)}`
  )
}

export function createGeneratedStoragePath({
  sessionId,
  name,
}: {
  sessionId: string
  name: string
}) {
  return join(
    "generated",
    safeFileName(sessionId),
    `${Date.now()}-${randomUUID()}-${safeFileName(name)}`
  )
}

export function createMediaStoragePath({
  kind,
  generationId,
  outputId,
  mimeType,
}: {
  kind: "image" | "audio" | "video"
  generationId: string
  outputId: string
  mimeType?: string | null
}) {
  const extension = extensionFromMimeType(mimeType)
  const safeOutputId = safeFileName(outputId)
  const currentExtension = extname(safeOutputId)
  const fileName = currentExtension
    ? safeOutputId
    : `${safeOutputId}.${extension}`

  return join("media", kind, safeFileName(generationId), fileName)
}

export function writeStudioFile(storagePath: string, buffer: Buffer) {
  const absolutePath = resolveStudioStoragePath(storagePath)
  const directory = dirname(absolutePath)
  const tempPath = join(directory, `.tmp-${randomUUID()}`)

  mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true })

  try {
    writeFileSync(/* turbopackIgnore: true */ tempPath, buffer)
    renameSync(/* turbopackIgnore: true */ tempPath, absolutePath)
  } catch (error) {
    rmSync(/* turbopackIgnore: true */ tempPath, { force: true })
    throw error
  }
}

export function readStudioFile(storagePath: string) {
  const absolutePath = resolveStudioStoragePath(storagePath)

  return readFileSync(/* turbopackIgnore: true */ absolutePath)
}

export function statStudioFile(storagePath: string) {
  const absolutePath = resolveStudioStoragePath(storagePath)

  return statSync(/* turbopackIgnore: true */ absolutePath)
}

export function removeStudioFile(storagePath: string) {
  const absolutePath = resolveStudioStoragePath(storagePath)

  rmSync(/* turbopackIgnore: true */ absolutePath, { force: true })
}

export function removeStudioDirectory(storagePath: string) {
  const absolutePath = resolveStudioStoragePath(storagePath)

  rmSync(/* turbopackIgnore: true */ absolutePath, {
    force: true,
    recursive: true,
  })
}

export function storagePathToDownloadName(storagePath: string) {
  return safeFileName(storagePath.split(/[\\/]/).at(-1) ?? "file")
}
