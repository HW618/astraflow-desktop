/* eslint-disable @typescript-eslint/no-require-imports */

const {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs")
const { join, sep } = require("node:path")

function copyFilter(sourcePath) {
  return !sourcePath.endsWith(".map")
}

function copyTree(source, target) {
  if (!copyFilter(source)) {
    return
  }

  const stats = lstatSync(source)

  if (stats.isSymbolicLink()) {
    copyTree(realpathSync(source), target)
    return
  }

  if (stats.isDirectory()) {
    mkdirSync(target, { recursive: true })

    for (const entry of readdirSync(source)) {
      copyTree(join(source, entry), join(target, entry))
    }

    return
  }

  if (stats.isFile()) {
    writeFileSync(target, readFileSync(source))
    chmodSync(target, stats.mode)
  }
}

function materializePackage(packageDir) {
  const tempDir = `${packageDir}.tmp-${process.pid}`

  rmSync(tempDir, { recursive: true, force: true })
  copyTree(packageDir, tempDir)
  rmSync(packageDir, { recursive: true, force: true })
  renameSync(tempDir, packageDir)
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

function getPackageNameFromPackageJson(packageDir) {
  const packageJsonPath = join(packageDir, "package.json")

  if (!existsSync(packageJsonPath)) {
    return null
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
    return typeof packageJson.name === "string" ? packageJson.name : null
  } catch {
    return null
  }
}

function getPackagedPackageForAlias(sourceAlias, targetAppDir) {
  let packageName = getPackageNameFromPackageJson(sourceAlias)

  if (!packageName && lstatSync(sourceAlias).isSymbolicLink()) {
    const realPath = realpathSync(sourceAlias)
    packageName =
      getPackageNameFromNodeModulesPath(realPath) ??
      getPackageNameFromPackageJson(realPath)
  }

  if (!packageName) {
    return null
  }

  const packagedPackage = join(
    targetAppDir,
    "node_modules",
    ...packageName.split("/")
  )

  return existsSync(packagedPackage) ? packagedPackage : null
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
    const copySource =
      getPackagedPackageForAlias(sourceAlias, targetAppDir) ?? sourceAlias

    copyTree(copySource, join(targetAliasesDir, entry.name))
  }
}

function syncPackage(sourcePackage, targetPackage) {
  if (existsSync(targetPackage)) {
    materializePackage(targetPackage)
    return
  }

  copyTree(sourcePackage, targetPackage)
}

function syncNodeModules(source, target) {
  mkdirSync(target, { recursive: true })

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue
    }

    const sourceEntry = join(source, entry.name)
    const targetEntry = join(target, entry.name)

    if (entry.name.startsWith("@")) {
      mkdirSync(targetEntry, { recursive: true })

      for (const scopedEntry of readdirSync(sourceEntry, {
        withFileTypes: true,
      })) {
        if (!scopedEntry.isDirectory()) {
          continue
        }

        syncPackage(
          join(sourceEntry, scopedEntry.name),
          join(targetEntry, scopedEntry.name)
        )
      }

      continue
    }

    syncPackage(sourceEntry, targetEntry)
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

  syncNodeModules(source, target)
  copyNextModuleAliases(sourceAppDir, targetAppDir)
}
