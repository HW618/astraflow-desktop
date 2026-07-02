/* eslint-disable @typescript-eslint/no-require-imports */
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  utilityProcess,
} = require("electron")
const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs")
const { get } = require("node:http")
const { createServer } = require("node:net")
const { join, resolve } = require("node:path")

const APP_NAME = "AstraFlow"
const LOOPBACK_HOST = "127.0.0.1"
const SERVER_START_TIMEOUT_MS = 90_000
const SMOKE_TIMEOUT_MS = 30_000
const CODEBOX_GITHUB_OAUTH_CLIENT_ID = "Ov23li4imZRAMlx9enez"
const PENDING_UPDATE_INSTALLERS_FILE = "pending-update-installers.json"

const isSmokeRun = process.env.ASTRAFLOW_ELECTRON_SMOKE === "1"
let mainWindow = null
let nextProcess = null
let serverUrl = null
let isQuitting = false
let lastServerOutput = ""
let autoUpdater = null
let updateInstallPromise = null

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
    env,
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

async function startNextServer() {
  const appRoot = getAppRoot()
  const standaloneServer = join(appRoot, "server.js")
  const nextBin = join(appRoot, "node_modules", "next", "dist", "bin", "next")

  if (!existsSync(standaloneServer) && !existsSync(nextBin)) {
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

  const env = {
    ...process.env,
    ASTRAFLOW_ELECTRON: "1",
    ASTRAFLOW_SQLITE_PATH: join(dataDir, "astraflow.sqlite"),
    ASTRAFLOW_STUDIO_FILES_PATH: filesDir,
    ASTRAFLOW_STUDIO_SKILLS_PATH: skillsDir,
    GITHUB_OAUTH_CLIENT_ID:
      process.env.GITHUB_OAUTH_CLIENT_ID || CODEBOX_GITHUB_OAUTH_CLIENT_ID,
    HOSTNAME: LOOPBACK_HOST,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    PORT: String(port),
  }

  const child = existsSync(standaloneServer)
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
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function attachNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternal(url)) {
      void shell.openExternal(url)
      return { action: "deny" }
    }

    return { action: "allow" }
  })

  window.webContents.on("will-navigate", (event, url) => {
    if (!shouldOpenExternal(url)) {
      return
    }

    event.preventDefault()
    void shell.openExternal(url)
  })
}

function createMainWindow(url, { show = true } = {}) {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: "#f7f6f2",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  })

  attachNavigationGuards(window)

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
      settle(error instanceof Error ? error : new Error(String(error)))
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
