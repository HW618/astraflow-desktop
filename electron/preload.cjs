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
})
