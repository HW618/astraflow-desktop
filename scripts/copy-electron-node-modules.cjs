/* eslint-disable @typescript-eslint/no-require-imports */

const {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} = require("node:fs")
const { join, sep } = require("node:path")

function copyFilter(sourcePath) {
  return !sourcePath.endsWith(".map")
}

function getPackagedAppDir(context) {
  if (context.electronPlatformName === "darwin") {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
      "app"
    )
  }

  return join(context.appOutDir, "resources", "app")
}

function getPackageNameFromNodeModulesPath(packagePath) {
  const parts = packagePath.split(sep)
  const nodeModulesIndex = parts.lastIndexOf("node_modules")

  if (nodeModulesIndex === -1 || !parts[nodeModulesIndex + 1]) {
    return null
  }

  const firstPart = parts[nodeModulesIndex + 1]

  if (firstPart.startsWith("@") && parts[nodeModulesIndex + 2]) {
    return `${firstPart}/${parts[nodeModulesIndex + 2]}`
  }

  return firstPart
}

function copyNextModuleAliases(sourceAppDir, targetAppDir) {
  const sourceAliasesDir = join(sourceAppDir, ".next", "node_modules")

  if (!existsSync(sourceAliasesDir)) {
    return
  }

  const targetAliasesDir = join(targetAppDir, ".next", "node_modules")
  rmSync(targetAliasesDir, { recursive: true, force: true })
  mkdirSync(targetAliasesDir, { recursive: true })

  for (const entry of readdirSync(sourceAliasesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue
    }

    const sourceAlias = join(sourceAliasesDir, entry.name)
    let copySource = sourceAlias

    if (lstatSync(sourceAlias).isSymbolicLink()) {
      const packageName = getPackageNameFromNodeModulesPath(
        realpathSync(sourceAlias)
      )
      const packagedPackage =
        packageName &&
        join(targetAppDir, "node_modules", ...packageName.split("/"))

      if (packagedPackage && existsSync(packagedPackage)) {
        copySource = packagedPackage
      }
    }

    cpSync(copySource, join(targetAliasesDir, entry.name), {
      recursive: true,
      dereference: true,
      filter: copyFilter,
    })
  }
}

exports.default = async function copyElectronNodeModules(context) {
  const projectDir = context.packager.projectDir
  const sourceAppDir = join(projectDir, "dist", "electron-app")
  const targetAppDir = getPackagedAppDir(context)
  const source = join(sourceAppDir, "node_modules")
  const target = join(targetAppDir, "node_modules")

  if (!existsSync(source)) {
    throw new Error(`Missing traced Electron node_modules: ${source}`)
  }

  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, {
    recursive: true,
    filter: copyFilter,
  })

  copyNextModuleAliases(sourceAppDir, targetAppDir)
}
