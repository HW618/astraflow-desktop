type AstraFlowDesktopUpdateResult = {
  version: string | null
}

type AstraFlowDesktopBridge = {
  platform: string
  installUpdate: () => Promise<AstraFlowDesktopUpdateResult>
}

interface Window {
  astraflowDesktop?: AstraFlowDesktopBridge
}
