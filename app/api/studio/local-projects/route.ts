import { stat, realpath } from "node:fs/promises"
import { basename, isAbsolute } from "node:path"
import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  countStudioPermissionRules,
  createStudioLocalProject,
  deleteStudioPermissionRules,
  deleteStudioLocalProject,
  listStudioLocalProjects,
} from "@/lib/studio-db"
import type {
  StudioLocalProjectGitInfo,
  StudioLocalProjectWithGitInfo,
} from "@/lib/studio-types"
import { runSafeGit } from "./safe-git"

export const runtime = "nodejs"

const GIT_TIMEOUT_MS = 750

const createLocalProjectSchema = z.object({
  path: z.string().trim().min(1),
  name: z.string().trim().max(120).optional(),
})

const deleteLocalProjectSchema = z.object({
  id: z.string().trim().min(1),
  action: z.enum(["delete", "clearPermissionRules"]).default("delete"),
})

const execGit = (path: string, args: string[]) =>
  runSafeGit(path, args, {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  })

async function readGitInfo(path: string): Promise<StudioLocalProjectGitInfo> {
  try {
    await execGit(path, ["rev-parse", "--is-inside-work-tree"])

    const [branchResult, statusResult] = await Promise.allSettled([
      execGit(path, ["branch", "--show-current"]),
      execGit(path, ["status", "--porcelain"]),
    ])

    return {
      branch:
        branchResult.status === "fulfilled"
          ? branchResult.value.trim() || null
          : null,
      isDirty:
        statusResult.status === "fulfilled"
          ? statusResult.value.trim().length > 0
          : null,
    }
  } catch {
    return {
      branch: null,
      isDirty: null,
    }
  }
}

async function withGitInfo(
  project: ReturnType<typeof listStudioLocalProjects>[number]
): Promise<StudioLocalProjectWithGitInfo> {
  return {
    ...project,
    git: await readGitInfo(project.path),
    permissionRuleCount: countStudioPermissionRules(project.id),
  }
}

export async function GET() {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  const projects = await Promise.all(listStudioLocalProjects().map(withGitInfo))

  return NextResponse.json({ ok: true, data: projects })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = createLocalProjectSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const requestedPath = parsed.data.path

  if (!isAbsolute(requestedPath)) {
    return NextResponse.json(
      { ok: false, error: "Project path must be absolute." },
      { status: 400 }
    )
  }

  let normalizedPath: string

  try {
    const stats = await stat(/* turbopackIgnore: true */ requestedPath)

    if (!stats.isDirectory()) {
      return NextResponse.json(
        { ok: false, error: "Project path must be a directory." },
        { status: 400 }
      )
    }

    normalizedPath = await realpath(/* turbopackIgnore: true */ requestedPath)
  } catch {
    return NextResponse.json(
      { ok: false, error: "Project directory was not found." },
      { status: 400 }
    )
  }

  const name = parsed.data.name || basename(normalizedPath) || normalizedPath
  const project = createStudioLocalProject({ name, path: normalizedPath })

  return NextResponse.json(
    { ok: true, data: await withGitInfo(project) },
    { status: 201 }
  )
}

export async function DELETE(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = deleteLocalProjectSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  if (parsed.data.action === "clearPermissionRules") {
    const deleted = deleteStudioPermissionRules(parsed.data.id)

    return NextResponse.json({
      ok: true,
      data: { id: parsed.data.id, deleted },
    })
  }

  deleteStudioLocalProject(parsed.data.id)

  return NextResponse.json({ ok: true, data: { id: parsed.data.id } })
}
