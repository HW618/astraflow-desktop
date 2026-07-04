type AstraFlowDesktopUpdateResult = {
  version: string | null
}

type AstraFlowTerminalCreateOptions = {
  cwd?: string | null
  cols?: number
  rows?: number
}

type AstraFlowTerminalCreateResult = {
  id: string
  cwd: string
}

type AstraFlowTerminalDataPayload = {
  id: string
  data: string
}

type AstraFlowTerminalExitPayload = {
  id: string
  exitCode: number
  signal?: number
}

type AstraFlowSidePanelDirectoryEntry = {
  name: string
  path: string
  kind: "directory" | "file"
  extension: string
  size: number | null
  modifiedAt: number
}

type AstraFlowSidePanelDirectory = {
  cwd: string
  name: string
  parent: string | null
  entries: AstraFlowSidePanelDirectoryEntry[]
}

type AstraFlowSidePanelTextFile = {
  path: string
  name: string
  directory: string
  size: number
  modifiedAt: number
  content: string
  truncated: boolean
}

type AstraFlowSidePanelDataUrlFile = {
  path: string
  name: string
  directory: string
  size: number
  modifiedAt: number
  mimeType: string
  dataUrl: string
}

type AstraFlowDesktopBridge = {
  platform: string
  installUpdate: () => Promise<AstraFlowDesktopUpdateResult>
  openExternal: (url: string) => Promise<boolean>
  pickFolder: () => Promise<string | null>
  sidePanelListDirectory: (
    directory?: string | null
  ) => Promise<AstraFlowSidePanelDirectory>
  sidePanelReadTextFile: (path: string) => Promise<AstraFlowSidePanelTextFile>
  sidePanelReadFileDataUrl: (
    path: string
  ) => Promise<AstraFlowSidePanelDataUrlFile>
  sidePanelShowItem: (path: string) => Promise<boolean>
  browserClearData: () => Promise<boolean>
  terminalCreate: (
    options?: AstraFlowTerminalCreateOptions
  ) => Promise<AstraFlowTerminalCreateResult>
  terminalWrite: (id: string, data: string) => Promise<boolean>
  terminalResize: (id: string, cols: number, rows: number) => Promise<boolean>
  terminalClose: (id: string) => Promise<boolean>
  onTerminalData: (
    callback: (payload: AstraFlowTerminalDataPayload) => void
  ) => () => void
  onTerminalExit: (
    callback: (payload: AstraFlowTerminalExitPayload) => void
  ) => () => void
  onCloseTabCommand: (callback: () => void) => () => void
}

interface Window {
  astraflowDesktop?: AstraFlowDesktopBridge
}
