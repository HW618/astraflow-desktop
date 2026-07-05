import { tool } from "langchain"
import { z } from "zod"

import {
  IMAGE_MODEL_REGISTRY,
  getImageModelDisplayName,
  type ImageOpenapiRegistryEntry,
} from "@/lib/image-model-openapi"
import { VIDEO_OPENAPI_MODELS } from "@/lib/generated/video-openapi-fields"
import {
  getGeneratedMediaSessionFileId,
  getStudioSessionFile,
  listStudioImageGenerations,
} from "@/lib/studio-db"
import {
  formatMediaGenerationResult,
  generateStudioImage,
  scheduleStudioVideoGenerationResumesForSession,
  submitStudioVideoGeneration,
} from "@/lib/studio-media-generation-service"
import type { StudioMediaReference } from "@/lib/studio-media-generation-service"
import type { StudioImageGeneration } from "@/lib/studio-types"
import { listStudioVideoGenerations } from "@/lib/studio-video-db"
import type { StudioVideoGeneration } from "@/lib/studio-video-types"

type StudioMediaToolOptions = {
  sessionId: string
  apiKey: string
}

type StudioMediaReadToolOptions = {
  sessionId: string
  apiKey?: string | null
}

const paramsSchema = z.record(z.string(), z.unknown())

const imageAttachmentSchema = z
  .object({
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
  .refine((value) => Boolean(value.dataUrl || value.url), {
    message: "Each attachment needs either dataUrl or url.",
  })

const mediaAttachmentSchema = z
  .object({
    name: z.string().trim().max(255).optional(),
    mimeType: z.string().trim().max(120).optional(),
    dataUrl: z
      .string()
      .trim()
      .regex(/^data:(?:image|video)\//i)
      .max(160_000_000)
      .optional(),
    url: z.string().trim().url().max(4_000).optional(),
  })
  .refine((value) => Boolean(value.dataUrl || value.url), {
    message: "Each attachment needs either dataUrl or url.",
  })

const mediaReferenceSchema: z.ZodType<StudioMediaReference> =
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("session_file"),
      id: z.string().trim().min(1),
      name: z.string().trim().max(255).optional(),
    }),
    z.object({
      type: z.literal("image_output"),
      id: z.string().trim().min(1),
      name: z.string().trim().max(255).optional(),
    }),
    z.object({
      type: z.literal("video_output"),
      id: z.string().trim().min(1),
      name: z.string().trim().max(255).optional(),
    }),
    z.object({
      type: z.literal("url"),
      url: z.string().trim().url().max(4_000),
      name: z.string().trim().max(255).optional(),
      mimeType: z.string().trim().max(120).optional(),
    }),
  ])

function normalizeModelQuery(query: string | undefined) {
  return query?.trim().toLowerCase() ?? ""
}

function imageModelRows(query: string, maxResults: number) {
  const rows = Object.entries(IMAGE_MODEL_REGISTRY)
    .filter(([, entry]) => entry.supported && entry.openapi)
    .map(([modelName, entry]) => ({
      kind: "image",
      modelName,
      label: getImageModelDisplayName(modelName),
      operations: [entry.openapi, entry.editOpenapi]
        .filter(
          (operation): operation is ImageOpenapiRegistryEntry =>
            Boolean(operation)
        )
        .map((operation) => ({
          operationId: operation.operationId,
          openapiFile: operation.file,
          adapter: operation.adapter,
          requiresReferenceImage: operation.adapter === "openai-images-edit",
        })),
    }))

  return rows
    .filter((row) => {
      if (!query) return true

      return (
        row.modelName.toLowerCase().includes(query) ||
        row.label.toLowerCase().includes(query) ||
        row.operations.some((operation) =>
          operation.operationId.toLowerCase().includes(query)
        )
      )
    })
    .slice(0, maxResults)
}

function videoModelRows(query: string, maxResults: number) {
  const rows = VIDEO_OPENAPI_MODELS.map((entry) => ({
    kind: "video",
    title: entry.title,
    modelNames: entry.modelValues,
    operationId: entry.operationId,
    openapiFile: entry.file,
    adapter: entry.adapter,
    contentType: entry.contentType,
  }))

  return rows
    .filter((row) => {
      if (!query) return true

      return (
        row.title.toLowerCase().includes(query) ||
        row.operationId.toLowerCase().includes(query) ||
        row.modelNames.some((modelName) =>
          modelName.toLowerCase().includes(query)
        )
      )
    })
    .slice(0, maxResults)
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

function imageGenerationRow(generation: StudioImageGeneration) {
  return {
    kind: "image",
    generationId: generation.id,
    status: generation.status,
    phase: generation.phase,
    progress: generation.progress,
    rawStatus: generation.rawStatus,
    attempt: generation.attempt,
    lastPolledAt: generation.lastPolledAt,
    nextPollAt: generation.nextPollAt,
    modelName: generation.modelName,
    openapiFile: generation.openapiFile,
    operationId: generation.operationId,
    prompt: generation.prompt,
    errorMessage: generation.errorMessage,
    createdAt: generation.createdAt,
    completedAt: generation.completedAt,
    outputs: generation.outputs.map((output) => ({
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
    })),
  }
}

function videoGenerationRow(generation: StudioVideoGeneration) {
  return {
    kind: "video",
    generationId: generation.id,
    status: generation.status,
    phase: generation.phase,
    progress: generation.progress,
    rawStatus: generation.rawStatus,
    attempt: generation.attempt,
    lastPolledAt: generation.lastPolledAt,
    nextPollAt: generation.nextPollAt,
    modelName: generation.modelName,
    openapiFile: generation.openapiFile,
    operationId: generation.operationId,
    providerTaskId: generation.providerTaskId,
    providerRequestId: generation.providerRequestId,
    prompt: generation.prompt,
    errorMessage: generation.errorMessage,
    createdAt: generation.createdAt,
    completedAt: generation.completedAt,
    outputs: generation.outputs.map((output) => ({
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
    })),
  }
}

function listMediaGenerations({
  kind,
  maxResults,
  sessionId,
  status,
}: {
  kind: "image" | "video" | "all"
  maxResults: number
  sessionId: string
  status?: string
}) {
  const imageRows =
    kind === "video"
      ? []
      : listStudioImageGenerations(sessionId).map(imageGenerationRow)
  const videoRows =
    kind === "image"
      ? []
      : listStudioVideoGenerations(sessionId).map(videoGenerationRow)
  const rows = [...imageRows, ...videoRows]
    .filter((row) => !status || row.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return rows.slice(0, maxResults)
}

export function createListStudioMediaGenerationModelsTool() {
  return tool(
    async ({ kind, query, maxResults }) => {
      const normalizedQuery = normalizeModelQuery(query)
      const count = Math.min(Math.max(maxResults ?? 20, 1), 50)
      const models =
        kind === "image"
          ? imageModelRows(normalizedQuery, count)
          : kind === "video"
            ? videoModelRows(normalizedQuery, count)
            : [
                ...imageModelRows(normalizedQuery, count),
                ...videoModelRows(normalizedQuery, count),
              ].slice(0, count)

      return JSON.stringify(
        {
          models,
          note:
            "Use modelName for generation. Pass operationId when selecting a non-default operation.",
        },
        null,
        2
      )
    },
    {
      name: "studio_list_media_generation_models",
      description:
        "List supported Studio image/video generation models and OpenAPI operation IDs available to chat agents.",
      schema: z.object({
        kind: z
          .enum(["image", "video", "all"])
          .optional()
          .default("all")
          .describe("Which media model family to list."),
        query: z
          .string()
          .trim()
          .optional()
          .describe("Optional case-insensitive model or operation filter."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(20)
          .describe("Maximum number of models to return."),
      }),
    }
  )
}

export function createListStudioMediaGenerationsTool({
  apiKey,
  sessionId,
}: StudioMediaReadToolOptions) {
  return tool(
    async ({ kind, status, maxResults }) => {
      const count = Math.min(Math.max(maxResults ?? 20, 1), 50)

      if (apiKey) {
        scheduleStudioVideoGenerationResumesForSession({ sessionId, apiKey })
      }

      return JSON.stringify(
        {
          generations: listMediaGenerations({
            kind,
            maxResults: count,
            sessionId,
            status,
          }),
        },
        null,
        2
      )
    },
    {
      name: "studio_list_media_generations",
      description:
        "List recent Studio image and video generation jobs in the current session.",
      schema: z.object({
        kind: z
          .enum(["image", "video", "all"])
          .optional()
          .default("all")
          .describe("Which media generation family to list."),
        status: z
          .enum([
            "queued",
            "running",
            "polling",
            "complete",
            "partial",
            "error",
            "cancelled",
          ])
          .optional()
          .describe("Optional status filter."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(20)
          .describe("Maximum number of jobs to return."),
      }),
    }
  )
}

export function createGetStudioMediaGenerationTool({
  apiKey,
  sessionId,
}: StudioMediaReadToolOptions) {
  return tool(
    async ({ generationId }) => {
      if (apiKey) {
        scheduleStudioVideoGenerationResumesForSession({ sessionId, apiKey })
      }

      const generations = listMediaGenerations({
        kind: "all",
        maxResults: 200,
        sessionId,
      })
      const generation =
        generations.find((candidate) => candidate.generationId === generationId)
          ?? null

      return JSON.stringify({ generation }, null, 2)
    },
    {
      name: "studio_get_media_generation",
      description:
        "Get one Studio image or video generation job by generation id, including status and output content URLs.",
      schema: z.object({
        generationId: z
          .string()
          .trim()
          .min(1)
          .describe("The image or video generation id."),
      }),
    }
  )
}

export function createStudioGenerateImageTool({
  sessionId,
  apiKey,
}: StudioMediaToolOptions) {
  return tool(
    async ({
      modelName,
      modelId,
      operationId,
      prompt,
      params,
      attachments,
      references,
    }) => {
      const result = await generateStudioImage({
        sessionId,
        apiKey,
        modelName,
        modelId,
        operationId,
        prompt,
        params,
        attachments,
        references,
      })

      return formatMediaGenerationResult(result)
    },
    {
      name: "studio_generate_image",
      description:
        "Generate or edit an image with Studio ModelVerse image models. Prefer references over data URLs for current-session files or prior image outputs. Returns a generation id, status, prompt, model, and output content/storage URLs when available.",
      schema: z.object({
        modelName: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Model name, such as gpt-image-2, doubao-seedream-4.5, or gemini-3-pro-image."
          ),
        modelId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional Model Square id. Defaults to modelName."),
        operationId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional OpenAPI operation id for edit or alternate modes."),
        prompt: z
          .string()
          .trim()
          .min(1)
          .max(4_000)
          .describe("Image prompt."),
        params: paramsSchema
          .optional()
          .default({})
          .describe("Provider-specific parameter values keyed by field name."),
        attachments: z
          .array(imageAttachmentSchema)
          .optional()
          .default([])
          .describe("Optional reference images as public URLs or data URLs."),
        references: z
          .array(mediaReferenceSchema)
          .optional()
          .default([])
          .describe(
            "Optional reusable references to session_file, image_output, or URL records. Use this instead of embedding dataUrl when possible."
          ),
      }),
    }
  )
}

export function createStudioGenerateVideoTool({
  sessionId,
  apiKey,
}: StudioMediaToolOptions) {
  return tool(
    async ({
      modelName,
      modelId,
      operationId,
      openapiFile,
      prompt,
      params,
      media,
      attachments,
      references,
      mediaReferences,
    }) => {
      const result = await submitStudioVideoGeneration({
        sessionId,
        apiKey,
        modelName,
        modelId,
        operationId,
        openapiFile,
        prompt,
        params,
        media,
        attachments,
        references,
        mediaReferences,
      })

      return formatMediaGenerationResult(result)
    },
    {
      name: "studio_generate_video",
      description:
        "Submit a Studio ModelVerse video generation task. Prefer references over data URLs for current-session files or prior media outputs. Returns the generation id, running/error status, provider task id, prompt, model, and any output URLs already available.",
      schema: z.object({
        modelName: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Video model name from studio_list_media_generation_models, such as OpenAI-Sora2-T2V or Wan-AI/Wan2.6-T2V."
          ),
        modelId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional Model Square id. Defaults to modelName."),
        operationId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional OpenAPI operation id."),
        openapiFile: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional OpenAPI file when disambiguating video models."),
        prompt: z
          .string()
          .trim()
          .min(1)
          .max(8_000)
          .describe("Video prompt."),
        params: paramsSchema
          .optional()
          .default({})
          .describe(
            "Provider-specific parameter values keyed by field name or payload path."
          ),
        media: z
          .record(z.string(), z.array(mediaAttachmentSchema))
          .optional()
          .default({})
          .describe(
            "Optional media attachments keyed by field name or payload path."
          ),
        attachments: z
          .array(mediaAttachmentSchema)
          .optional()
          .default([])
          .describe(
            "Optional fallback reference images as public URLs or data URLs."
          ),
        references: z
          .array(mediaReferenceSchema)
          .optional()
          .default([])
          .describe(
            "Optional fallback media references to session_file, image_output, video_output, or URL records. Use this instead of embedding dataUrl when possible."
          ),
        mediaReferences: z
          .record(z.string(), z.array(mediaReferenceSchema))
          .optional()
          .default({})
          .describe(
            "Optional media references keyed by field name or payload path, for first-frame, last-frame, source image, or other media fields."
          ),
      }),
    }
  )
}
