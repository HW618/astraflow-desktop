type AstraFlowDesktopUpdateResult = {
  version: string | null
}

type AstraFlowDesktopBridge = {
  installUpdate: () => Promise<AstraFlowDesktopUpdateResult>
}

interface Window {
  astraflowDesktop?: AstraFlowDesktopBridge
}
