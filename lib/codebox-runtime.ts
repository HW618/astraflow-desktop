import { randomBytes } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  Sandbox,
  type SandboxInfo,
  type SandboxState,
} from "@e2b/code-interpreter"

import {
  ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN,
  ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  getAstraFlowSandboxConnectionOptions,
  readAstraFlowSandboxEnv,
} from "@/lib/astraflow-sandbox-runtime"
import { MODELVERSE_BASE_URL_V1 } from "@/lib/modelverse-config"
import {
  deleteCodeBoxSandboxRecord,
  getCodeBoxGithubTokens,
  getCodeBoxSandboxRecord,
  getStudioModelverseApiKey,
  getStudioOAuthTokens,
  listCodeBoxSandboxRecords,
  touchCodeBoxSandboxRecord,
  updateCodeBoxSandboxNameRecord,
  upsertCodeBoxSandboxRecord,
} from "@/lib/studio-db"
import type {
  CodeBoxDirectoryList,
  CodeBoxSandbox,
  CodeBoxSandboxStatus,
  CodeBoxSshAccess,
} from "@/lib/codebox-types"

const ASTRAFLOW_CODE_SANDBOX_DEFAULT_TEMPLATE = "yeyb5hbs2kweus6ku07l"
export const ASTRAFLOW_CODE_SANDBOX_TEMPLATE =
  process.env.ASTRAFLOW_CODE_SANDBOX_TEMPLATE?.trim() ||
  process.env.CODEBOX_SANDBOX_TEMPLATE?.trim() ||
  process.env.E2B_CODE_TEMPLATE?.trim() ||
  ASTRAFLOW_CODE_SANDBOX_DEFAULT_TEMPLATE
export const CODEBOX_CODE_SERVER_PORT = 8080
export const CODEBOX_SSH_WEBSOCKET_PORT = 8081
export const CODEBOX_WORKSPACE_PATH = "/root/workspace"
export const CODEBOX_INSTALLED_CLI = [
  "Claude Code",
  "Codex",
  "opencode",
] as const
export const CODEBOX_CODE_SERVER_EXTENSIONS = [
  "Anthropic.claude-code",
  "openai.chatgpt",
  "sst-dev.opencode",
  "ms-python.python",
  "ms-python.debugpy",
  "dbaeumer.vscode-eslint",
  "esbenp.prettier-vscode",
  "GitHub.vscode-pull-request-github",
] as const

const CODEBOX_AUTO_PAUSE_TIMEOUT_MS = 3_600_000
const CODEBOX_APP_METADATA = "astraflow-codebox"
const CODEBOX_MODELVERSE_ANTHROPIC_BASE_URL = MODELVERSE_BASE_URL_V1
const CODEBOX_OPENCODE_PROVIDER_ID = "modelverse"
const CODEBOX_OPENCODE_MODEL = "glm-5.2"
const CODEBOX_SSH_USER = "root"
const CODEBOX_SSH_PROXY_BUFFER_SIZE = 65_536
const CODEBOX_SSH_READY_CACHE_MS = 10 * 60 * 1000
const codeBoxSshProxyReadyUntil = new Map<string, number>()
const codeBoxSshProxyPreparePromises = new Map<string, Promise<void>>()

type SandboxConnectionOptions = ReturnType<
  typeof getAstraFlowSandboxConnectionOptions
>

const CODEBOX_UNKNOWN_COMPANY = "unknown-company"

type CodeBoxOwner = {
  ownerKey: string
  ownerEmail: string | null
  companyId: string
  projectId: string
}

function requireModelverseApiKey() {
  const apiKey = getStudioModelverseApiKey()

  if (!apiKey?.key) {
    throw new Error("Modelverse API key is not configured.")
  }

  return apiKey
}

function buildOwnerKey(companyId: string, projectId: string) {
  return `${companyId || CODEBOX_UNKNOWN_COMPANY}:${projectId}`
}

function getCodeBoxOwner(): CodeBoxOwner {
  const apiKey = requireModelverseApiKey()
  const oauth = getStudioOAuthTokens()
  const ownerEmail = oauth?.email?.trim() || null
  // The Modelverse API key is scoped to a single company account, so the
  // authenticated email is our stable per-company identity. A sandbox created
  // under one company + project must never surface under another.
  const companyId = ownerEmail ?? CODEBOX_UNKNOWN_COMPANY
  const projectId = apiKey.projectId.trim()

  return {
    ownerKey: buildOwnerKey(companyId, projectId),
    ownerEmail,
    companyId,
    projectId,
  }
}

function withCodeBoxOwner<T extends Record<string, unknown>>(
  owner: CodeBoxOwner,
  input: T
) {
  return {
    ...input,
    ownerKey: owner.ownerKey,
    ownerEmail: owner.ownerEmail,
    companyId: owner.companyId,
    projectId: owner.projectId,
  }
}

// Reconstruct the owner identity a remote sandbox was created under so that
// sandboxes from other companies/projects are excluded from the current view.
// Prefer the metadata written at creation time; fall back to the locally
// stored record for sandboxes created before owner metadata was tracked.
function resolveSandboxOwnerKey(
  info: SandboxInfo,
  fallbackOwnerKey: string | null
): string | null {
  const metadata = info.metadata ?? {}
  const metadataOwnerKey = metadata.ownerKey?.trim()

  if (metadataOwnerKey) {
    return metadataOwnerKey
  }

  const metadataCompanyId = metadata.companyId?.trim()
  const metadataProjectId = metadata.projectId?.trim()

  if (metadataCompanyId || metadataProjectId) {
    return buildOwnerKey(metadataCompanyId ?? "", metadataProjectId ?? "")
  }

  return fallbackOwnerKey
}

function getConnectionOptions(): SandboxConnectionOptions {
  return getAstraFlowSandboxConnectionOptions(requireModelverseApiKey().key)
}

function normalizeSandboxDomain(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\*\./, "")
    .replace(/\/+$/, "")
}

function getSandboxDomain() {
  const domain = normalizeSandboxDomain(
    readAstraFlowSandboxEnv("domain") ?? ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN
  )

  return domain || ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN
}

function getCodeServerHost(
  sandboxId: string,
  sandboxDomain = getSandboxDomain()
) {
  return `${CODEBOX_CODE_SERVER_PORT}-${sandboxId}.${sandboxDomain}`
}

function getCodeBoxSshWebSocketHost(
  sandboxId: string,
  codeServerHost?: string | null
) {
  const expectedCodeServerPrefix = `${CODEBOX_CODE_SERVER_PORT}-${sandboxId}.`

  if (codeServerHost?.startsWith(expectedCodeServerPrefix)) {
    return `${CODEBOX_SSH_WEBSOCKET_PORT}-${sandboxId}.${codeServerHost.slice(
      expectedCodeServerPrefix.length
    )}`
  }

  return `${CODEBOX_SSH_WEBSOCKET_PORT}-${sandboxId}.${getSandboxDomain()}`
}

function getCodeServerUrl(host: string, workspacePath = CODEBOX_WORKSPACE_PATH) {
  const scheme = host.includes("localhost") ? "http" : "https"

  return `${scheme}://${host}/?folder=${encodeURIComponent(workspacePath)}`
}

function getWebSocketUrl(host: string) {
  const scheme =
    host.includes("localhost") || host.startsWith("127.0.0.1") ? "ws" : "wss"

  return `${scheme}://${host}`
}

function getCodeBoxSshHostAlias(sandboxId: string) {
  return `astraflow-codebox-${sandboxId.replace(/[^a-zA-Z0-9-]/g, "-")}`
}

function encodeVscodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/")
}

function getVscodeRemoteSshUri(hostAlias: string, workspacePath: string) {
  return `vscode://vscode-remote/ssh-remote+${encodeURIComponent(
    hostAlias
  )}${encodeVscodePath(workspacePath)}`
}

function syncLocalSshConfig({
  hostAlias,
  sshConfig,
}: {
  hostAlias: string
  sshConfig: string
}) {
  const home = homedir()

  if (!home) {
    return null
  }

  const sshDirectory = join(home, ".ssh")
  const sshConfigPath = join(sshDirectory, "config")
  const startMarker = `# >>> AstraFlow CodeBox ${hostAlias}`
  const endMarker = `# <<< AstraFlow CodeBox ${hostAlias}`
  const block = [
    startMarker,
    sshConfig.trimEnd(),
    endMarker,
    "",
  ].join("\n")

  mkdirSync(sshDirectory, { recursive: true })

  try {
    chmodSync(sshDirectory, 0o700)
  } catch {
    // Best effort only; Windows and some managed homes may not support chmod.
  }

  const current = existsSync(sshConfigPath)
    ? readFileSync(sshConfigPath, "utf8")
    : ""
  const markerPattern = new RegExp(
    `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n*`,
    "g"
  )
  const withoutExistingBlock = current.replace(markerPattern, "").trimStart()
  const nextConfig = `${block}${withoutExistingBlock}`.trimEnd() + "\n"

  writeFileSync(sshConfigPath, nextConfig, "utf8")

  try {
    chmodSync(sshConfigPath, 0o600)
  } catch {
    // Best effort only; OpenSSH will still report its own permission error.
  }

  return sshConfigPath
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function redactSensitiveOutput(value: string) {
  return value.replace(/https?:\/\/[^:\s/@]+:[^@\s]+@/g, "https://***:***@")
}

function getCommandFailureDetail(error: unknown) {
  if (!error || typeof error !== "object") {
    return null
  }

  const result = error as {
    exitCode?: unknown
    stdout?: unknown
    stderr?: unknown
    error?: unknown
  }
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : ""
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : ""
  const commandError =
    typeof result.error === "string" ? result.error.trim() : ""
  const exitCode =
    typeof result.exitCode === "number" ? result.exitCode : undefined
  const detail = [stderr, stdout, commandError].filter(Boolean).join("\n")

  return {
    exitCode,
    detail: redactSensitiveOutput(detail),
  }
}

function normalizeCodeBoxWorkspacePath(value: string | null | undefined) {
  const trimmed = value?.trim() || CODEBOX_WORKSPACE_PATH

  if (!trimmed.startsWith("/") || trimmed.includes("\0")) {
    throw new Error("Workspace directory must be an absolute path.")
  }

  const parts: string[] = []

  for (const part of trimmed.split("/")) {
    if (!part || part === ".") {
      continue
    }

    if (part === "..") {
      if (!parts.length) {
        throw new Error("Workspace directory cannot escape root.")
      }

      parts.pop()
      continue
    }

    parts.push(part)
  }

  return `/${parts.join("/")}` || "/"
}

function getInjectedEnvironment() {
  const apiKey = getStudioModelverseApiKey()
  const github = getCodeBoxGithubTokens()
  const envs: Record<string, string> = {}

  if (apiKey?.key) {
    envs.MODELVERSE_API_KEY = apiKey.key
    envs.OPENAI_API_KEY = apiKey.key
    envs.ANTHROPIC_AUTH_TOKEN = apiKey.key
  }

  if (github?.accessToken) {
    envs.GH_TOKEN = github.accessToken
    envs.GITHUB_TOKEN = github.accessToken
  }

  return envs
}

function stringifyProfileExports(envs: Record<string, string>) {
  return [
    "# AstraFlow CodeBox runtime credentials",
    ...Object.entries(envs).map(
      ([name, value]) => `export ${name}=${shellQuote(value)}`
    ),
    "",
  ].join("\n")
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeSandboxStatus(
  value: string | undefined
): CodeBoxSandboxStatus {
  if (value === "running" || value === "paused") {
    return value
  }

  return "unknown"
}

function mergeSandboxRecord(
  info: SandboxInfo,
  owner: CodeBoxOwner
): CodeBoxSandbox {
  const existing = getCodeBoxSandboxRecord(info.sandboxId, owner.ownerKey)
  const codeServerHost =
    existing?.codeServerHost ??
    getCodeServerHost(info.sandboxId, info.sandboxDomain ?? getSandboxDomain())

  return {
    sandboxId: info.sandboxId,
    name: existing?.name ?? info.metadata.name ?? info.name ?? null,
    ownerKey: owner.ownerKey,
    companyId: owner.companyId,
    projectId: owner.projectId,
    template: info.templateId,
    status: normalizeSandboxStatus(info.state),
    volumeId: existing?.volumeId ?? null,
    volumeName: existing?.volumeName ?? null,
    codeServerUrl: getCodeServerUrl(codeServerHost),
    codeServerHost,
    codeServerPort: existing?.codeServerPort ?? CODEBOX_CODE_SERVER_PORT,
    password: existing?.password ?? null,
    workspacePath: CODEBOX_WORKSPACE_PATH,
    repoUrl: existing?.repoUrl ?? info.metadata.repoUrl ?? null,
    startedAt: formatDate(info.startedAt),
    endAt: formatDate(info.endAt),
    createdAt: existing?.createdAt ?? formatDate(info.startedAt) ?? "",
    updatedAt: new Date().toISOString(),
    lastUsedAt: existing?.lastUsedAt ?? new Date().toISOString(),
  }
}

async function runChecked(
  sandbox: Sandbox,
  command: string,
  step: string,
  timeoutMs = 60_000
) {
  let result: Awaited<ReturnType<Sandbox["commands"]["run"]>>

  try {
    result = await sandbox.commands.run(command, {
      timeoutMs,
      requestTimeoutMs: Math.max(
        timeoutMs + 10_000,
        ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
      ),
    })
  } catch (error) {
    const failure = getCommandFailureDetail(error)

    console.error("[CodeBox] command failed", {
      sandboxId: sandbox.sandboxId,
      step,
      exitCode: failure?.exitCode,
      detail: failure?.detail,
    })

    if (failure?.detail) {
      throw new Error(
        `${step} failed${
          failure.exitCode === undefined ? "" : ` with exit code ${failure.exitCode}`
        }: ${failure.detail}`
      )
    }

    throw error
  }

  if (result.exitCode !== 0) {
    const detail = redactSensitiveOutput(
      [result.stderr, result.stdout].filter(Boolean).join("\n")
    )

    console.error("[CodeBox] command exited with non-zero status", {
      sandboxId: sandbox.sandboxId,
      step,
      exitCode: result.exitCode,
      detail,
    })

    throw new Error(`${step} failed: ${detail || "command exited with error"}`)
  }

  return result
}

async function writeGithubAuth(sandbox: Sandbox) {
  const github = getCodeBoxGithubTokens()

  if (!github?.accessToken) {
    return
  }

  const login = github.login || "github-user"
  const email = github.email || `${login}@users.noreply.github.com`
  const name = github.name || login
  const token = github.accessToken
  const hostsYaml = [
    "github.com:",
    "    user: " + login,
    "    oauth_token: " + token,
    "    git_protocol: https",
    "",
  ].join("\n")
  const credential = `https://${login}:${token}@github.com\n`

  await sandbox.files.write("/tmp/astraflow-gh-hosts.yml", hostsYaml)
  await sandbox.files.write("/tmp/astraflow-git-credentials", credential)
  await runChecked(
    sandbox,
    [
      "install -d -m 700 /root/.config/gh",
      "install -m 600 /tmp/astraflow-gh-hosts.yml /root/.config/gh/hosts.yml",
      "install -m 644 /tmp/astraflow-git-credentials /etc/git-credentials",
      "while IFS=: read -r user _ uid gid _ home _; do " +
        'case "$home" in /home/*) ' +
        '[ -d "$home" ] || continue; ' +
        'install -d -m 700 "$home/.config/gh"; ' +
        'install -m 600 /tmp/astraflow-gh-hosts.yml "$home/.config/gh/hosts.yml"; ' +
        'chown -R "$uid:$gid" "$home/.config/gh"; ' +
        ";; esac; " +
        "done < /etc/passwd",
    ].join(" && "),
    "prepare GitHub config",
    30_000
  )
  await runChecked(
    sandbox,
    [
      "chmod 600 /root/.config/gh/hosts.yml",
      "chmod 644 /etc/git-credentials",
      `git config --global user.name ${shellQuote(name)}`,
      `git config --global user.email ${shellQuote(email)}`,
      "git config --global credential.helper " +
        shellQuote("store --file=/etc/git-credentials"),
      `git config --system user.name ${shellQuote(name)}`,
      `git config --system user.email ${shellQuote(email)}`,
      "git config --system credential.helper " +
        shellQuote("store --file=/etc/git-credentials"),
      "git config --global pull.rebase false",
      "git config --system pull.rebase false",
      "rm -f /tmp/astraflow-gh-hosts.yml /tmp/astraflow-git-credentials",
    ].join(" && "),
    "configure GitHub",
    30_000
  )
}

async function writeAgentEnvironment(sandbox: Sandbox) {
  const apiKey = getStudioModelverseApiKey()

  if (!apiKey?.key) {
    return
  }

  await runChecked(
    sandbox,
    "mkdir -p /root/.codex /root/.config/opencode && rm -f /root/.claude/settings.json /home/*/.claude/settings.json",
    "prepare agent config",
    30_000
  )
  await sandbox.files.write(
    "/root/.codex/auth.json",
    JSON.stringify({ OPENAI_API_KEY: apiKey.key }, null, 2)
  )
  await sandbox.files.write(
    "/root/.config/opencode/opencode.json",
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        model: `${CODEBOX_OPENCODE_PROVIDER_ID}/${CODEBOX_OPENCODE_MODEL}`,
        small_model: `${CODEBOX_OPENCODE_PROVIDER_ID}/${CODEBOX_OPENCODE_MODEL}`,
        provider: {
          [CODEBOX_OPENCODE_PROVIDER_ID]: {
            npm: "@ai-sdk/anthropic",
            name: "ModelVerse",
            options: {
              baseURL: CODEBOX_MODELVERSE_ANTHROPIC_BASE_URL,
              apiKey: "{env:MODELVERSE_API_KEY}",
              headers: {
                Authorization: "Bearer {env:MODELVERSE_API_KEY}",
                "anthropic-version": "2023-06-01",
                "x-api-key": "{env:MODELVERSE_API_KEY}",
              },
            },
            models: {
              [CODEBOX_OPENCODE_MODEL]: {
                name: "GLM-5.2",
              },
            },
          },
        },
      },
      null,
      2
    )
  )
  await runChecked(
    sandbox,
    "chmod 600 /root/.codex/auth.json /root/.config/opencode/opencode.json",
    "secure agent config",
    30_000
  )
}

async function writeRuntimeProfile(sandbox: Sandbox) {
  const envs = getInjectedEnvironment()

  if (Object.keys(envs).length === 0) {
    return envs
  }

  await sandbox.files.write(
    "/etc/profile.d/astraflow-codebox.sh",
    stringifyProfileExports(envs)
  )
  await runChecked(
    sandbox,
    "chmod 644 /etc/profile.d/astraflow-codebox.sh",
    "write runtime profile",
    30_000
  )

  return envs
}

async function resetCodeServerWorkbench(sandbox: Sandbox) {
  const settingsPath = "/root/.local/share/code-server/User/settings.json"
  const settingsPatchPath = "/tmp/astraflow-code-server-settings.json"

  await sandbox.files.write(
    settingsPatchPath,
    JSON.stringify(
      {
        "workbench.startupEditor": "none",
        "workbench.editor.restoreViewState": false,
        "window.restoreWindows": "none",
      },
      null,
      2
    )
  )
  await runChecked(
    sandbox,
    [
      "mkdir -p /root/.local/share/code-server/User",
      "node -e " +
        shellQuote(
          [
            "const fs = require('fs');",
            `const target = ${JSON.stringify(settingsPath)};`,
            `const patch = JSON.parse(fs.readFileSync(${JSON.stringify(
              settingsPatchPath
            )}, 'utf8'));`,
            "let current = {};",
            "try { current = JSON.parse(fs.readFileSync(target, 'utf8')); } catch {}",
            "fs.writeFileSync(target, JSON.stringify({ ...current, ...patch }, null, 2) + '\\n');",
          ].join(" ")
        ),
      "rm -rf /root/.local/share/code-server/User/workspaceStorage",
      "rm -rf /root/.local/share/code-server/User/History",
      "rm -f /root/.local/share/code-server/User/globalStorage/state.vscdb*",
      "rm -f /tmp/astraflow-code-server-settings.json",
    ].join(" && "),
    "reset code-server workbench state",
    30_000
  )
}

async function installCodeBoxStartupExtension(sandbox: Sandbox) {
  const extensionDir =
    "/root/.local/share/code-server/extensions/astraflow.codebox-startup-0.0.1"

  await runChecked(
    sandbox,
    `mkdir -p ${shellQuote(extensionDir)}`,
    "prepare CodeBox startup extension",
    30_000
  )
  await sandbox.files.write(
    `${extensionDir}/package.json`,
    JSON.stringify(
      {
        name: "codebox-startup",
        displayName: "AstraFlow CodeBox Startup",
        version: "0.0.1",
        publisher: "astraflow",
        engines: {
          vscode: "^1.94.0",
        },
        categories: ["Other"],
        activationEvents: ["onStartupFinished"],
        main: "./extension.js",
      },
      null,
      2
    )
  )
  await sandbox.files.write(
    `${extensionDir}/extension.js`,
    [
      "const vscode = require('vscode')",
      "",
      "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))",
      "",
      "async function executeWhenAvailable(command, attempts = 12) {",
      "  for (let attempt = 0; attempt < attempts; attempt += 1) {",
      "    const commands = await vscode.commands.getCommands(true)",
      "    if (commands.includes(command)) {",
      "      await vscode.commands.executeCommand(command)",
      "      return true",
      "    }",
      "    await sleep(750)",
      "  }",
      "  return false",
      "}",
      "",
      "async function activate() {",
      "  await sleep(1500)",
      "  if (await executeWhenAvailable('claude-vscode.editor.openLast')) {",
      "    await sleep(500)",
      "    await executeWhenAvailable('claude-vscode.focus', 2)",
      "  }",
      "}",
      "",
      "function deactivate() {}",
      "",
      "module.exports = { activate, deactivate }",
      "",
    ].join("\n")
  )
}

async function startCodeServer(
  sandbox: Sandbox,
  password: string,
  envs: Record<string, string> = {}
) {
  await runChecked(
    sandbox,
    [
      `mkdir -p /root/.config/code-server ${shellQuote(CODEBOX_WORKSPACE_PATH)}`,
      "chmod 700 /root/.config/code-server",
    ].join(" && "),
    "prepare code-server",
    30_000
  )

  await sandbox.files.write(
    "/root/.config/code-server/config.yaml",
    [
      `bind-addr: 0.0.0.0:${CODEBOX_CODE_SERVER_PORT}`,
      "auth: password",
      `password: ${password}`,
      "cert: false",
      "",
    ].join("\n")
  )

  await sandbox.commands.run(
    "pkill -f '[c]ode-server' >/dev/null 2>&1 || true",
    {
      timeoutMs: 10_000,
      requestTimeoutMs: 20_000,
    }
  )
  await resetCodeServerWorkbench(sandbox)
  await installCodeBoxStartupExtension(sandbox)
  await sandbox.commands.run(
    `code-server ${shellQuote(CODEBOX_WORKSPACE_PATH)}`,
    {
      background: true,
      envs,
      timeoutMs: 0,
      requestTimeoutMs: 20_000,
    }
  )
}

export async function listCodeBoxSandboxes({
  state = "all",
}: {
  state?: "running" | "paused" | "all"
} = {}) {
  const owner = getCodeBoxOwner()
  const connectionOptions = getConnectionOptions()
  const states: SandboxState[] =
    state === "running" || state === "paused" ? [state] : ["running", "paused"]
  const paginator = Sandbox.list({
    ...connectionOptions,
    limit: 100,
    query: {
      metadata: {
        app: CODEBOX_APP_METADATA,
      },
      state: states,
    },
  })
  const remote = await paginator.nextItems(connectionOptions)
  const localById = new Map(
    listCodeBoxSandboxRecords(owner.ownerKey).map((sandbox) => [
      sandbox.sandboxId,
      sandbox,
    ])
  )
  // E2B scopes Sandbox.list to the whole account (shared across companies and
  // projects), so keep only the sandboxes created under the current owner.
  const ownedRemote = remote.filter(
    (info) =>
      resolveSandboxOwnerKey(info, localById.get(info.sandboxId)?.ownerKey ?? null) ===
      owner.ownerKey
  )

  for (const info of ownedRemote) {
    const merged = mergeSandboxRecord(info, owner)
    upsertCodeBoxSandboxRecord(
      withCodeBoxOwner(owner, {
        sandboxId: merged.sandboxId,
        name: merged.name,
        volumeId: merged.volumeId,
        volumeName: merged.volumeName,
        sandboxDomain: info.sandboxDomain ?? getSandboxDomain(),
        template: merged.template,
        status: merged.status,
        codeServerUrl: merged.codeServerUrl,
        codeServerHost: merged.codeServerHost,
        codeServerPort: merged.codeServerPort,
        password: merged.password,
        workspacePath: merged.workspacePath,
        repoUrl: merged.repoUrl,
        startedAt: merged.startedAt,
        endAt: merged.endAt,
      })
    )
    localById.delete(info.sandboxId)
  }

  const now = new Date().toISOString()
  const staleLocalSandboxes = Array.from(localById.values()).map((sandbox) => {
    touchCodeBoxSandboxRecord(sandbox.sandboxId, "unknown", owner.ownerKey)

    return {
      ...sandbox,
      status: "unknown" as const,
      updatedAt: now,
      lastUsedAt: now,
    }
  })

  return [
    ...ownedRemote.map((info) => mergeSandboxRecord(info, owner)),
    ...(state === "all" ? staleLocalSandboxes : []),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function listCodeBoxSandboxDirectories({
  path,
  sandboxId,
}: {
  path?: string | null
  sandboxId: string
}): Promise<CodeBoxDirectoryList> {
  const owner = getCodeBoxOwner()
  const existing = getCodeBoxSandboxRecord(sandboxId, owner.ownerKey)

  if (!existing) {
    throw new Error("Sandbox was not found.")
  }

  const normalizedPath = normalizeCodeBoxWorkspacePath(path)
  const sandbox = await Sandbox.connect(sandboxId, {
    ...getConnectionOptions(),
    timeoutMs: CODEBOX_AUTO_PAUSE_TIMEOUT_MS,
  })
  const script = [
    `target=${shellQuote(normalizedPath)}`,
    "node -e " +
      shellQuote(
        [
          "const fs = require('fs');",
          "const path = require('path').posix;",
          "const target = process.argv[1];",
          "const stat = fs.statSync(target);",
          "if (!stat.isDirectory()) {",
          "  process.stderr.write('Not a directory');",
          "  process.exit(66);",
          "}",
          "const directories = fs.readdirSync(target, { withFileTypes: true })",
          "  .filter((entry) => entry.isDirectory())",
          "  .map((entry) => ({ name: entry.name, path: path.join(target, entry.name) }))",
          "  .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));",
          "console.log(JSON.stringify({",
          "  path: target,",
          "  parentPath: target === '/' ? null : path.dirname(target),",
          "  directories,",
          "}));",
        ].join("\n")
      ) +
      ' "$target"',
  ].join("\n")
  const result = await runChecked(
    sandbox,
    `bash -lc ${shellQuote(script)}`,
    "list workspace directories",
    20_000
  )

  touchCodeBoxSandboxRecord(sandboxId, "running", owner.ownerKey)

  try {
    const parsed = JSON.parse(result.stdout) as CodeBoxDirectoryList

    return {
      path: parsed.path,
      parentPath: parsed.parentPath,
      directories: Array.isArray(parsed.directories)
        ? parsed.directories.map((directory) => ({
            name: directory.name,
            path: directory.path,
          }))
        : [],
    }
  } catch {
    throw new Error("Failed to read workspace directory list.")
  }
}

function isCodeBoxSshProxyReadyCached(sandboxId: string) {
  const readyUntil = codeBoxSshProxyReadyUntil.get(sandboxId) ?? 0

  if (readyUntil > Date.now()) {
    return true
  }

  codeBoxSshProxyReadyUntil.delete(sandboxId)

  return false
}

async function ensureCodeBoxSshProxyCached(
  sandbox: Sandbox,
  password: string
) {
  if (isCodeBoxSshProxyReadyCached(sandbox.sandboxId)) {
    return
  }

  const existing = codeBoxSshProxyPreparePromises.get(sandbox.sandboxId)

  if (existing) {
    await existing
    return
  }

  const promise = ensureCodeBoxSshProxy(sandbox, password)
    .then(() => {
      codeBoxSshProxyReadyUntil.set(
        sandbox.sandboxId,
        Date.now() + CODEBOX_SSH_READY_CACHE_MS
      )
    })
    .finally(() => {
      codeBoxSshProxyPreparePromises.delete(sandbox.sandboxId)
    })

  codeBoxSshProxyPreparePromises.set(sandbox.sandboxId, promise)
  await promise
}

async function ensureCodeBoxSshProxy(sandbox: Sandbox, password: string) {
  const prepareScript = [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "if [ ! -x /usr/sbin/sshd ] || ! command -v curl >/dev/null 2>&1; then",
    "  apt-get update",
    "  apt-get install -y openssh-server curl ca-certificates",
    "fi",
    "if [ ! -x /usr/local/bin/websocat ]; then",
    "  curl -fsSL -o /usr/local/bin/websocat https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl",
    "  chmod a+x /usr/local/bin/websocat",
    "fi",
    "mkdir -p /run/sshd /etc/ssh/sshd_config.d",
    "cat > /etc/ssh/sshd_config.d/astraflow-codebox.conf <<'EOF'",
    "PermitRootLogin yes",
    "PasswordAuthentication yes",
    "KbdInteractiveAuthentication yes",
    "PubkeyAuthentication yes",
    "UsePAM yes",
    "EOF",
    `printf '%s:%s\\n' ${shellQuote(CODEBOX_SSH_USER)} ${shellQuote(
      password
    )} | chpasswd`,
    "ssh-keygen -A >/dev/null 2>&1 || true",
    "/usr/sbin/sshd -t",
    "if pgrep -x sshd >/dev/null 2>&1; then",
    "  pkill -HUP -x sshd >/dev/null 2>&1 || true",
    "else",
    "  /usr/sbin/sshd",
    "fi",
    "for _ in $(seq 1 30); do",
    "  if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | awk '{print $4}' | grep -Eq '(^|[:.])22$'; then",
    "    exit 0",
    "  fi",
    "  sleep 0.5",
    "done",
    "echo 'port 22 did not become ready' >&2",
    "exit 1",
  ].join("\n")

  await runChecked(
    sandbox,
    `bash -lc ${shellQuote(prepareScript)}`,
    "prepare SSH access",
    180_000
  )

  const webSocketPort = String(CODEBOX_SSH_WEBSOCKET_PORT)
  const isProxyReadyScript = [
    "set -euo pipefail",
    `port=${shellQuote(webSocketPort)}`,
    "if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | awk '{print $4}' | grep -Eq \"(^|[:.])${port}$\"; then",
    "  exit 0",
    "fi",
    "exit 1",
  ].join("\n")
  const existingProxy = await sandbox.commands
    .run(`bash -lc ${shellQuote(isProxyReadyScript)}`, {
      timeoutMs: 5_000,
      requestTimeoutMs: 15_000,
    })
    .then((result) => result.exitCode === 0)
    .catch(() => false)

  if (!existingProxy) {
    const startProxyScript = [
      "set -euo pipefail",
      `port=${shellQuote(webSocketPort)}`,
      "pkill -f \"[w]ebsocat .*ws-l:0.0.0.0:${port}\" >/dev/null 2>&1 || true",
      "rm -f /tmp/astraflow-ssh-websocat.log",
      "exec /usr/local/bin/websocat -b --exit-on-eof ws-l:0.0.0.0:${port} tcp:127.0.0.1:22 >>/tmp/astraflow-ssh-websocat.log 2>&1",
    ].join("\n")

    await sandbox.commands.run(`bash -lc ${shellQuote(startProxyScript)}`, {
      background: true,
      timeoutMs: 0,
      requestTimeoutMs: 20_000,
    })
  }

  const waitProxyScript = [
    "set -euo pipefail",
    `port=${shellQuote(webSocketPort)}`,
    "for _ in $(seq 1 40); do",
    "  if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | awk '{print $4}' | grep -Eq \"(^|[:.])${port}$\"; then",
    "    exit 0",
    "  fi",
    "  sleep 0.5",
    "done",
    "echo \"port ${port} did not become ready\" >&2",
    "echo 'websocat processes:' >&2",
    "pgrep -af '[w]ebsocat' >&2 || true",
    "echo 'websocat log:' >&2",
    "tail -n 80 /tmp/astraflow-ssh-websocat.log >&2 || true",
    "echo 'listening ports:' >&2",
    "(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null || true) >&2",
    "exit 1",
  ].join("\n")

  await runChecked(
    sandbox,
    `bash -lc ${shellQuote(waitProxyScript)}`,
    "prepare SSH access",
    30_000
  )
}

export async function prepareCodeBoxSshAccess({
  sandboxId,
  workspacePath,
  prepareRemote = false,
  writeConfig = false,
}: {
  sandboxId: string
  workspacePath?: string | null
  prepareRemote?: boolean | null
  writeConfig?: boolean | null
}): Promise<CodeBoxSshAccess> {
  const owner = getCodeBoxOwner()
  const existing = getCodeBoxSandboxRecord(sandboxId, owner.ownerKey)

  if (!existing) {
    throw new Error("Sandbox was not found.")
  }

  const normalizedWorkspacePath = normalizeCodeBoxWorkspacePath(
    workspacePath || existing.workspacePath
  )
  const password = existing.password || randomBytes(12).toString("hex")
  let status: CodeBoxSandboxStatus = existing.status
  let webSocketUrl = getWebSocketUrl(
    getCodeBoxSshWebSocketHost(sandboxId, existing.codeServerHost)
  )

  if (prepareRemote && !isCodeBoxSshProxyReadyCached(sandboxId)) {
    const sandbox = await Sandbox.connect(sandboxId, {
      ...getConnectionOptions(),
      timeoutMs: CODEBOX_AUTO_PAUSE_TIMEOUT_MS,
    })

    await ensureCodeBoxSshProxyCached(sandbox, password)

    status = "running"
    webSocketUrl = getWebSocketUrl(sandbox.getHost(CODEBOX_SSH_WEBSOCKET_PORT))
  }

  const remoteReady = isCodeBoxSshProxyReadyCached(sandboxId)
  const hostAlias = getCodeBoxSshHostAlias(sandboxId)
  const proxyCommand = `websocat --binary -B ${CODEBOX_SSH_PROXY_BUFFER_SIZE} - ${webSocketUrl}`
  const sshConfig = [
    `Host ${hostAlias}`,
    `  HostName ${sandboxId}`,
    `  User ${CODEBOX_SSH_USER}`,
    `  ProxyCommand ${proxyCommand}`,
    "  ServerAliveInterval 30",
    "  ServerAliveCountMax 3",
    "  StrictHostKeyChecking accept-new",
    "",
  ].join("\n")
  const sshConfigPath = writeConfig
    ? syncLocalSshConfig({ hostAlias, sshConfig })
    : null

  upsertCodeBoxSandboxRecord(
    withCodeBoxOwner(owner, {
      sandboxId,
      name: existing.name,
      volumeId: existing.volumeId,
      volumeName: existing.volumeName,
      sandboxDomain: getSandboxDomain(),
      template: existing.template,
      status,
      codeServerUrl: existing.codeServerUrl,
      codeServerHost: existing.codeServerHost,
      codeServerPort: existing.codeServerPort,
      password,
      workspacePath: existing.workspacePath || CODEBOX_WORKSPACE_PATH,
      repoUrl: existing.repoUrl,
      startedAt: existing.startedAt,
      endAt: existing.endAt,
    })
  )

  return {
    sandboxId,
    user: CODEBOX_SSH_USER,
    hostAlias,
    hostName: sandboxId,
    workspacePath: normalizedWorkspacePath,
    webSocketUrl,
    sshConfig,
    sshConfigPath,
    sshCommand: `ssh -o ${shellQuote(
      `ProxyCommand=${proxyCommand}`
    )} ${CODEBOX_SSH_USER}@${sandboxId}`,
    vscodeUri: getVscodeRemoteSshUri(hostAlias, normalizedWorkspacePath),
    remoteReady,
    password,
  }
}

export async function createCodeBoxSandbox({
  name,
  repoUrl,
}: {
  name?: string | null
  repoUrl?: string | null
}) {
  const owner = getCodeBoxOwner()
  const connectionOptions = getConnectionOptions()
  const password = randomBytes(12).toString("hex")
  const metadata: Record<string, string> = {
    app: CODEBOX_APP_METADATA,
    codeServerPort: String(CODEBOX_CODE_SERVER_PORT),
    // Tag the sandbox with its owner identity so the shared-account
    // Sandbox.list can be scoped back to this company + project on read.
    ownerKey: owner.ownerKey,
    companyId: owner.companyId,
    projectId: owner.projectId,
  }
  const normalizedRepoUrl = repoUrl?.trim()
  const normalizedName = name?.trim()

  if (normalizedName) {
    metadata.name = normalizedName
  }

  if (normalizedRepoUrl) {
    metadata.repoUrl = normalizedRepoUrl
  }

  const sandbox = await Sandbox.create(ASTRAFLOW_CODE_SANDBOX_TEMPLATE, {
    ...connectionOptions,
    timeoutMs: CODEBOX_AUTO_PAUSE_TIMEOUT_MS,
    allowInternetAccess: true,
    lifecycle: {
      onTimeout: { action: "pause", keepMemory: true },
      autoResume: true,
    },
    metadata,
  })

  try {
    await writeGithubAuth(sandbox)
    await writeAgentEnvironment(sandbox)
    const envs = await writeRuntimeProfile(sandbox)

    if (normalizedRepoUrl) {
      const cloneScript = [
        "set -euo pipefail",
        `repo_url=${shellQuote(normalizedRepoUrl)}`,
        `workspace=${shellQuote(CODEBOX_WORKSPACE_PATH)}`,
        'mkdir -p "$workspace"',
        'if [ -d "$workspace/.git" ]; then',
        '  echo "workspace already contains a git repository"',
        "  exit 0",
        "fi",
        'tmp_dir=$(mktemp -d /tmp/astraflow-codebox-clone.XXXXXX)',
        'trap \'rm -rf "$tmp_dir"\' EXIT',
        'GIT_TERMINAL_PROMPT=0 git clone --depth 1 "$repo_url" "$tmp_dir/repo"',
        'if [ -n "$(find "$workspace" -mindepth 1 -maxdepth 1 -print -quit)" ]; then',
        '  echo "workspace is not empty; copying cloned repository into it" >&2',
        '  cp -a "$tmp_dir/repo/." "$workspace/"',
        "else",
        '  rmdir "$workspace"',
        '  mv "$tmp_dir/repo" "$workspace"',
        "fi",
      ].join("\n")

      await runChecked(
        sandbox,
        `bash -lc ${shellQuote(cloneScript)}`,
        "clone repository",
        300_000
      )
    }

    await startCodeServer(sandbox, password, envs)

    const host = sandbox.getHost(CODEBOX_CODE_SERVER_PORT)

    return upsertCodeBoxSandboxRecord(
      withCodeBoxOwner(owner, {
        sandboxId: sandbox.sandboxId,
        name: normalizedName || null,
        volumeId: null,
        volumeName: null,
        sandboxDomain: getSandboxDomain(),
        template: ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
        status: "running",
        codeServerUrl: getCodeServerUrl(host),
        codeServerHost: host,
        codeServerPort: CODEBOX_CODE_SERVER_PORT,
        password,
        workspacePath: CODEBOX_WORKSPACE_PATH,
        repoUrl: normalizedRepoUrl || null,
      })
    ) as CodeBoxSandbox
  } catch (error) {
    await sandbox
      .kill({ requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS })
      .catch(() => undefined)
    throw error
  }
}

export async function pauseCodeBoxSandbox(sandboxId: string) {
  const owner = getCodeBoxOwner()
  const paused = await Sandbox.pause(sandboxId, {
    ...getConnectionOptions(),
    keepMemory: true,
  })

  if (paused) {
    touchCodeBoxSandboxRecord(sandboxId, "paused", owner.ownerKey)
  }

  return paused
}

export async function resumeCodeBoxSandbox(sandboxId: string) {
  const owner = getCodeBoxOwner()
  const existing = getCodeBoxSandboxRecord(sandboxId, owner.ownerKey)
  const sandbox = await Sandbox.connect(sandboxId, {
    ...getConnectionOptions(),
    timeoutMs: CODEBOX_AUTO_PAUSE_TIMEOUT_MS,
  })
  const password = existing?.password || randomBytes(12).toString("hex")

  await writeGithubAuth(sandbox)
  await writeAgentEnvironment(sandbox)
  const envs = await writeRuntimeProfile(sandbox)
  await startCodeServer(sandbox, password, envs)

  const host = sandbox.getHost(CODEBOX_CODE_SERVER_PORT)

  upsertCodeBoxSandboxRecord(
    withCodeBoxOwner(owner, {
      sandboxId,
      name: existing?.name ?? null,
      volumeId: existing?.volumeId ?? null,
      volumeName: existing?.volumeName ?? null,
      sandboxDomain: existing ? getSandboxDomain() : null,
      template: existing?.template ?? ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
      status: "running",
      codeServerUrl: getCodeServerUrl(host),
      codeServerHost: host,
      codeServerPort: CODEBOX_CODE_SERVER_PORT,
      password,
      workspacePath: CODEBOX_WORKSPACE_PATH,
      repoUrl: existing?.repoUrl ?? null,
      startedAt: existing?.startedAt ?? null,
      endAt: existing?.endAt ?? null,
    })
  )

  return true
}

export async function updateCodeBoxSandboxName({
  sandboxId,
  name,
}: {
  sandboxId: string
  name?: string | null
}) {
  const owner = getCodeBoxOwner()
  const normalizedName = name?.trim() || null
  const existing = getCodeBoxSandboxRecord(sandboxId, owner.ownerKey)

  if (!existing) {
    return null
  }

  return updateCodeBoxSandboxNameRecord(
    sandboxId,
    normalizedName,
    owner.ownerKey
  )
}

export async function syncCodeBoxCredentialsToRunningSandboxes() {
  const sandboxes = await listCodeBoxSandboxes({ state: "running" })
  const runningSandboxes = sandboxes.filter(
    (sandbox) => sandbox.status === "running"
  )
  const results = await Promise.allSettled(
    runningSandboxes.map(async (record) => {
      const sandbox = await Sandbox.connect(record.sandboxId, {
        ...getConnectionOptions(),
        timeoutMs: CODEBOX_AUTO_PAUSE_TIMEOUT_MS,
      })

      await writeGithubAuth(sandbox)
      await writeAgentEnvironment(sandbox)
      await writeRuntimeProfile(sandbox)

      return record.sandboxId
    })
  )

  return {
    total: runningSandboxes.length,
    synced: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  }
}

export async function killCodeBoxSandbox(sandboxId: string) {
  const owner = getCodeBoxOwner()
  const existing = getCodeBoxSandboxRecord(sandboxId, owner.ownerKey)
  const killed = await Sandbox.kill(sandboxId, getConnectionOptions())

  if (killed || existing) {
    deleteCodeBoxSandboxRecord(sandboxId)
  }

  return killed || Boolean(existing)
}
