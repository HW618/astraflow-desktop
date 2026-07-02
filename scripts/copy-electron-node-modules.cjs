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

const ELECTRON_BUILDER_ARCH_NAMES = {
  0: "ia32",
  1: "x64",
  2: "armv7l",
  3: "arm64",
  4: "universal",
}

const REBUILDABLE_NATIVE_MODULES = ["better-sqlite3"]

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
  const packageNameFromAlias = getPackageNameFromAlias(
    sourceAlias,
    join(targetAppDir, "node_modules")
  )
  let packageName = getPackageNameFromPackageJson(sourceAlias)

  if (!packageName && lstatSync(sourceAlias).isSymbolicLink()) {
    try {
      const realPath = realpathSync(sourceAlias)
      packageName =
        getPackageNameFromNodeModulesPath(realPath) ??
        getPackageNameFromPackageJson(realPath)
    } catch {
      packageName = null
    }
  }

  packageName ??= packageNameFromAlias

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

function collectPackagedPackageNames(nodeModulesDir) {
  const packageNames = []

  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue
    }

    if (entry.name.startsWith("@")) {
      const scopeDir = join(nodeModulesDir, entry.name)

      for (const scopedEntry of readdirSync(scopeDir, {
        withFileTypes: true,
      })) {
        if (scopedEntry.isDirectory()) {
          packageNames.push(`${entry.name}/${scopedEntry.name}`)
        }
      }

      continue
    }

    packageNames.push(entry.name)
  }

  return packageNames.sort((a, b) => b.length - a.length)
}

function getPackageNameFromAlias(sourceAlias, nodeModulesDir) {
  const aliasName = sourceAlias.split(sep).at(-1)

  if (!aliasName || !existsSync(nodeModulesDir)) {
    return null
  }

  return (
    collectPackagedPackageNames(nodeModulesDir).find((packageName) =>
      aliasName.startsWith(`${packageName.split("/").at(-1)}-`)
    ) ?? null
  )
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
    const packagedPackage = getPackagedPackageForAlias(
      sourceAlias,
      targetAppDir
    )
    const copySource = packagedPackage ?? sourceAlias

    console.log(
      `[electron-package] materializing Next module alias ${entry.name} from ${copySource}`
    )

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

function getElectronVersion(projectDir) {
  const packageJson = JSON.parse(
    readFileSync(join(projectDir, "package.json"), "utf8")
  )
  const version =
    packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron
  const match =
    typeof version === "string" ? version.match(/\d+\.\d+\.\d+/) : null

  if (!match) {
    throw new Error("Could not resolve Electron version from package.json.")
  }

  return match[0]
}

function getElectronRebuildArch(context) {
  const arch =
    typeof context.arch === "string"
      ? context.arch
      : ELECTRON_BUILDER_ARCH_NAMES[context.arch]

  if (!arch || arch === "universal") {
    throw new Error(`Unsupported Electron rebuild arch: ${context.arch}`)
  }

  return arch
}

function getNodeModuleDir(nodeModulesDir, packageName) {
  return join(nodeModulesDir, ...packageName.split("/"))
}

function copyRebuildableNativeModules(projectDir, targetAppDir) {
  for (const packageName of REBUILDABLE_NATIVE_MODULES) {
    const sourcePackage = getNodeModuleDir(
      join(projectDir, "node_modules"),
      packageName
    )
    const targetPackage = getNodeModuleDir(
      join(targetAppDir, "node_modules"),
      packageName
    )

    if (!existsSync(sourcePackage)) {
      throw new Error(`Missing native module source package: ${sourcePackage}`)
    }

    rmSync(targetPackage, { recursive: true, force: true })
    copyTree(sourcePackage, targetPackage)
  }
}

function pruneRebuildableNativeModules(targetAppDir) {
  const betterSqliteDir = getNodeModuleDir(
    join(targetAppDir, "node_modules"),
    "better-sqlite3"
  )
  const betterSqliteBinary = join(
    betterSqliteDir,
    "build",
    "Release",
    "better_sqlite3.node"
  )

  if (!existsSync(betterSqliteBinary)) {
    throw new Error(
      `Missing rebuilt better-sqlite3 binary: ${betterSqliteBinary}`
    )
  }

  const binaryMode = lstatSync(betterSqliteBinary).mode
  const binaryContents = readFileSync(betterSqliteBinary)

  rmSync(join(betterSqliteDir, "build"), { recursive: true, force: true })
  mkdirSync(join(betterSqliteDir, "build", "Release"), { recursive: true })
  writeFileSync(betterSqliteBinary, binaryContents)
  chmodSync(betterSqliteBinary, binaryMode)

  for (const entry of ["deps", "src", "test"]) {
    rmSync(join(betterSqliteDir, entry), { recursive: true, force: true })
  }

  for (const entry of [
    "binding.gyp",
    "common.gypi",
    "copy.js",
    "defines.gypi",
    "download.sh",
  ]) {
    rmSync(join(betterSqliteDir, entry), { force: true })
  }
}

async function rebuildElectronNativeModules(context, targetAppDir) {
  const { rebuild } = await import("@electron/rebuild")
  const electronVersion = getElectronVersion(context.packager.projectDir)
  const arch = getElectronRebuildArch(context)
  const nativeModuleBuildDir = join(
    targetAppDir,
    "node_modules",
    "better-sqlite3",
    "build"
  )

  console.log(
    `[electron-package] rebuilding native modules for Electron ${electronVersion} (${context.electronPlatformName}/${arch})`
  )

  copyRebuildableNativeModules(context.packager.projectDir, targetAppDir)
  rmSync(nativeModuleBuildDir, { recursive: true, force: true })

  const rebuildTask = rebuild({
    buildPath: targetAppDir,
    electronVersion,
    platform: context.electronPlatformName,
    arch,
    onlyModules: ["better-sqlite3"],
    force: true,
    buildFromSource: true,
    disablePreGypCopy: true,
    projectRootPath: targetAppDir,
  })
  let foundNativeModules = []

  rebuildTask.lifecycle.on("modules-found", (modules) => {
    foundNativeModules = modules
    console.log(
      `[electron-package] native modules found: ${modules.join(", ")}`
    )
  })

  rebuildTask.lifecycle.on("module-done", (moduleName) => {
    console.log(`[electron-package] rebuilt native module: ${moduleName}`)
  })

  await rebuildTask

  if (!foundNativeModules.includes("better-sqlite3")) {
    throw new Error("better-sqlite3 was not found during Electron rebuild.")
  }

  pruneRebuildableNativeModules(targetAppDir)
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
  await rebuildElectronNativeModules(context, targetAppDir)
  copyNextModuleAliases(sourceAppDir, targetAppDir)
}
