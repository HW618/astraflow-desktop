import { NextResponse } from "next/server"

import { listStudioInstalledSkills } from "@/lib/studio-db"
import { scanLocalSkillImportCandidates } from "@/lib/studio-skills"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"

export const runtime = "nodejs"

export async function GET() {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is not configured locally." },
      { status: 403 }
    )
  }

  const installedSlugs = new Set(
    listStudioInstalledSkills().map((skill) => skill.slug)
  )

  return NextResponse.json({
    ok: true,
    data: scanLocalSkillImportCandidates({ installedSlugs }),
  })
}
