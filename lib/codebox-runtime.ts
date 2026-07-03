import { randomBytes } from "node:crypto"

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
import type { CodeBoxSandbox, CodeBoxSandboxStatus } from "@/lib/codebox-types"

const ASTRAFLOW_CODE_SANDBOX_DEFAULT_TEMPLATE = "yeyb5hbs2kweus6ku07l"
export const ASTRAFLOW_CODE_SANDBOX_TEMPLATE =
  process.env.ASTRAFLOW_CODE_SANDBOX_TEMPLATE?.trim() ||
  process.env.CODEBOX_SANDBOX_TEMPLATE?.trim() ||
  process.env.E2B_CODE_TEMPLATE?.trim() ||
  ASTRAFLOW_CODE_SANDBOX_DEFAULT_TEMPLATE
export const CODEBOX_CODE_SERVER_PORT = 8080
export const CODEBOX_WORKSPACE_PATH = "/root/workspace"
const CODEBOX_CODE_SERVER_OPEN_PATH = CODEBOX_WORKSPACE_PATH
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

type SandboxConnectionOptions = ReturnType<
  typeof getAstraFlowSandboxConnectionOptions
>

type CodeBoxOwner = {
  ownerKey: string
  ownerEmail: string | null
  projectId: string
}

function requireModelverseApiKey() {
  const apiKey = getStudioModelverseApiKey()

  if (!apiKey?.key) {
    throw new Error("Modelverse API key is not configured.")
  }

  return apiKey
}

function getCodeBoxOwner(): CodeBoxOwner {
  const apiKey = requireModelverseApiKey()
  const oauth = getStudioOAuthTokens()
  const ownerEmail = oauth?.email?.trim() || null
  const projectId = apiKey.projectId.trim()
  const ownerKey = `${ownerEmail ?? "unknown-account"}:${projectId}`

  return {
    ownerKey,
    ownerEmail,
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
    projectId: owner.projectId,
  }
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

function getCodeServerUrl(host: string) {
  const scheme = host.includes("localhost") ? "http" : "https"

  return `${scheme}://${host}/?folder=${encodeURIComponent(CODEBOX_CODE_SERVER_OPEN_PATH)}`
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
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
  const result = await sandbox.commands.run(command, {
    timeoutMs,
    requestTimeoutMs: Math.max(
      timeoutMs + 10_000,
      ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
    ),
  })

  if (result.exitCode !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n")
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

  for (const info of remote) {
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
    ...remote.map((info) => mergeSandboxRecord(info, owner)),
    ...(state === "all" ? staleLocalSandboxes : []),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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
      await runChecked(
        sandbox,
        [
          `cd ${shellQuote(CODEBOX_WORKSPACE_PATH)}`,
          "[ -d .git ] || git clone --depth 1 " +
            `${shellQuote(normalizedRepoUrl)} .`,
        ].join(" && "),
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
  const killed = await Sandbox.kill(sandboxId, getConnectionOptions())

  if (killed) {
    deleteCodeBoxSandboxRecord(sandboxId)
  }

  return killed
}
