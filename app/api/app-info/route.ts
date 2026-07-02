import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse } from "next/server"

export const runtime = "nodejs"

type PackageJson = {
  version?: string
}

type GitHubRelease = {
  tag_name?: string
  name?: string
  html_url?: string
  published_at?: string
}

const RELEASE_API_URL =
  "https://api.github.com/repos/mfzzf/astraflow-desktop/releases/latest"
const FALLBACK_VERSION = "0.0.0"

async function readCurrentVersion() {
  try {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as PackageJson

    return packageJson.version?.trim() || FALLBACK_VERSION
  } catch {
    return process.env.npm_package_version?.trim() || FALLBACK_VERSION
  }
}

function normalizeVersion(value: string | undefined) {
  return value?.trim().replace(/^v/i, "") ?? ""
}

function parseVersion(value: string) {
  const [core = "", prerelease = ""] = normalizeVersion(value).split("-", 2)
  const parts = core
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))

  return {
    parts: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0],
    prerelease,
  }
}

function compareVersions(left: string, right: string) {
  const leftVersion = parseVersion(left)
  const rightVersion = parseVersion(right)

  for (let index = 0; index < 3; index += 1) {
    const diff = leftVersion.parts[index] - rightVersion.parts[index]

    if (diff !== 0) {
      return diff
    }
  }

  if (!leftVersion.prerelease && rightVersion.prerelease) {
    return 1
  }

  if (leftVersion.prerelease && !rightVersion.prerelease) {
    return -1
  }

  return leftVersion.prerelease.localeCompare(rightVersion.prerelease)
}

async function checkLatestRelease(currentVersion: string) {
  const checkedAt = new Date().toISOString()

  try {
    const response = await fetch(RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AstraFlow Desktop",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status}.`)
    }

    const release = (await response.json()) as GitHubRelease
    const latestVersion = normalizeVersion(release.tag_name)

    if (!latestVersion) {
      throw new Error("Latest release version is unavailable.")
    }

    return {
      checkedAt,
      latestVersion,
      releaseDate: release.published_at ?? null,
      releaseName: release.name ?? null,
      releaseUrl: release.html_url ?? null,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      message: null,
    }
  } catch (error) {
    return {
      checkedAt,
      latestVersion: null,
      releaseDate: null,
      releaseName: null,
      releaseUrl: null,
      updateAvailable: null,
      message:
        error instanceof Error ? error.message : "Unable to check updates.",
    }
  }
}

export async function GET(request: Request) {
  const currentVersion = await readCurrentVersion()
  const shouldCheck =
    new URL(request.url).searchParams.get("check")?.trim() === "1"

  return NextResponse.json({
    ok: true,
    data: {
      name: "AstraFlow",
      currentVersion,
      update: shouldCheck ? await checkLatestRelease(currentVersion) : null,
    },
  })
}
