import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

const root = process.cwd()
const appDir = join(root, "dist", "electron-app")
const standaloneDir = join(root, ".next", "standalone")
const forcedRuntimeDependencies = [
  "@agentclientprotocol/claude-agent-acp",
  "@agentclientprotocol/codex-acp",
  "electron-updater",
  "node-pty",
  "opencode-ai",
]
const runtimeDependenciesWithRequiredOptionals = new Set([
  "@anthropic-ai/claude-agent-sdk",
  "@openai/codex",
])
const rootPackageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
)
const removeOptions = {
  recursive: true,
  force: true,
  maxRetries: process.platform === "win32" ? 5 : 0,
  retryDelay: 100,
}
const semverPattern =
  /^(?:v)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/

function readTagVersion() {
  const tagName =
    process.env.ASTRAFLOW_RELEASE_VERSION ||
    (process.env.GITHUB_REF_TYPE === "tag"
      ? process.env.GITHUB_REF_NAME
      : "") ||
    (process.env.GITHUB_REF?.startsWith("refs/tags/")
      ? process.env.GITHUB_REF.slice("refs/tags/".length)
      : "")

  if (!tagName) {
    return null
  }

  const match = tagName.trim().match(semverPattern)

  if (!match) {
    throw new Error(
      `Release tag/version must be semver with an optional leading "v"; received "${tagName}".`
    )
  }

  return match[1]
}

const appVersion = readTagVersion() ?? rootPackageJson.version ?? "0.0.1"

function remove(path) {
  rmSync(path, removeOptions)
}

function copy(from, to) {
  remove(to)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, {
    recursive: true,
    force: true,
    filter: (source) => !source.endsWith(".map"),
  })
}

function readDependencyVersion(nodeModulesDir, name) {
  const packagePath = join(nodeModulesDir, name, "package.json")
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"))

  return packageJson.version || "*"
}

function getNodeModulePath(nodeModulesDir, packageName) {
  return join(nodeModulesDir, ...packageName.split("/"))
}

function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
}

function copyRuntimeDependency(packageName, seen = new Set(), optional = false) {
  if (seen.has(packageName)) {
    return
  }

  seen.add(packageName)

  const sourcePackage = getNodeModulePath(
    join(root, "node_modules"),
    packageName
  )
  const targetPackage = getNodeModulePath(
    join(appDir, "node_modules"),
    packageName
  )

  if (!existsSync(sourcePackage)) {
    if (optional) {
      return
    }

    throw new Error(`Missing runtime dependency ${packageName}`)
  }

  const packageJson = readPackageJson(sourcePackage)

  copy(sourcePackage, targetPackage)

  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    copyRuntimeDependency(dependencyName, seen)
  }

  if (runtimeDependenciesWithRequiredOptionals.has(packageName)) {
    for (const dependencyName of Object.keys(
      packageJson.optionalDependencies ?? {}
    )) {
      copyRuntimeDependency(dependencyName, seen, true)
    }
  }
}

remove(appDir)

copy(standaloneDir, appDir)
copy(join(root, ".next", "static"), join(appDir, ".next", "static"))
copy(join(root, "public"), join(appDir, "public"))
copy(join(root, "electron"), join(appDir, "electron"))

for (const dependencyName of forcedRuntimeDependencies) {
  copyRuntimeDependency(dependencyName)
}

const packageJson = {
  name: "astraflow-desktop",
  version: appVersion,
  description: "AstraFlow desktop frontend",
  author: {
    name: "UCloud",
    email: "support@ucloud.cn",
  },
  desktopName: "AstraFlow",
  main: "electron/main.cjs",
  type: "module",
  private: true,
  dependencies: {
    "better-sqlite3": readDependencyVersion(
      join(appDir, "node_modules"),
      "better-sqlite3"
    ),
    "electron-updater": readDependencyVersion(
      join(appDir, "node_modules"),
      "electron-updater"
    ),
    "node-pty": readDependencyVersion(join(appDir, "node_modules"), "node-pty"),
  },
}

writeFileSync(
  join(appDir, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`
)

console.log(`Prepared Electron app version ${appVersion}.`)
