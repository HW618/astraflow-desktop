import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const appDir = join(root, "dist", "electron-app")
const standaloneDir = join(root, ".next", "standalone")

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

rmSync(appDir, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })

copy(standaloneDir, appDir)
copy(join(root, ".next", "static"), join(appDir, ".next", "static"))
copy(join(root, "public"), join(appDir, "public"))
copy(join(root, "electron"), join(appDir, "electron"))

const packageJson = {
  name: "astraflow-desktop",
  version: "0.0.1",
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
  },
}

writeFileSync(
  join(appDir, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`
)
