import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getStoredModelverseApiKey } from "@/lib/modelverse-openai"
import {
  getStudioSession,
  listStudioImageGenerations,
} from "@/lib/studio-db"
import {
  generateStudioImage,
  type StudioMediaReference,
} from "@/lib/studio-media-generation-service"
import type { StudioImageGeneration } from "@/lib/studio-types"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ sessionId: string }>
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
      .max(20_000_000)
      .optional(),
    url: z.string().trim().url().max(2_000).optional(),
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

const submitSchema = z.object({
  modelId: z.string().trim().min(1),
  modelName: z.string().trim().min(1),
  operationId: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).max(4_000),
  params: paramsSchema.default({}),
  attachments: z.array(imageAttachmentSchema).default([]),
  references: z.array(mediaReferenceSchema).default([]),
})

function getImageOutputContentUrl(outputId: string) {
  return `/api/studio/image-outputs/${encodeURIComponent(outputId)}/content`
}

function toLightImageGeneration(
  generation: StudioImageGeneration
): StudioImageGeneration {
  return {
    ...generation,
    outputs: generation.outputs.map((output) => ({
      ...output,
      src: getImageOutputContentUrl(output.id),
      dataUrl: null,
    })),
  }
}

function findImageGeneration(sessionId: string, generationId: string) {
  return (
    listStudioImageGenerations(sessionId).find(
      (generation) => generation.id === generationId
    ) ?? null
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
    data: listStudioImageGenerations(sessionId).map(toLightImageGeneration),
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

  const apiKey = getStoredModelverseApiKey()

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Modelverse API key is not configured locally." },
      { status: 400 }
    )
  }

  try {
    const result = await generateStudioImage({
      ...parsed.data,
      apiKey,
      sessionId,
    })
    const generation = findImageGeneration(sessionId, result.generationId)

    if (result.status === "error") {
      return NextResponse.json(
        {
          ok: false,
          error: result.errorMessage ?? "Image generation failed.",
          data: generation ? toLightImageGeneration(generation) : result,
        },
        { status: 502 }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        data: generation ? toLightImageGeneration(generation) : result,
      },
      { status: 201 }
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image generation failed."

    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
