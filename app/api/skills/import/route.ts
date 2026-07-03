import { NextResponse } from "next/server"
import { z } from "zod"

import {
  getStudioInstalledSkill,
  listStudioInstalledSkills,
  upsertStudioInstalledSkill,
} from "@/lib/studio-db"
import type {
  InstalledSkill,
  InvalidSkillImportCandidate,
  SkillImportCandidate,
  SkillMeta,
} from "@/lib/skill-market"
import {
  type ArchiveFile,
  installLocalStudioSkillDirectory,
  installUploadedStudioSkillGroups,
  isAllowedLocalSkillImportPath,
  parseUploadedSkillCandidates,
  readLocalSkillImportCandidate,
  removeInstalledSkillFiles,
} from "@/lib/studio-skills"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"

export const runtime = "nodejs"

const importPathsSchema = z.object({
  sourcePaths: z.array(z.string().trim().min(1)).min(1),
})

function toErrorResponse(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Failed to import skills." },
    { status: 500 }
  )
}

function saveInstallResult(installResult: {
  slug: string
  version: string
  skill: SkillMeta
  skillMd: string
  installPath: string
  installedFileCount: number
  installedSizeBytes: number
}) {
  const previous = getStudioInstalledSkill(installResult.slug)
  const installed = upsertStudioInstalledSkill({
    slug: installResult.slug,
    version: installResult.version,
    skill: installResult.skill,
    skillMd: installResult.skillMd,
    enabled: previous?.enabled ?? true,
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
    throw new Error("Failed to save imported skill.")
  }

  return installed
}

async function readUploadedSkillFiles(formData: FormData) {
  const fileValues = formData.getAll("files")
  const pathValues = formData.getAll("paths").map((value) => String(value))
  const files: ArchiveFile[] = []

  for (let index = 0; index < fileValues.length; index += 1) {
    const value = fileValues[index]

    if (!(value instanceof File)) {
      continue
    }

    const relativePath =
      pathValues[index]?.trim() ||
      (value as File & { webkitRelativePath?: string }).webkitRelativePath ||
      value.name

    files.push({
      path: relativePath,
      bytes: new Uint8Array(await value.arrayBuffer()),
    })
  }

  if (files.length === 0) {
    throw new Error("No skill folder files were uploaded.")
  }

  return files
}

async function handleUploadedFolder(formData: FormData) {
  const mode = String(formData.get("mode") ?? "install")
  const uploadFiles = await readUploadedSkillFiles(formData)
  const installedSlugs = new Set(
    listStudioInstalledSkills().map((skill) => skill.slug)
  )

  if (mode === "parse") {
    return NextResponse.json({
      ok: true,
      data: parseUploadedSkillCandidates({
        files: uploadFiles,
        installedSlugs,
      }),
    })
  }

  const selectedRaw = formData.getAll("selectedPaths").map((value) =>
    String(value)
  )
  const selectedPaths = selectedRaw.length > 0 ? selectedRaw : undefined

  const result = installUploadedStudioSkillGroups({
    files: uploadFiles,
    selectedPaths,
    installedSlugs,
  })
  const imported = result.imported.map((installResult) =>
    saveInstallResult(installResult)
  )

  return NextResponse.json({
    ok: true,
    data: { imported, skipped: result.skipped, failed: result.failed },
  })
}

export async function POST(request: Request) {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is not configured locally." },
      { status: 401 }
    )
  }

  try {
    const contentType = request.headers.get("content-type") ?? ""
    const imported: InstalledSkill[] = []
    const skipped: SkillImportCandidate[] = []
    const failed: InvalidSkillImportCandidate[] = []

    if (contentType.includes("multipart/form-data")) {
      return await handleUploadedFolder(await request.formData())
    }

    const body = importPathsSchema.parse(await request.json())
    const uniquePaths = Array.from(new Set(body.sourcePaths))
    const installedSlugs = new Set(
      listStudioInstalledSkills().map((skill) => skill.slug)
    )

    for (const sourcePath of uniquePaths) {
      try {
        if (!isAllowedLocalSkillImportPath(sourcePath)) {
          failed.push({
            sourcePath,
            sourceRoot: "",
            message: "Skill folder is outside the configured import roots.",
          })
          continue
        }

        const candidate = readLocalSkillImportCandidate({
          installedSlugs,
          sourcePath,
        })

        if (candidate.alreadyInstalled) {
          skipped.push(candidate)
          continue
        }

        const installed = saveInstallResult(
          installLocalStudioSkillDirectory({ sourcePath })
        )

        installedSlugs.add(installed.slug)
        imported.push(installed)
      } catch (error) {
        failed.push({
          sourcePath,
          sourceRoot: "",
          message:
            error instanceof Error ? error.message : "Failed to import skill.",
        })
      }
    }

    return NextResponse.json({
      ok: true,
      data: { imported, skipped, failed },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
