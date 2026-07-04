import { posix } from "node:path"

import {
  CommandExitError,
  type CommandResult,
  type Sandbox,
} from "@e2b/code-interpreter"
import {
  BaseSandbox,
  type EditResult,
  type ExecuteResponse,
  type FileData,
  type FileDownloadResponse,
  type FileInfo,
  type FileOperationError,
  type FileUploadResponse,
  type LsResult,
  type ReadRawResult,
  type ReadResult,
  type WriteResult,
} from "deepagents"

import {
  ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
  ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
} from "@/lib/astraflow-sandbox-runtime"
import { getOrCreateSessionSandbox } from "@/lib/astraflow-session-sandbox"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

const DEEPAGENTS_SANDBOX_MAX_OUTPUT_CHARS = 18_000
const DEEPAGENTS_SANDBOX_CWD = "/home/user"

type DeepAgentsE2BBackendOptions = {
  sessionId: string
  apiKey: string
  commandTimeoutSeconds?: number
}

function quoteShell(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function truncateOutput(output: string) {
  if (output.length <= DEEPAGENTS_SANDBOX_MAX_OUTPUT_CHARS) {
    return { output, truncated: false }
  }

  return {
    output: `${output.slice(0, DEEPAGENTS_SANDBOX_MAX_OUTPUT_CHARS)}\n...[truncated ${
      output.length - DEEPAGENTS_SANDBOX_MAX_OUTPUT_CHARS
    } chars]`,
    truncated: true,
  }
}

function normalizeCommandResult(error: unknown): CommandResult | null {
  if (error instanceof CommandExitError) {
    return {
      exitCode: error.exitCode,
      error: error.error,
      stdout: error.stdout,
      stderr: error.stderr,
    }
  }

  return null
}

function formatCommandOutput(result: CommandResult) {
  const sections: string[] = []
  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()

  if (stdout) {
    sections.push(stdout)
  }

  if (stderr) {
    sections.push(`STDERR:\n${stderr}`)
  }

  if (result.error) {
    sections.push(`ERROR:\n${result.error}`)
  }

  return sections.join("\n\n")
}

function toUint8Array(value: unknown) {
  if (value instanceof Uint8Array) {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  if (typeof value === "string") {
    return new TextEncoder().encode(value)
  }

  return new Uint8Array()
}

function uint8ArrayToArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)

  return buffer
}

function decodeText(bytes: Uint8Array) {
  if (bytes.includes(0)) {
    return null
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function createFileData(path: string, bytes: Uint8Array): FileData {
  const now = new Date().toISOString()
  const text = decodeText(bytes)

  return {
    content: text ?? bytes,
    mimeType: text === null ? inferBinaryMimeType(path) : "text/plain",
    created_at: now,
    modified_at: now,
  }
}

function inferBinaryMimeType(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase()

  if (extension === "png") {
    return "image/png"
  }

  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg"
  }

  if (extension === "gif") {
    return "image/gif"
  }

  if (extension === "webp") {
    return "image/webp"
  }

  if (extension === "pdf") {
    return "application/pdf"
  }

  return "application/octet-stream"
}

function normalizeFileError(error: unknown): FileOperationError {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (lower.includes("not found") || lower.includes("no such file")) {
    return "file_not_found"
  }

  if (lower.includes("permission") || lower.includes("denied")) {
    return "permission_denied"
  }

  if (lower.includes("directory")) {
    return "is_directory"
  }

  return "invalid_path"
}

function normalizeFileInfo(basePath: string, entry: unknown): FileInfo {
  const record =
    typeof entry === "object" && entry !== null
      ? (entry as Record<string, unknown>)
      : {}
  const name = typeof record.name === "string" ? record.name : ""
  const path =
    typeof record.path === "string" && record.path
      ? record.path
      : posix.join(basePath, name)
  const type = typeof record.type === "string" ? record.type : ""
  const size = typeof record.size === "number" ? record.size : undefined
  const modifiedAt =
    typeof record.modifiedAt === "string"
      ? record.modifiedAt
      : typeof record.modified_at === "string"
        ? record.modified_at
        : undefined

  return {
    path,
    is_dir: type === "dir" || type === "directory",
    ...(size !== undefined ? { size } : {}),
    ...(modifiedAt ? { modified_at: modifiedAt } : {}),
  }
}

function sliceLines(content: string, offset = 0, limit = 500) {
  const start = Math.max(Math.trunc(offset), 0)
  const count = Math.max(Math.trunc(limit), 1)

  return content
    .split(/\r?\n/)
    .slice(start, start + count)
    .join("\n")
}

export class DeepAgentsE2BBackend extends BaseSandbox {
  readonly id: string

  private readonly apiKey: string
  private readonly commandTimeoutSeconds: number
  private readonly sessionId: string
  private sandboxPromise: Promise<Sandbox> | null = null

  constructor({
    apiKey,
    commandTimeoutSeconds = ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
    sessionId,
  }: DeepAgentsE2BBackendOptions) {
    super()
    this.apiKey = apiKey
    this.commandTimeoutSeconds = commandTimeoutSeconds
    this.id = `astraflow-e2b:${sessionId}`
    this.sessionId = sessionId
  }

  private getSandbox() {
    this.sandboxPromise ??= getOrCreateSessionSandbox({
      apiKey: this.apiKey,
      sessionId: this.sessionId,
    }).catch((error) => {
      this.sandboxPromise = null
      throw error
    })

    return this.sandboxPromise
  }

  private async runCommand(command: string): Promise<ExecuteResponse> {
    const sandbox = await this.getSandbox()
    const timeoutMs = this.commandTimeoutSeconds * 1000
    let result: CommandResult

    try {
      result = await sandbox.commands.run(
        `/bin/bash -l -c ${quoteShell(command)}`,
        {
          cwd: DEEPAGENTS_SANDBOX_CWD,
          timeoutMs,
          requestTimeoutMs: Math.max(
            timeoutMs + 10_000,
            ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
          ),
        }
      )
    } catch (error) {
      const commandResult = normalizeCommandResult(error)

      if (!commandResult) {
        throw error
      }

      result = commandResult
    }

    const truncated = truncateOutput(formatCommandOutput(result))

    return {
      output: truncated.output,
      exitCode: result.exitCode,
      truncated: truncated.truncated,
    }
  }

  async execute(command: string): Promise<ExecuteResponse> {
    return withStudioSessionLock(this.sessionId, () => this.runCommand(command))
  }

  override async ls(path: string): Promise<LsResult> {
    return withStudioSessionLock(this.sessionId, async () => {
      try {
        const sandbox = await this.getSandbox()
        const entries = await sandbox.files.list(path, {
          requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
        })

        return {
          files: entries.map((entry) => normalizeFileInfo(path, entry)),
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  override async read(
    filePath: string,
    offset?: number,
    limit?: number
  ): Promise<ReadResult> {
    return withStudioSessionLock(this.sessionId, async () => {
      try {
        const sandbox = await this.getSandbox()
        const bytes = toUint8Array(
          await sandbox.files.read(filePath, {
            format: "bytes",
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
        )
        const text = decodeText(bytes)

        if (text === null) {
          return {
            content: bytes,
            mimeType: inferBinaryMimeType(filePath),
          }
        }

        return {
          content: sliceLines(text, offset, limit),
          mimeType: "text/plain",
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  override async readRaw(filePath: string): Promise<ReadRawResult> {
    return withStudioSessionLock(this.sessionId, async () => {
      try {
        const sandbox = await this.getSandbox()
        const bytes = toUint8Array(
          await sandbox.files.read(filePath, {
            format: "bytes",
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
        )

        return {
          data: createFileData(filePath, bytes),
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  override async write(
    filePath: string,
    content: string
  ): Promise<WriteResult> {
    return withStudioSessionLock(this.sessionId, async () => {
      try {
        const sandbox = await this.getSandbox()

        await sandbox.files.write(filePath, content, {
          requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
        })

        return {
          path: filePath,
          filesUpdate: null,
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  override async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false
  ): Promise<EditResult> {
    return withStudioSessionLock(this.sessionId, async () => {
      try {
        const sandbox = await this.getSandbox()
        const bytes = toUint8Array(
          await sandbox.files.read(filePath, {
            format: "bytes",
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
        )
        const current = decodeText(bytes)

        if (current === null) {
          return { error: "Cannot edit binary file content." }
        }

        const occurrences = replaceAll
          ? current.split(oldString).length - 1
          : current.includes(oldString)
            ? 1
            : 0

        if (occurrences === 0) {
          return { error: "String to replace was not found." }
        }

        const next = replaceAll
          ? current.split(oldString).join(newString)
          : current.replace(oldString, newString)

        await sandbox.files.write(filePath, next, {
          requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
        })

        return {
          path: filePath,
          filesUpdate: null,
          occurrences,
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  override async uploadFiles(
    files: Array<[string, Uint8Array]>
  ): Promise<FileUploadResponse[]> {
    return withStudioSessionLock(this.sessionId, async () => {
      const sandbox = await this.getSandbox()
      const responses: FileUploadResponse[] = []

      for (const [path, content] of files) {
        try {
          await sandbox.files.write(path, uint8ArrayToArrayBuffer(content), {
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
          responses.push({ path, error: null })
        } catch (error) {
          responses.push({ path, error: normalizeFileError(error) })
        }
      }

      return responses
    })
  }

  override async downloadFiles(
    paths: string[]
  ): Promise<FileDownloadResponse[]> {
    return withStudioSessionLock(this.sessionId, async () => {
      const sandbox = await this.getSandbox()
      const responses: FileDownloadResponse[] = []

      for (const path of paths) {
        try {
          const content = toUint8Array(
            await sandbox.files.read(path, {
              format: "bytes",
              requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
            })
          )
          responses.push({ path, content, error: null })
        } catch (error) {
          responses.push({
            path,
            content: null,
            error: normalizeFileError(error),
          })
        }
      }

      return responses
    })
  }
}
