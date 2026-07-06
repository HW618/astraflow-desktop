import { NextResponse } from "next/server"
import { z } from "zod"

import {
  type DescribeSkillDetailResponse,
  type SkillMeta,
} from "@/lib/skill-market"
import { resolveModelverseProjectId } from "@/lib/modelverse-api-keys"
import {
  getSelectedUCloudProjectId,
  getStudioInstalledSkill,
  getStudioModelverseApiKey,
  listStudioInstalledSkills,
  upsertStudioInstalledSkill,
} from "@/lib/studio-db"
import { installStudioSkillFiles, removeInstalledSkillFiles } from "@/lib/studio-skills"
import { callUCloudAction, UCloudApiError } from "@/lib/ucloud"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"

export const runtime = "nodejs"

const installSkillSchema = z.object({
  slug: z.string().trim().min(1),
  version: z.string().trim().optional(),
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
    { ok: false, message: "Failed to manage installed skills." },
    { status: 500 }
  )
}

function withResolvedIdentity(skill: SkillMeta, slug: string, version?: string) {
  return {
    ...skill,
    Slug: skill.Slug?.trim() || slug,
    Version: skill.Version?.trim() || version?.trim() || "latest",
  }
}

async function requireCredentials() {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return null
  }

  return credentials
}

export async function GET() {
  const credentials = await requireCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is not configured locally." },
      { status: 403 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: listStudioInstalledSkills(),
  })
}

export async function POST(request: Request) {
  const credentials = await requireCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is not configured locally." },
      { status: 403 }
    )
  }

  try {
    const body = installSkillSchema.parse(await request.json())
    const projectId = await resolveModelverseProjectId({
      credentials,
      preferredProjectId:
        getSelectedUCloudProjectId() ||
        getStudioModelverseApiKey()?.projectId ||
        credentials.projectId,
    })
    const response = await callUCloudAction<DescribeSkillDetailResponse>({
      credentials,
      params: {
        Action: "DescribeSkillDetail",
        Backend: "SkillLab",
        ProjectId: projectId,
        Slug: body.slug,
        ...(body.version ? { Version: body.version } : {}),
      },
    })
    const skill = withResolvedIdentity(response.Skill ?? {}, body.slug, body.version)
    const previous = getStudioInstalledSkill(body.slug)
    const installResult = await installStudioSkillFiles({
      skill,
      skillMd: response.SkillMd ?? "",
    })
    const installed = upsertStudioInstalledSkill({
      slug: skill.Slug ?? body.slug,
      version: skill.Version ?? body.version ?? "latest",
      skill,
      skillMd: installResult.skillMd,
      enabled: true,
      installPath: installResult.installPath,
      installedFileCount: installResult.installedFileCount,
      installedSizeBytes: installResult.installedSizeBytes,
    })

    if (
      previous &&
      previous.installPath !== installResult.installPath &&
      previous.installPath
    ) {
      removeInstalledSkillFiles(previous.installPath)
    }

    if (!installed) {
      throw new Error("Failed to save installed skill.")
    }

    return NextResponse.json({ ok: true, data: installed })
  } catch (error) {
    return toErrorResponse(error)
  }
}
