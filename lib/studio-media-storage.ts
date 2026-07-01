import { once } from "node:events"
import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

import {
  createMediaStoragePath,
  parseDataUrl,
  resolveStudioStoragePath,
  writeStudioFile,
} from "@/lib/studio-file-storage"

export type StudioMediaKind = "image" | "audio" | "video"

type StoredStudioMedia = {
  storagePath: string
  mimeType: string
  size: number
}

const DEFAULT_MEDIA_MAX_BYTES: Record<StudioMediaKind, number> = {
  image: 50 * 1024 * 1024,
  audio: 200 * 1024 * 1024,
  video: 1024 * 1024 * 1024,
}
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000

function readPositiveInt(value: string | undefined) {
  if (!value) {
    return null
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

function getMediaMaxBytes(kind: StudioMediaKind) {
  const envKey = `ASTRAFLOW_MAX_${kind.toUpperCase()}_BYTES`

  return readPositiveInt(process.env[envKey]) ?? DEFAULT_MEDIA_MAX_BYTES[kind]
}

function getDownloadTimeoutMs() {
  return (
    readPositiveInt(process.env.ASTRAFLOW_MEDIA_DOWNLOAD_TIMEOUT_MS) ??
    DEFAULT_DOWNLOAD_TIMEOUT_MS
  )
}

function getFallbackMimeType(kind: StudioMediaKind) {
  if (kind === "image") {
    return "image/png"
  }

  if (kind === "audio") {
    return "audio/mpeg"
  }

  return "video/mp4"
}

function normalizeMimeType(value: string | null, kind: StudioMediaKind) {
  return value?.split(";")[0]?.trim() || getFallbackMimeType(kind)
}

function createStoragePath({
  kind,
  generationId,
  outputId,
  mimeType,
}: {
  kind: StudioMediaKind
  generationId: string
  outputId: string
  mimeType: string
}) {
  return createMediaStoragePath({
    kind,
    generationId,
    outputId,
    mimeType,
  })
}

async function writeChunk(
  stream: ReturnType<typeof createWriteStream>,
  chunk: Uint8Array
) {
  if (!stream.write(Buffer.from(chunk))) {
    await Promise.race([
      once(stream, "drain"),
      once(stream, "error").then(([error]) => Promise.reject(error)),
    ])
  }
}

async function finishWrite(stream: ReturnType<typeof createWriteStream>) {
  stream.end()

  await Promise.race([
    once(stream, "finish"),
    once(stream, "error").then(([error]) => Promise.reject(error)),
  ])
}

export function writeDataUrlToStudioMediaFile({
  kind,
  generationId,
  outputId,
  dataUrl,
  fallbackMimeType,
}: {
  kind: StudioMediaKind
  generationId: string
  outputId: string
  dataUrl: string
  fallbackMimeType?: string | null
}): StoredStudioMedia {
  const parsed = parseDataUrl(dataUrl)
  const mimeType = normalizeMimeType(
    parsed.mimeType || fallbackMimeType || null,
    kind
  )
  const maxBytes = getMediaMaxBytes(kind)

  if (parsed.buffer.byteLength > maxBytes) {
    throw new Error(`Media file exceeds the ${maxBytes} byte storage limit.`)
  }

  const storagePath = createStoragePath({
    kind,
    generationId,
    outputId,
    mimeType,
  })

  writeStudioFile(storagePath, parsed.buffer)

  return {
    storagePath,
    mimeType,
    size: parsed.buffer.byteLength,
  }
}

export async function downloadUrlToStudioMediaFile({
  kind,
  generationId,
  outputId,
  url,
  fallbackMimeType,
}: {
  kind: StudioMediaKind
  generationId: string
  outputId: string
  url: string
  fallbackMimeType?: string | null
}): Promise<StoredStudioMedia> {
  const parsedUrl = new URL(url)

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only http and https media URLs can be saved.")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getDownloadTimeoutMs())
  const maxBytes = getMediaMaxBytes(kind)

  try {
    const response = await fetch(parsedUrl, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`Failed to fetch media (${response.status}).`)
    }

    const contentLength = Number(response.headers.get("content-length"))

    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Media file exceeds the ${maxBytes} byte storage limit.`)
    }

    const mimeType = normalizeMimeType(
      response.headers.get("content-type") || fallbackMimeType || null,
      kind
    )
    const storagePath = createStoragePath({
      kind,
      generationId,
      outputId,
      mimeType,
    })
    const absolutePath = resolveStudioStoragePath(storagePath)
    const directory = dirname(absolutePath)
    const tempPath = join(directory, `.tmp-${randomUUID()}`)

    mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true })

    const stream = createWriteStream(/* turbopackIgnore: true */ tempPath, {
      flags: "wx",
    })
    let totalBytes = 0
    let streamError: unknown = null

    stream.once("error", (error) => {
      streamError = error
    })

    try {
      if (!response.body) {
        const buffer = Buffer.from(await response.arrayBuffer())

        totalBytes = buffer.byteLength

        if (totalBytes > maxBytes) {
          throw new Error(
            `Media file exceeds the ${maxBytes} byte storage limit.`
          )
        }

        await writeChunk(stream, buffer)

        if (streamError) {
          throw streamError
        }
      } else {
        const reader = response.body.getReader()

        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          totalBytes += value.byteLength

          if (totalBytes > maxBytes) {
            await reader.cancel()
            throw new Error(
              `Media file exceeds the ${maxBytes} byte storage limit.`
            )
          }

          await writeChunk(stream, value)

          if (streamError) {
            throw streamError
          }
        }
      }

      await finishWrite(stream)

      if (streamError) {
        throw streamError
      }

      renameSync(/* turbopackIgnore: true */ tempPath, absolutePath)
    } catch (error) {
      stream.destroy()
      rmSync(/* turbopackIgnore: true */ tempPath, { force: true })
      throw error
    }

    return { storagePath, mimeType, size: totalBytes }
  } finally {
    clearTimeout(timeout)
  }
}
