import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

import { safeFileName } from "@/lib/studio-file-storage"

const DEFAULT_WORKSPACE_ROOT_DIRECTORY = ".data"
const DEFAULT_WORKSPACE_ROOT_NAME = "acp-workspaces"

function getConfiguredWorkspaceRoot() {
  return process.env.ASTRAFLOW_ACP_WORKSPACES_PATH?.trim() || null
}

function getWorkspaceRoot() {
  const configuredWorkspaceRoot = getConfiguredWorkspaceRoot()

  if (configuredWorkspaceRoot) {
    return configuredWorkspaceRoot
  }

  const configuredStudioFilesRoot =
    process.env.ASTRAFLOW_STUDIO_FILES_PATH?.trim()

  if (configuredStudioFilesRoot) {
    return join(dirname(configuredStudioFilesRoot), DEFAULT_WORKSPACE_ROOT_NAME)
  }

  return join(
    process.cwd(),
    DEFAULT_WORKSPACE_ROOT_DIRECTORY,
    DEFAULT_WORKSPACE_ROOT_NAME
  )
}

export function ensureAcpWorkspace(sessionId: string) {
  const workspace = join(
    /* turbopackIgnore: true */ getWorkspaceRoot(),
    safeFileName(sessionId)
  )

  mkdirSync(/* turbopackIgnore: true */ workspace, { recursive: true })

  return workspace
}
