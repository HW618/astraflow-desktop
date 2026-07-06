import { NextResponse } from "next/server"
import { z } from "zod"

import {
  deleteStudioInstalledSkill,
  getStudioInstalledSkill,
  updateStudioInstalledSkillEnabled,
} from "@/lib/studio-db"
import { removeInstalledSkillFiles } from "@/lib/studio-skills"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"

export const runtime = "nodejs"

type InstalledSkillRouteContext = {
  params: Promise<{
    slug: string
  }>
}

const updateInstalledSkillSchema = z.object({
  enabled: z.boolean(),
})

function toErrorResponse(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Failed to update installed skill." },
    { status: 500 }
  )
}

async function readSlug(context: InstalledSkillRouteContext) {
  const { slug } = await context.params
  const normalizedSlug = decodeURIComponent(slug).trim()

  if (!normalizedSlug) {
    throw new Error("Skill slug is required.")
  }

  return normalizedSlug
}

async function requireCredentials() {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is not configured locally." },
      { status: 403 }
    )
  }

  return null
}

export async function PATCH(
  request: Request,
  context: InstalledSkillRouteContext
) {
  const unauthorized = await requireCredentials()

  if (unauthorized) {
    return unauthorized
  }

  try {
    const slug = await readSlug(context)
    const body = updateInstalledSkillSchema.parse(await request.json())
    const installed = updateStudioInstalledSkillEnabled(slug, body.enabled)

    if (!installed) {
      return NextResponse.json(
        { ok: false, message: "Installed skill was not found." },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true, data: installed })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(
  _request: Request,
  context: InstalledSkillRouteContext
) {
  const unauthorized = await requireCredentials()

  if (unauthorized) {
    return unauthorized
  }

  try {
    const slug = await readSlug(context)
    const installed = getStudioInstalledSkill(slug)

    if (!installed) {
      return NextResponse.json(
        { ok: false, message: "Installed skill was not found." },
        { status: 404 }
      )
    }

    deleteStudioInstalledSkill(slug)
    removeInstalledSkillFiles(installed.installPath)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
