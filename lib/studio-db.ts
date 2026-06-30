import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

import type {
  StudioAttachment,
  StudioMessageActivity,
  StudioImageGeneration,
  StudioImageOutput,
  StudioSavedImageOutput,
  StudioImageStatus,
  StudioMessage,
  StudioMessageRole,
  StudioMessagePart,
  StudioMessageStatus,
  StudioExaApiKey,
  StudioGenericLibraryFile,
  StudioModelverseApiKey,
  StudioMode,
  StudioOAuthStatus,
  StudioOAuthTokens,
  StudioSession,
  StudioSessionFile,
  StudioSessionFileKind,
  StudioSessionSandbox,
} from "@/lib/studio-types"

type DbSessionRow = {
  id: string
  mode: StudioMode
  title: string
  created_at: string
  updated_at: string
}

type DbMessageRow = {
  id: string
  session_id: string
  role: StudioMessageRole
  content: string
  model: string | null
  version_group_id: string | null
  version_index: number | null
  version_count: number | null
  active_version: number | null
  activities: string | null
  parts: string | null
  reasoning_content: string | null
  reasoning_duration_ms: number | null
  status: StudioMessageStatus
  attachments: string | null
  created_at: string
}

type DbSettingRow = {
  key: string
  value: string
  updated_at: string
}

type DbSessionSandboxRow = {
  session_id: string
  sandbox_id: string
  sandbox_domain: string | null
  template: string
  status: StudioSessionSandbox["status"]
  auto_pause_timeout_seconds: number
  created_at: string
  updated_at: string
  last_used_at: string
}

type DbSessionFileRow = {
  id: string
  session_id: string
  message_id: string | null
  kind: StudioSessionFileKind
  original_name: string
  mime_type: string | null
  size: number | null
  storage_path: string
  sandbox_path: string | null
  source_tool_call_id: string | null
  saved_at: string | null
  created_at: string
  updated_at: string
}

type CreateSessionInput = {
  mode: StudioMode
  title?: string
}

type CreateMessageInput = {
  id?: string
  sessionId: string
  role: StudioMessageRole
  content: string
  model?: string | null
  versionGroupId?: string | null
  replacesMessageId?: string | null
  activities?: StudioMessageActivity[]
  parts?: StudioMessagePart[]
  reasoningContent?: string
  reasoningDurationMs?: number | null
  status?: StudioMessageStatus
  attachments?: StudioAttachment[]
}

type UpdateMessageSnapshotInput = {
  messageId: string
  sessionId?: string
  content?: string
  activities?: StudioMessageActivity[]
  parts?: StudioMessagePart[]
  reasoningContent?: string
  reasoningDurationMs?: number | null
  status?: StudioMessageStatus
}

type UpsertSessionSandboxInput = {
  sessionId: string
  sandboxId: string
  sandboxDomain?: string | null
  template: string
  status?: StudioSessionSandbox["status"]
  autoPauseTimeoutSeconds: number
}

type CreateSessionFileInput = {
  id?: string
  sessionId: string
  messageId?: string | null
  kind: StudioSessionFileKind
  originalName: string
  mimeType?: string | null
  size?: number | null
  storagePath: string
  sandboxPath?: string | null
  sourceToolCallId?: string | null
  savedAt?: string | null
}

type DbImageGenerationRow = {
  id: string
  session_id: string
  model_square_id: string
  model_name: string
  manufacturer: string | null
  openapi_file: string | null
  operation_id: string | null
  prompt: string
  params: string
  status: StudioImageStatus
  error_message: string | null
  raw_response: string | null
  created_at: string
  completed_at: string | null
}

type DbImageOutputRow = {
  id: string
  generation_id: string
  output_index: number
  url: string | null
  data_url: string | null
  mime_type: string | null
  width: number | null
  height: number | null
  metadata: string | null
  saved_at: string | null
  created_at: string
}

type DbSavedImageOutputRow = {
  id: string
  generation_id: string
  session_id: string
  output_index: number
  prompt: string
  model_name: string
  manufacturer: string | null
  mime_type: string | null
  width: number | null
  height: number | null
  saved_at: string
  created_at: string
}

type CreateImageGenerationInput = {
  sessionId: string
  modelSquareId: string
  modelName: string
  manufacturer?: string | null
  openapiFile?: string | null
  operationId?: string | null
  prompt: string
  params: Record<string, unknown>
  status?: StudioImageStatus
}

type CreateImageOutputInput = {
  generationId: string
  index: number
  url?: string | null
  dataUrl?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  metadata?: unknown
}

type UpdateImageGenerationInput = {
  status: StudioImageStatus
  errorMessage?: string | null
  rawResponse?: unknown
  completedAt?: string | null
}

const DEFAULT_SESSION_TITLE = "New chat"
const STUDIO_MODELVERSE_API_KEY_SETTING = "modelverse_api_key"
const STUDIO_EXA_API_KEY_SETTING = "exa_api_key"
const STUDIO_OAUTH_SETTING = "ucloud_oauth_tokens"

let db: Database.Database | undefined

function getDatabasePath() {
  return (
    process.env.ASTRAFLOW_SQLITE_PATH?.trim() ??
    join(process.cwd(), ".data", "astraflow.sqlite")
  )
}

function getDb() {
  if (db) {
    return db
  }

  const dbPath = getDatabasePath()
  mkdirSync(dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  initializeSchema(db)
  migrateSchema(db)

  return db
}

function initializeSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS studio_sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      version_group_id TEXT,
      version_index INTEGER NOT NULL DEFAULT 1,
      active_version INTEGER NOT NULL DEFAULT 1,
      activities TEXT,
      parts TEXT,
      reasoning_content TEXT NOT NULL DEFAULT '',
      reasoning_duration_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'complete',
      attachments TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS studio_sessions_updated_at_idx
      ON studio_sessions(updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_messages_session_id_created_at_idx
      ON studio_messages(session_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS studio_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_session_sandboxes (
      session_id TEXT PRIMARY KEY,
      sandbox_id TEXT NOT NULL,
      sandbox_domain TEXT,
      template TEXT NOT NULL,
      status TEXT NOT NULL,
      auto_pause_timeout_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_session_files (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT,
      kind TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      storage_path TEXT NOT NULL,
      sandbox_path TEXT,
      source_tool_call_id TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES studio_messages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS studio_session_files_session_idx
      ON studio_session_files(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_session_files_saved_idx
      ON studio_session_files(saved_at DESC, created_at DESC);

    CREATE TABLE IF NOT EXISTS studio_image_generations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      model_square_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      manufacturer TEXT,
      openapi_file TEXT,
      operation_id TEXT,
      prompt TEXT NOT NULL,
      params TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      raw_response TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_image_outputs (
      id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL,
      output_index INTEGER NOT NULL,
      url TEXT,
      data_url TEXT,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      metadata TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (generation_id) REFERENCES studio_image_generations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS studio_image_generations_session_idx
      ON studio_image_generations(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_image_outputs_generation_idx
      ON studio_image_outputs(generation_id, output_index ASC);
  `)
}

function migrateSchema(database: Database.Database) {
  const columns = database
    .prepare(`PRAGMA table_info(studio_messages)`)
    .all() as Array<{ name: string }>

  if (!columns.some((column) => column.name === "attachments")) {
    database.exec(`ALTER TABLE studio_messages ADD COLUMN attachments TEXT`)
  }

  if (!columns.some((column) => column.name === "reasoning_content")) {
    database.exec(
      `ALTER TABLE studio_messages ADD COLUMN reasoning_content TEXT NOT NULL DEFAULT ''`
    )
  }

  if (!columns.some((column) => column.name === "reasoning_duration_ms")) {
    database.exec(
      `ALTER TABLE studio_messages ADD COLUMN reasoning_duration_ms INTEGER`
    )
  }

  if (!columns.some((column) => column.name === "model")) {
    database.exec(`ALTER TABLE studio_messages ADD COLUMN model TEXT`)
  }

  if (!columns.some((column) => column.name === "version_group_id")) {
    database.exec(
      `ALTER TABLE studio_messages ADD COLUMN version_group_id TEXT`
    )
  }

  if (!columns.some((column) => column.name === "version_index")) {
    database.exec(
      `ALTER TABLE studio_messages ADD COLUMN version_index INTEGER NOT NULL DEFAULT 1`
    )
  }

  if (!columns.some((column) => column.name === "active_version")) {
    database.exec(
      `ALTER TABLE studio_messages ADD COLUMN active_version INTEGER NOT NULL DEFAULT 1`
    )
  }

  if (!columns.some((column) => column.name === "activities")) {
    database.exec(`ALTER TABLE studio_messages ADD COLUMN activities TEXT`)
  }

  if (!columns.some((column) => column.name === "parts")) {
    database.exec(`ALTER TABLE studio_messages ADD COLUMN parts TEXT`)
  }
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeTitle(title: string | undefined) {
  const normalized = title?.trim()

  if (!normalized) {
    return DEFAULT_SESSION_TITLE
  }

  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized
}

function mapSession(row: DbSessionRow): StudioSession {
  return {
    id: row.id,
    mode: row.mode,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseAttachments(raw: string | null): StudioAttachment[] {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (item): item is StudioAttachment =>
        typeof item === "object" &&
        item !== null &&
        ((item as StudioAttachment).type === "image" ||
          (item as StudioAttachment).type === "file") &&
        typeof (item as StudioAttachment).name === "string" &&
        typeof (item as StudioAttachment).mimeType === "string"
    )
  } catch {
    return []
  }
}

function mapSessionSandbox(row: DbSessionSandboxRow): StudioSessionSandbox {
  return {
    sessionId: row.session_id,
    sandboxId: row.sandbox_id,
    sandboxDomain: row.sandbox_domain,
    template: row.template,
    status: row.status,
    autoPauseTimeoutSeconds: row.auto_pause_timeout_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  }
}

function mapSessionFile(row: DbSessionFileRow): StudioSessionFile {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    kind: row.kind,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    storagePath: row.storage_path,
    sandboxPath: row.sandbox_path,
    sourceToolCallId: row.source_tool_call_id,
    savedAt: row.saved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseActivities(raw: string | null): StudioMessageActivity[] {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (item): item is StudioMessageActivity =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as StudioMessageActivity).id === "string" &&
        typeof (item as StudioMessageActivity).toolName === "string" &&
        ((item as StudioMessageActivity).status === "running" ||
          (item as StudioMessageActivity).status === "complete" ||
          (item as StudioMessageActivity).status === "error")
    )
  } catch {
    return []
  }
}

function isStudioMessageActivity(
  value: unknown
): value is StudioMessageActivity {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StudioMessageActivity).id === "string" &&
    typeof (value as StudioMessageActivity).toolName === "string" &&
    ((value as StudioMessageActivity).status === "running" ||
      (value as StudioMessageActivity).status === "complete" ||
      (value as StudioMessageActivity).status === "error")
  )
}

function parseParts(raw: string | null): StudioMessagePart[] {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item): item is StudioMessagePart => {
      if (typeof item !== "object" || item === null) {
        return false
      }

      const part = item as StudioMessagePart

      if (part.type === "text") {
        return typeof part.id === "string" && typeof part.content === "string"
      }

      if (part.type === "reasoning") {
        return typeof part.id === "string" && typeof part.content === "string"
      }

      return (
        part.type === "tool" &&
        typeof part.id === "string" &&
        isStudioMessageActivity(part.activity)
      )
    })
  } catch {
    return []
  }
}

function mapMessage(row: DbMessageRow): StudioMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    model: row.model,
    versionGroupId: row.version_group_id,
    versionIndex: row.version_index ?? 1,
    versionCount: row.version_count ?? 1,
    isActiveVersion: row.active_version !== 0,
    activities: parseActivities(row.activities),
    parts: parseParts(row.parts),
    reasoningContent: row.reasoning_content ?? "",
    reasoningDurationMs: row.reasoning_duration_ms,
    status: row.status,
    attachments: parseAttachments(row.attachments),
    createdAt: row.created_at,
  }
}

function readStudioSetting(key: string) {
  return getDb()
    .prepare(
      `
        SELECT key, value, updated_at
        FROM studio_settings
        WHERE key = ?
      `
    )
    .get(key) as DbSettingRow | undefined
}

function writeStudioSetting(key: string, value: string, updatedAt = nowIso()) {
  getDb()
    .prepare(
      `
        INSERT INTO studio_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    )
    .run(key, value, updatedAt)

  return updatedAt
}

function deleteStudioSetting(key: string) {
  getDb()
    .prepare(
      `
        DELETE FROM studio_settings
        WHERE key = ?
      `
    )
    .run(key)
}

export function listStudioSessions() {
  const rows = getDb()
    .prepare(
      `
        SELECT id, mode, title, created_at, updated_at
        FROM studio_sessions
        ORDER BY updated_at DESC
      `
    )
    .all() as DbSessionRow[]

  return rows.map(mapSession)
}

export function getStudioSession(sessionId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT id, mode, title, created_at, updated_at
        FROM studio_sessions
        WHERE id = ?
      `
    )
    .get(sessionId) as DbSessionRow | undefined

  return row ? mapSession(row) : null
}

export function createStudioSession({ mode, title }: CreateSessionInput) {
  const session: StudioSession = {
    id: randomUUID(),
    mode,
    title: normalizeTitle(title),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_sessions (id, mode, title, created_at, updated_at)
        VALUES (@id, @mode, @title, @createdAt, @updatedAt)
      `
    )
    .run(session)

  return session
}

export function updateStudioSessionTitle(sessionId: string, title: string) {
  const normalized = normalizeTitle(title)

  getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET title = ?
        WHERE id = ?
      `
    )
    .run(normalized, sessionId)

  return getStudioSession(sessionId)
}

export function deleteStudioSession(sessionId: string) {
  const result = getDb()
    .prepare(
      `
        DELETE FROM studio_sessions
        WHERE id = ?
      `
    )
    .run(sessionId)

  return result.changes > 0
}

export function listStudioMessages(sessionId: string) {
  const rows = getDb()
    .prepare(
      `
        SELECT
          message.id,
          message.session_id,
          message.role,
          message.content,
          message.model,
          message.version_group_id,
          message.version_index,
          CASE
            WHEN message.version_group_id IS NULL THEN 1
            ELSE (
              SELECT COUNT(*)
              FROM studio_messages AS version
              WHERE version.session_id = message.session_id
                AND version.role = 'assistant'
                AND version.version_group_id = message.version_group_id
            )
          END AS version_count,
          message.active_version,
          message.activities,
          message.parts,
          message.reasoning_content,
          message.reasoning_duration_ms,
          message.status,
          message.attachments,
          message.created_at
        FROM studio_messages AS message
        WHERE message.session_id = ?
          AND (
            message.role != 'assistant'
            OR message.active_version = 1
          )
        ORDER BY
          CASE
            WHEN message.version_group_id IS NULL THEN message.created_at
            ELSE (
              SELECT MIN(version.created_at)
              FROM studio_messages AS version
              WHERE version.session_id = message.session_id
                AND version.role = 'assistant'
                AND version.version_group_id = message.version_group_id
            )
          END ASC,
          message.created_at ASC
      `
    )
    .all(sessionId) as DbMessageRow[]

  return rows.map(mapMessage)
}

export function listStudioMessageVersions(
  sessionId: string,
  versionGroupId: string
) {
  const rows = getDb()
    .prepare(
      `
        SELECT
          message.id,
          message.session_id,
          message.role,
          message.content,
          message.model,
          message.version_group_id,
          message.version_index,
          CASE
            WHEN message.version_group_id IS NULL THEN 1
            ELSE (
              SELECT COUNT(*)
              FROM studio_messages AS version
              WHERE version.session_id = message.session_id
                AND version.role = 'assistant'
                AND version.version_group_id = message.version_group_id
            )
          END AS version_count,
          message.active_version,
          message.activities,
          message.parts,
          message.reasoning_content,
          message.reasoning_duration_ms,
          message.status,
          message.attachments,
          message.created_at
        FROM studio_messages AS message
        WHERE message.session_id = ?
          AND message.role = 'assistant'
          AND (
            message.version_group_id = ?
            OR message.id = ?
          )
        ORDER BY message.version_index ASC, message.created_at ASC
      `
    )
    .all(sessionId, versionGroupId, versionGroupId) as DbMessageRow[]

  return rows.map(mapMessage)
}

export function getStudioMessage(messageId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT
          message.id,
          message.session_id,
          message.role,
          message.content,
          message.model,
          message.version_group_id,
          message.version_index,
          CASE
            WHEN message.version_group_id IS NULL THEN 1
            ELSE (
              SELECT COUNT(*)
              FROM studio_messages AS version
              WHERE version.session_id = message.session_id
                AND version.role = 'assistant'
                AND version.version_group_id = message.version_group_id
            )
          END AS version_count,
          message.active_version,
          message.activities,
          message.parts,
          message.reasoning_content,
          message.reasoning_duration_ms,
          message.status,
          message.attachments,
          message.created_at
        FROM studio_messages AS message
        WHERE message.id = ?
      `
    )
    .get(messageId) as DbMessageRow | undefined

  return row ? mapMessage(row) : null
}

export function createStudioMessage({
  id,
  sessionId,
  role,
  content,
  model = null,
  versionGroupId = null,
  replacesMessageId = null,
  activities = [],
  parts = [],
  reasoningContent = "",
  reasoningDurationMs = null,
  status = "complete",
  attachments = [],
}: CreateMessageInput) {
  const database = getDb()
  const createdAt = nowIso()
  const messageId = id ?? randomUUID()

  const createMessageTransaction = database.transaction(() => {
    let resolvedVersionGroupId: string | null = null
    let versionIndex = 1

    if (role === "assistant") {
      const replacement = replacesMessageId
        ? (database
            .prepare(
              `
                SELECT id, version_group_id
                FROM studio_messages
                WHERE id = ?
                  AND session_id = ?
                  AND role = 'assistant'
              `
            )
            .get(replacesMessageId, sessionId) as
            { id: string; version_group_id: string | null } | undefined)
        : undefined

      resolvedVersionGroupId =
        replacement?.version_group_id ?? versionGroupId ?? messageId

      if (replacement && !replacement.version_group_id) {
        database
          .prepare(
            `
              UPDATE studio_messages
              SET version_group_id = ?,
                  version_index = 1
              WHERE id = ?
            `
          )
          .run(resolvedVersionGroupId, replacement.id)
      }

      if (replacesMessageId || versionGroupId) {
        database
          .prepare(
            `
              UPDATE studio_messages
              SET active_version = 0
              WHERE session_id = ?
                AND role = 'assistant'
                AND version_group_id = ?
            `
          )
          .run(sessionId, resolvedVersionGroupId)
      }

      const latestVersion = database
        .prepare(
          `
            SELECT MAX(version_index) AS version_index
            FROM studio_messages
            WHERE session_id = ?
              AND role = 'assistant'
              AND version_group_id = ?
          `
        )
        .get(sessionId, resolvedVersionGroupId) as
        { version_index: number | null } | undefined

      versionIndex =
        typeof latestVersion?.version_index === "number"
          ? latestVersion.version_index + 1
          : 1
    }

    const message: StudioMessage = {
      id: messageId,
      sessionId,
      role,
      content,
      model,
      versionGroupId: resolvedVersionGroupId,
      versionIndex,
      versionCount: versionIndex,
      isActiveVersion: true,
      activities,
      parts,
      reasoningContent,
      reasoningDurationMs,
      status,
      attachments,
      createdAt,
    }

    database
      .prepare(
        `
          INSERT INTO studio_messages
            (
              id,
              session_id,
              role,
              content,
              model,
              version_group_id,
              version_index,
              active_version,
              activities,
              parts,
              reasoning_content,
              reasoning_duration_ms,
              status,
              attachments,
              created_at
            )
          VALUES
            (
              @id,
              @sessionId,
              @role,
              @content,
              @model,
              @versionGroupId,
              @versionIndex,
              1,
              @activities,
              @parts,
              @reasoningContent,
              @reasoningDurationMs,
              @status,
              @attachments,
              @createdAt
            )
        `
      )
      .run({
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        model: message.model,
        versionGroupId: message.versionGroupId,
        versionIndex: message.versionIndex,
        activities: activities.length ? JSON.stringify(activities) : null,
        parts: parts.length ? JSON.stringify(parts) : null,
        reasoningContent: message.reasoningContent,
        reasoningDurationMs: message.reasoningDurationMs,
        status: message.status,
        attachments: attachments.length ? JSON.stringify(attachments) : null,
        createdAt: message.createdAt,
      })

    database
      .prepare(
        `
          UPDATE studio_sessions
          SET updated_at = ?
          WHERE id = ?
        `
      )
      .run(createdAt, sessionId)

    return message
  })

  return createMessageTransaction()
}

export function updateStudioMessageSnapshot({
  messageId,
  sessionId,
  content,
  activities,
  parts,
  reasoningContent,
  reasoningDurationMs,
  status,
}: UpdateMessageSnapshotInput) {
  const database = getDb()
  const current = getStudioMessage(messageId)

  if (!current || (sessionId && current.sessionId !== sessionId)) {
    return null
  }

  const nextContent = content ?? current.content
  const nextActivities = activities ?? current.activities
  const nextParts = parts ?? current.parts
  const nextReasoningContent = reasoningContent ?? current.reasoningContent
  const nextReasoningDurationMs =
    reasoningDurationMs === undefined
      ? current.reasoningDurationMs
      : reasoningDurationMs
  const nextStatus = status ?? current.status
  const updatedAt = nowIso()

  const updateTransaction = database.transaction(() => {
    database
      .prepare(
        `
          UPDATE studio_messages
          SET content = ?,
              activities = ?,
              parts = ?,
              reasoning_content = ?,
              reasoning_duration_ms = ?,
              status = ?
          WHERE id = ?
        `
      )
      .run(
        nextContent,
        nextActivities.length ? JSON.stringify(nextActivities) : null,
        nextParts.length ? JSON.stringify(nextParts) : null,
        nextReasoningContent,
        nextReasoningDurationMs,
        nextStatus,
        messageId
      )

    database
      .prepare(
        `
          UPDATE studio_sessions
          SET updated_at = ?
          WHERE id = ?
        `
      )
      .run(updatedAt, current.sessionId)
  })

  updateTransaction()

  return getStudioMessage(messageId)
}

export function updateStudioMessageAttachments(
  messageId: string,
  attachments: StudioAttachment[]
) {
  getDb()
    .prepare(
      `
        UPDATE studio_messages
        SET attachments = ?
        WHERE id = ?
      `
    )
    .run(attachments.length ? JSON.stringify(attachments) : null, messageId)
}

export function getStudioSessionSandbox(sessionId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT session_id, sandbox_id, sandbox_domain, template, status,
               auto_pause_timeout_seconds, created_at, updated_at, last_used_at
        FROM studio_session_sandboxes
        WHERE session_id = ?
      `
    )
    .get(sessionId) as DbSessionSandboxRow | undefined

  return row ? mapSessionSandbox(row) : null
}

export function upsertStudioSessionSandbox({
  sessionId,
  sandboxId,
  sandboxDomain = null,
  template,
  status = "running",
  autoPauseTimeoutSeconds,
}: UpsertSessionSandboxInput) {
  const existing = getStudioSessionSandbox(sessionId)
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_session_sandboxes
          (session_id, sandbox_id, sandbox_domain, template, status,
           auto_pause_timeout_seconds, created_at, updated_at, last_used_at)
        VALUES
          (@sessionId, @sandboxId, @sandboxDomain, @template, @status,
           @autoPauseTimeoutSeconds, @createdAt, @updatedAt, @lastUsedAt)
        ON CONFLICT(session_id) DO UPDATE SET
          sandbox_id = excluded.sandbox_id,
          sandbox_domain = excluded.sandbox_domain,
          template = excluded.template,
          status = excluded.status,
          auto_pause_timeout_seconds = excluded.auto_pause_timeout_seconds,
          updated_at = excluded.updated_at,
          last_used_at = excluded.last_used_at
      `
    )
    .run({
      sessionId,
      sandboxId,
      sandboxDomain,
      template,
      status,
      autoPauseTimeoutSeconds,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
    })

  return getStudioSessionSandbox(sessionId)
}

export function touchStudioSessionSandbox(
  sessionId: string,
  status: StudioSessionSandbox["status"] = "running"
) {
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_session_sandboxes
        SET status = ?,
            updated_at = ?,
            last_used_at = ?
        WHERE session_id = ?
      `
    )
    .run(status, timestamp, timestamp, sessionId)
}

export function createStudioSessionFile({
  id = randomUUID(),
  sessionId,
  messageId = null,
  kind,
  originalName,
  mimeType = null,
  size = null,
  storagePath,
  sandboxPath = null,
  sourceToolCallId = null,
  savedAt = null,
}: CreateSessionFileInput) {
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_session_files
          (id, session_id, message_id, kind, original_name, mime_type, size,
           storage_path, sandbox_path, source_tool_call_id, saved_at,
           created_at, updated_at)
        VALUES
          (@id, @sessionId, @messageId, @kind, @originalName, @mimeType, @size,
           @storagePath, @sandboxPath, @sourceToolCallId, @savedAt,
           @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          message_id = excluded.message_id,
          kind = excluded.kind,
          original_name = excluded.original_name,
          mime_type = excluded.mime_type,
          size = excluded.size,
          storage_path = excluded.storage_path,
          sandbox_path = excluded.sandbox_path,
          source_tool_call_id = excluded.source_tool_call_id,
          saved_at = excluded.saved_at,
          updated_at = excluded.updated_at
      `
    )
    .run({
      id,
      sessionId,
      messageId,
      kind,
      originalName,
      mimeType,
      size,
      storagePath,
      sandboxPath,
      sourceToolCallId,
      savedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

  return getStudioSessionFile(id)
}

export function getStudioSessionFile(fileId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT id, session_id, message_id, kind, original_name, mime_type, size,
               storage_path, sandbox_path, source_tool_call_id, saved_at,
               created_at, updated_at
        FROM studio_session_files
        WHERE id = ?
      `
    )
    .get(fileId) as DbSessionFileRow | undefined

  return row ? mapSessionFile(row) : null
}

export function listStudioSessionFiles(sessionId: string) {
  const rows = getDb()
    .prepare(
      `
        SELECT id, session_id, message_id, kind, original_name, mime_type, size,
               storage_path, sandbox_path, source_tool_call_id, saved_at,
               created_at, updated_at
        FROM studio_session_files
        WHERE session_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(sessionId) as DbSessionFileRow[]

  return rows.map(mapSessionFile)
}

export function updateStudioSessionFileSandboxPath(
  fileId: string,
  sandboxPath: string
) {
  getDb()
    .prepare(
      `
        UPDATE studio_session_files
        SET sandbox_path = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(sandboxPath, nowIso(), fileId)
}

export function listStudioSavedGenericFiles(): StudioGenericLibraryFile[] {
  const rows = getDb()
    .prepare(
      `
        SELECT id, session_id, message_id, kind, original_name, mime_type, size,
               storage_path, sandbox_path, source_tool_call_id, saved_at,
               created_at, updated_at
        FROM studio_session_files
        WHERE kind = 'generated'
          AND saved_at IS NOT NULL
        ORDER BY saved_at DESC, created_at DESC
      `
    )
    .all() as DbSessionFileRow[]

  return rows.map((row) => ({
    id: row.id,
    kind: "file",
    sessionId: row.session_id,
    messageId: row.message_id,
    name: row.original_name,
    prompt: row.original_name,
    modelName: "AstraFlow Sandbox",
    manufacturer: "AstraFlow",
    mimeType: row.mime_type,
    size: row.size,
    sandboxPath: row.sandbox_path,
    downloadUrl: `/api/studio/files/${row.id}/content?download=1`,
    savedAt: row.saved_at ?? row.created_at,
    createdAt: row.created_at,
  }))
}

export function getStudioOAuthTokens(): StudioOAuthTokens | null {
  const row = readStudioSetting(STUDIO_OAUTH_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      accessToken?: string
      refreshToken?: string | null
      tokenType?: string | null
      expiresAt?: number | null
      email?: string | null
    }

    if (!parsed.accessToken) {
      return null
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
      tokenType: parsed.tokenType ?? null,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : null,
      email: parsed.email ?? null,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function getStudioOAuthStatus(): StudioOAuthStatus {
  const tokens = getStudioOAuthTokens()

  return {
    configured: Boolean(tokens?.accessToken),
    email: tokens?.email ?? null,
    expiresAt: tokens?.expiresAt ?? null,
    updatedAt: tokens?.updatedAt ?? null,
  }
}

export function saveStudioOAuthTokens(
  input: Omit<StudioOAuthTokens, "updatedAt">
) {
  const updatedAt = writeStudioSetting(
    STUDIO_OAUTH_SETTING,
    JSON.stringify({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? null,
      tokenType: input.tokenType ?? null,
      expiresAt: input.expiresAt ?? null,
      email: input.email ?? null,
    })
  )

  return {
    configured: true,
    email: input.email ?? null,
    expiresAt: input.expiresAt ?? null,
    updatedAt,
  } satisfies StudioOAuthStatus
}

export function clearStudioOAuthTokens() {
  deleteStudioSetting(STUDIO_OAUTH_SETTING)
}

export function getStudioModelverseApiKey(): StudioModelverseApiKey | null {
  const row = readStudioSetting(STUDIO_MODELVERSE_API_KEY_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      id?: string
      name?: string
      key?: string
      projectId?: string
    }

    if (!parsed.id || !parsed.name || !parsed.key || !parsed.projectId) {
      return null
    }

    return {
      id: parsed.id,
      name: parsed.name,
      key: parsed.key,
      projectId: parsed.projectId,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function saveStudioModelverseApiKey(
  input: Omit<StudioModelverseApiKey, "updatedAt">
) {
  const updatedAt = writeStudioSetting(
    STUDIO_MODELVERSE_API_KEY_SETTING,
    JSON.stringify({
      id: input.id,
      name: input.name,
      key: input.key,
      projectId: input.projectId,
    })
  )

  return {
    ...input,
    updatedAt,
  } satisfies StudioModelverseApiKey
}

export function clearStudioModelverseApiKey() {
  deleteStudioSetting(STUDIO_MODELVERSE_API_KEY_SETTING)
}

export function getStudioExaApiKey(): StudioExaApiKey | null {
  const row = readStudioSetting(STUDIO_EXA_API_KEY_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      key?: string
    }

    if (!parsed.key) {
      return null
    }

    return {
      key: parsed.key,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function saveStudioExaApiKey(key: string) {
  const updatedAt = writeStudioSetting(
    STUDIO_EXA_API_KEY_SETTING,
    JSON.stringify({ key })
  )

  return {
    key,
    updatedAt,
  } satisfies StudioExaApiKey
}

export function clearStudioExaApiKey() {
  deleteStudioSetting(STUDIO_EXA_API_KEY_SETTING)
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed JSON; treat as empty record.
  }

  return {}
}

function mapImageOutput(row: DbImageOutputRow): StudioImageOutput {
  const src = row.data_url ?? row.url ?? ""

  return {
    id: row.id,
    generationId: row.generation_id,
    index: row.output_index,
    src,
    url: row.url,
    dataUrl: row.data_url,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  }
}

function mapImageGeneration(
  row: DbImageGenerationRow,
  outputs: StudioImageOutput[]
): StudioImageGeneration {
  return {
    id: row.id,
    sessionId: row.session_id,
    modelSquareId: row.model_square_id,
    modelName: row.model_name,
    manufacturer: row.manufacturer,
    openapiFile: row.openapi_file,
    operationId: row.operation_id,
    prompt: row.prompt,
    params: parseJsonRecord(row.params),
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    outputs,
  }
}

export function listStudioImageGenerations(sessionId: string) {
  const database = getDb()
  const rows = database
    .prepare(
      `
        SELECT id, session_id, model_square_id, model_name, manufacturer,
               openapi_file, operation_id, prompt, params, status,
               error_message, raw_response, created_at, completed_at
        FROM studio_image_generations
        WHERE session_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(sessionId) as DbImageGenerationRow[]

  if (rows.length === 0) {
    return []
  }

  const outputRows = database
    .prepare(
      `
        SELECT id, generation_id, output_index, url, data_url, mime_type,
               width, height, metadata, saved_at, created_at
        FROM studio_image_outputs
        WHERE generation_id IN (${rows.map(() => "?").join(",")})
        ORDER BY generation_id, output_index ASC
      `
    )
    .all(...rows.map((row) => row.id)) as DbImageOutputRow[]

  const outputsByGeneration = new Map<string, StudioImageOutput[]>()

  for (const output of outputRows) {
    const bucket = outputsByGeneration.get(output.generation_id) ?? []
    bucket.push(mapImageOutput(output))
    outputsByGeneration.set(output.generation_id, bucket)
  }

  return rows.map((row) =>
    mapImageGeneration(row, outputsByGeneration.get(row.id) ?? [])
  )
}

export function createStudioImageGeneration(
  input: CreateImageGenerationInput
): StudioImageGeneration {
  const database = getDb()
  const createdAt = nowIso()
  const id = randomUUID()
  const status = input.status ?? "running"

  const transaction = database.transaction(() => {
    database
      .prepare(
        `
          INSERT INTO studio_image_generations
            (id, session_id, model_square_id, model_name, manufacturer,
             openapi_file, operation_id, prompt, params, status,
             error_message, raw_response, created_at, completed_at)
          VALUES
            (@id, @sessionId, @modelSquareId, @modelName, @manufacturer,
             @openapiFile, @operationId, @prompt, @params, @status,
             NULL, NULL, @createdAt, NULL)
        `
      )
      .run({
        id,
        sessionId: input.sessionId,
        modelSquareId: input.modelSquareId,
        modelName: input.modelName,
        manufacturer: input.manufacturer ?? null,
        openapiFile: input.openapiFile ?? null,
        operationId: input.operationId ?? null,
        prompt: input.prompt,
        params: JSON.stringify(input.params),
        status,
        createdAt,
      })

    database
      .prepare(
        `
          UPDATE studio_sessions
          SET updated_at = ?
          WHERE id = ?
        `
      )
      .run(createdAt, input.sessionId)
  })

  transaction()

  return {
    id,
    sessionId: input.sessionId,
    modelSquareId: input.modelSquareId,
    modelName: input.modelName,
    manufacturer: input.manufacturer ?? null,
    openapiFile: input.openapiFile ?? null,
    operationId: input.operationId ?? null,
    prompt: input.prompt,
    params: input.params,
    status,
    errorMessage: null,
    createdAt,
    completedAt: null,
    outputs: [],
  }
}

export function updateStudioImageGeneration(
  generationId: string,
  input: UpdateImageGenerationInput
) {
  const completedAt = input.completedAt ?? nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_image_generations
        SET status = ?,
            error_message = ?,
            raw_response = ?,
            completed_at = ?
        WHERE id = ?
      `
    )
    .run(
      input.status,
      input.errorMessage ?? null,
      input.rawResponse === undefined
        ? null
        : JSON.stringify(input.rawResponse),
      completedAt,
      generationId
    )
}

export function createStudioImageOutput(
  input: CreateImageOutputInput
): StudioImageOutput {
  const id = randomUUID()
  const createdAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_image_outputs
          (id, generation_id, output_index, url, data_url, mime_type,
           width, height, metadata, saved_at, created_at)
        VALUES
          (@id, @generationId, @index, @url, @dataUrl, @mimeType,
           @width, @height, @metadata, NULL, @createdAt)
      `
    )
    .run({
      id,
      generationId: input.generationId,
      index: input.index,
      url: input.url ?? null,
      dataUrl: input.dataUrl ?? null,
      mimeType: input.mimeType ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      metadata:
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
      createdAt,
    })

  return {
    id,
    generationId: input.generationId,
    index: input.index,
    src: input.dataUrl ?? input.url ?? "",
    url: input.url ?? null,
    dataUrl: input.dataUrl ?? null,
    mimeType: input.mimeType ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    savedAt: null,
    createdAt,
  }
}

export function getStudioImageOutput(outputId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT id, generation_id, output_index, url, data_url, mime_type,
               width, height, metadata, saved_at, created_at
        FROM studio_image_outputs
        WHERE id = ?
      `
    )
    .get(outputId) as DbImageOutputRow | undefined

  return row ? mapImageOutput(row) : null
}

export function listStudioSavedImageOutputs(): StudioSavedImageOutput[] {
  const rows = getDb()
    .prepare(
      `
        SELECT outputs.id, outputs.generation_id, generations.session_id,
               outputs.output_index, generations.prompt, generations.model_name,
               generations.manufacturer, outputs.mime_type, outputs.width,
               outputs.height, outputs.saved_at, outputs.created_at
        FROM studio_image_outputs AS outputs
        INNER JOIN studio_image_generations AS generations
          ON generations.id = outputs.generation_id
        WHERE outputs.saved_at IS NOT NULL
        ORDER BY outputs.saved_at DESC, outputs.created_at DESC
      `
    )
    .all() as DbSavedImageOutputRow[]

  return rows.map((row) => ({
    id: row.id,
    generationId: row.generation_id,
    sessionId: row.session_id,
    index: row.output_index,
    prompt: row.prompt,
    modelName: row.model_name,
    manufacturer: row.manufacturer,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  }))
}

export function saveStudioImageOutputData(
  outputId: string,
  dataUrl: string,
  mimeType?: string | null
) {
  const savedAt = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_image_outputs
        SET data_url = ?,
            mime_type = COALESCE(?, mime_type),
            saved_at = ?
        WHERE id = ?
      `
    )
    .run(dataUrl, mimeType ?? null, savedAt, outputId)

  return getStudioImageOutput(outputId)
}
