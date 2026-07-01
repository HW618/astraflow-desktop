import { spawn } from "node:child_process"

function getOpenFolderCommand(path: string) {
  if (process.platform === "darwin") {
    return { command: "open", args: [path] }
  }

  if (process.platform === "win32") {
    return { command: "explorer.exe", args: [path] }
  }

  return { command: "xdg-open", args: [path] }
}

export function openFolder(path: string) {
  const { command, args } = getOpenFolderCommand(path)

  return new Promise<void>((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ command, args, {
      detached: true,
      stdio: "ignore",
    })

    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}
