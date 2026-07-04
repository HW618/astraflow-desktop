import { spawnSync } from "node:child_process"
import { accessSync, constants, realpathSync } from "node:fs"
import { delimiter, join } from "node:path"

import {
  AcpRuntime,
  type AcpCommandSpec,
  type AcpStdioCommandSpec,
} from "@/lib/agent/acp/acp-runtime"
import {
  registerAgentRuntime,
  type AgentRuntimeInfo,
} from "@/lib/agent/runtime"

type CommandProbe =
  | { available: true; command: AcpCommandSpec; detail: string }
  | { available: false; detail: string }

const ACP_RUNTIME_CAPABILITIES = {
  hitl: true,
  resume: true,
  subagents: false,
  plan: true,
  sandbox: false,
  mcp: false,
  skills: false,
}
const ACP_RUNTIME_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"

let codexProbe: CommandProbe | null = null
let claudeCodeProbe: CommandProbe | null = null
let openCodeProbe: CommandProbe | null = null

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isReadable(path: string) {
  try {
    accessSync(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function executableNames(name: string) {
  return process.platform === "win32"
    ? [`${name}.cmd`, `${name}.exe`, name]
    : [name]
}

function findExecutableOnPath(name: string) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) {
      continue
    }

    for (const executableName of executableNames(name)) {
      const candidate = join(directory, executableName)

      if (isExecutable(candidate)) {
        return realpathSync(candidate)
      }
    }
  }

  return null
}

function resolveNodeModulesBin(name: string) {
  for (const executableName of executableNames(name)) {
    const candidate = join(
      process.cwd(),
      "node_modules",
      ".bin",
      executableName
    )

    if (isExecutable(candidate)) {
      return realpathSync(candidate)
    }
  }

  return null
}

function resolveNodePackageScript(
  packageName: string,
  relativeScriptPath: string
): AcpStdioCommandSpec | null {
  const scriptPath = join(
    process.cwd(),
    "node_modules",
    ...packageName.split("/"),
    relativeScriptPath
  )

  if (!isReadable(scriptPath)) {
    return null
  }

  return {
    command: process.execPath,
    args: [scriptPath],
  }
}

function resolveNodePackageExecutable(
  packageName: string,
  relativeExecutablePath: string
) {
  const executablePath = join(
    process.cwd(),
    "node_modules",
    ...packageName.split("/"),
    relativeExecutablePath
  )

  return isExecutable(executablePath) ? realpathSync(executablePath) : null
}

function getCommandOutput(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 3000,
  })
  const output = [result.stdout, result.stderr].join("\n").trim()

  return output || null
}

function codexCliSupportsAcp(codexPath: string) {
  const help = getCommandOutput(codexPath, ["--help"])

  return Boolean(help?.match(/^\s+acp\b/m))
}

export function probeCodexAcpCommand(): CommandProbe {
  if (codexProbe) {
    return codexProbe
  }

  const codexPath = findExecutableOnPath("codex")

  if (codexPath && codexCliSupportsAcp(codexPath)) {
    codexProbe = {
      available: true,
      command: {
        command: codexPath,
        args: ["acp"],
      },
      detail: `using local codex ACP command at ${codexPath}`,
    }
    return codexProbe
  }

  const codexAcpPath = resolveNodeModulesBin("codex-acp")

  if (codexAcpPath) {
    codexProbe = {
      available: true,
      command: {
        command: codexAcpPath,
      },
      detail: codexPath
        ? `local codex at ${codexPath} does not advertise an acp subcommand; using ${codexAcpPath}`
        : `local codex CLI not found; using ${codexAcpPath}`,
    }
    return codexProbe
  }

  const codexAcpScript = resolveNodePackageScript(
    "@agentclientprotocol/codex-acp",
    "dist/index.js"
  )

  if (codexAcpScript) {
    const scriptPath = codexAcpScript.args?.[0] ?? "codex-acp"
    codexProbe = {
      available: true,
      command: codexAcpScript,
      detail: codexPath
        ? `local codex at ${codexPath} does not advertise an acp subcommand; using ${scriptPath}`
        : `local codex CLI not found; using ${scriptPath}`,
    }
    return codexProbe
  }

  codexProbe = {
    available: false,
    detail:
      "neither a local codex acp subcommand nor node_modules/.bin/codex-acp is available",
  }

  return codexProbe
}

export function resolveCodexAcpCommand() {
  const probe = probeCodexAcpCommand()

  return probe.available ? probe.command : null
}

export function probeClaudeCodeAcpCommand(): CommandProbe {
  if (claudeCodeProbe) {
    return claudeCodeProbe
  }

  const claudeAgentAcpBin = resolveNodeModulesBin("claude-agent-acp")
  const claudeAgentAcpScript =
    resolveNodePackageScript(
      "@agentclientprotocol/claude-agent-acp",
      "dist/index.js"
    ) ?? (claudeAgentAcpBin ? { command: claudeAgentAcpBin } : null)

  if (!claudeAgentAcpScript) {
    claudeCodeProbe = {
      available: false,
      detail: "@agentclientprotocol/claude-agent-acp is not available",
    }
    return claudeCodeProbe
  }

  const scriptPath =
    claudeAgentAcpScript.args?.[0] ?? claudeAgentAcpScript.command
  claudeCodeProbe = {
    available: true,
    command: claudeAgentAcpScript,
    detail: `using ${scriptPath}`,
  }

  return claudeCodeProbe
}

export function resolveClaudeCodeAcpCommand() {
  const probe = probeClaudeCodeAcpCommand()

  return probe.available ? probe.command : null
}

export function probeOpenCodeAcpCommand(): CommandProbe {
  if (openCodeProbe) {
    return openCodeProbe
  }

  const openCodePath =
    (isExecutable(`${process.env.HOME ?? ""}/.opencode/bin/opencode`)
      ? realpathSync(`${process.env.HOME}/.opencode/bin/opencode`)
      : null) ??
    findExecutableOnPath("opencode") ??
    resolveNodePackageExecutable("opencode-ai", "bin/opencode.exe")

  if (!openCodePath) {
    openCodeProbe = {
      available: false,
      detail: "OpenCode executable was not found",
    }
    return openCodeProbe
  }

  openCodeProbe = {
    available: true,
    command: {
      command: openCodePath,
      args: ["acp"],
    },
    detail: `using local OpenCode ACP stdio command at ${openCodePath}`,
  }

  return openCodeProbe
}

export function resolveOpenCodeAcpCommand() {
  const probe = probeOpenCodeAcpCommand()

  return probe.available ? probe.command : null
}

function registerAcpRuntime(info: AgentRuntimeInfo, probe: CommandProbe) {
  if (!probe.available) {
    if (ACP_RUNTIME_DEBUG) {
      console.info("[studio-chat:acp] runtime_unavailable", {
        runtimeId: info.id,
        detail: probe.detail,
      })
    }
    return
  }

  const resolveCommand =
    info.id === "codex"
      ? resolveCodexAcpCommand
      : info.id === "claude-code"
        ? resolveClaudeCodeAcpCommand
        : resolveOpenCodeAcpCommand

  registerAgentRuntime(
    new AcpRuntime({
      info,
      resolveCommand,
    })
  )

  if (ACP_RUNTIME_DEBUG) {
    console.info("[studio-chat:acp] runtime_registered", {
      runtimeId: info.id,
      detail: probe.detail,
    })
  }
}

registerAcpRuntime(
  {
    id: "codex",
    label: "Codex",
    description: "OpenAI Codex via Agent Client Protocol",
    capabilities: ACP_RUNTIME_CAPABILITIES,
  },
  probeCodexAcpCommand()
)

registerAcpRuntime(
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Claude Code via Agent Client Protocol",
    capabilities: ACP_RUNTIME_CAPABILITIES,
  },
  probeClaudeCodeAcpCommand()
)

registerAcpRuntime(
  {
    id: "opencode",
    label: "OpenCode",
    description: "OpenCode via Agent Client Protocol",
    capabilities: ACP_RUNTIME_CAPABILITIES,
  },
  probeOpenCodeAcpCommand()
)
