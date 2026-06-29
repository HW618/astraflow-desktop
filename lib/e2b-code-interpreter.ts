import {
  CommandExitError,
  Sandbox,
  type CommandResult,
  type Execution,
  type RunCodeLanguage,
  type SandboxOpts,
} from "@e2b/code-interpreter"

export const E2B_CODE_INTERPRETER_TEMPLATE = "code-interpreter-v1"
export const E2B_DEFAULT_DOMAIN = "cn-wlcb.sandbox.ucloudai.com"
export const E2B_REQUEST_TIMEOUT_MS = 30_000
export const E2B_DEFAULT_RUN_TIMEOUT_SECONDS = 60
export const E2B_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS = 300
const E2B_MAX_OUTPUT_CHARS = 18_000
const E2B_MAX_SECTION_CHARS = 8_000

export const E2B_CODE_INTERPRETER_LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "bash",
  "r",
  "java",
] as const

export type E2BCodeInterpreterLanguage =
  (typeof E2B_CODE_INTERPRETER_LANGUAGES)[number]

export type RunE2BCodeInput = {
  apiKey: string
  code: string
  language: E2BCodeInterpreterLanguage
  autoPause: boolean
  sandboxId?: string
  timeoutSeconds?: number
  autoPauseTimeoutSeconds?: number
}

export type RunE2BCommandInput = {
  sandbox: Sandbox
  command: string
  cwd?: string
  env?: Record<string, string>
  timeoutSeconds?: number
  lifecycleLine: string
  cleanupLine: string
}

export type E2BConnectionOptions = Pick<
  SandboxOpts,
  | "apiKey"
  | "validateApiKey"
  | "domain"
  | "apiUrl"
  | "sandboxUrl"
  | "requestTimeoutMs"
>

function normalizeDomain(value: string | undefined) {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^\*\./, "")
    .replace(/\/+$/, "")
}

function normalizeUrl(value: string | undefined) {
  const trimmed = value?.trim()

  return trimmed || undefined
}

export function getE2BConnectionOptions(apiKey: string): E2BConnectionOptions {
  const options: E2BConnectionOptions = {
    apiKey,
    validateApiKey: false,
    requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
  }
  const domain = normalizeDomain(process.env.E2B_DOMAIN ?? E2B_DEFAULT_DOMAIN)
  const apiUrl = normalizeUrl(process.env.E2B_API_URL)
  const sandboxUrl = normalizeUrl(process.env.E2B_SANDBOX_URL)

  if (domain) {
    options.domain = domain
  }

  if (apiUrl) {
    options.apiUrl = apiUrl
  }

  if (sandboxUrl) {
    options.sandboxUrl = sandboxUrl
  }

  return options
}

function clampSeconds(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  if (!value || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(Math.max(Math.trunc(value), min), max)
}

export function clampE2BSeconds(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  return clampSeconds(value, fallback, min, max)
}

function truncateText(text: string, maxChars = E2B_MAX_SECTION_CHARS) {
  if (text.length <= maxChars) {
    return text
  }

  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`
}

function codeFence(label: string, text: string) {
  return ["```" + label, text.replaceAll("```", "`\\`\\`"), "```"].join("\n")
}

function stringifyExecutionResult(
  result: Execution["results"][number],
  index: number
) {
  if (result.text) {
    return `Result ${index + 1}:\n${truncateText(result.text)}`
  }

  if (result.markdown) {
    return `Result ${index + 1} (markdown):\n${truncateText(result.markdown)}`
  }

  if (result.json) {
    return `Result ${index + 1} (json):\n${truncateText(result.json)}`
  }

  if (result.html) {
    return `Result ${index + 1} (html):\n${truncateText(result.html)}`
  }

  if (result.png || result.jpeg || result.svg || result.pdf) {
    return `Result ${index + 1}: binary or rich media output was produced and is not inlined in chat.`
  }

  try {
    return `Result ${index + 1}:\n${truncateText(
      JSON.stringify(result.toJSON(), null, 2)
    )}`
  } catch {
    return ""
  }
}

function formatExecution({
  execution,
  language,
  sandboxId,
  lifecycleLine,
  cleanupLine,
}: {
  execution: Execution
  language: E2BCodeInterpreterLanguage
  sandboxId: string
  lifecycleLine: string
  cleanupLine: string
}) {
  const sections = [
    "Code interpreter execution complete.",
    `Template: ${E2B_CODE_INTERPRETER_TEMPLATE}`,
    `Sandbox ID: ${sandboxId}`,
    `Language: ${language}`,
    lifecycleLine,
    cleanupLine,
  ]
  const stdout = execution.logs.stdout.join("\n").trim()
  const stderr = execution.logs.stderr.join("\n").trim()
  const resultText = execution.results
    .map((result, index) => stringifyExecutionResult(result, index))
    .filter(Boolean)
    .join("\n\n")

  if (stdout) {
    sections.push(`STDOUT:\n${codeFence("text", truncateText(stdout))}`)
  }

  if (stderr) {
    sections.push(`STDERR:\n${codeFence("text", truncateText(stderr))}`)
  }

  if (resultText) {
    sections.push(`RESULTS:\n${truncateText(resultText)}`)
  }

  if (execution.error) {
    sections.push(
      [
        "ERROR:",
        `${execution.error.name}: ${execution.error.value}`,
        truncateText(execution.error.traceback),
      ].join("\n")
    )
  }

  return truncateText(sections.join("\n\n"), E2B_MAX_OUTPUT_CHARS)
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

function formatCommandExecution({
  command,
  cwd,
  result,
  sandboxId,
  lifecycleLine,
  cleanupLine,
}: {
  command: string
  cwd?: string
  result: CommandResult
  sandboxId: string
  lifecycleLine: string
  cleanupLine: string
}) {
  const sections = [
    "Shell command execution complete.",
    `Template: ${E2B_CODE_INTERPRETER_TEMPLATE}`,
    `Sandbox ID: ${sandboxId}`,
    `Command: ${command}`,
    cwd ? `Working directory: ${cwd}` : "Working directory: sandbox default",
    `Exit code: ${result.exitCode}`,
    lifecycleLine,
    cleanupLine,
  ]
  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()

  if (stdout) {
    sections.push(`STDOUT:\n${codeFence("text", truncateText(stdout))}`)
  }

  if (stderr) {
    sections.push(`STDERR:\n${codeFence("text", truncateText(stderr))}`)
  }

  if (result.error) {
    sections.push(`ERROR:\n${truncateText(result.error)}`)
  }

  return truncateText(sections.join("\n\n"), E2B_MAX_OUTPUT_CHARS)
}

export async function runE2BCode({
  apiKey,
  code,
  language,
  autoPause,
  sandboxId,
  timeoutSeconds,
  autoPauseTimeoutSeconds,
}: RunE2BCodeInput) {
  const runTimeoutSeconds = clampSeconds(
    timeoutSeconds,
    E2B_DEFAULT_RUN_TIMEOUT_SECONDS,
    1,
    300
  )
  const autoPauseSeconds = clampSeconds(
    autoPauseTimeoutSeconds,
    E2B_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS,
    60,
    3_600
  )
  const runTimeoutMs = runTimeoutSeconds * 1000
  const autoPauseTimeoutMs = autoPauseSeconds * 1000
  const oneShotTimeoutMs = Math.max(runTimeoutMs + 30_000, 60_000)
  const connectionOptions = getE2BConnectionOptions(apiKey)
  let sandbox: Sandbox | null = null
  let killed = false

  try {
    sandbox = sandboxId
      ? await Sandbox.connect(sandboxId, {
          ...connectionOptions,
          timeoutMs: autoPause ? autoPauseTimeoutMs : oneShotTimeoutMs,
        })
      : await Sandbox.create(E2B_CODE_INTERPRETER_TEMPLATE, {
          ...connectionOptions,
          timeoutMs: autoPause ? autoPauseTimeoutMs : oneShotTimeoutMs,
          lifecycle: autoPause
            ? {
                onTimeout: { action: "pause", keepMemory: true },
                autoResume: true,
              }
            : { onTimeout: "kill" },
          metadata: {
            app: "astraflow-desktop",
            tool: "run_code",
          },
        })

    if (autoPause && sandboxId) {
      await sandbox.setTimeout(autoPauseTimeoutMs, {
        requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
      })
    }

    const execution = await sandbox.runCode(code, {
      language: language as RunCodeLanguage,
      timeoutMs: runTimeoutMs,
      requestTimeoutMs: Math.max(runTimeoutMs + 10_000, E2B_REQUEST_TIMEOUT_MS),
    })

    let cleanupLine = autoPause
      ? `Lifecycle: auto-pause enabled; sandbox will pause after ${autoPauseSeconds}s of timeout and can auto-resume on traffic with memory and filesystem preserved.`
      : "Lifecycle: one-shot execution."

    if (!autoPause) {
      killed = await sandbox.kill({
        requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
      })
      cleanupLine = killed
        ? "Cleanup: sandbox killed after code execution."
        : "Cleanup: sandbox was already stopped or could not be found."
    }

    return formatExecution({
      execution,
      language,
      sandboxId: sandbox.sandboxId,
      lifecycleLine: autoPause
        ? "Auto pause: true"
        : "Auto pause: false",
      cleanupLine,
    })
  } finally {
    if (sandbox && !autoPause && !killed) {
      await sandbox.kill({ requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS }).catch(
        () => undefined
      )
    }
  }
}

export async function runCodeInE2BSandbox({
  sandbox,
  code,
  language,
  timeoutSeconds,
  lifecycleLine,
  cleanupLine,
}: {
  sandbox: Sandbox
  code: string
  language: E2BCodeInterpreterLanguage
  timeoutSeconds?: number
  lifecycleLine: string
  cleanupLine: string
}) {
  const runTimeoutSeconds = clampSeconds(
    timeoutSeconds,
    E2B_DEFAULT_RUN_TIMEOUT_SECONDS,
    1,
    300
  )
  const runTimeoutMs = runTimeoutSeconds * 1000
  const execution = await sandbox.runCode(code, {
    language: language as RunCodeLanguage,
    timeoutMs: runTimeoutMs,
    requestTimeoutMs: Math.max(runTimeoutMs + 10_000, E2B_REQUEST_TIMEOUT_MS),
  })

  return formatExecution({
    execution,
    language,
    sandboxId: sandbox.sandboxId,
    lifecycleLine,
    cleanupLine,
  })
}

export async function runCommandInE2BSandbox({
  sandbox,
  command,
  cwd,
  env,
  timeoutSeconds,
  lifecycleLine,
  cleanupLine,
}: RunE2BCommandInput) {
  const runTimeoutSeconds = clampSeconds(
    timeoutSeconds,
    E2B_DEFAULT_RUN_TIMEOUT_SECONDS,
    1,
    300
  )
  const runTimeoutMs = runTimeoutSeconds * 1000
  let result: CommandResult

  try {
    result = await sandbox.commands.run(command, {
      cwd,
      envs: env,
      timeoutMs: runTimeoutMs,
      requestTimeoutMs: Math.max(runTimeoutMs + 10_000, E2B_REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const commandResult = normalizeCommandResult(error)

    if (!commandResult) {
      throw error
    }

    result = commandResult
  }

  return formatCommandExecution({
    command,
    cwd,
    result,
    sandboxId: sandbox.sandboxId,
    lifecycleLine,
    cleanupLine,
  })
}
