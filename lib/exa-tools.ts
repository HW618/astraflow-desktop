import { tool } from "langchain"
import type { StructuredToolInterface } from "@langchain/core/tools"
import { createHash } from "node:crypto"
import { z } from "zod"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import TurndownService from "turndown"

import { createModelverseChatModel } from "@/lib/modelverse-langchain"
import {
  E2B_CODE_INTERPRETER_LANGUAGES,
  E2B_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS,
  E2B_REQUEST_TIMEOUT_MS,
  runCommandInE2BSandbox,
  runCodeInE2BSandbox,
} from "@/lib/e2b-code-interpreter"
import {
  createStudioSessionFile,
  getStudioExaApiKey,
  getStudioModelverseApiKey,
} from "@/lib/studio-db"
import {
  getSessionSandboxRoot,
  getSessionSandboxOutputRoot,
  getOrCreateSessionSandbox,
  normalizeSandboxFilePath,
  normalizeSandboxOutputPath,
  uploadSessionFileToSandbox,
  type SessionSandboxContext,
} from "@/lib/e2b-session-sandbox"
import {
  createGeneratedStoragePath,
  writeStudioFile,
} from "@/lib/studio-file-storage"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

const EXA_SEARCH_URL = "https://api.exa.ai/search"
const MAX_WEB_SEARCH_RESULTS = 8
const WEB_FETCH_TIMEOUT_MS = 60_000
const WEB_FETCH_MAX_BYTES = 10 * 1024 * 1024
const WEB_FETCH_MAX_PROMPT_CHARS = 100_000
const WEB_FETCH_FALLBACK_CHARS = 40_000
const SANDBOX_FILE_READ_DEFAULT_BYTES = 32 * 1024
const SANDBOX_FILE_READ_MAX_BYTES = 120 * 1024
const SANDBOX_FILE_SUMMARY_LINES = 80
const SANDBOX_COMMAND_ENV_MAX_VARS = 40

const exaSearchTypeSchema = z
  .enum(["instant", "fast", "auto", "deep-lite", "deep", "deep-reasoning"])
  .default("auto")

type ExaSearchResult = {
  title?: string
  url?: string
  publishedDate?: string | null
  author?: string | null
  summary?: string
  highlights?: string[]
}

type ExaSearchResponse = {
  requestId?: string
  results?: ExaSearchResult[]
  costDollars?: {
    total?: number
  }
}

type FetchedWebContent = {
  url: string
  contentType: string
  markdown: string
}

type StudioAgentToolsOptions = {
  sessionId?: string
  modelverseApiKey?: string | null
}

function clampResultCount(numResults: number | undefined) {
  if (!numResults || Number.isNaN(numResults)) {
    return 5
  }

  return Math.min(Math.max(Math.trunc(numResults), 1), MAX_WEB_SEARCH_RESULTS)
}

function normalizeDomains(domains: string[] | undefined) {
  const normalized = (domains ?? [])
    .map((domain) => domain.trim())
    .filter(Boolean)

  return normalized.length > 0 ? normalized : undefined
}

function formatResult(result: ExaSearchResult, index: number) {
  const title = result.title?.trim() || "Untitled"
  const url = result.url?.trim() || "No URL"
  const publishedDate = result.publishedDate
    ? `\nPublished: ${result.publishedDate}`
    : ""
  const author = result.author ? `\nAuthor: ${result.author}` : ""
  const summary = result.summary?.trim()
    ? `\nSummary: ${result.summary.trim()}`
    : ""
  const highlights = result.highlights?.length
    ? `\nHighlights:\n${result.highlights
        .slice(0, 3)
        .map((highlight) => `- ${highlight}`)
        .join("\n")}`
    : ""

  return `${index + 1}. ${title}\nURL: ${url}${publishedDate}${author}${summary}${highlights}`
}

export function getStoredExaApiKey() {
  return getStudioExaApiKey()?.key ?? null
}

function normalizeWebFetchUrl(url: string) {
  const trimmed = url.trim()
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  return withProtocol.replace(/^http:\/\//i, "https://")
}

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
  const nonEmpty = lines.filter((line) => line.trim()).slice(
    0,
    SANDBOX_FILE_SUMMARY_LINES
  )

  return [
    `Lines: ${lines.length}`,
    "",
    "Preview lines:",
    ...nonEmpty,
  ].join("\n")
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

async function readResponseText(response: Response) {
  const contentLength = Number(response.headers.get("content-length"))

  if (Number.isFinite(contentLength) && contentLength > WEB_FETCH_MAX_BYTES) {
    throw new Error("Fetched content is larger than the 10 MB limit.")
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer()

    if (buffer.byteLength > WEB_FETCH_MAX_BYTES) {
      throw new Error("Fetched content is larger than the 10 MB limit.")
    }

    return new TextDecoder("utf-8").decode(buffer)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    totalBytes += value.byteLength

    if (totalBytes > WEB_FETCH_MAX_BYTES) {
      await reader.cancel()
      throw new Error("Fetched content is larger than the 10 MB limit.")
    }

    chunks.push(value)
  }

  const buffer = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder("utf-8").decode(buffer)
}

function markdownFromHtml(html: string) {
  const turndown = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  })

  return turndown.turndown(html)
}

function cleanFetchedMarkdown(markdown: string) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

async function fetchWebContent(url: string): Promise<FetchedWebContent> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(normalizeWebFetchUrl(url), {
      headers: {
        "User-Agent": "AstraFlow-WebFetch/1.0",
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }

    const contentType = response.headers.get("content-type") ?? ""
    const text = await readResponseText(response)
    const markdown = contentType.includes("text/html")
      ? markdownFromHtml(text)
      : text

    return {
      url: response.url,
      contentType,
      markdown: cleanFetchedMarkdown(markdown),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function messageContentToText(content: unknown) {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part
      }

      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text
      }

      return ""
    })
    .filter(Boolean)
    .join("\n")
}

async function applyPromptToFetchedContent(
  fetched: FetchedWebContent,
  prompt: string
) {
  const content = fetched.markdown.slice(0, WEB_FETCH_MAX_PROMPT_CHARS)

  try {
    const model = createModelverseChatModel("gpt-5.4-mini", "none")
    const result = await model.invoke([
      new SystemMessage(
        [
          "You extract useful information from fetched web page content.",
          "Follow the user's prompt exactly.",
          "Answer only from the provided page content.",
          "Include the source URL when the answer depends on the page.",
        ].join(" ")
      ),
      new HumanMessage(
        [
          `Source URL: ${fetched.url}`,
          `Content-Type: ${fetched.contentType || "unknown"}`,
          `User prompt: ${prompt}`,
          "",
          "Fetched page content:",
          content,
        ].join("\n")
      ),
    ])
    const text = messageContentToText(result.content).trim()

    if (text) {
      return text
    }
  } catch {
    // Return the fetched content excerpt below so the main model can continue.
  }

  return [
    "Prompt processing was unavailable. Here is the fetched page content excerpt:",
    fetched.markdown.slice(0, WEB_FETCH_FALLBACK_CHARS),
  ].join("\n\n")
}

export function createExaWebSearchTool(apiKey: string) {
  return tool(
    async ({
      query,
      numResults,
      type,
      includeDomains,
      excludeDomains,
    }) => {
      const resultCount = clampResultCount(numResults)
      const response = await fetch(EXA_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          query,
          type,
          numResults: resultCount,
          includeDomains: normalizeDomains(includeDomains),
          excludeDomains: normalizeDomains(excludeDomains),
          contents: {
            highlights: {
              maxCharacters: 1200,
            },
            summary: {
              query: "Summarize the facts most relevant to the search query.",
            },
          },
        }),
      })

      if (!response.ok) {
        return `web_search failed with HTTP ${response.status}: ${await response.text()}`
      }

      const data = (await response.json()) as ExaSearchResponse
      const results = data.results?.slice(0, resultCount) ?? []

      if (results.length === 0) {
        return `No web search results found for: ${query}`
      }

      const cost = data.costDollars?.total
      const costLine =
        typeof cost === "number" ? `\nEstimated cost: $${cost}` : ""

      return [
        `Web search results for: ${query}`,
        `Request ID: ${data.requestId ?? "unknown"}${costLine}`,
        ...results.map(formatResult),
      ].join("\n\n")
    },
    {
      name: "web_search",
      description:
        "Search the web with Exa and return grounded results with titles, URLs, publication dates, summaries, and highlights. Use for current events, recent facts, source-backed answers, or when the user asks to search the web.",
      schema: z.object({
        query: z.string().min(1).describe("The web search query."),
        numResults: z
          .number()
          .int()
          .min(1)
          .max(MAX_WEB_SEARCH_RESULTS)
          .optional()
          .default(5)
          .describe("Number of search results to return."),
        type: exaSearchTypeSchema.describe(
          "Exa search mode. Use auto for most searches, fast for interactive latency, and deep/deep-reasoning for harder research."
        ),
        includeDomains: z
          .array(z.string())
          .optional()
          .describe("Optional domains to include, such as ['openai.com']."),
        excludeDomains: z
          .array(z.string())
          .optional()
          .describe("Optional domains to exclude."),
      }),
    }
  )
}

export function createWebFetchTool() {
  return tool(
    async ({ url, prompt }) => {
      try {
        const fetched = await fetchWebContent(url)
        const answer = await applyPromptToFetchedContent(fetched, prompt)

        return [
          `Web fetch result for: ${url}`,
          `Fetched URL: ${fetched.url}`,
          `Prompt: ${prompt}`,
          "",
          answer,
        ].join("\n")
      } catch (error) {
        return `web_fetch failed for ${url}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "web_fetch",
      description:
        "Fetch a specific URL, convert the page content into readable Markdown, and answer or extract information from it using the provided prompt. Use when the user gives a URL or asks to read, summarize, or extract from a specific page.",
      schema: z.object({
        url: z.string().min(1).describe("The URL to fetch."),
        prompt: z
          .string()
          .min(1)
          .describe("What to extract, summarize, or answer from the page."),
      }),
    }
  )
}

function createSessionSandboxGetter({
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

          return runCodeInE2BSandbox({
            sandbox,
            code,
            language,
            timeoutSeconds: timeout_seconds,
            lifecycleLine: "Auto pause: true",
            cleanupLine: `Lifecycle: session sandbox ${sandboxId} is reused for this chat session and will auto-pause after ${E2B_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS}s of inactivity with memory and filesystem preserved.`,
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
        "Run code in this chat session's persistent E2B code-interpreter-v1 sandbox. Supported languages are python, javascript, typescript, bash, r, and java. The sandbox automatically pauses after inactivity and auto-resumes on later traffic with memory and filesystem preserved. Uploaded session files are available at their sandbox paths.",
      schema: z.object({
        code: z.string().min(1).describe("The code to execute."),
        language: z
          .enum(E2B_CODE_INTERPRETER_LANGUAGES)
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

          return runCommandInE2BSandbox({
            sandbox,
            command,
            cwd: workingDirectory,
            env: normalizeCommandEnv(env),
            timeoutSeconds: timeout_seconds,
            lifecycleLine: "Auto pause: true",
            cleanupLine: `Lifecycle: session sandbox ${sandboxId} is reused for this chat session and will auto-pause after ${E2B_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS}s of inactivity with memory and filesystem preserved.`,
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
        "Run a shell command in this chat session's persistent E2B sandbox via sandbox.commands.run. Commands execute with /bin/bash -l -c. Use this for bash utilities, package or environment inspection, shell pipelines, and filesystem operations under /home/user/astraflow. Prefer run_code for calculations, data processing, and language-specific scripts.",
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
        "Upload exactly one local session file into the code interpreter sandbox on demand. Use this before analyzing uploaded PDFs, Word documents, spreadsheets, CSVs, or other files in run_code. Prefer file_id from the session file manifest; name is a fallback and must uniquely identify a file.",
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
            requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
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
        "List files in the session code interpreter sandbox. Use this to inspect uploaded files and generated outputs.",
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
            requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
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
        "Read a bounded page or summary of a text-like file from the session sandbox. Returns SHA256 so write_file can safely overwrite later. For PDFs, Word documents, spreadsheets, or binary data, prefer run_code with Python libraries to parse the file.",
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
          .describe("page returns the requested byte page; summary returns metadata plus representative lines."),
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
              requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
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
            requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
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
        "Write a text file inside the session sandbox. Relative paths are written under the sandbox outputs directory. Existing files are protected: call read_file first and pass expected_sha256 to overwrite.",
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
            requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
          })
          const fileName =
            name?.trim() ||
            path
              .split("/")
              .filter(Boolean)
              .at(-1) ||
            "download"
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

export function createStudioAgentTools(options: StudioAgentToolsOptions = {}) {
  const exaApiKey = getStoredExaApiKey()
  const modelverseApiKey =
    options.modelverseApiKey ?? getStudioModelverseApiKey()?.key
  const tools: StructuredToolInterface[] = [createWebFetchTool()]

  if (exaApiKey) {
    tools.push(createExaWebSearchTool(exaApiKey))
  }

  if (modelverseApiKey && options.sessionId) {
    const getSandboxContext = createSessionSandboxGetter({
      sessionId: options.sessionId,
      apiKey: modelverseApiKey,
    })

    tools.push(
      createUploadFileTool({
        sessionId: options.sessionId,
        apiKey: modelverseApiKey,
      }),
      createCodeInterpreterTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createRunCommandTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createListFilesTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createReadFileTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createWriteFileTool({
        getSandboxContext,
        sessionId: options.sessionId,
      }),
      createDownloadFileTool({
        getSandboxContext,
        sessionId: options.sessionId,
      })
    )
  }

  return tools
}
