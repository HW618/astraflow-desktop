/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, shell } = require("electron")
const { spawn } = require("node:child_process")
const { existsSync, mkdirSync } = require("node:fs")
const { get } = require("node:http")
const { createServer } = require("node:net")
const { join, resolve } = require("node:path")

const APP_NAME = "AstraFlow"
const LOOPBACK_HOST = "127.0.0.1"
const SERVER_START_TIMEOUT_MS = 90_000
const SMOKE_TIMEOUT_MS = 30_000

const isSmokeRun = process.env.ASTRAFLOW_ELECTRON_SMOKE === "1"
const shouldCheckForUpdates = app.isPackaged && !isSmokeRun
let mainWindow = null
let nextProcess = null
let serverUrl = null
let isQuitting = false
let lastServerOutput = ""
let updatePromptShown = false

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
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: LOOPBACK_HOST,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    PORT: String(port),
  }

  const child = spawn(
    process.execPath,
    existsSync(standaloneServer)
      ? [standaloneServer]
      : [nextBin, "start", "--hostname", LOOPBACK_HOST, "--port", String(port)],
    {
      cwd: appRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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
    lastServerOutput =
      `${lastServerOutput}\n${error.stack ?? error.message}`.slice(-6_000)
  })

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

function setupAutoUpdates() {
  if (!shouldCheckForUpdates) {
    return
  }

  let autoUpdater

  try {
    autoUpdater = require("electron-updater").autoUpdater
  } catch (error) {
    console.error("Failed to load electron-updater.", error)
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on("error", (error) => {
    console.error("Auto update failed.", error)
  })

  autoUpdater.on("update-downloaded", (info) => {
    if (updatePromptShown || !mainWindow || mainWindow.isDestroyed()) {
      return
    }

    updatePromptShown = true

    void dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: `${APP_NAME} update ready`,
        message: "A new AstraFlow update is ready to install.",
        detail: info?.version
          ? `Version ${info.version} has been downloaded. Restart AstraFlow to install it now, or install it when you quit later.`
          : "The update has been downloaded. Restart AstraFlow to install it now, or install it when you quit later.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall(false, true)
        }
      })
      .catch((error) => {
        console.error("Failed to show update prompt.", error)
      })
  })

  void autoUpdater.checkForUpdates().catch((error) => {
    console.error("Failed to check for updates.", error)
  })
}

function stopNextServer() {
  const child = nextProcess

  if (!child || child.killed) {
    return
  }

  child.kill()

  setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL")
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

  const url = await startNextServer()

  if (isSmokeRun) {
    await runSmoke(url)
    return
  }

  mainWindow = createMainWindow(url)
  setupAutoUpdates()
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
