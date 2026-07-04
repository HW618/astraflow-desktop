import {
  createAcpClientApp,
  createAcpProcessStream,
  initializeAcpConnection,
  spawnAcpChild,
  type AcpCommandSpec,
} from "@/lib/agent/acp/acp-runtime"
import { ensureAcpWorkspace } from "@/lib/agent/acp/workspace"
import {
  probeClaudeCodeAcpCommand,
  probeCodexAcpCommand,
  probeOpenCodeAcpCommand,
} from "@/lib/agent/adapters/acp-runtimes"

const SMOKE_TIMEOUT_MS = 20 * 1000

type SmokeTarget = {
  id: string
  label: string
  probe: () =>
    | { available: true; command: AcpCommandSpec; detail: string }
    | { available: false; detail: string }
}

const targets: SmokeTarget[] = [
  {
    id: "codex",
    label: "Codex",
    probe: probeCodexAcpCommand,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    probe: probeClaudeCodeAcpCommand,
  },
  {
    id: "opencode",
    label: "OpenCode",
    probe: probeOpenCodeAcpCommand,
  },
]

function commandToString(command: AcpCommandSpec) {
  return [command.command, ...(command.args ?? [])].join(" ")
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function withTimeout<T>(promise: Promise<T>, label: string) {
  let timer: NodeJS.Timeout | null = null

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${SMOKE_TIMEOUT_MS}ms`))
      }, SMOKE_TIMEOUT_MS)
      timer.unref()
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

async function smokeTarget(target: SmokeTarget) {
  const probe = target.probe()

  if (!probe.available) {
    console.log(`${target.id}: unavailable - ${probe.detail}`)
    return
  }

  const workspace = ensureAcpWorkspace(
    `smoke-${target.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  const child = spawnAcpChild(probe.command, workspace)
  let stderr = ""
  const abortController = new AbortController()
  const app = createAcpClientApp({
    debugLabel: `smoke:${target.id}`,
    getSignal: () => abortController.signal,
    sessionId: `smoke:${target.id}`,
    workspace,
  })
  const connection = app.connect(createAcpProcessStream(child))
  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", reject)
  })

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2000)
  })

  try {
    const initialize = await withTimeout(
      Promise.race([initializeAcpConnection(connection), spawnError]),
      `${target.label} initialize`
    )
    const session = await withTimeout(
      Promise.race([
        connection.agent
          .buildSession({
            cwd: workspace,
            mcpServers: [],
          })
          .start(),
        spawnError,
      ]),
      `${target.label} session/new`
    )

    console.log(
      `${target.id}: available - ${commandToString(probe.command)} - ` +
        `protocol=${initialize.protocolVersion} ` +
        `agent=${initialize.agentInfo?.name ?? "unknown"} ` +
        `session=${session.sessionId}`
    )

    session.dispose()
  } catch (error) {
    process.exitCode = 1
    console.log(
      `${target.id}: failed - ${commandToString(probe.command)} - ${errorMessage(error)}`
    )

    if (stderr.trim()) {
      console.log(`${target.id}: stderr - ${stderr.trim()}`)
    }
  } finally {
    connection.close()

    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM")
    }
  }
}

for (const target of targets) {
  await smokeTarget(target)
}

export {}
