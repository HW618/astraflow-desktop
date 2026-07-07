import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"

import {
  LocalShellBackend,
  type EditResult,
  type ExecuteResponse,
  type FileUploadResponse,
  type GlobResult,
  type GrepResult,
  type WriteResult,
} from "deepagents"

import { ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS } from "@/lib/astraflow-sandbox-runtime"
import {
  requestToolPermission,
  type PermissionGatewayContext,
} from "@/lib/agent/permission-gateway"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

type DeepAgentsLocalBackendOptions = {
  rootDir: string
  sessionId: string
  permissionContext: PermissionGatewayContext
}

const LOCAL_SEARCH_TIMEOUT_MS = 10_000
const LOCAL_SEARCH_MAX_RESULTS = 200
const BROAD_HOME_GLOB_ERROR =
  "Glob search was not started because recursive ** searches from the home directory can hang the desktop client. Select or open a project folder, or retry with a narrower path/pattern such as AGENTS.md, */AGENTS.md, or a known project directory."
const BROAD_HOME_GREP_ERROR =
  "Grep search was not started because searching the entire home directory can hang the desktop client. Select or open a project folder, or retry with a narrower path or file glob."

// Runs Deep Agent filesystem/shell tools directly on the user's machine,
// rooted at the bound local project. Mutating operations and shell commands
// go through the same permission gateway as the remote sandbox backend.
export class DeepAgentsLocalBackend extends LocalShellBackend {
  private readonly rootDir: string
  private readonly permissionContext: PermissionGatewayContext
  private readonly sessionId: string
  private initializePromise: Promise<void> | null = null

  constructor({
    permissionContext,
    rootDir,
    sessionId,
  }: DeepAgentsLocalBackendOptions) {
    super({
      rootDir,
      inheritEnv: true,
      timeout: ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
    })
    this.rootDir = resolve(rootDir)
    this.permissionContext = permissionContext
    this.sessionId = sessionId
  }

  private ensureReady() {
    if (this.isInitialized) {
      return Promise.resolve()
    }

    this.initializePromise ??= this.initialize().catch((error) => {
      this.initializePromise = null
      throw error
    })

    return this.initializePromise
  }

  private async getPermissionDenial(toolName: string, input: unknown) {
    const permission = await requestToolPermission({
      context: this.permissionContext,
      input,
      toolName,
    })

    return permission.allowed ? null : permission.message
  }

  private resolveSearchPath(searchPath = "/") {
    const trimmedSearchPath = searchPath.trim()

    if (!trimmedSearchPath || trimmedSearchPath === "/") {
      return this.rootDir
    }

    if (isAbsolute(trimmedSearchPath)) {
      return resolve(trimmedSearchPath)
    }

    return resolve(this.rootDir, trimmedSearchPath)
  }

  private isBroadHomeGlob(pattern: string, searchPath = "/") {
    const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\/+/, "")

    return (
      normalizedPattern.includes("**") &&
      this.isHomeDirectorySearch(searchPath)
    )
  }

  private isHomeDirectorySearch(searchPath = "/") {
    return this.resolveSearchPath(searchPath) === resolve(homedir())
  }

  private async runWithTimeout<T extends { error?: string }>(
    work: Promise<T>,
    timeoutMessage: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null

    try {
      return await Promise.race([
        work,
        new Promise<T>((resolveTimeout) => {
          timer = setTimeout(() => {
            resolveTimeout({ error: timeoutMessage } as T)
          }, LOCAL_SEARCH_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  private limitGlobResult(result: GlobResult): GlobResult {
    if (!result.files || result.files.length <= LOCAL_SEARCH_MAX_RESULTS) {
      return result
    }

    return {
      error:
        result.error ??
        `Glob matched ${result.files.length} entries; returning the first ${LOCAL_SEARCH_MAX_RESULTS}. Retry with a narrower path or pattern.`,
      files: result.files.slice(0, LOCAL_SEARCH_MAX_RESULTS),
    }
  }

  private limitGrepResult(result: GrepResult): GrepResult {
    if (!result.matches || result.matches.length <= LOCAL_SEARCH_MAX_RESULTS) {
      return result
    }

    return {
      error:
        result.error ??
        `Grep matched ${result.matches.length} entries; returning the first ${LOCAL_SEARCH_MAX_RESULTS}. Retry with a narrower path or file glob.`,
      matches: result.matches.slice(0, LOCAL_SEARCH_MAX_RESULTS),
    }
  }

  override async glob(pattern: string, searchPath = "/"): Promise<GlobResult> {
    if (this.isBroadHomeGlob(pattern, searchPath)) {
      return { error: BROAD_HOME_GLOB_ERROR }
    }

    return this.limitGlobResult(
      await this.runWithTimeout(
        super.glob(pattern, searchPath),
        `Glob search timed out after ${
          LOCAL_SEARCH_TIMEOUT_MS / 1000
        }s. Retry with a narrower path or pattern.`
      )
    )
  }

  override async grep(
    pattern: string,
    searchPath = "/",
    glob: string | null = null
  ): Promise<GrepResult> {
    if (this.isHomeDirectorySearch(searchPath)) {
      return { error: BROAD_HOME_GREP_ERROR }
    }

    return this.limitGrepResult(
      await this.runWithTimeout(
        super.grep(pattern, searchPath, glob),
        `Grep search timed out after ${
          LOCAL_SEARCH_TIMEOUT_MS / 1000
        }s. Retry with a narrower path or file glob.`
      )
    )
  }

  override async execute(command: string): Promise<ExecuteResponse> {
    const denial = await this.getPermissionDenial("execute", { command })

    if (denial) {
      return {
        output: denial,
        exitCode: 1,
        truncated: false,
      }
    }

    return withStudioSessionLock(this.sessionId, async () => {
      await this.ensureReady()

      return super.execute(command)
    })
  }

  override async write(
    filePath: string,
    content: string
  ): Promise<WriteResult> {
    const denial = await this.getPermissionDenial("write_file", {
      path: filePath,
      content,
    })

    if (denial) {
      return { error: denial }
    }

    return withStudioSessionLock(this.sessionId, () =>
      super.write(filePath, content)
    )
  }

  override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<EditResult> {
    const denial = await this.getPermissionDenial("edit_file", {
      path: filePath,
      oldString,
      newString,
      replaceAll,
    })

    if (denial) {
      return { error: denial }
    }

    return withStudioSessionLock(this.sessionId, () =>
      super.edit(filePath, oldString, newString, replaceAll)
    )
  }

  override async uploadFiles(
    files: Array<[string, Uint8Array]>
  ): Promise<FileUploadResponse[]> {
    const denial = await this.getPermissionDenial(
      "upload_file",
      files.map(([path, content]) => ({
        path,
        bytes: content.byteLength,
      }))
    )

    if (denial) {
      return files.map(([path]) => ({ path, error: "permission_denied" }))
    }

    return withStudioSessionLock(this.sessionId, () =>
      super.uploadFiles(files)
    )
  }
}
