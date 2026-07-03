import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse } from "next/server"

export const runtime = "nodejs"

type PackageJson = {
  version?: string
}

type ReleaseManifest = {
  version?: string
  tagName?: string
  tag_name?: string
  name?: string
  releaseName?: string
  releaseDate?: string
  releaseUrl?: string
  publishedAt?: string
  html_url?: string
  published_at?: string
}

const RELEASE_MANIFEST_URL =
  process.env.ASTRAFLOW_UPDATE_MANIFEST_URL ??
  "https://astraflow-desktop.cn-sh2.ufileos.com/latest.json"
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
    const response = await fetch(RELEASE_MANIFEST_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "AstraFlow Desktop",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw new Error(`Update manifest returned HTTP ${response.status}.`)
    }

    const release = (await response.json()) as ReleaseManifest
    const latestVersion = normalizeVersion(
      release.version ?? release.tagName ?? release.tag_name
    )

    if (!latestVersion) {
      throw new Error("Latest release version is unavailable.")
    }

    return {
      checkedAt,
      latestVersion,
      releaseDate:
        release.releaseDate ??
        release.publishedAt ??
        release.published_at ??
        null,
      releaseName: release.releaseName ?? release.name ?? null,
      releaseUrl: release.releaseUrl ?? release.html_url ?? null,
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
