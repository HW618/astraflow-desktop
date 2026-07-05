import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  AGENT_MODEL_PROTOCOLS,
  AGENT_RUNTIME_IDS,
} from "@/lib/agent-model-settings-shared"
import {
  getAgentModelSettings,
  listAgentModels,
  saveAgentModelSettings,
  upsertCustomAgentModel,
} from "@/lib/agent-model-settings"
import { SUPPORTED_CHAT_REASONING_EFFORTS } from "@/lib/chat-models"
import { getStudioModelverseApiKey } from "@/lib/studio-db"

export const runtime = "nodejs"

const runtimeModelSettingSchema = z.object({
  useLocalSettings: z.boolean(),
  defaultModel: z.string().trim().min(1).max(128),
})

const customModelSchema = z.object({
  id: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(128),
  providerModel: z.string().trim().min(1).max(128),
  protocol: z.enum(AGENT_MODEL_PROTOCOLS),
  baseUrl: z.string().trim().max(256).nullable().optional(),
  supportedRuntimeIds: z.array(z.enum(AGENT_RUNTIME_IDS)).min(1),
  reasoningEfforts: z.array(z.enum(SUPPORTED_CHAT_REASONING_EFFORTS)).min(1),
  defaultReasoningEffort: z.enum(SUPPORTED_CHAT_REASONING_EFFORTS),
  enabled: z.boolean().optional(),
})

const settingsSchema = z.object({
  runtimes: z.object({
    astraflow: runtimeModelSettingSchema,
    "claude-native": runtimeModelSettingSchema,
    "claude-code": runtimeModelSettingSchema,
    "codex-direct": runtimeModelSettingSchema,
    codex: runtimeModelSettingSchema,
    "opencode-native": runtimeModelSettingSchema,
    opencode: runtimeModelSettingSchema,
  }),
  customModels: z.array(customModelSchema).default([]),
})

function toPayload() {
  const settings = getAgentModelSettings()

  return {
    ...settings,
    models: listAgentModels(settings),
    hasModelverseApiKey: Boolean(getStudioModelverseApiKey()?.key),
  }
}

function toErrorResponse(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to save agent model settings.",
    },
    { status: 400 }
  )
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  return NextResponse.json({
    ok: true,
    data: toPayload(),
  })
}

export async function PUT(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const input = settingsSchema.parse(await request.json())

    saveAgentModelSettings({
      runtimes: input.runtimes,
      customModels: input.customModels.map((model) => ({
        ...model,
        baseUrl: model.baseUrl?.trim() || null,
        builtin: false,
        enabled: model.enabled ?? true,
      })),
    })

    return NextResponse.json({
      ok: true,
      data: toPayload(),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const input = customModelSchema.parse(await request.json())

    upsertCustomAgentModel({
      ...input,
      baseUrl: input.baseUrl?.trim() || null,
    })

    return NextResponse.json({
      ok: true,
      data: toPayload(),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
