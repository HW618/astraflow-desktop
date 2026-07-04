import { spawnSync } from "node:child_process"
import { accessSync, constants, realpathSync } from "node:fs"
import { delimiter, join } from "node:path"

import { AcpRuntime, type AcpCommandSpec } from "@/lib/agent/acp/acp-runtime"
import {
  registerAgentRuntime,
  type AgentRuntimeInfo,
} from "@/lib/agent/runtime"
import { MODELVERSE_BASE_URL } from "@/lib/modelverse-config"
import { getStoredModelverseApiKey } from "@/lib/modelverse-openai"

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

  const claudeAgentAcpPath = resolveNodeModulesBin("claude-agent-acp")

  if (!claudeAgentAcpPath) {
    claudeCodeProbe = {
      available: false,
      detail: "node_modules/.bin/claude-agent-acp is not available",
    }
    return claudeCodeProbe
  }

  claudeCodeProbe = {
    available: true,
    command: {
      command: claudeAgentAcpPath,
    },
    detail: `using ${claudeAgentAcpPath}; ModelVerse env is resolved when the runtime starts`,
  }

  return claudeCodeProbe
}

export function resolveClaudeCodeAcpCommand() {
  const probe = probeClaudeCodeAcpCommand()

  if (!probe.available) {
    return null
  }

  const apiKey = getStoredModelverseApiKey()

  return {
    ...probe.command,
    env: apiKey
      ? {
          ...(probe.command.env ?? {}),
          ANTHROPIC_AUTH_TOKEN: apiKey,
          ANTHROPIC_BASE_URL: MODELVERSE_BASE_URL,
        }
      : probe.command.env,
  }
}

function openCodeAcpLooksStdioCompatible(help: string) {
  return /stdio/i.test(help) || /--stdio\b/.test(help)
}

export function probeOpenCodeAcpCommand(): CommandProbe {
  if (openCodeProbe) {
    return openCodeProbe
  }

  const openCodePath =
    (isExecutable(`${process.env.HOME ?? ""}/.opencode/bin/opencode`)
      ? realpathSync(`${process.env.HOME}/.opencode/bin/opencode`)
      : null) ?? findExecutableOnPath("opencode")

  if (!openCodePath) {
    openCodeProbe = {
      available: false,
      detail: "OpenCode executable was not found",
    }
    return openCodeProbe
  }

  const help = getCommandOutput(openCodePath, ["acp", "--help"])

  if (!help) {
    openCodeProbe = {
      available: false,
      detail: `${openCodePath} acp --help did not produce usable output`,
    }
    return openCodeProbe
  }

  if (!openCodeAcpLooksStdioCompatible(help)) {
    openCodeProbe = {
      available: false,
      detail:
        `${openCodePath} acp is HTTP-oriented (` +
        "--port/--hostname in help) and does not advertise stdio mode",
    }
    return openCodeProbe
  }

  openCodeProbe = {
    available: true,
    command: {
      command: openCodePath,
      args: ["acp"],
    },
    detail: `using local OpenCode ACP command at ${openCodePath}`,
  }

  return openCodeProbe
}

export function resolveOpenCodeAcpCommand() {
  const probe = probeOpenCodeAcpCommand()

  return probe.available ? probe.command : null
}

function registerAcpRuntime(info: AgentRuntimeInfo, probe: CommandProbe) {
  if (!probe.available) {
    console.info("[studio-chat:acp] runtime_unavailable", {
      runtimeId: info.id,
      detail: probe.detail,
    })
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

  console.info("[studio-chat:acp] runtime_registered", {
    runtimeId: info.id,
    detail: probe.detail,
  })
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
