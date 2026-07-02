import { spawn } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const distDir = join(root, "dist", "electron")
const timeoutMs = 120_000

function walk(directory) {
  const entries = []

  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry)
    const stats = statSync(absolutePath)

    if (stats.isDirectory()) {
      entries.push(...walk(absolutePath))
    } else {
      entries.push(absolutePath)
    }
  }

  return entries
}

function findPackagedExecutable() {
  const files = walk(distDir)

  if (process.platform === "darwin") {
    return files.find((file) => file.endsWith(".app/Contents/MacOS/AstraFlow"))
  }

  if (process.platform === "win32") {
    return files.find(
      (file) => file.includes("win-unpacked") && file.endsWith("AstraFlow.exe")
    )
  }

  return files.find((file) =>
    ["AstraFlow", "astraflow", "astraflow-desktop"].some(
      (name) => file.includes("linux-unpacked") && file.endsWith(`/${name}`)
    )
  )
}

const executable = findPackagedExecutable()
const smokeArgs = process.platform === "linux" ? ["--no-sandbox"] : []
const smokeEnv =
  process.platform === "linux"
    ? {
        ELECTRON_DISABLE_SANDBOX: "1",
      }
    : {}

if (!executable) {
  throw new Error(
    `Could not find a packaged AstraFlow executable in ${distDir}.`
  )
}

await new Promise((resolveRun, rejectRun) => {
  const child = spawn(executable, smokeArgs, {
    env: {
      ...process.env,
      ASTRAFLOW_ELECTRON_SMOKE: "1",
      ELECTRON_ENABLE_LOGGING: "1",
      ...smokeEnv,
    },
    stdio: "inherit",
    windowsHide: true,
  })

  const timeout = setTimeout(() => {
    child.kill()
    rejectRun(new Error(`Electron smoke run timed out: ${executable}`))
  }, timeoutMs)

  child.once("error", (error) => {
    clearTimeout(timeout)
    rejectRun(error)
  })

  child.once("exit", (code, signal) => {
    clearTimeout(timeout)

    if (code === 0) {
      resolveRun()
      return
    }

    rejectRun(
      new Error(
        `Electron smoke run failed with code ${code ?? "null"} and signal ${
          signal ?? "null"
        }.`
      )
    )
  })
})
