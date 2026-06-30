import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
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

function resolveStoragePath(storagePath: string) {
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

export function writeStudioFile(storagePath: string, buffer: Buffer) {
  const absolutePath = resolveStoragePath(storagePath)
  const directory = dirname(absolutePath)

  mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true })
  writeFileSync(/* turbopackIgnore: true */ absolutePath, buffer)
}

export function readStudioFile(storagePath: string) {
  const absolutePath = resolveStoragePath(storagePath)

  return readFileSync(/* turbopackIgnore: true */ absolutePath)
}

export function statStudioFile(storagePath: string) {
  const absolutePath = resolveStoragePath(storagePath)

  return statSync(/* turbopackIgnore: true */ absolutePath)
}

export function storagePathToDownloadName(storagePath: string) {
  return safeFileName(storagePath.split(/[\\/]/).at(-1) ?? "file")
}
