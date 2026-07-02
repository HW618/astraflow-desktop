import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const appDir = join(root, "dist", "electron-app")
const standaloneDir = join(root, ".next", "standalone")
const electronMainDependencies = ["electron-updater"]
const rootPackageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
)

function copy(from, to) {
  cpSync(from, to, {
    recursive: true,
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

function copyRuntimeDependency(packageName, seen = new Set()) {
  if (seen.has(packageName)) {
    return
  }

  seen.add(packageName)

  const sourcePackage = getNodeModulePath(join(root, "node_modules"), packageName)
  const targetPackage = getNodeModulePath(
    join(appDir, "node_modules"),
    packageName
  )
  const packageJson = readPackageJson(sourcePackage)

  rmSync(targetPackage, { recursive: true, force: true })
  copy(sourcePackage, targetPackage)

  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    copyRuntimeDependency(dependencyName, seen)
  }
}

rmSync(appDir, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })

copy(standaloneDir, appDir)
copy(join(root, ".next", "static"), join(appDir, ".next", "static"))
copy(join(root, "public"), join(appDir, "public"))
copy(join(root, "electron"), join(appDir, "electron"))

for (const dependencyName of electronMainDependencies) {
  copyRuntimeDependency(dependencyName)
}

const packageJson = {
  name: "astraflow-desktop",
  version: rootPackageJson.version ?? "0.0.1",
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
  },
}

writeFileSync(
  join(appDir, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`
)
