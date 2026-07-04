/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron")

const platform = process.platform

function markDesktopEnvironment() {
  document.documentElement.dataset.astraflowDesktop = "true"
  document.documentElement.dataset.astraflowPlatform = platform
}

try {
  markDesktopEnvironment()
} catch {
  window.addEventListener("DOMContentLoaded", markDesktopEnvironment, {
    once: true,
  })
}

ipcRenderer.on("astraflow:fullscreen-changed", (_event, isFullScreen) => {
  document.documentElement.dataset.astraflowFullscreen = isFullScreen
    ? "true"
    : "false"
})

contextBridge.exposeInMainWorld("astraflowDesktop", {
  platform,
  installUpdate: () => ipcRenderer.invoke("astraflow:install-update"),
  openExternal: (url) => ipcRenderer.invoke("astraflow:open-external", url),
  pickFolder: () => ipcRenderer.invoke("astraflow:pick-folder"),
  sidePanelListDirectory: (directory) =>
    ipcRenderer.invoke("astraflow:side-panel-list-directory", directory),
  sidePanelReadTextFile: (filePath) =>
    ipcRenderer.invoke("astraflow:side-panel-read-text-file", filePath),
  sidePanelReadFileDataUrl: (filePath) =>
    ipcRenderer.invoke("astraflow:side-panel-read-file-data-url", filePath),
  sidePanelShowItem: (path) =>
    ipcRenderer.invoke("astraflow:side-panel-show-item", path),
  browserClearData: () => ipcRenderer.invoke("astraflow:browser-clear-data"),
  terminalCreate: (options) =>
    ipcRenderer.invoke("astraflow:terminal-create", options),
  terminalWrite: (id, data) =>
    ipcRenderer.invoke("astraflow:terminal-write", id, data),
  terminalResize: (id, cols, rows) =>
    ipcRenderer.invoke("astraflow:terminal-resize", id, cols, rows),
  terminalClose: (id) => ipcRenderer.invoke("astraflow:terminal-close", id),
  onTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload)

    ipcRenderer.on("astraflow:terminal-data", listener)

    return () => {
      ipcRenderer.removeListener("astraflow:terminal-data", listener)
    }
  },
  onTerminalExit: (callback) => {
    const listener = (_event, payload) => callback(payload)

    ipcRenderer.on("astraflow:terminal-exit", listener)

    return () => {
      ipcRenderer.removeListener("astraflow:terminal-exit", listener)
    }
  },
  onCloseTabCommand: (callback) => {
    const listener = () => callback()

    ipcRenderer.on("astraflow:close-active-tab", listener)

    return () => {
      ipcRenderer.removeListener("astraflow:close-active-tab", listener)
    }
  },
})
