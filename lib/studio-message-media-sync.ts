import {
  getGeneratedMediaSessionFileId,
  getStudioSessionFile,
  getStudioModelverseApiKey,
  listStudioImageGenerations,
  updateStudioMessageSnapshot,
} from "@/lib/studio-db"
import { scheduleStudioVideoGenerationResumesForSession } from "@/lib/studio-media-generation-service"
import type {
  StudioImageGeneration,
  StudioMediaGenerationOutput,
  StudioMessage,
  StudioMessagePart,
} from "@/lib/studio-types"
import { listStudioVideoGenerations } from "@/lib/studio-video-db"
import type {
  StudioVideoGeneration,
  StudioVideoOutput,
} from "@/lib/studio-video-types"

type StudioMediaGenerationPart = Extract<
  StudioMessagePart,
  { type: "media_generation" }
>

const ACTIVE_MEDIA_STATUSES: ReadonlySet<StudioMediaGenerationPart["status"]> =
  new Set([
    "queued",
    "running",
    "polling",
  ])

function hasActiveMediaPart(message: StudioMessage) {
  return message.parts.some(
    (part) =>
      part.type === "media_generation" && ACTIVE_MEDIA_STATUSES.has(part.status)
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

function imageOutputs(
  outputs: StudioImageGeneration["outputs"]
): StudioMediaGenerationOutput[] {
  return outputs.map((output) => ({
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
  }))
}

function videoOutputs(
  outputs: StudioVideoOutput[]
): StudioMediaGenerationOutput[] {
  return outputs.map((output) => ({
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
  }))
}

function syncImagePart(
  part: StudioMediaGenerationPart,
  generation: StudioImageGeneration
): StudioMediaGenerationPart {
  return {
    ...part,
    status: generation.status,
    modelName: generation.modelName,
    prompt: generation.prompt,
    phase: generation.phase,
    progress: generation.progress,
    rawStatus: generation.rawStatus,
    outputs: imageOutputs(generation.outputs),
    errorMessage: generation.errorMessage,
  }
}

function syncVideoPart(
  part: StudioMediaGenerationPart,
  generation: StudioVideoGeneration
): StudioMediaGenerationPart {
  return {
    ...part,
    status: generation.status,
    modelName: generation.modelName,
    prompt: generation.prompt,
    phase: generation.phase,
    progress: generation.progress,
    rawStatus: generation.rawStatus,
    outputs: videoOutputs(generation.outputs),
    errorMessage: generation.errorMessage,
    providerTaskId: generation.providerTaskId,
    providerRequestId: generation.providerRequestId,
  }
}

function isSamePart(left: StudioMessagePart, right: StudioMessagePart) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function syncStudioMessageMediaParts(
  sessionId: string,
  messages: StudioMessage[]
) {
  if (!messages.some(hasActiveMediaPart)) {
    return messages
  }

  const apiKey = getStudioModelverseApiKey()?.key ?? null

  if (apiKey) {
    scheduleStudioVideoGenerationResumesForSession({ sessionId, apiKey })
  }

  const imagesById = new Map(
    listStudioImageGenerations(sessionId).map((generation) => [
      generation.id,
      generation,
    ])
  )
  const videosById = new Map(
    listStudioVideoGenerations(sessionId).map((generation) => [
      generation.id,
      generation,
    ])
  )

  return messages.map((message) => {
    let changed = false
    const parts = message.parts.map((part) => {
      if (
        part.type !== "media_generation" ||
        !ACTIVE_MEDIA_STATUSES.has(part.status)
      ) {
        return part
      }

      const nextPart =
        part.kind === "image"
          ? (() => {
              const generation = imagesById.get(part.generationId)

              return generation ? syncImagePart(part, generation) : part
            })()
          : (() => {
              const generation = videosById.get(part.generationId)

              return generation ? syncVideoPart(part, generation) : part
            })()

      if (!isSamePart(part, nextPart)) {
        changed = true
      }

      return nextPart
    })

    if (!changed) {
      return message
    }

    return (
      updateStudioMessageSnapshot({
        messageId: message.id,
        sessionId: message.sessionId,
        content: message.content,
        activities: message.activities,
        parts,
        reasoningContent: message.reasoningContent,
        reasoningDurationMs: message.reasoningDurationMs,
        status: message.status,
      }) ?? { ...message, parts }
    )
  })
}
