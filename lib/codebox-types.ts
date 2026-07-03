export type CodeBoxVolume = {
  volumeId: string
  name: string
  createdAt: string | null
  lastSeenAt: string | null
}

export type CodeBoxSandboxStatus = "running" | "paused" | "unknown"

export type CodeBoxSandbox = {
  sandboxId: string
  name: string | null
  ownerKey: string | null
  companyId: string | null
  projectId: string | null
  template: string
  status: CodeBoxSandboxStatus
  volumeId: string | null
  volumeName: string | null
  codeServerUrl: string | null
  codeServerHost: string | null
  codeServerPort: number
  password: string | null
  workspacePath: string
  repoUrl: string | null
  startedAt: string | null
  endAt: string | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string
}

export type CodeBoxDirectoryEntry = {
  name: string
  path: string
}

export type CodeBoxDirectoryList = {
  path: string
  parentPath: string | null
  directories: CodeBoxDirectoryEntry[]
}

export type CodeBoxSshAccess = {
  sandboxId: string
  user: string
  hostAlias: string
  hostName: string
  workspacePath: string
  webSocketUrl: string
  sshConfig: string
  sshConfigPath: string | null
  sshCommand: string
  vscodeUri: string
  remoteReady: boolean
  password: string | null
}

export type CodeBoxLocalPlatform =
  | "darwin"
  | "linux"
  | "freebsd"
  | "win32"
  | "unknown"

export type CodeBoxLocalDependencyStatus = {
  platform: CodeBoxLocalPlatform
  websocat: {
    installed: boolean
    path: string | null
    version: string | null
  }
}

export type CodeBoxGithubStatus = {
  configured: boolean
  login: string | null
  name: string | null
  email: string | null
  updatedAt: string | null
}

export type CodeBoxStatus = {
  template: string
  codeServerPort: number
  workspacePath: string
  modelverseApiKey: {
    configured: boolean
    name: string | null
    projectId: string | null
    updatedAt: string | null
  }
  github: CodeBoxGithubStatus
  installedCli: string[]
  installedExtensions: string[]
}
