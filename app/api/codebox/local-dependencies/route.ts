import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { NextResponse } from "next/server"

import type {
  CodeBoxLocalDependencyStatus,
  CodeBoxLocalPlatform,
} from "@/lib/codebox-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const execFileAsync = promisify(execFile)

function getPlatform(): CodeBoxLocalPlatform {
  if (
    process.platform === "darwin" ||
    process.platform === "linux" ||
    process.platform === "freebsd" ||
    process.platform === "win32"
  ) {
    return process.platform
  }

  return "unknown"
}

async function detectWebsocat() {
  const command =
    process.platform === "win32"
      ? {
          file: "cmd.exe",
          args: [
            "/d",
            "/s",
            "/c",
            "for /f %i in ('where websocat') do @echo %i & websocat --version",
          ],
        }
      : {
          file: "/bin/sh",
          args: [
            "-lc",
            "path=$(command -v websocat 2>/dev/null) || exit 127; version=$(websocat --version 2>&1 | head -n 1 || true); printf '%s\\n%s\\n' \"$path\" \"$version\"",
          ],
        }

  try {
    const { stdout } = await execFileAsync(command.file, command.args, {
      timeout: 3_000,
      windowsHide: true,
    })
    const [path = null, version = null] = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    return {
      installed: Boolean(path),
      path,
      version,
    }
  } catch {
    return {
      installed: false,
      path: null,
      version: null,
    }
  }
}

export async function GET() {
  const data: CodeBoxLocalDependencyStatus = {
    platform: getPlatform(),
    websocat: await detectWebsocat(),
  }

  return NextResponse.json({
    ok: true,
    data,
  })
}
