import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  clearStudioModelverseApiKey,
  getSelectedUCloudProjectId,
  getStudioModelverseApiKey,
  saveSelectedUCloudProjectId,
  saveStudioModelverseApiKey,
} from "@/lib/studio-db"
import {
  createModelverseApiKey,
  deleteModelverseApiKey,
  findModelverseApiKey,
  listModelverseApiKeys,
  resolveModelverseProjectId,
  updateModelverseApiKey,
  type ModelverseApiKey,
  type ModelverseApiKeyMutationInput,
} from "@/lib/modelverse-api-keys"
import { UCloudApiError } from "@/lib/ucloud"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"

export const runtime = "nodejs"

const apiKeyMutationSchema = z.object({
  projectId: z.string().trim().optional(),
  name: z.string().trim().min(1).max(128),
  modelverseEnabled: z.boolean().optional().default(true),
  sandboxEnabled: z.boolean().optional().default(true),
  dailyLimitAmount: z.string().trim().max(64).optional().default(""),
  monthlyLimitAmount: z.string().trim().max(64).optional().default(""),
  grantAllModels: z.boolean().optional().default(true),
  grantedModels: z.array(z.string().trim().min(1)).optional().default([]),
  ipWhitelist: z.string().max(4096).optional().default(""),
  useForApp: z.boolean().optional().default(false),
})

const createApiKeySchema = apiKeyMutationSchema.extend({
  action: z.literal("create"),
})

const selectApiKeySchema = z.object({
  action: z.literal("select").optional(),
  apiKeyId: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
})

const updateApiKeySchema = apiKeyMutationSchema.extend({
  keyId: z.string().trim().min(1),
})

const deleteApiKeySchema = z.object({
  keyId: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
})

type PublicModelverseApiKey = ModelverseApiKey & {
  keyPreview: string
}

type SelectedApiKeyPayload = {
  id: string
  name: string
} | null

function readString(value: string | null) {
  return typeof value === "string" ? value.trim() : ""
}

function keyPreview(value: string | undefined) {
  if (!value) {
    return ""
  }

  if (value.length <= 12) {
    return value
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function toPublicApiKey(apiKey: ModelverseApiKey): PublicModelverseApiKey {
  return {
    ...apiKey,
    keyPreview: keyPreview(apiKey.key),
  }
}

function toMutationInput(
  input: z.infer<typeof apiKeyMutationSchema>
): ModelverseApiKeyMutationInput {
  return {
    name: input.name,
    modelverseDisabled: input.modelverseEnabled ? 0 : 1,
    sandboxDisabled: input.sandboxEnabled ? 0 : 1,
    dailyLimitAmount: input.dailyLimitAmount,
    monthlyLimitAmount: input.monthlyLimitAmount,
    grantAllModels: input.grantAllModels,
    grantedModels: input.grantedModels,
    ipWhitelist: input.ipWhitelist,
  }
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

async function readJson(request: Request) {
  return request.json().catch(() => null)
}

async function requireCredentials() {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return null
  }

  return credentials
}

async function resolveApiKeyProjectId({
  credentials,
  preferredProjectId,
}: {
  credentials: NonNullable<Awaited<ReturnType<typeof getUCloudCredentials>>>
  preferredProjectId?: string
}) {
  return resolveModelverseProjectId({
    credentials,
    preferredProjectId:
      preferredProjectId?.trim() ||
      getSelectedUCloudProjectId() ||
      getStudioModelverseApiKey()?.projectId ||
      credentials.projectId,
  })
}

async function saveApiKeyForApp({
  credentials,
  projectId,
  apiKeyId,
}: {
  credentials: NonNullable<Awaited<ReturnType<typeof getUCloudCredentials>>>
  projectId: string
  apiKeyId: string
}) {
  const apiKey = await findModelverseApiKey({
    credentials,
    projectId,
    apiKeyId,
  })

  if (!apiKey?.key) {
    throw new Error("The selected Modelverse API key was not found.")
  }

  const saved = saveStudioModelverseApiKey({
    id: apiKey.id,
    name: apiKey.name,
    key: apiKey.key,
    projectId,
  })

  saveSelectedUCloudProjectId(projectId)

  return {
    id: saved.id,
    name: saved.name,
  }
}

async function syncSelectedKeyAfterUpdate({
  credentials,
  projectId,
  apiKeyId,
  useForApp,
}: {
  credentials: NonNullable<Awaited<ReturnType<typeof getUCloudCredentials>>>
  projectId: string
  apiKeyId: string
  useForApp: boolean
}) {
  if (useForApp) {
    return saveApiKeyForApp({ credentials, projectId, apiKeyId })
  }

  const saved = getStudioModelverseApiKey()

  if (saved?.id !== apiKeyId) {
    return null
  }

  const apiKey = await findModelverseApiKey({
    credentials,
    projectId,
    apiKeyId,
  })

  if (!apiKey?.key) {
    clearStudioModelverseApiKey()
    return null
  }

  const next = saveStudioModelverseApiKey({
    id: apiKey.id,
    name: apiKey.name,
    key: apiKey.key,
    projectId,
  })

  return {
    id: next.id,
    name: next.name,
  }
}

async function modelverseApiKeysPayload({
  credentials,
  projectId,
}: {
  credentials: NonNullable<Awaited<ReturnType<typeof getUCloudCredentials>>>
  projectId: string
}) {
  const savedApiKey = getStudioModelverseApiKey()
  const apiKeys = await listModelverseApiKeys({
    credentials,
    projectId,
    includeDisabled: true,
  })
  const selected = savedApiKey
    ? apiKeys.find((item) => item.id === savedApiKey.id)
    : null

  if (savedApiKey && (!selected || selected.modelverseDisabled === 1)) {
    clearStudioModelverseApiKey()
  }

  return {
    projectId,
    items: apiKeys.map(toPublicApiKey),
    selected:
      selected && selected.modelverseDisabled !== 1
        ? ({
            id: selected.id,
            name: selected.name,
          } satisfies NonNullable<SelectedApiKeyPayload>)
        : null,
  }
}

export async function GET(request: Request) {
  const credentials = await requireCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is required." },
      { status: 401 }
    )
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const projectId = await resolveApiKeyProjectId({
      credentials,
      preferredProjectId: readString(searchParams.get("projectId")),
    })

    return NextResponse.json({
      ok: true,
      data: await modelverseApiKeysPayload({ credentials, projectId }),
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

  const credentials = await requireCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is required." },
      { status: 401 }
    )
  }

  try {
    const body = await readJson(request)
    const createParsed = createApiKeySchema.safeParse(body)

    if (createParsed.success) {
      const projectId = await resolveApiKeyProjectId({
        credentials,
        preferredProjectId: createParsed.data.projectId,
      })
      const created = await createModelverseApiKey({
        credentials,
        projectId,
        input: toMutationInput(
          createParsed.data
        ) as ModelverseApiKeyMutationInput & {
          name: string
        },
      })

      if (createParsed.data.useForApp) {
        if (!created?.id) {
          throw new Error("UCloud did not return the created API key id.")
        }

        await saveApiKeyForApp({
          credentials,
          projectId,
          apiKeyId: created.id,
        })
      }

      return NextResponse.json({
        ok: true,
        data: await modelverseApiKeysPayload({ credentials, projectId }),
      })
    }

    const selectParsed = selectApiKeySchema.safeParse(body)

    if (!selectParsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message: "Select a Modelverse API key before saving.",
          error: selectParsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const projectId = await resolveApiKeyProjectId({
      credentials,
      preferredProjectId: selectParsed.data.projectId,
    })

    await saveApiKeyForApp({
      credentials,
      projectId,
      apiKeyId: selectParsed.data.apiKeyId,
    })

    return NextResponse.json({
      ok: true,
      data: await modelverseApiKeysPayload({ credentials, projectId }),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const credentials = await requireCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is required." },
      { status: 401 }
    )
  }

  try {
    const parsed = updateApiKeySchema.safeParse(await readJson(request))

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message: "Check the API key form and try again.",
          error: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const projectId = await resolveApiKeyProjectId({
      credentials,
      preferredProjectId: parsed.data.projectId,
    })

    await updateModelverseApiKey({
      credentials,
      projectId,
      apiKeyId: parsed.data.keyId,
      input: toMutationInput(parsed.data),
    })
    await syncSelectedKeyAfterUpdate({
      credentials,
      projectId,
      apiKeyId: parsed.data.keyId,
      useForApp: parsed.data.useForApp,
    })

    return NextResponse.json({
      ok: true,
      data: await modelverseApiKeysPayload({ credentials, projectId }),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const credentials = await requireCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is required." },
      { status: 401 }
    )
  }

  try {
    const parsed = deleteApiKeySchema.safeParse(await readJson(request))

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message: "Select a Modelverse API key to delete.",
          error: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const projectId = await resolveApiKeyProjectId({
      credentials,
      preferredProjectId: parsed.data.projectId,
    })

    await deleteModelverseApiKey({
      credentials,
      projectId,
      apiKeyId: parsed.data.keyId,
    })

    if (getStudioModelverseApiKey()?.id === parsed.data.keyId) {
      clearStudioModelverseApiKey()
    }

    return NextResponse.json({
      ok: true,
      data: await modelverseApiKeysPayload({ credentials, projectId }),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
