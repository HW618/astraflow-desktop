/* eslint-disable @typescript-eslint/no-require-imports */
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  session,
  utilityProcess,
} = require("electron")
const {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs")
const { execFile, spawn } = require("node:child_process")
const { randomBytes } = require("node:crypto")
const { get } = require("node:http")
const { createServer } = require("node:net")
const { homedir } = require("node:os")
const { fileURLToPath } = require("node:url")
const {
  basename,
  dirname,
  extname,
  join,
  normalize,
  resolve,
} = require("node:path")
const pty = require("node-pty")
const { parseDn } = require("builder-util-runtime")

const APP_NAME = "AstraFlow"
const LOOPBACK_HOST = "127.0.0.1"
const SERVER_START_TIMEOUT_MS = 90_000
const SMOKE_TIMEOUT_MS = 30_000
const CODEBOX_GITHUB_OAUTH_CLIENT_ID = "Ov23li4imZRAMlx9enez"
const PENDING_UPDATE_INSTALLERS_FILE = "pending-update-installers.json"
const SECRET_KEY_FILE = "studio-secret.key"
const SIDE_PANEL_TEXT_FILE_LIMIT_BYTES = 2 * 1024 * 1024
const SIDE_PANEL_DATA_URL_FILE_LIMIT_BYTES = 50 * 1024 * 1024
const WINDOWS_SIGNATURE_CHAIN_ERROR_PATTERN =
  /certificate chain|trusted root|0x800b010a|cert_e_chaining|证书链|受信任的根/i
const WINDOWS_SIGNATURE_RECOVERABLE_STATUSES = new Set([1, 4])
const WINDOWS_SIGNER_THUMBPRINTS_ENV = "ASTRAFLOW_WINDOWS_SIGNER_THUMBPRINTS"

const isSmokeRun = process.env.ASTRAFLOW_ELECTRON_SMOKE === "1"
const isDevRun = process.env.ASTRAFLOW_ELECTRON_DEV === "1"
let mainWindow = null
let nextProcess = null
let serverUrl = null
let isQuitting = false
let lastServerOutput = ""
let autoUpdater = null
let updateInstallPromise = null
const terminalSessions = new Map()

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

function rememberServerOutput(chunk) {
  const text = String(chunk)
  lastServerOutput = `${lastServerOutput}${text}`.slice(-6_000)
  return text
}

function getAppRoot() {
  return app.isPackaged ? app.getAppPath() : resolve(__dirname, "..")
}

function getPendingUpdateInstallersPath() {
  return join(app.getPath("userData"), PENDING_UPDATE_INSTALLERS_FILE)
}

function cleanupPendingUpdateInstallers() {
  const markerPath = getPendingUpdateInstallersPath()

  if (!existsSync(markerPath)) {
    return
  }

  try {
    const installerPaths = JSON.parse(readFileSync(markerPath, "utf8"))

    if (Array.isArray(installerPaths)) {
      for (const installerPath of installerPaths) {
        if (typeof installerPath === "string" && installerPath.trim()) {
          rmSync(installerPath, { force: true })
        }
      }
    }
  } catch (error) {
    console.error("Failed to clean update installer.", error)
  } finally {
    rmSync(markerPath, { force: true })
  }
}

function rememberUpdateInstallers(installerPaths) {
  const normalizedPaths = (Array.isArray(installerPaths) ? installerPaths : [])
    .filter((installerPath) => typeof installerPath === "string")
    .map((installerPath) => installerPath.trim())
    .filter(Boolean)

  if (normalizedPaths.length === 0) {
    return
  }

  try {
    writeFileSync(
      getPendingUpdateInstallersPath(),
      JSON.stringify(normalizedPaths),
      "utf8"
    )
  } catch (error) {
    console.error("Failed to remember update installer.", error)
  }
}

function getFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()

    server.once("error", rejectPort)
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address()

      server.close(() => {
        if (address && typeof address === "object") {
          resolvePort(address.port)
          return
        }

        rejectPort(new Error("Unable to allocate a loopback port."))
      })
    })
  })
}

function request(url) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = get(url, (res) => {
      res.resume()
      res.once("end", () => resolveRequest(res.statusCode ?? 0))
    })

    req.setTimeout(5_000, () => {
      req.destroy(new Error("Timed out while waiting for the Next.js server."))
    })
    req.once("error", rejectRequest)
  })
}

function waitForServer(url, child) {
  const startedAt = Date.now()

  return new Promise((resolveServer, rejectServer) => {
    let settled = false
    let timer = null

    function cleanup() {
      settled = true
      child.off("exit", onExit)

      if (timer) {
        clearTimeout(timer)
      }
    }

    function fail(error) {
      if (settled) return
      cleanup()
      rejectServer(error)
    }

    function onExit(code, signal) {
      fail(
        new Error(
          `Next.js server exited before startup (code ${code ?? "null"}, signal ${
            signal ?? "null"
          }).\n${lastServerOutput}`
        )
      )
    }

    async function poll() {
      if (settled) return

      if (Date.now() - startedAt > SERVER_START_TIMEOUT_MS) {
        fail(
          new Error(
            `Next.js server did not start in time.\n${lastServerOutput}`
          )
        )
        return
      }

      try {
        const statusCode = await request(url)

        if (statusCode > 0 && statusCode < 500) {
          cleanup()
          resolveServer()
          return
        }
      } catch {
        // Keep polling until the server accepts requests or the timeout expires.
      }

      timer = setTimeout(poll, 500)
    }

    child.once("exit", onExit)
    void poll()
  })
}

function startServerProcess(script, args, { appRoot, env }) {
  const child = utilityProcess.fork(script, args, {
    cwd: appRoot,
    env: sanitizeProcessEnv(env),
    serviceName: `${APP_NAME} Server`,
    stdio: ["ignore", "pipe", "pipe"],
  })

  nextProcess = child

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(rememberServerOutput(chunk))
  })
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(rememberServerOutput(chunk))
  })

  child.once("error", (type, location, report) => {
    lastServerOutput =
      `${lastServerOutput}\n${type}: ${location}\n${report}`.slice(-6_000)
  })

  return child
}

function sanitizeProcessEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined)
  )
}

function getBunCommand() {
  const npmExecPath = process.env.npm_execpath

  if (npmExecPath && /(^|[/\\])bun(?:\.exe)?$/i.test(npmExecPath)) {
    return npmExecPath
  }

  return process.platform === "win32" ? "bun.cmd" : "bun"
}

function startDevServerProcess(port, { appRoot, env }) {
  const child = spawn(
    getBunCommand(),
    [
      "run",
      "dev",
      "--",
      "--hostname",
      LOOPBACK_HOST,
      "--port",
      String(port),
    ],
    {
      cwd: appRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  )

  nextProcess = child

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(rememberServerOutput(chunk))
  })
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(rememberServerOutput(chunk))
  })

  child.once("error", (error) => {
    lastServerOutput = `${lastServerOutput}\n${error.stack ?? error.message}`.slice(
      -6_000
    )
  })

  return child
}

function resolveStudioSecretKey() {
  // Persist a 32-byte key encrypted at rest with the OS keychain (safeStorage)
  // and hand it to the server process as hex so it can encrypt sensitive
  // settings. Returns null when encryption is unavailable so the server falls
  // back to plaintext storage.
  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }

  const keyPath = join(app.getPath("userData"), SECRET_KEY_FILE)

  if (existsSync(keyPath)) {
    try {
      const decrypted = safeStorage.decryptString(readFileSync(keyPath))
      const trimmed = decrypted.trim()

      if (/^[0-9a-f]{64}$/i.test(trimmed)) {
        return trimmed
      }
    } catch {
      // Fall through and regenerate the key below.
    }
  }

  const key = randomBytes(32).toString("hex")

  try {
    writeFileSync(keyPath, safeStorage.encryptString(key))
  } catch {
    // If persistence fails, still return the key for this run so credentials
    // are encrypted in memory; they simply won't decrypt on the next launch.
  }

  return key
}

async function startNextServer() {
  const appRoot = getAppRoot()
  const standaloneServer = join(appRoot, "server.js")
  const nextBin = join(appRoot, "node_modules", "next", "dist", "bin", "next")

  if (!isDevRun && !existsSync(standaloneServer) && !existsSync(nextBin)) {
    throw new Error(
      `Next.js runtime was not packaged. Missing ${standaloneServer} and ${nextBin}.`
    )
  }

  const port = await getFreePort()
  const userData = app.getPath("userData")
  const dataDir = join(userData, "data")
  const filesDir = join(userData, "studio-files")
  const skillsDir = join(userData, "studio-skills")

  mkdirSync(dataDir, { recursive: true })
  mkdirSync(filesDir, { recursive: true })
  mkdirSync(skillsDir, { recursive: true })

  const secretKey = resolveStudioSecretKey()

  const env = {
    ...process.env,
    ASTRAFLOW_ELECTRON: "1",
    ASTRAFLOW_ELECTRON_DEV: isDevRun ? "1" : undefined,
    ASTRAFLOW_SQLITE_PATH: join(dataDir, "astraflow.sqlite"),
    ASTRAFLOW_STUDIO_FILES_PATH: filesDir,
    ASTRAFLOW_STUDIO_SKILLS_PATH: skillsDir,
    GITHUB_OAUTH_CLIENT_ID:
      process.env.GITHUB_OAUTH_CLIENT_ID || CODEBOX_GITHUB_OAUTH_CLIENT_ID,
    HOSTNAME: LOOPBACK_HOST,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: isDevRun ? "development" : "production",
    PORT: String(port),
  }

  if (secretKey) {
    env.ASTRAFLOW_SECRET_KEY = secretKey
  }

  const child = isDevRun
    ? startDevServerProcess(port, { appRoot, env })
    : existsSync(standaloneServer)
      ? startServerProcess(standaloneServer, [], { appRoot, env })
      : startServerProcess(
          nextBin,
          ["start", "--hostname", LOOPBACK_HOST, "--port", String(port)],
          { appRoot, env }
        )

  serverUrl = `http://${LOOPBACK_HOST}:${port}`
  await waitForServer(serverUrl, child)

  return serverUrl
}

function shouldOpenExternal(url) {
  if (url === "about:blank") {
    return false
  }

  if (serverUrl && url.startsWith(serverUrl)) {
    return false
  }

  try {
    const parsed = new URL(url)
    return isExternalOpenProtocol(parsed.protocol)
  } catch {
    return false
  }
}

function isExternalOpenProtocol(protocol) {
  return (
    protocol === "http:" ||
    protocol === "https:" ||
    protocol === "mailto:" ||
    protocol === "vscode:" ||
    protocol === "vscode-insiders:"
  )
}

function normalizeExternalOpenUrl(targetUrl) {
  if (typeof targetUrl !== "string") {
    return null
  }

  const trimmedUrl = targetUrl.trim()

  if (!trimmedUrl) {
    return null
  }

  try {
    const parsed = new URL(trimmedUrl)
    return isExternalOpenProtocol(parsed.protocol) ? parsed.toString() : null
  } catch {
    return null
  }
}

async function openExternalUrl(targetUrl) {
  const normalizedUrl = normalizeExternalOpenUrl(targetUrl)

  if (!normalizedUrl) {
    return false
  }

  try {
    await shell.openExternal(normalizedUrl)
    return true
  } catch (error) {
    console.error("Failed to open external URL.", error)
    return false
  }
}

function attachNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternal(url)) {
      void openExternalUrl(url)
      return { action: "deny" }
    }

    return { action: "allow" }
  })

  window.webContents.on("will-navigate", (event, url) => {
    if (!shouldOpenExternal(url)) {
      return
    }

    event.preventDefault()
    void openExternalUrl(url)
  })

  window.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key ?? "").toLowerCase()

    if ((input.meta || input.control) && key === "w") {
      event.preventDefault()
      window.webContents.send("astraflow:close-active-tab")
    }
  })
}

function createMainWindow(url, { show = true } = {}) {
  const macWindowOptions =
    process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset",
          transparent: true,
          backgroundColor: "#00000000",
          vibrancy: "sidebar",
          // Vertically centered with the --titlebar-height (3rem) row that
          // acts as the drag region on macOS: 48/2 - 12/2 = 18.
          trafficLightPosition: { x: 13, y: 18 },
        }
      : {}

  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: "#f7f6f2",
    show: false,
    ...macWindowOptions,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  })

  attachNavigationGuards(window)

  if (process.platform === "darwin") {
    // Let the renderer collapse the traffic-light padding while the lights
    // are auto-hidden in fullscreen.
    const sendFullScreenState = (isFullScreen) => {
      if (!window.isDestroyed()) {
        window.webContents.send("astraflow:fullscreen-changed", isFullScreen)
      }
    }

    window.on("enter-full-screen", () => sendFullScreenState(true))
    window.on("leave-full-screen", () => sendFullScreenState(false))
  }

  window.once("closed", () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  window.once("ready-to-show", () => {
    if (show) {
      window.show()
    }
  })

  void window.loadURL(url)
  return window
}

function getDefaultShell() {
  if (process.platform === "win32") {
    return process.env.ComSpec || "powershell.exe"
  }

  return process.env.SHELL || "/bin/zsh"
}

function getDefaultShellArgs() {
  if (process.platform === "win32") {
    return []
  }

  return ["-l"]
}

function resolveTerminalCwd(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) {
    return homedir()
  }

  try {
    const resolved = resolve(cwd)

    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      return resolved
    }
  } catch {
    // Fall back to the user's home directory for malformed or inaccessible cwd.
  }

  return homedir()
}

function createTerminalSession(event, options = {}) {
  const id = randomBytes(12).toString("hex")
  const cols = Math.max(20, Math.min(400, Number(options.cols) || 80))
  const rows = Math.max(6, Math.min(160, Number(options.rows) || 24))
  const cwd = resolveTerminalCwd(options.cwd)
  const shellPath = getDefaultShell()
  const shellArgs = getDefaultShellArgs()
  const webContents = event.sender

  const terminal = pty.spawn(shellPath, shellArgs, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: sanitizeProcessEnv({
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ASTRAFLOW_TERMINAL: "1",
    }),
  })

  terminalSessions.set(id, {
    terminal,
    webContents,
  })

  terminal.onData((data) => {
    if (!webContents.isDestroyed()) {
      webContents.send("astraflow:terminal-data", { id, data })
    }
  })

  terminal.onExit(({ exitCode, signal }) => {
    terminalSessions.delete(id)

    if (!webContents.isDestroyed()) {
      webContents.send("astraflow:terminal-exit", { id, exitCode, signal })
    }
  })

  return { id, cwd }
}

function closeTerminalSession(id) {
  const session = terminalSessions.get(id)

  if (!session) {
    return false
  }

  terminalSessions.delete(id)
  session.terminal.kill()
  return true
}

function closeAllTerminalSessions() {
  for (const id of terminalSessions.keys()) {
    closeTerminalSession(id)
  }
}

function getDefaultSidePanelDirectory() {
  const downloadsPath = join(homedir(), "Downloads")

  try {
    if (existsSync(downloadsPath) && statSync(downloadsPath).isDirectory()) {
      return downloadsPath
    }
  } catch {
    // Fall back to home below.
  }

  return homedir()
}

function resolveSidePanelDirectory(directory) {
  if (typeof directory !== "string" || !directory.trim()) {
    return getDefaultSidePanelDirectory()
  }

  try {
    const resolved = resolve(directory)

    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      return resolved
    }
  } catch {
    // Fall back to the default directory for malformed or inaccessible paths.
  }

  return getDefaultSidePanelDirectory()
}

function mapSidePanelDirectoryEntry(parentPath, entry) {
  const path = join(parentPath, entry.name)

  try {
    const stats = statSync(path)

    return {
      name: entry.name,
      path,
      kind: stats.isDirectory() ? "directory" : "file",
      extension: stats.isDirectory()
        ? ""
        : extname(entry.name).replace(/^\./, "").toLowerCase(),
      size: stats.isDirectory() ? null : stats.size,
      modifiedAt: stats.mtimeMs,
    }
  } catch {
    return null
  }
}

function listSidePanelDirectory(directory) {
  const cwd = resolveSidePanelDirectory(directory)
  const parent = dirname(cwd)
  const entries = readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => mapSidePanelDirectoryEntry(cwd, entry))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1
      }

      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    })

  return {
    cwd,
    name: basename(cwd) || cwd,
    parent: parent !== cwd ? parent : null,
    entries,
  }
}

function readSidePanelTextFile(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("File path is required.")
  }

  const resolved = resolveSidePanelFilePath(filePath)
  const stats = statSync(resolved)

  if (!stats.isFile()) {
    throw new Error("Selected path is not a file.")
  }

  const bytes = readFileSync(resolved)
  const truncated = bytes.length > SIDE_PANEL_TEXT_FILE_LIMIT_BYTES
  const content = bytes
    .subarray(0, SIDE_PANEL_TEXT_FILE_LIMIT_BYTES)
    .toString("utf8")

  return {
    path: resolved,
    name: basename(resolved),
    directory: dirname(resolved),
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    content,
    truncated,
  }
}

function resolveSidePanelFilePath(filePath) {
  const trimmedPath = filePath.trim()

  if (trimmedPath.startsWith("/api/") || /^https?:\/\//i.test(trimmedPath)) {
    throw new Error("Selected target is not a local file.")
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(trimmedPath)) {
    if (trimmedPath.startsWith("file://")) {
      return fileURLToPath(trimmedPath)
    }

    throw new Error("Selected target is not a local file.")
  }

  return resolve(trimmedPath)
}

function getSidePanelMimeType(filePath) {
  const extension = extname(filePath).replace(/^\./, "").toLowerCase()
  const mimeTypes = {
    avif: "image/avif",
    gif: "image/gif",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
  }

  return mimeTypes[extension] ?? "application/octet-stream"
}

function readSidePanelDataUrlFile(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("File path is required.")
  }

  const resolved = resolveSidePanelFilePath(filePath)
  const stats = statSync(resolved)

  if (!stats.isFile()) {
    throw new Error("Selected path is not a file.")
  }

  if (stats.size > SIDE_PANEL_DATA_URL_FILE_LIMIT_BYTES) {
    throw new Error("Selected file is too large to preview.")
  }

  const mimeType = getSidePanelMimeType(resolved)
  const data = readFileSync(resolved).toString("base64")

  return {
    path: resolved,
    name: basename(resolved),
    directory: dirname(resolved),
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    mimeType,
    dataUrl: `data:${mimeType};base64,${data}`,
  }
}

function showSidePanelPathInFolder(path) {
  if (typeof path !== "string" || !path.trim()) {
    return false
  }

  try {
    shell.showItemInFolder(resolveSidePanelFilePath(path))
    return true
  } catch {
    return false
  }
}

async function openSidePanelPath(path) {
  if (typeof path !== "string" || !path.trim()) {
    return false
  }

  try {
    const errorMessage = await shell.openPath(resolveSidePanelFilePath(path))
    return errorMessage === ""
  } catch {
    return false
  }
}

async function clearSidePanelBrowserData() {
  await session.defaultSession.clearStorageData()
  await session.defaultSession.clearCache()
  return true
}

function preparePowerShellExec(command, timeout = 20_000) {
  return [
    'set "PSModulePath=" & chcp 65001 >NUL & powershell.exe',
    [
      "-NoProfile",
      "-NonInteractive",
      "-InputFormat",
      "None",
      "-Command",
      command,
    ],
    { shell: true, timeout, maxBuffer: 1024 * 1024 * 4 },
  ]
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''")
}

function readAuthenticodeSignature(filePath) {
  const escapedPath = escapePowerShellSingleQuoted(filePath)
  const command = `Get-AuthenticodeSignature -LiteralPath '${escapedPath}' | ConvertTo-Json -Depth 6 -Compress`

  return new Promise((resolveSignature, rejectSignature) => {
    execFile(...preparePowerShellExec(command), (error, stdout, stderr) => {
      if (error) {
        rejectSignature(error)
        return
      }

      if (stderr) {
        rejectSignature(
          new Error(`Cannot inspect Authenticode signature: ${stderr}`)
        )
        return
      }

      try {
        const trimmed = stdout.trim()

        if (!trimmed) {
          throw new Error("Empty Authenticode signature output.")
        }

        resolveSignature(JSON.parse(trimmed))
      } catch (parseError) {
        rejectSignature(parseError)
      }
    })
  })
}

function normalizeCertificateThumbprint(value) {
  return String(value ?? "")
    .replace(/[^a-f0-9]/gi, "")
    .toUpperCase()
}

function readSignerCertificate(signature) {
  return signature && typeof signature === "object"
    ? (signature.SignerCertificate ?? null)
    : null
}

function normalizeComparableWindowsPath(value) {
  return normalize(value).toLowerCase()
}

function signaturePathMatches(signature, expectedPath) {
  if (!signature?.Path) {
    return true
  }

  return (
    normalizeComparableWindowsPath(signature.Path) ===
    normalizeComparableWindowsPath(expectedPath)
  )
}

function parseDistinguishedName(value) {
  try {
    return parseDn(String(value ?? ""))
  } catch {
    return new Map()
  }
}

function publisherMatchesSigner(publisherNames, signerCertificate) {
  const subject = parseDistinguishedName(signerCertificate?.Subject)

  if (!subject.size) {
    return false
  }

  return publisherNames.some((publisherName) => {
    const publisherDn = parseDistinguishedName(publisherName)

    if (publisherDn.size) {
      return [...publisherDn.keys()].every(
        (key) => publisherDn.get(key) === subject.get(key)
      )
    }

    return publisherName === subject.get("CN")
  })
}

function signatureHasRecoverableChainError(signature, failureMessage = "") {
  const status = Number(signature?.Status)

  if (!WINDOWS_SIGNATURE_RECOVERABLE_STATUSES.has(status)) {
    return false
  }

  return WINDOWS_SIGNATURE_CHAIN_ERROR_PATTERN.test(
    `${signature?.StatusMessage ?? ""}\n${failureMessage}`
  )
}

function collectConfiguredWindowsSignerThumbprints() {
  return new Set(
    String(process.env[WINDOWS_SIGNER_THUMBPRINTS_ENV] ?? "")
      .split(/[\s,;|]+/)
      .map(normalizeCertificateThumbprint)
      .filter(Boolean)
  )
}

async function collectCurrentWindowsSignerThumbprints() {
  const thumbprints = collectConfiguredWindowsSignerThumbprints()

  if (!app.isPackaged || !existsSync(process.execPath)) {
    return thumbprints
  }

  const currentSignature = await readAuthenticodeSignature(process.execPath)
  const currentStatus = Number(currentSignature?.Status)

  if (
    currentStatus !== 0 &&
    !signatureHasRecoverableChainError(currentSignature)
  ) {
    return thumbprints
  }

  const currentThumbprint = normalizeCertificateThumbprint(
    readSignerCertificate(currentSignature)?.Thumbprint
  )

  if (currentThumbprint) {
    thumbprints.add(currentThumbprint)
  }

  return thumbprints
}

async function verifyWindowsUpdateSignatureFallback(
  publisherNames,
  updateFilePath,
  defaultFailure
) {
  if (process.platform !== "win32") {
    return defaultFailure
  }

  const updateSignature = await readAuthenticodeSignature(updateFilePath)

  if (
    !signatureHasRecoverableChainError(updateSignature, defaultFailure) ||
    !signaturePathMatches(updateSignature, updateFilePath)
  ) {
    return defaultFailure
  }

  const updateSigner = readSignerCertificate(updateSignature)
  const updateThumbprint = normalizeCertificateThumbprint(
    updateSigner?.Thumbprint
  )

  if (
    !updateThumbprint ||
    !publisherMatchesSigner(publisherNames, updateSigner)
  ) {
    return defaultFailure
  }

  const trustedThumbprints = await collectCurrentWindowsSignerThumbprints()

  if (!trustedThumbprints.has(updateThumbprint)) {
    return defaultFailure
  }

  console.warn(
    "Accepted Windows update signature with matching signer thumbprint after Windows reported an incomplete certificate chain.",
    { path: updateFilePath, thumbprint: updateThumbprint }
  )

  return null
}

function configureWindowsUpdateSignatureVerification(updater) {
  if (
    process.platform !== "win32" ||
    updater.__astraflowSignatureVerifierConfigured
  ) {
    return
  }

  const defaultVerifier = updater.verifyUpdateCodeSignature

  if (typeof defaultVerifier !== "function") {
    return
  }

  updater.verifyUpdateCodeSignature = async (
    publisherNames,
    updateFilePath
  ) => {
    const defaultFailure = await defaultVerifier(publisherNames, updateFilePath)

    if (defaultFailure == null) {
      return null
    }

    try {
      return await verifyWindowsUpdateSignatureFallback(
        publisherNames,
        updateFilePath,
        defaultFailure
      )
    } catch (error) {
      console.warn("Windows update signature fallback failed.", error)
      return defaultFailure
    }
  }
  updater.__astraflowSignatureVerifierConfigured = true
}

function normalizeUpdateError(error) {
  const message = error instanceof Error ? error.message : String(error)

  if (WINDOWS_SIGNATURE_CHAIN_ERROR_PATTERN.test(message)) {
    return new Error(
      "Windows could not verify the AstraFlow installer certificate chain. Please install the latest Windows root certificates or use the release page installer for this version."
    )
  }

  return error instanceof Error ? error : new Error(message)
}

function getAutoUpdater() {
  if (autoUpdater) {
    return autoUpdater
  }

  try {
    autoUpdater = require("electron-updater").autoUpdater
  } catch (error) {
    console.error("Failed to load electron-updater.", error)
    throw new Error("Updater is unavailable.")
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  configureWindowsUpdateSignatureVerification(autoUpdater)

  autoUpdater.on("error", (error) => {
    console.error("Auto update failed.", error)
  })

  return autoUpdater
}

function installUpdateNow() {
  if (!app.isPackaged && process.env.ASTRAFLOW_FORCE_UPDATE !== "1") {
    throw new Error("Update installation is only available in packaged apps.")
  }

  if (updateInstallPromise) {
    return updateInstallPromise
  }

  updateInstallPromise = new Promise((resolveInstall, rejectInstall) => {
    const updater = getAutoUpdater()
    let settled = false

    function cleanup() {
      updater.off("update-available", onUpdateAvailable)
      updater.off("update-not-available", onUpdateNotAvailable)
      updater.off("update-downloaded", onUpdateDownloaded)
      updater.off("error", onError)
    }

    function settle(error, value) {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      updateInstallPromise = null

      if (error) {
        rejectInstall(error)
      } else {
        resolveInstall(value)
      }
    }

    function onError(error) {
      settle(normalizeUpdateError(error))
    }

    function onUpdateNotAvailable() {
      settle(new Error("AstraFlow is already up to date."))
    }

    function onUpdateAvailable() {
      updater.downloadUpdate().then(rememberUpdateInstallers).catch(onError)
    }

    function onUpdateDownloaded(info) {
      const version = info?.version ?? null

      settle(null, { version })
      setTimeout(() => {
        updater.quitAndInstall(false, true)
      }, 250)
    }

    updater.once("update-available", onUpdateAvailable)
    updater.once("update-not-available", onUpdateNotAvailable)
    updater.once("update-downloaded", onUpdateDownloaded)
    updater.once("error", onError)

    updater.checkForUpdates().catch(onError)
  })

  return updateInstallPromise
}

function setupAppIpc() {
  ipcMain.handle("astraflow:install-update", async () => installUpdateNow())
  ipcMain.handle("astraflow:open-external", async (_event, url) =>
    openExternalUrl(url)
  )
  ipcMain.handle("astraflow:pick-folder", async () => {
    const options = { properties: ["openDirectory"] }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled) {
      return null
    }

    return result.filePaths[0] ?? null
  })
  ipcMain.handle("astraflow:side-panel-list-directory", (_event, directory) =>
    listSidePanelDirectory(directory)
  )
  ipcMain.handle("astraflow:side-panel-read-text-file", (_event, filePath) =>
    readSidePanelTextFile(filePath)
  )
  ipcMain.handle(
    "astraflow:side-panel-read-file-data-url",
    (_event, filePath) => readSidePanelDataUrlFile(filePath)
  )
  ipcMain.handle("astraflow:side-panel-show-item", (_event, path) =>
    showSidePanelPathInFolder(path)
  )
  ipcMain.handle("astraflow:side-panel-open-path", (_event, path) =>
    openSidePanelPath(path)
  )
  ipcMain.handle("astraflow:browser-clear-data", async () =>
    clearSidePanelBrowserData()
  )
  ipcMain.handle("astraflow:terminal-create", (event, options) =>
    createTerminalSession(event, options)
  )
  ipcMain.handle("astraflow:terminal-write", (_event, id, data) => {
    const session = terminalSessions.get(id)

    if (!session || typeof data !== "string") {
      return false
    }

    session.terminal.write(data)
    return true
  })
  ipcMain.handle("astraflow:terminal-resize", (_event, id, cols, rows) => {
    const session = terminalSessions.get(id)
    const nextCols = Number(cols)
    const nextRows = Number(rows)

    if (
      !session ||
      !Number.isFinite(nextCols) ||
      !Number.isFinite(nextRows)
    ) {
      return false
    }

    session.terminal.resize(
      Math.max(20, Math.min(400, Math.round(nextCols))),
      Math.max(6, Math.min(160, Math.round(nextRows)))
    )
    return true
  })
  ipcMain.handle("astraflow:terminal-close", (_event, id) =>
    closeTerminalSession(id)
  )
}

function stopNextServer() {
  const child = nextProcess

  if (!child || !child.pid) {
    return
  }

  child.kill()

  setTimeout(() => {
    if (child.pid) {
      child.kill()
    }
  }, 5_000).unref()
}

function loadForSmoke(window, url) {
  return new Promise((resolveLoad, rejectLoad) => {
    const timeout = setTimeout(() => {
      rejectLoad(new Error("Smoke window did not finish loading in time."))
    }, SMOKE_TIMEOUT_MS)

    window.webContents.once("did-finish-load", () => {
      clearTimeout(timeout)
      resolveLoad()
    })

    window.webContents.once("did-fail-load", (_event, code, description) => {
      clearTimeout(timeout)
      rejectLoad(
        new Error(`Smoke window failed to load: ${code} ${description}`)
      )
    })

    void window.loadURL(url)
  })
}

async function runSmoke(url) {
  const window = createMainWindow(url, { show: false })
  await loadForSmoke(window, url)
  app.exit(0)
}

async function bootstrap() {
  app.setAppUserModelId("cn.ucloud.astraflow.desktop")
  cleanupPendingUpdateInstallers()
  setupAppIpc()

  const url = await startNextServer()

  if (isSmokeRun) {
    await runSmoke(url)
    return
  }

  mainWindow = createMainWindow(url)
}

function showFatalError(error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(message)

  if (!isSmokeRun && app.isReady()) {
    dialog.showErrorBox(APP_NAME, message)
  }

  app.exit(1)
}

app.on("second-instance", () => {
  if (!mainWindow) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.focus()
})

app.on("before-quit", () => {
  isQuitting = true
  closeAllTerminalSessions()
  stopNextServer()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (mainWindow || !serverUrl || isQuitting) {
    return
  }

  mainWindow = createMainWindow(serverUrl)
})

if (gotSingleInstanceLock) {
  app.whenReady().then(bootstrap).catch(showFatalError)
}
