import { tool } from "langchain"
import { createHash } from "node:crypto"
import { z } from "zod"

import {
  ASTRAFLOW_SANDBOX_CODE_LANGUAGES,
  ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS,
  ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  runCommandInAstraFlowSandbox,
  runCodeInAstraFlowSandbox,
} from "@/lib/astraflow-sandbox-runtime"
import { createStudioSessionFile } from "@/lib/studio-db"
import {
  getSessionSandboxRoot,
  getSessionSandboxOutputRoot,
  getOrCreateSessionSandbox,
  normalizeSandboxFilePath,
  normalizeSandboxOutputPath,
  uploadSessionFileToSandbox,
  type SessionSandboxContext,
} from "@/lib/astraflow-session-sandbox"
import {
  createGeneratedStoragePath,
  writeStudioFile,
} from "@/lib/studio-file-storage"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

const SANDBOX_FILE_READ_DEFAULT_BYTES = 32 * 1024
const SANDBOX_FILE_READ_MAX_BYTES = 120 * 1024
const SANDBOX_FILE_SUMMARY_LINES = 80
const SANDBOX_COMMAND_ENV_MAX_VARS = 40

function sha256Bytes(bytes: Uint8Array | Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex")
}

function clampReadBytes(value: number | undefined) {
  if (!value || !Number.isFinite(value)) {
    return SANDBOX_FILE_READ_DEFAULT_BYTES
  }

  return Math.min(Math.max(Math.trunc(value), 1), SANDBOX_FILE_READ_MAX_BYTES)
}

function clampReadOffset(value: number | undefined) {
  if (!value || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(Math.trunc(value), 0)
}

function summarizeTextContent(text: string) {
  const lines = text.split(/\r?\n/)
  const nonEmpty = lines
    .filter((line) => line.trim())
    .slice(0, SANDBOX_FILE_SUMMARY_LINES)

  return [`Lines: ${lines.length}`, "", "Preview lines:", ...nonEmpty].join(
    "\n"
  )
}

function normalizeCommandEnv(env: Record<string, string> | undefined) {
  if (!env) {
    return undefined
  }

  const entries = Object.entries(env)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key)

  if (entries.length > SANDBOX_COMMAND_ENV_MAX_VARS) {
    throw new Error(
      `run_command env supports at most ${SANDBOX_COMMAND_ENV_MAX_VARS} variables.`
    )
  }

  for (const [key] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`)
    }
  }

  return Object.fromEntries(entries)
}

export function createSessionSandboxGetter({
  sessionId,
  apiKey,
}: {
  sessionId: string
  apiKey: string
}) {
  let promise: Promise<SessionSandboxContext> | null = null

  return () => {
    promise ??= getOrCreateSessionSandbox({ sessionId, apiKey })
      .then((sandbox) => ({
        sandbox,
        sandboxId: sandbox.sandboxId,
        files: [],
        manifest: "",
      }))
      .catch((error) => {
        promise = null
        throw error
      })
    return promise
  }
}

export function createCodeInterpreterTool({
  getSandboxContext,
  sessionId,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
}) {
  return tool(
    async ({ code, language, timeout_seconds }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox, sandboxId } = await getSandboxContext()

          return runCodeInAstraFlowSandbox({
            sandbox,
            code,
            language,
            timeoutSeconds: timeout_seconds,
            lifecycleLine: "Auto pause: true",
            cleanupLine: `Lifecycle: AstraFlow Sandbox ${sandboxId} is reused for this chat session and will auto-pause after ${ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS}s of inactivity with memory and filesystem preserved.`,
          })
        })
      } catch (error) {
        return `run_code failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "run_code",
      description:
        "Run code in this chat session's persistent AstraFlow Sandbox. Supported languages are python, javascript, typescript, bash, r, and java. The sandbox automatically pauses after inactivity and auto-resumes on later traffic with memory and filesystem preserved. Uploaded session files are available at their sandbox paths.",
      schema: z.object({
        code: z.string().min(1).describe("The code to execute."),
        language: z
          .enum(ASTRAFLOW_SANDBOX_CODE_LANGUAGES)
          .default("python")
          .describe("Code language to execute."),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(300)
          .optional()
          .default(60)
          .describe("Maximum time to allow this code cell to run."),
      }),
    }
  )
}

export function createRunCommandTool({
  getSandboxContext,
  sessionId,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
}) {
  return tool(
    async ({ command, cwd, env, timeout_seconds }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox, sandboxId } = await getSandboxContext()
          const workingDirectory = cwd?.trim()
            ? normalizeSandboxFilePath(cwd, {
                relativeBase: getSessionSandboxRoot(),
              })
            : undefined

          return runCommandInAstraFlowSandbox({
            sandbox,
            command,
            cwd: workingDirectory,
            env: normalizeCommandEnv(env),
            timeoutSeconds: timeout_seconds,
            lifecycleLine: "Auto pause: true",
            cleanupLine: `Lifecycle: AstraFlow Sandbox ${sandboxId} is reused for this chat session and will auto-pause after ${ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS}s of inactivity with memory and filesystem preserved.`,
          })
        })
      } catch (error) {
        return `run_command failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "run_command",
      description:
        "Run a shell command in this chat session's persistent AstraFlow Sandbox via sandbox.commands.run. Commands execute with /bin/bash -l -c. Use this for bash utilities, package or environment inspection, shell pipelines, and filesystem operations under /home/user/astraflow. Prefer run_code for calculations, data processing, and language-specific scripts. If a command starts a service that should be exposed outside the sandbox, it must listen on 0.0.0.0:<port>; services bound to localhost or 127.0.0.1 will not work with the sandbox proxy. Start long-lived services in a detached tmux session, then call sandbox_get_host with the port. Do not run foreground long-lived commands such as python3 -m http.server 8080 directly in run_command, because they can block the tool call.",
      schema: z.object({
        command: z
          .string()
          .trim()
          .min(1)
          .describe("Shell command to execute with /bin/bash -l -c."),
        cwd: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Optional working directory under /home/user/astraflow. Relative paths resolve under /home/user/astraflow."
          ),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe("Optional environment variables for this command."),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(300)
          .optional()
          .default(60)
          .describe("Maximum time to allow this command to run."),
      }),
    }
  )
}

export function createSandboxGetHostTool({
  getSandboxContext,
  sessionId,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
}) {
  return tool(
    async ({ port }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox, sandboxId } = await getSandboxContext()
          const host = sandbox.getHost(port)
          const hostWithScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(host)
            ? host
            : `https://${host}`
          const websocketUrl = hostWithScheme.replace(/^http/i, "ws")

          return [
            "Sandbox host resolved.",
            `Sandbox ID: ${sandboxId}`,
            `Port: ${port}`,
            `Host: ${host}`,
            `URL: ${hostWithScheme}`,
            `WebSocket URL: ${websocketUrl}`,
            `Make sure the service inside the sandbox is listening on 0.0.0.0:${port}.`,
          ].join("\n")
        })
      } catch (error) {
        return `sandbox_get_host failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "sandbox_get_host",
      description:
        "Resolve the public host address for a port in this chat session's persistent AstraFlow Sandbox. This wraps sandbox.getHost(port), equivalent to sandbox.get_host(port). Use it after starting a web server or WebSocket server inside the sandbox. The service must listen on 0.0.0.0:<port>; localhost or 127.0.0.1 listeners are not reachable through the sandbox proxy. Long-lived servers should run in a detached tmux session, not as a foreground command.",
      schema: z.object({
        port: z
          .number()
          .int()
          .min(1)
          .max(65_535)
          .describe("Port number inside the sandbox to expose."),
      }),
    }
  )
}

export function createUploadFileTool({
  sessionId,
  apiKey,
}: {
  sessionId: string
  apiKey: string
}) {
  return tool(
    async ({ file_id, name }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const result = await uploadSessionFileToSandbox({
            sessionId,
            apiKey,
            fileId: file_id,
            name,
          })

          return [
            `Uploaded file: ${result.file.originalName}`,
            `File ID: ${result.file.id}`,
            `Sandbox ID: ${result.sandboxId}`,
            `Sandbox path: ${result.file.sandboxPath}`,
            result.file.mimeType ? `MIME: ${result.file.mimeType}` : null,
            typeof result.file.size === "number"
              ? `Bytes: ${result.file.size}`
              : null,
          ]
            .filter(Boolean)
            .join("\n")
        })
      } catch (error) {
        return `upload_file failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "upload_file",
      description:
        "Upload exactly one local session file into AstraFlow Sandbox on demand. Use this before analyzing uploaded PDFs, Word documents, spreadsheets, CSVs, or other files in run_code. Prefer file_id from the session file manifest; name is a fallback and must uniquely identify a file.",
      schema: z
        .object({
          file_id: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe("The file_id from the session file manifest."),
          name: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe("Fallback file name when file_id is unavailable."),
        })
        .refine((value) => Boolean(value.file_id || value.name), {
          message: "file_id or name is required.",
        }),
    }
  )
}

export function createListFilesTool({
  getSandboxContext,
  sessionId,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
}) {
  return tool(
    async ({ path }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox } = await getSandboxContext()
          const directory = normalizeSandboxFilePath(
            path?.trim() || "/home/user/astraflow",
            { relativeBase: "/home/user/astraflow" }
          )
          const entries = await sandbox.files.list(directory, {
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })

          if (!entries.length) {
            return `No files found in ${directory}`
          }

          return [
            `Files in ${directory}:`,
            ...entries.map((entry) =>
              [
                `- ${entry.name}`,
                `type: ${entry.type ?? "unknown"}`,
                `path: ${entry.path}`,
                `bytes: ${entry.size}`,
              ].join(" | ")
            ),
          ].join("\n")
        })
      } catch (error) {
        return `list_files failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "list_files",
      description:
        "List files in AstraFlow Sandbox. Use this to inspect uploaded files and generated outputs.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .optional()
          .describe("Directory to list. Defaults to /home/user/astraflow."),
      }),
    }
  )
}

export function createReadFileTool({
  getSandboxContext,
  sessionId,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
}) {
  return tool(
    async ({ path, offset_bytes, max_bytes, mode }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox } = await getSandboxContext()
          const sandboxPath = normalizeSandboxFilePath(path, {
            relativeBase: "/home/user/astraflow",
          })
          const bytes = await sandbox.files.read(sandboxPath, {
            format: "bytes",
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
          const offset = clampReadOffset(offset_bytes)
          const limit = clampReadBytes(max_bytes)
          const end = Math.min(offset + limit, bytes.byteLength)
          const slice = bytes.slice(offset, end)
          const text = new TextDecoder("utf-8", { fatal: false }).decode(slice)
          const isBinary = slice.includes(0)
          const content =
            mode === "summary"
              ? summarizeTextContent(text)
              : isBinary
                ? "Binary-looking content. Use run_code with an appropriate parser instead of read_file for this file."
                : text

          return [
            `Read file: ${sandboxPath}`,
            `Bytes: ${bytes.byteLength}`,
            `SHA256: ${sha256Bytes(bytes)}`,
            `Returned bytes: ${offset}-${end} of ${bytes.byteLength}`,
            end < bytes.byteLength
              ? `More content is available. Call read_file with offset_bytes=${end}.`
              : "End of file reached.",
            "",
            content,
          ].join("\n")
        })
      } catch (error) {
        return `read_file failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "read_file",
      description:
        "Read a bounded page or summary of a text-like file from AstraFlow Sandbox. Returns SHA256 so write_file can safely overwrite later. For PDFs, Word documents, spreadsheets, or binary data, prefer run_code with Python libraries to parse the file.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Sandbox file path under /home/user/astraflow. Relative paths are resolved under /home/user/astraflow."
          ),
        offset_bytes: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .default(0)
          .describe("Byte offset for paginated reads."),
        max_bytes: z
          .number()
          .int()
          .min(1)
          .max(SANDBOX_FILE_READ_MAX_BYTES)
          .optional()
          .default(SANDBOX_FILE_READ_DEFAULT_BYTES)
          .describe("Maximum bytes to return. Hard-capped at 120 KB."),
        mode: z
          .enum(["page", "summary"])
          .optional()
          .default("page")
          .describe(
            "page returns the requested byte page; summary returns metadata plus representative lines."
          ),
      }),
    }
  )
}

export function createWriteFileTool({
  getSandboxContext,
  sessionId,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
}) {
  return tool(
    async ({ path, content, expected_sha256 }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox } = await getSandboxContext()
          const sandboxPath = normalizeSandboxOutputPath(path)

          try {
            const existing = await sandbox.files.read(sandboxPath, {
              format: "bytes",
              requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
            })
            const currentHash = sha256Bytes(existing)

            if (!expected_sha256 || expected_sha256 !== currentHash) {
              return [
                `write_file refused to overwrite existing file: ${sandboxPath}`,
                `Current SHA256: ${currentHash}`,
                "Call read_file first, then retry write_file with expected_sha256 equal to the current SHA256 if overwriting is intended.",
              ].join("\n")
            }
          } catch {
            // Missing file is fine; write creates it.
          }

          await sandbox.files.write(sandboxPath, content, {
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })

          return [
            `Wrote file: ${sandboxPath}`,
            `Bytes: ${new TextEncoder().encode(content).byteLength}`,
            `SHA256: ${sha256Bytes(content)}`,
            `Use download_file with this path if the user should download it.`,
          ].join("\n")
        })
      } catch (error) {
        return `write_file failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "write_file",
      description:
        "Write a text file inside AstraFlow Sandbox. Relative paths are written under the sandbox outputs directory. Existing files are protected: call read_file first and pass expected_sha256 to overwrite.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe(
            `Absolute sandbox path or relative path under ${getSessionSandboxOutputRoot()}.`
          ),
        content: z.string().describe("Text content to write."),
        expected_sha256: z
          .string()
          .trim()
          .regex(/^[a-f0-9]{64}$/i)
          .optional()
          .describe(
            "Required to overwrite an existing file. Use SHA256 returned by read_file."
          ),
      }),
    }
  )
}

export function createDownloadFileTool({
  getSandboxContext,
  sessionId,
}: {
  getSandboxContext: () => Promise<SessionSandboxContext>
  sessionId: string
}) {
  return tool(
    async ({ path, name, mime_type }) => {
      try {
        return await withStudioSessionLock(sessionId, async () => {
          const { sandbox } = await getSandboxContext()
          const sandboxPath = normalizeSandboxFilePath(path, {
            relativeBase: getSessionSandboxOutputRoot(),
          })
          const bytes = await sandbox.files.read(sandboxPath, {
            format: "bytes",
            requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
          })
          const fileName =
            name?.trim() || path.split("/").filter(Boolean).at(-1) || "download"
          const storagePath = createGeneratedStoragePath({
            sessionId,
            name: fileName,
          })
          const buffer = Buffer.from(bytes)

          writeStudioFile(storagePath, buffer)
          const file = createStudioSessionFile({
            sessionId,
            kind: "generated",
            originalName: fileName,
            mimeType: mime_type?.trim() || "application/octet-stream",
            size: buffer.byteLength,
            storagePath,
            sandboxPath,
            savedAt: new Date().toISOString(),
          })

          if (!file) {
            return "download_file failed: file metadata could not be saved."
          }

          return [
            `Saved sandbox file for download: ${file.originalName}`,
            `Sandbox path: ${sandboxPath}`,
            `Bytes: ${buffer.byteLength}`,
            `SHA256: ${sha256Bytes(buffer)}`,
            `Download: [${file.originalName}](/api/studio/files/${file.id}/content?download=1)`,
          ].join("\n")
        })
      } catch (error) {
        return `download_file failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "download_file",
      description:
        "Make a sandbox file downloadable by saving it to AstraFlow's local file library. Use after generating reports, CSVs, plots, PDFs, or other output files the user may want.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Sandbox file path under /home/user/astraflow. Relative paths are resolved under /home/user/astraflow/outputs."
          ),
        name: z
          .string()
          .trim()
          .optional()
          .describe("Download filename to show in the file library."),
        mime_type: z
          .string()
          .trim()
          .optional()
          .describe("Optional MIME type for the downloaded file."),
      }),
    }
  )
}
