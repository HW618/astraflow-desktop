import {
  CommandExitError,
  Sandbox,
  type CommandResult,
  type Execution,
  type RunCodeLanguage,
  type SandboxOpts,
} from "@e2b/code-interpreter"

const ASTRAFLOW_SANDBOX_DEFAULT_TEMPLATE = "ry2jck30zrnfwtm1fihv"

export const ASTRAFLOW_SANDBOX_TEMPLATE =
  process.env.ASTRAFLOW_SANDBOX_TEMPLATE?.trim() ??
  process.env.E2B_TEMPLATE?.trim() ??
  ASTRAFLOW_SANDBOX_DEFAULT_TEMPLATE
export const ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN = "cn-wlcb.sandbox.ucloudai.com"
export const ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS = 30_000
export const ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS = 60
export const ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS = 300
const ASTRAFLOW_SANDBOX_MAX_OUTPUT_CHARS = 18_000
const ASTRAFLOW_SANDBOX_MAX_SECTION_CHARS = 8_000

export const ASTRAFLOW_SANDBOX_ENV = {
  domain: "ASTRAFLOW_SANDBOX_DOMAIN",
  apiUrl: "ASTRAFLOW_SANDBOX_API_URL",
  sandboxUrl: "ASTRAFLOW_SANDBOX_URL",
  sessionAutoPauseTimeoutSeconds:
    "ASTRAFLOW_SANDBOX_SESSION_AUTO_PAUSE_TIMEOUT_SECONDS",
} as const

const LEGACY_SANDBOX_ENV: Record<keyof typeof ASTRAFLOW_SANDBOX_ENV, string> = {
  domain: "E2B_DOMAIN",
  apiUrl: "E2B_API_URL",
  sandboxUrl: "E2B_SANDBOX_URL",
  sessionAutoPauseTimeoutSeconds: "E2B_SESSION_AUTO_PAUSE_TIMEOUT_SECONDS",
}

export const ASTRAFLOW_SANDBOX_CODE_LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "bash",
  "r",
  "java",
] as const

export type AstraFlowSandboxCodeLanguage =
  (typeof ASTRAFLOW_SANDBOX_CODE_LANGUAGES)[number]

export type RunAstraFlowSandboxCodeInput = {
  apiKey: string
  code: string
  language: AstraFlowSandboxCodeLanguage
  autoPause: boolean
  sandboxId?: string
  timeoutSeconds?: number
  autoPauseTimeoutSeconds?: number
}

export type RunAstraFlowSandboxCommandInput = {
  sandbox: Sandbox
  command: string
  cwd?: string
  env?: Record<string, string>
  timeoutSeconds?: number
  lifecycleLine: string
  cleanupLine: string
}

export type AstraFlowSandboxConnectionOptions = Pick<
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

export function readAstraFlowSandboxEnv(
  name: keyof typeof ASTRAFLOW_SANDBOX_ENV
) {
  const value =
    process.env[ASTRAFLOW_SANDBOX_ENV[name]] ??
    process.env[LEGACY_SANDBOX_ENV[name]]
  const trimmed = value?.trim()

  return trimmed || undefined
}

export function getAstraFlowSandboxConnectionOptions(
  apiKey: string
): AstraFlowSandboxConnectionOptions {
  const options: AstraFlowSandboxConnectionOptions = {
    apiKey,
    validateApiKey: false,
    requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  }
  const domain = normalizeDomain(
    readAstraFlowSandboxEnv("domain") ?? ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN
  )
  const apiUrl = normalizeUrl(readAstraFlowSandboxEnv("apiUrl"))
  const sandboxUrl = normalizeUrl(readAstraFlowSandboxEnv("sandboxUrl"))

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

export function clampAstraFlowSandboxSeconds(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  return clampSeconds(value, fallback, min, max)
}

function truncateText(
  text: string,
  maxChars = ASTRAFLOW_SANDBOX_MAX_SECTION_CHARS
) {
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
  language: AstraFlowSandboxCodeLanguage
  sandboxId: string
  lifecycleLine: string
  cleanupLine: string
}) {
  const sections = [
    "AstraFlow Sandbox code execution complete.",
    `Runtime template: ${ASTRAFLOW_SANDBOX_TEMPLATE}`,
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

  return truncateText(sections.join("\n\n"), ASTRAFLOW_SANDBOX_MAX_OUTPUT_CHARS)
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
    "AstraFlow Sandbox shell command complete.",
    `Runtime template: ${ASTRAFLOW_SANDBOX_TEMPLATE}`,
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

  return truncateText(sections.join("\n\n"), ASTRAFLOW_SANDBOX_MAX_OUTPUT_CHARS)
}

export async function runAstraFlowSandboxCode({
  apiKey,
  code,
  language,
  autoPause,
  sandboxId,
  timeoutSeconds,
  autoPauseTimeoutSeconds,
}: RunAstraFlowSandboxCodeInput) {
  const runTimeoutSeconds = clampSeconds(
    timeoutSeconds,
    ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
    1,
    300
  )
  const autoPauseSeconds = clampSeconds(
    autoPauseTimeoutSeconds,
    ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS,
    60,
    3_600
  )
  const runTimeoutMs = runTimeoutSeconds * 1000
  const autoPauseTimeoutMs = autoPauseSeconds * 1000
  const oneShotTimeoutMs = Math.max(runTimeoutMs + 30_000, 60_000)
  const connectionOptions = getAstraFlowSandboxConnectionOptions(apiKey)
  let sandbox: Sandbox | null = null
  let killed = false

  try {
    sandbox = sandboxId
      ? await Sandbox.connect(sandboxId, {
          ...connectionOptions,
          timeoutMs: autoPause ? autoPauseTimeoutMs : oneShotTimeoutMs,
        })
      : await Sandbox.create(ASTRAFLOW_SANDBOX_TEMPLATE, {
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
        requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
      })
    }

    const execution = await sandbox.runCode(code, {
      language: language as RunCodeLanguage,
      timeoutMs: runTimeoutMs,
      requestTimeoutMs: Math.max(
        runTimeoutMs + 10_000,
        ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
      ),
    })

    let cleanupLine = autoPause
      ? `Lifecycle: auto-pause enabled; AstraFlow Sandbox will pause after ${autoPauseSeconds}s of timeout and can auto-resume on traffic with memory and filesystem preserved.`
      : "Lifecycle: one-shot execution."

    if (!autoPause) {
      killed = await sandbox.kill({
        requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
      })
      cleanupLine = killed
        ? "Cleanup: AstraFlow Sandbox killed after code execution."
        : "Cleanup: AstraFlow Sandbox was already stopped or could not be found."
    }

    return formatExecution({
      execution,
      language,
      sandboxId: sandbox.sandboxId,
      lifecycleLine: autoPause ? "Auto pause: true" : "Auto pause: false",
      cleanupLine,
    })
  } finally {
    if (sandbox && !autoPause && !killed) {
      await sandbox
        .kill({ requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS })
        .catch(() => undefined)
    }
  }
}

export async function runCodeInAstraFlowSandbox({
  sandbox,
  code,
  language,
  timeoutSeconds,
  lifecycleLine,
  cleanupLine,
}: {
  sandbox: Sandbox
  code: string
  language: AstraFlowSandboxCodeLanguage
  timeoutSeconds?: number
  lifecycleLine: string
  cleanupLine: string
}) {
  const runTimeoutSeconds = clampSeconds(
    timeoutSeconds,
    ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
    1,
    300
  )
  const runTimeoutMs = runTimeoutSeconds * 1000
  const execution = await sandbox.runCode(code, {
    language: language as RunCodeLanguage,
    timeoutMs: runTimeoutMs,
    requestTimeoutMs: Math.max(
      runTimeoutMs + 10_000,
      ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
    ),
  })

  return formatExecution({
    execution,
    language,
    sandboxId: sandbox.sandboxId,
    lifecycleLine,
    cleanupLine,
  })
}

export async function runCommandInAstraFlowSandbox({
  sandbox,
  command,
  cwd,
  env,
  timeoutSeconds,
  lifecycleLine,
  cleanupLine,
}: RunAstraFlowSandboxCommandInput) {
  const runTimeoutSeconds = clampSeconds(
    timeoutSeconds,
    ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
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
      requestTimeoutMs: Math.max(
        runTimeoutMs + 10_000,
        ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
      ),
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
