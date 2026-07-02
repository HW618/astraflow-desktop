import { randomUUID } from "node:crypto"
import { posix } from "node:path"

import { Sandbox, Volume } from "@e2b/code-interpreter"

import {
  ASTRAFLOW_SANDBOX_TEMPLATE,
  ASTRAFLOW_SANDBOX_DEFAULT_AUTO_PAUSE_TIMEOUT_SECONDS,
  ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN,
  ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
  getAstraFlowSandboxConnectionOptions,
  readAstraFlowSandboxEnv,
} from "@/lib/astraflow-sandbox-runtime"
import {
  getStudioSessionSandboxVolumeRecord,
  getStudioSessionSandbox,
  listStudioMessages,
  listStudioSessionFiles,
  saveStudioSessionSandboxVolumeRecord,
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
const SESSION_VOLUME_NAME = "astraflow-studio-sessions"
const SESSION_VOLUME_MOUNT_ROOT = "/mnt/.astraflow-sessions"
const SESSION_VOLUME_SESSION_ROOT = `${SESSION_VOLUME_MOUNT_ROOT}/sessions`
const SESSION_VOLUME_RELATIVE_SESSION_ROOT = "sessions"

type SessionVolumeWorkspace = {
  volume: Volume
  volumeId: string
  volumeName: string
  volumePath: string
}

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

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function bytesToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

function normalizeVolumePath(value: string) {
  const normalized = posix.normalize(value.trim().replace(/^\/+/, ""))

  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Invalid session volume path.")
  }

  return normalized
}

function createSessionVolumePath() {
  return normalizeVolumePath(
    posix.join(SESSION_VOLUME_RELATIVE_SESSION_ROOT, randomUUID())
  )
}

function getMountedSessionVolumePath(volumePath: string) {
  return posix.join(SESSION_VOLUME_MOUNT_ROOT, normalizeVolumePath(volumePath))
}

async function runChecked(
  sandbox: Sandbox,
  command: string,
  step: string,
  timeoutMs = 60_000
) {
  const result = await sandbox.commands.run(command, {
    timeoutMs,
    requestTimeoutMs: Math.max(
      timeoutMs + 10_000,
      ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS
    ),
  })

  if (result.exitCode !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n")
    throw new Error(`${step} failed: ${detail || "command exited with error"}`)
  }

  return result
}

async function ensureSessionVolume(apiKey: string) {
  const connectionOptions = createConnectionOptions(apiKey)
  const saved = getStudioSessionSandboxVolumeRecord()

  if (saved?.volumeId) {
    try {
      const volume = await Volume.connect(saved.volumeId, connectionOptions)

      if (volume.name !== saved.name) {
        saveStudioSessionSandboxVolumeRecord({
          volumeId: volume.volumeId,
          name: volume.name,
        })
      }

      return volume
    } catch {
      // Fall through to lookup by the shared name. The saved volume may have
      // been deleted outside the app.
    }
  }

  const existing = (await Volume.list(connectionOptions)).find(
    (volume) => volume.name === SESSION_VOLUME_NAME
  )
  const volume = existing
    ? await Volume.connect(existing.volumeId, connectionOptions)
    : await Volume.create(SESSION_VOLUME_NAME, connectionOptions)

  saveStudioSessionSandboxVolumeRecord({
    volumeId: volume.volumeId,
    name: volume.name,
  })

  return volume
}

async function resolveSessionVolume({
  apiKey,
  volumeId,
}: {
  apiKey: string
  volumeId?: string | null
}) {
  const connectionOptions = createConnectionOptions(apiKey)

  if (volumeId) {
    try {
      return await Volume.connect(volumeId, connectionOptions)
    } catch {
      return ensureSessionVolume(apiKey)
    }
  }

  return ensureSessionVolume(apiKey)
}

async function resolveSessionWorkspace({
  apiKey,
  volumeId,
  volumePath,
}: {
  apiKey: string
  volumeId?: string | null
  volumePath?: string | null
}): Promise<SessionVolumeWorkspace> {
  const volume = await resolveSessionVolume({ apiKey, volumeId })
  const normalizedVolumePath = volumePath
    ? normalizeVolumePath(volumePath)
    : createSessionVolumePath()

  return {
    volume,
    volumeId: volume.volumeId,
    volumeName: volume.name,
    volumePath: normalizedVolumePath,
  }
}

function createSandboxOptions(
  apiKey: string,
  sessionId: string,
  workspace: SessionVolumeWorkspace
) {
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
      sessionVolumeId: workspace.volumeId,
      sessionVolumeName: workspace.volumeName,
      sessionVolumePath: workspace.volumePath,
    },
    volumeMounts: {
      [SESSION_VOLUME_MOUNT_ROOT]: workspace.volume,
    },
  } as const
}

function createMaintenanceSandboxOptions(
  apiKey: string,
  sessionId: string,
  volume: Volume
) {
  return {
    ...createConnectionOptions(apiKey),
    timeoutMs: 60_000,
    lifecycle: {
      onTimeout: "kill",
    },
    metadata: {
      app: "astraflow-desktop",
      tool: "session_volume_cleanup",
      sessionId,
      sessionVolumeId: volume.volumeId,
      sessionVolumeName: volume.name,
    },
    volumeMounts: {
      [SESSION_VOLUME_MOUNT_ROOT]: volume,
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

async function bootstrapSessionWorkspace(sandbox: Sandbox, volumePath: string) {
  const target = getMountedSessionVolumePath(volumePath)
  const script = [
    "set -e",
    `mount_root=${shellQuote(SESSION_VOLUME_MOUNT_ROOT)}`,
    `sessions_root=${shellQuote(SESSION_VOLUME_SESSION_ROOT)}`,
    `target=${shellQuote(target)}`,
    `visible_root=${shellQuote(SESSION_SANDBOX_ROOT)}`,
    'test -d "$mount_root"',
    'case "$target" in "$sessions_root"/*) ;; *) exit 64 ;; esac',
    'mkdir -p "$target"',
    'chmod 700 "$target"',
    'mkdir -p "$(dirname "$visible_root")"',
    'if [ -e "$visible_root" ] && [ ! -L "$visible_root" ]; then',
    '  if [ -z "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]; then',
    '    cp -a "$visible_root"/. "$target"/ 2>/dev/null || true',
    "  fi",
    '  rm -rf "$visible_root"',
    "fi",
    'if [ -L "$visible_root" ]; then',
    '  current="$(readlink "$visible_root")"',
    '  [ "$current" = "$target" ] || rm -f "$visible_root"',
    "fi",
    '[ -e "$visible_root" ] || ln -s "$target" "$visible_root"',
    'mkdir -p "$visible_root/uploads" "$visible_root/outputs"',
  ].join("\n")

  await runChecked(
    sandbox,
    `bash -lc ${shellQuote(script)}`,
    "bootstrap session workspace",
    60_000
  )
}

async function exportLegacySessionRoot(sandbox: Sandbox) {
  const archivePath = "/tmp/astraflow-session-root.tgz"

  try {
    const script = [
      "set -e",
      `archive=${shellQuote(archivePath)}`,
      `root=${shellQuote(SESSION_SANDBOX_ROOT)}`,
      'rm -f "$archive"',
      'if [ -d "$root" ]; then',
      '  tar -C /home/user -czf "$archive" astraflow',
      "fi",
    ].join("\n")

    await runChecked(
      sandbox,
      `bash -lc ${shellQuote(script)}`,
      "archive legacy session workspace",
      120_000
    )

    return await sandbox.files.read(archivePath, {
      format: "bytes",
      requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
    })
  } catch {
    return null
  }
}

async function restoreLegacySessionRoot({
  sandbox,
  volumePath,
  archive,
}: {
  sandbox: Sandbox
  volumePath: string
  archive: Uint8Array | null
}) {
  if (!archive?.byteLength) {
    return
  }

  const target = getMountedSessionVolumePath(volumePath)
  const archivePath = "/tmp/astraflow-session-root.tgz"

  try {
    await sandbox.files.write(archivePath, bytesToArrayBuffer(archive), {
      requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
    })
    await runChecked(
      sandbox,
      [
        `mkdir -p ${shellQuote(target)}`,
        `tar -C ${shellQuote(target)} --strip-components=1 -xzf ${shellQuote(
          archivePath
        )}`,
        `rm -f ${shellQuote(archivePath)}`,
      ].join(" && "),
      "restore legacy session workspace",
      120_000
    )
  } catch {
    // Best-effort migration should not block creation of the volume-backed
    // sandbox. Local attachments can still be re-uploaded on demand.
  }
}

async function createFreshSandbox({
  apiKey,
  sessionId,
  workspace,
  legacyArchive = null,
}: {
  apiKey: string
  sessionId: string
  workspace: SessionVolumeWorkspace
  legacyArchive?: Uint8Array | null
}) {
  const sandbox = await Sandbox.create(
    ASTRAFLOW_SANDBOX_TEMPLATE,
    createSandboxOptions(apiKey, sessionId, workspace)
  )

  try {
    await bootstrapSessionWorkspace(sandbox, workspace.volumePath)
    await restoreLegacySessionRoot({
      sandbox,
      volumePath: workspace.volumePath,
      archive: legacyArchive,
    })
    await bootstrapSessionWorkspace(sandbox, workspace.volumePath)
  } catch (error) {
    await sandbox
      .kill({ requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS })
      .catch(() => undefined)
    throw error
  }

  upsertStudioSessionSandbox({
    sessionId,
    sandboxId: sandbox.sandboxId,
    sandboxDomain:
      readAstraFlowSandboxEnv("domain") ?? ASTRAFLOW_SANDBOX_DEFAULT_DOMAIN,
    template: ASTRAFLOW_SANDBOX_TEMPLATE,
    status: "running",
    autoPauseTimeoutSeconds: getAutoPauseTimeoutSeconds(),
    volumeId: workspace.volumeId,
    volumeName: workspace.volumeName,
    volumePath: workspace.volumePath,
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
  const workspace = await resolveSessionWorkspace({
    apiKey,
    volumeId: existing?.volumeId,
    volumePath: existing?.volumePath,
  })
  let legacySandbox: Sandbox | null = null
  let legacyArchive: Uint8Array | null = null

  if (existing?.sandboxId) {
    try {
      const sandbox = await Sandbox.connect(
        existing.sandboxId,
        createConnectOptions(apiKey)
      )

      await sandbox.setTimeout(getAutoPauseTimeoutMs(), {
        requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS,
      })

      if (existing.volumeId && existing.volumePath) {
        await bootstrapSessionWorkspace(sandbox, workspace.volumePath)
        touchStudioSessionSandbox(sessionId, "running")

        return sandbox
      }

      legacySandbox = sandbox
      legacyArchive = await exportLegacySessionRoot(sandbox)
    } catch {
      // The stored sandbox may have expired or been removed. Create a new one
      // and let upload_file re-upload individual files on demand.
    }
  }

  const sandbox = await createFreshSandbox({
    apiKey,
    sessionId,
    workspace,
    legacyArchive,
  })

  if (legacySandbox && legacySandbox.sandboxId !== sandbox.sandboxId) {
    await legacySandbox
      .kill({ requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS })
      .catch(() => undefined)
  }

  return sandbox
}

async function removeSessionVolumePath(
  sandbox: Sandbox,
  volumePath: string,
  timeoutMs = 60_000
) {
  const target = getMountedSessionVolumePath(volumePath)
  const script = [
    "set -e",
    `mount_root=${shellQuote(SESSION_VOLUME_MOUNT_ROOT)}`,
    `sessions_root=${shellQuote(SESSION_VOLUME_SESSION_ROOT)}`,
    `target=${shellQuote(target)}`,
    'test -d "$mount_root"',
    'case "$target" in "$sessions_root"/*) rm -rf -- "$target" ;; *) exit 64 ;; esac',
  ].join("\n")

  await runChecked(
    sandbox,
    `bash -lc ${shellQuote(script)}`,
    "remove session volume workspace",
    timeoutMs
  )
}

export async function cleanupSessionSandboxVolumeData({
  sessionId,
  apiKey,
}: {
  sessionId: string
  apiKey: string
}) {
  const existing = getStudioSessionSandbox(sessionId)

  if (!existing?.volumePath) {
    return false
  }

  if (existing.sandboxId) {
    try {
      const sandbox = await Sandbox.connect(
        existing.sandboxId,
        createConnectOptions(apiKey)
      )
      await removeSessionVolumePath(sandbox, existing.volumePath)

      return true
    } catch {
      // Fall through to a maintenance sandbox that mounts the shared volume.
    }
  }

  const volume = await resolveSessionVolume({
    apiKey,
    volumeId: existing.volumeId,
  })
  const maintenanceSandbox = await Sandbox.create(
    ASTRAFLOW_SANDBOX_TEMPLATE,
    createMaintenanceSandboxOptions(apiKey, sessionId, volume)
  )

  try {
    await removeSessionVolumePath(maintenanceSandbox, existing.volumePath)

    return true
  } finally {
    await maintenanceSandbox
      .kill({ requestTimeoutMs: ASTRAFLOW_SANDBOX_REQUEST_TIMEOUT_MS })
      .catch(() => undefined)
  }
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
