import { posix } from "node:path"

import { Sandbox } from "@e2b/code-interpreter"

import {
  ASTRAFLOW_SANDBOX_TEMPLATE,
  ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS,
  ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN,
  ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  getAstraFlowSandboxConnectionOptions,
  readAstraFlowSandboxEnv,
} from "@/lib/astraflow-sandbox-runtime"
import {
  getStudioSessionSandbox,
  listStudioMessages,
  listStudioSessionFiles,
  touchStudioSessionSandbox,
  updateStudioMessageAttachments,
  updateStudioSessionFileSandboxPath,
  upsertStudioSessionSandbox,
} from "@/lib/studio-db"
import {
  bufferToArrayBuffer,
  readStudioFile,
  safeFileName,
} from "@/lib/studio-file-storage"
import type { StudioAttachment, StudioSessionFile } from "@/lib/studio-types"

const SESSION_SANDBOX_ROOT = "/home/user/astraflow"
const SESSION_UPLOAD_ROOT = `${SESSION_SANDBOX_ROOT}/uploads`
const SESSION_OUTPUT_ROOT = `${SESSION_SANDBOX_ROOT}/outputs`

export type SessionSandboxContext = {
  sandbox: Sandbox
  sandboxId: string
  files: StudioSessionFile[]
  manifest: string
}

function getAutoPauseTimeoutSeconds() {
  const value = Number(
    readAstraFlowSandboxEnv("sessionAutoPauseTimeoutSeconds")
  )

  if (!Number.isFinite(value)) {
    return ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS
  }

  return Math.min(Math.max(Math.trunc(value), 60), 3_600)
}

function getAutoPauseTimeoutMs() {
  return getAutoPauseTimeoutSeconds() * 1000
}

function createConnectionOptions(apiKey: string) {
  return getAstraFlowSandboxConnectionOptions(apiKey)
}

function createSandboxOptions(apiKey: string, sessionId: string) {
  return {
    ...createConnectionOptions(apiKey),
    timeoutMs: getAutoPauseTimeoutMs(),
    lifecycle: {
      onTimeout: { action: "pause", keepMemory: true },
      autoResume: true,
    },
    metadata: {
      app: "astraflow-desktop",
      tool: "session_code_interpreter",
      sessionId,
    },
  } as const
}

function createConnectOptions(apiKey: string) {
  return {
    ...createConnectionOptions(apiKey),
    timeoutMs: getAutoPauseTimeoutMs(),
  }
}

export function getSessionSandboxOutputRoot() {
  return SESSION_OUTPUT_ROOT
}

export function getSessionSandboxRoot() {
  return SESSION_SANDBOX_ROOT
}

export function normalizeSandboxFilePath(
  path: string,
  {
    relativeBase = SESSION_OUTPUT_ROOT,
  }: {
    relativeBase?: string
  } = {}
) {
  const trimmed = path.trim()

  if (!trimmed) {
    throw new Error("File path is required.")
  }

  const normalized = trimmed.startsWith("/")
    ? posix.normalize(trimmed)
    : posix.normalize(posix.join(relativeBase, trimmed))

  if (
    normalized !== SESSION_SANDBOX_ROOT &&
    !normalized.startsWith(`${SESSION_SANDBOX_ROOT}/`)
  ) {
    throw new Error(
      `Sandbox file paths must stay under ${SESSION_SANDBOX_ROOT}.`
    )
  }

  return normalized
}

export function normalizeSandboxOutputPath(path: string) {
  const trimmed = path.trim()

  if (trimmed.startsWith("/")) {
    return normalizeSandboxFilePath(trimmed)
  }

  const safeRelativePath = trimmed
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => safeFileName(part))
    .join("/")

  return normalizeSandboxFilePath(safeRelativePath || "output.txt", {
    relativeBase: SESSION_OUTPUT_ROOT,
  })
}

function createSandboxUploadPath(file: StudioSessionFile) {
  const messagePart = file.messageId ? safeFileName(file.messageId) : "session"
  const fileName = `${safeFileName(file.id)}-${safeFileName(file.originalName)}`

  return `${SESSION_UPLOAD_ROOT}/${messagePart}/${fileName}`
}

function updateAttachmentSandboxPath(
  sessionId: string,
  fileId: string,
  sandboxPath: string
) {
  for (const message of listStudioMessages(sessionId)) {
    let changed = false
    const attachments = message.attachments.map((attachment) => {
      if (attachment.id !== fileId) {
        return attachment
      }

      changed = true
      return { ...attachment, sandboxPath }
    })

    if (changed) {
      updateStudioMessageAttachments(message.id, attachments)
    }
  }
}

async function createFreshSandbox(apiKey: string, sessionId: string) {
  const sandbox = await Sandbox.create(
    ASTRAFLOW_SANDBOX_TEMPLATE,
    createSandboxOptions(apiKey, sessionId)
  )

  upsertStudioSessionSandbox({
    sessionId,
    sandboxId: sandbox.sandboxId,
    sandboxDomain:
      readAstraFlowSandboxEnv("domain") ?? ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN,
    template: ASTRAFLOW_SANDBOX_TEMPLATE,
    status: "running",
    autoPauseTimeoutSeconds: getAutoPauseTimeoutSeconds(),
  })

  return sandbox
}

export async function getOrCreateSessionSandbox({
  sessionId,
  apiKey,
}: {
  sessionId: string
  apiKey: string
}) {
  const existing = getStudioSessionSandbox(sessionId)

  if (existing?.sandboxId) {
    try {
      const sandbox = await Sandbox.connect(
        existing.sandboxId,
        createConnectOptions(apiKey)
      )

      await sandbox.setTimeout(getAutoPauseTimeoutMs(), {
        requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
      })
      touchStudioSessionSandbox(sessionId, "running")

      return sandbox
    } catch {
      // The stored sandbox may have expired or been removed. Create a new one
      // and let upload_file re-upload individual files on demand.
    }
  }

  return createFreshSandbox(apiKey, sessionId)
}

async function uploadFileToSandbox({
  sandbox,
  sessionId,
  file,
  force,
}: {
  sandbox: Sandbox
  sessionId: string
  file: StudioSessionFile
  force: boolean
}) {
  if (file.sandboxPath && !force) {
    return file
  }

  const sandboxPath = file.sandboxPath || createSandboxUploadPath(file)
  const buffer = readStudioFile(file.storagePath)

  await sandbox.files.write(sandboxPath, bufferToArrayBuffer(buffer), {
    requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  })
  updateStudioSessionFileSandboxPath(file.id, sandboxPath)
  updateAttachmentSandboxPath(sessionId, file.id, sandboxPath)

  return { ...file, sandboxPath }
}

function findSessionFile({
  sessionId,
  fileId,
  name,
}: {
  sessionId: string
  fileId?: string
  name?: string
}) {
  const files = listStudioSessionFiles(sessionId)
  const normalizedName = name?.trim().toLowerCase()

  if (fileId?.trim()) {
    return files.find((file) => file.id === fileId.trim()) ?? null
  }

  if (!normalizedName) {
    return null
  }

  const exactMatches = files.filter(
    (file) => file.originalName.toLowerCase() === normalizedName
  )

  if (exactMatches.length === 1) {
    return exactMatches[0]
  }

  const fuzzyMatches = files.filter((file) =>
    file.originalName.toLowerCase().includes(normalizedName)
  )

  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : null
}

export function createAvailableSessionFilesManifest(sessionId: string) {
  const files = listStudioSessionFiles(sessionId)

  if (!files.length) {
    return ""
  }

  return [
    "Session files available for on-demand upload to AstraFlow Sandbox:",
    ...files.map((file) =>
      [
        `- ${file.originalName}`,
        `file_id: ${file.id}`,
        file.kind ? `kind: ${file.kind}` : null,
        file.mimeType ? `mime: ${file.mimeType}` : null,
        typeof file.size === "number" ? `bytes: ${file.size}` : null,
      ]
        .filter(Boolean)
        .join(" | ")
    ),
    "Before analyzing one of these files in run_code, call upload_file with its file_id to get a valid AstraFlow Sandbox path.",
  ].join("\n")
}

export async function uploadSessionFileToSandbox({
  sessionId,
  apiKey,
  fileId,
  name,
}: {
  sessionId: string
  apiKey: string
  fileId?: string
  name?: string
}) {
  const file = findSessionFile({ sessionId, fileId, name })

  if (!file) {
    throw new Error("Session file not found or file name is ambiguous.")
  }

  const previousSandboxId =
    getStudioSessionSandbox(sessionId)?.sandboxId ?? null
  const sandbox = await getOrCreateSessionSandbox({ sessionId, apiKey })
  const force = previousSandboxId !== sandbox.sandboxId
  const uploaded = await uploadFileToSandbox({
    sandbox,
    sessionId,
    file,
    force,
  })

  touchStudioSessionSandbox(sessionId, "running")

  return {
    sandbox,
    sandboxId: sandbox.sandboxId,
    file: uploaded,
  }
}

export function describeAttachmentForPrompt(attachment: StudioAttachment) {
  return [
    `Attachment: ${attachment.name}`,
    attachment.id ? `file_id: ${attachment.id}` : null,
    `type: ${attachment.type}`,
    `mime: ${attachment.mimeType}`,
    typeof attachment.size === "number" ? `bytes: ${attachment.size}` : null,
    "call upload_file with file_id before using this file in code",
  ]
    .filter(Boolean)
    .join(" | ")
}
