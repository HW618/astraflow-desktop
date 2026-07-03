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

contextBridge.exposeInMainWorld("astraflowDesktop", {
  platform,
  installUpdate: () => ipcRenderer.invoke("astraflow:install-update"),
})
