import { spawn } from "node:child_process"

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    })

    child.once("error", rejectRun)
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun()
        return
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} failed with code ${
            code ?? "null"
          } and signal ${signal ?? "null"}.`
        )
      )
    })
  })
}

const builderArgs = process.argv.slice(2)
let builderError = null

try {
  await run("bunx", ["electron-builder", ...builderArgs])
} catch (error) {
  builderError = error
} finally {
  await run("bun", ["install", "--force", "--frozen-lockfile"])
}

if (builderError) {
  throw builderError
}
