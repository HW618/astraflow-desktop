/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("astraflowDesktop", {
  installUpdate: () => ipcRenderer.invoke("astraflow:install-update"),
})
