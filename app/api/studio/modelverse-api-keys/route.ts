import { NextResponse } from "next/server"
import { z } from "zod"

import {
  clearStudioModelverseApiKey,
  getSelectedUCloudProjectId,
  getStudioModelverseApiKey,
  saveStudioModelverseApiKey,
  saveSelectedUCloudProjectId,
} from "@/lib/studio-db"
import {
  findModelverseApiKey,
  listModelverseApiKeys,
  resolveModelverseProjectId,
} from "@/lib/modelverse-api-keys"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"
import { UCloudApiError } from "@/lib/ucloud"

export const runtime = "nodejs"

const saveApiKeySchema = z.object({
  apiKeyId: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
})

function readString(value: string | null) {
  return typeof value === "string" ? value.trim() : ""
}

function toErrorResponse(error: unknown) {
  if (error instanceof UCloudApiError) {
    return NextResponse.json(
      { ok: false, message: error.message, retCode: error.retCode },
      { status: error.status }
    )
  }

  if (error instanceof Error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Unexpected Modelverse API key request failure." },
    { status: 500 }
  )
}

export async function GET(request: Request) {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is required." },
      { status: 401 }
    )
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const savedApiKey = getStudioModelverseApiKey()
    const projectId = await resolveModelverseProjectId({
      credentials,
      preferredProjectId:
        readString(searchParams.get("projectId")) ||
        getSelectedUCloudProjectId() ||
        savedApiKey?.projectId,
    })
    const apiKeys = await listModelverseApiKeys({ credentials, projectId })
    const selected = savedApiKey
      ? apiKeys.find((item) => item.id === savedApiKey.id)
      : null

    if (savedApiKey && !selected) {
      clearStudioModelverseApiKey()
    }

    return NextResponse.json({
      ok: true,
      data: {
        projectId,
        items: apiKeys.map((item) => ({ id: item.id, name: item.name })),
        selected: selected ? { id: selected.id, name: selected.name } : null,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is required." },
      { status: 401 }
    )
  }

  try {
    const parsed = saveApiKeySchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message: "Select a Modelverse API key before saving.",
          error: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const projectId = await resolveModelverseProjectId({
      credentials,
      preferredProjectId:
        parsed.data.projectId || getSelectedUCloudProjectId() || undefined,
    })
    const apiKey = await findModelverseApiKey({
      credentials,
      projectId,
      apiKeyId: parsed.data.apiKeyId,
    })

    if (!apiKey?.key) {
      return NextResponse.json(
        {
          ok: false,
          message: "The selected Modelverse API key was not found.",
        },
        { status: 404 }
      )
    }

    const saved = saveStudioModelverseApiKey({
      id: apiKey.id,
      name: apiKey.name,
      key: apiKey.key,
      projectId,
    })
    saveSelectedUCloudProjectId(projectId)

    return NextResponse.json({
      ok: true,
      data: {
        projectId,
        selected: {
          id: saved.id,
          name: saved.name,
        },
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
