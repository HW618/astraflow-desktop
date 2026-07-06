import { readdir, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative } from "node:path"
import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getStudioLocalProject } from "@/lib/studio-db"
import { runSafeGit } from "../../local-projects/safe-git"

export const runtime = "nodejs"

type WorkspaceEntryKind = "file" | "folder"

type WorkspaceFileCandidate = {
  path: string
  relativePath: string
  name: string
}

type WorkspaceResult = WorkspaceFileCandidate & {
  kind: WorkspaceEntryKind
}

type ScoredWorkspaceResult = WorkspaceResult & {
  score: number
}

type CachedProjectFiles = {
  expiresAt: number
  files: WorkspaceFileCandidate[]
}

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const CACHE_TTL_MS = 60_000
const GIT_TIMEOUT_MS = 1_500
const GIT_MAX_BUFFER = 10 * 1024 * 1024
const MAX_RECURSIVE_DEPTH = 8
const MAX_RECURSIVE_ENTRIES = 5_000
const SKIPPED_RECURSIVE_NAMES = new Set([".git", "node_modules"])

const projectFilesCache = new Map<string, CachedProjectFiles>()

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status })
}

function normalizeRelativePath(path: string) {
  return path
    .split("\\")
    .join("/")
    .replace(/^\.\/+/, "")
}

function isSafeRelativePath(path: string) {
  const normalized = normalizeRelativePath(path)

  return (
    normalized.length > 0 &&
    !isAbsolute(normalized) &&
    normalized !== "." &&
    !normalized.startsWith("../") &&
    !normalized.includes("/../")
  )
}

function parseLimit(rawLimit: string | null) {
  const parsed = rawLimit ? Number.parseInt(rawLimit, 10) : DEFAULT_LIMIT

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT
  }

  return Math.min(MAX_LIMIT, Math.max(1, parsed))
}

function git(root: string, args: string[]) {
  return runSafeGit(root, args, {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  })
}

async function isProjectRootGitRepo(root: string) {
  try {
    const inside = (await git(root, ["rev-parse", "--is-inside-work-tree"]))
      .trim()
      .toLowerCase()

    if (inside !== "true") {
      return false
    }

    const topLevel = (await git(root, ["rev-parse", "--show-toplevel"])).trim()

    return normalizeRelativePath(relative(topLevel, root)) === ""
  } catch {
    return false
  }
}

function toFileCandidate(root: string, relativePath: string) {
  const normalized = normalizeRelativePath(relativePath)

  if (!isSafeRelativePath(normalized)) {
    return null
  }

  return {
    path: join(root, normalized),
    relativePath: normalized,
    name: basename(normalized),
  } satisfies WorkspaceFileCandidate
}

async function listGitFiles(root: string) {
  const output = await git(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ])

  return output
    .split("\0")
    .flatMap((entry) => {
      const candidate = toFileCandidate(root, entry)

      return candidate ? [candidate] : []
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function shouldSkipRecursiveEntry(name: string) {
  return name.startsWith(".") || SKIPPED_RECURSIVE_NAMES.has(name)
}

async function listRecursiveFiles(root: string) {
  const files: WorkspaceFileCandidate[] = []

  async function walk(directory: string, depth: number) {
    if (depth > MAX_RECURSIVE_DEPTH || files.length >= MAX_RECURSIVE_ENTRIES) {
      return
    }

    const entries = await readdir(/* turbopackIgnore: true */ directory, {
      withFileTypes: true,
    })

    for (const entry of entries) {
      if (files.length >= MAX_RECURSIVE_ENTRIES) {
        return
      }

      if (shouldSkipRecursiveEntry(entry.name)) {
        continue
      }

      const absolutePath = join(directory, entry.name)
      const relativePath = normalizeRelativePath(relative(root, absolutePath))

      if (entry.isDirectory()) {
        await walk(absolutePath, depth + 1)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const candidate = toFileCandidate(root, relativePath)

      if (candidate) {
        files.push(candidate)
      }
    }
  }

  await walk(root, 0)

  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  )
}

async function listProjectFiles(root: string) {
  const cached = projectFilesCache.get(root)
  const now = Date.now()

  if (cached && cached.expiresAt > now) {
    return cached.files
  }

  const files = (await isProjectRootGitRepo(root))
    ? await listGitFiles(root)
    : await listRecursiveFiles(root)

  projectFilesCache.set(root, {
    expiresAt: now + CACHE_TTL_MS,
    files,
  })

  return files
}

function fuzzySubsequenceScore(query: string, target: string) {
  if (!query) {
    return 0
  }

  let targetIndex = 0
  let previousMatchIndex = -1
  let score = 0

  for (const queryCharacter of query) {
    const matchIndex = target.indexOf(queryCharacter, targetIndex)

    if (matchIndex < 0) {
      return null
    }

    const gap = matchIndex - targetIndex
    score += 12 - Math.min(gap, 10)

    if (previousMatchIndex + 1 === matchIndex) {
      score += 8
    }

    const previousCharacter = target[matchIndex - 1]

    if (
      matchIndex === 0 ||
      previousCharacter === "/" ||
      previousCharacter === "-" ||
      previousCharacter === "_" ||
      previousCharacter === "."
    ) {
      score += 4
    }

    previousMatchIndex = matchIndex
    targetIndex = matchIndex + 1
  }

  return score - target.length * 0.01
}

function scoreFile(candidate: WorkspaceFileCandidate, query: string) {
  if (!query) {
    return 0
  }

  const relativePath = candidate.relativePath.toLowerCase()
  const name = candidate.name.toLowerCase()
  const pathScore = fuzzySubsequenceScore(query, relativePath)
  const nameScore = fuzzySubsequenceScore(query, name)

  if (pathScore === null && nameScore === null) {
    return null
  }

  let score = (pathScore ?? 0) + (nameScore ?? 0) * 3

  if (name.startsWith(query)) {
    score += 200
  } else if (name.includes(query)) {
    score += 100
  }

  if (relativePath.includes(query)) {
    score += 50
  }

  return score
}

function scoreResults(
  root: string,
  files: WorkspaceFileCandidate[],
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase()
  const fileResults = files.flatMap((file) => {
    const score = scoreFile(file, normalizedQuery)

    return score === null
      ? []
      : [
          {
            ...file,
            kind: "file" as const,
            score,
          } satisfies ScoredWorkspaceResult,
        ]
  })
  const foldersByRelativePath = new Map<string, ScoredWorkspaceResult>()

  for (const file of fileResults) {
    const relativeFolder = normalizeRelativePath(dirname(file.relativePath))

    if (relativeFolder === ".") {
      continue
    }

    const existing = foldersByRelativePath.get(relativeFolder)
    const score = file.score - 0.1

    if (existing && existing.score >= score) {
      continue
    }

    foldersByRelativePath.set(relativeFolder, {
      path: join(root, relativeFolder),
      relativePath: relativeFolder,
      name: basename(relativeFolder),
      kind: "folder",
      score,
    })
  }

  return [...foldersByRelativePath.values(), ...fileResults].sort(
    (left, right) =>
      right.score - left.score ||
      left.relativePath.localeCompare(right.relativePath) ||
      left.kind.localeCompare(right.kind)
  )
}

async function resolveProjectRoot(projectId: string) {
  const project = getStudioLocalProject(projectId)

  if (!project) {
    return null
  }

  try {
    const stats = await stat(/* turbopackIgnore: true */ project.path)

    return stats.isDirectory() ? project.path : null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const url = new URL(request.url)
  const projectId = url.searchParams.get("projectId")?.trim()

  if (!projectId) {
    return jsonError("Project id is required.", 400)
  }

  const root = await resolveProjectRoot(projectId)

  if (!root) {
    return jsonError("Project id is invalid.", 400)
  }

  try {
    const query = url.searchParams.get("q") ?? ""
    const limit = parseLimit(url.searchParams.get("limit"))
    const files = await listProjectFiles(root)
    const results = scoreResults(root, files, query)
      .slice(0, limit)
      .map((entry) => ({
        path: entry.path,
        relativePath: entry.relativePath,
        name: entry.name,
        kind: entry.kind,
      }))

    return NextResponse.json({ files: results })
  } catch (error) {
    console.warn("[studio-workspace] file_search_failed", {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    })

    return jsonError("Failed to search workspace files.", 500)
  }
}
