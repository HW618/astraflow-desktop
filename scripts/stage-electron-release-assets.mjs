import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"

const sourceDir = process.argv[2] ?? join("dist", "release")
const targetDir = process.argv[3] ?? join("dist", "publish")
const publicBaseUrl =
  process.env.ASTRAFLOW_RELEASE_BASE_URL ??
  "https://astraflow-desktop.cn-sh2.ufileos.com"
const releasePageUrl =
  process.env.ASTRAFLOW_RELEASE_PAGE_URL ??
  "https://github.com/mfzzf/astraflow-desktop/releases/tag/{tag}"

function walkFiles(dir) {
  const files = []

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)

    if (stat.isDirectory()) {
      files.push(...walkFiles(path))
    } else if (stat.isFile()) {
      files.push(path)
    }
  }

  return files
}

function cleanScalar(value) {
  const trimmed = value.trim()

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function readNumber(value, file, key) {
  const parsed = Number(cleanScalar(value))

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${key} in ${file}: ${value}`)
  }

  return parsed
}

function parseUpdateInfo(file) {
  const text = readFileSync(file, "utf8")
  const updateInfo = {
    file,
    files: [],
    releaseDate: null,
    version: null,
  }
  let currentFile = null
  let readingFiles = false

  for (const line of text.split(/\r?\n/)) {
    const versionMatch = line.match(/^version:\s*(.+)$/)
    const releaseDateMatch = line.match(/^releaseDate:\s*(.+)$/)
    const fileStartMatch = line.match(/^  - url:\s*(.+)$/)
    const fileValueMatch = line.match(/^    ([A-Za-z0-9]+):\s*(.+)$/)

    if (versionMatch) {
      updateInfo.version = cleanScalar(versionMatch[1])
      readingFiles = false
      continue
    }

    if (line === "files:") {
      readingFiles = true
      continue
    }

    if (releaseDateMatch) {
      updateInfo.releaseDate = cleanScalar(releaseDateMatch[1])
      readingFiles = false
      continue
    }

    if (!readingFiles) {
      continue
    }

    if (fileStartMatch) {
      currentFile = { url: cleanScalar(fileStartMatch[1]) }
      updateInfo.files.push(currentFile)
      continue
    }

    if (currentFile && fileValueMatch) {
      const [, key, value] = fileValueMatch
      currentFile[key] =
        key === "size" || key === "blockMapSize"
          ? readNumber(value, file, key)
          : cleanScalar(value)
    }
  }

  if (!updateInfo.version || !updateInfo.releaseDate) {
    throw new Error(`Missing version or releaseDate in ${file}.`)
  }

  if (updateInfo.files.length === 0) {
    throw new Error(`Missing update files in ${file}.`)
  }

  for (const updateFile of updateInfo.files) {
    if (!updateFile.url || !updateFile.sha512 || updateFile.size == null) {
      throw new Error(`Incomplete update file entry in ${file}.`)
    }
  }

  return updateInfo
}

function formatUpdateInfo({ files, releaseDate, version }) {
  const fallbackFile =
    files.find(
      (file) => file.url.endsWith(".zip") && !file.url.includes("arm64")
    ) ??
    files.find((file) => file.url.endsWith(".zip")) ??
    files.find((file) => !file.url.includes("arm64")) ??
    files[0]
  const lines = [`version: ${version}`, "files:"]

  for (const file of files) {
    lines.push(`  - url: ${file.url}`)
    lines.push(`    sha512: ${file.sha512}`)
    lines.push(`    size: ${file.size}`)

    if (file.blockMapSize != null) {
      lines.push(`    blockMapSize: ${file.blockMapSize}`)
    }
  }

  lines.push(`path: ${fallbackFile.url}`)
  lines.push(`sha512: ${fallbackFile.sha512}`)
  lines.push(`releaseDate: '${releaseDate}'`)
  lines.push("")

  return lines.join("\n")
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "")
}

function normalizeVersion(value) {
  return value.trim().replace(/^v/i, "")
}

function versionTag(version) {
  return `v${normalizeVersion(version)}`
}

function latestReleaseDate(updateInfos) {
  return updateInfos
    .map((info) => info.releaseDate)
    .sort(
      (left, right) => new Date(right).getTime() - new Date(left).getTime()
    )[0]
}

function detectPlatform(file) {
  const name = basename(file.file)

  if (name === "latest-mac.yml") {
    return "mac"
  }

  if (name === "latest-linux.yml") {
    return "linux"
  }

  if (name === "latest.yml") {
    return "windows"
  }

  return "unknown"
}

function writeReleaseManifest() {
  const updateFiles = walkFiles(targetDir)
    .filter((file) => /^latest(?:-.+)?\.yml$/.test(basename(file)))
    .sort((left, right) => basename(left).localeCompare(basename(right)))

  if (updateFiles.length === 0) {
    throw new Error("Missing Electron update metadata.")
  }

  const updateInfos = updateFiles.map(parseUpdateInfo)
  const versions = new Set(
    updateInfos.map((info) => normalizeVersion(info.version))
  )

  if (versions.size !== 1) {
    throw new Error(
      `Cannot create release manifest with different versions: ${[
        ...versions,
      ].join(", ")}`
    )
  }

  const version = [...versions][0]
  const tagName = versionTag(version)
  const baseUrl = normalizeBaseUrl(publicBaseUrl)
  const files = updateInfos
    .flatMap((info) =>
      info.files.map((file) => ({
        name: file.url,
        platform: detectPlatform(info),
        sha512: file.sha512,
        size: file.size,
        url: `${baseUrl}/${encodeURI(file.url)}`,
      }))
    )
    .sort((left, right) => left.name.localeCompare(right.name))

  writeFileSync(
    join(targetDir, "latest.json"),
    `${JSON.stringify(
      {
        name: "AstraFlow",
        version,
        tagName,
        releaseName: `AstraFlow ${tagName}`,
        releaseDate: latestReleaseDate(updateInfos),
        releaseUrl: releasePageUrl.replace("{tag}", tagName),
        files,
      },
      null,
      2
    )}\n`
  )
}

rmSync(targetDir, { recursive: true, force: true })
mkdirSync(targetDir, { recursive: true })

const macUpdateFiles = []

for (const file of walkFiles(sourceDir)) {
  const name = basename(file)

  if (name === "latest-mac.yml") {
    macUpdateFiles.push(file)
    continue
  }

  cpSync(file, join(targetDir, name))
}

if (macUpdateFiles.length === 1) {
  cpSync(macUpdateFiles[0], join(targetDir, "latest-mac.yml"))
} else if (macUpdateFiles.length > 1) {
  const updateInfos = macUpdateFiles.map(parseUpdateInfo)
  const versions = new Set(updateInfos.map((info) => info.version))

  if (versions.size !== 1) {
    throw new Error(
      `Cannot merge latest-mac.yml files with different versions: ${[
        ...versions,
      ].join(", ")}`
    )
  }

  const files = updateInfos
    .flatMap((info) => info.files)
    .sort((left, right) => left.url.localeCompare(right.url))

  writeFileSync(
    join(targetDir, "latest-mac.yml"),
    formatUpdateInfo({
      files,
      releaseDate: latestReleaseDate(updateInfos),
      version: [...versions][0],
    })
  )
}

writeReleaseManifest()

console.log(`Staged ${walkFiles(targetDir).length} Electron release assets.`)
