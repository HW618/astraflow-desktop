import { execFile } from "node:child_process"

const SAFE_GIT_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
]

const SAFE_GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
}

export function runSafeGit(
  path: string,
  args: string[],
  options: { timeout: number; maxBuffer: number }
) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      [...SAFE_GIT_CONFIG_ARGS, "-C", path, ...args],
      {
        ...options,
        env: {
          ...process.env,
          ...SAFE_GIT_ENV,
        },
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }

        resolve(stdout.toString())
      }
    )
  })
}
