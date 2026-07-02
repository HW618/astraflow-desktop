import { NextResponse } from "next/server"
import { z } from "zod"

import {
  getSelectedUCloudProjectId,
  getStudioModelverseApiKey,
  saveSelectedUCloudProjectId,
} from "@/lib/studio-db"
import { listUCloudProjects } from "@/lib/modelverse-api-keys"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"
import { UCloudApiError } from "@/lib/ucloud"

export const runtime = "nodejs"

const selectProjectSchema = z.object({
  projectId: z.string().trim().min(1),
})

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
    { ok: false, message: "Unexpected project request failure." },
    { status: 500 }
  )
}

export async function GET() {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is required." },
      { status: 401 }
    )
  }

  try {
    const projects = await listUCloudProjects({ credentials })
    const selectedProjectId = getSelectedUCloudProjectId()
    const savedProjectId = getStudioModelverseApiKey()?.projectId ?? ""
    const credentialProjectId = credentials.projectId
    const resolvedProjectId =
      projects.find((project) => project.id === selectedProjectId)?.id ??
      projects.find((project) => project.id === savedProjectId)?.id ??
      projects.find((project) => project.id === credentialProjectId)?.id ??
      projects[0]?.id ??
      null

    return NextResponse.json({
      ok: true,
      data: {
        items: projects,
        selectedProjectId: resolvedProjectId,
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
    const parsed = selectProjectSchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message: "Select a UCloud project.",
          error: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const projects = await listUCloudProjects({ credentials })
    const selected = projects.find(
      (project) => project.id === parsed.data.projectId
    )

    if (!selected) {
      return NextResponse.json(
        {
          ok: false,
          message: "The selected UCloud project was not found.",
        },
        { status: 404 }
      )
    }

    saveSelectedUCloudProjectId(selected.id)

    return NextResponse.json({
      ok: true,
      data: {
        items: projects,
        selectedProjectId: selected.id,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
