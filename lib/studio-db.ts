import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

import type {
  StudioAttachment,
  StudioMessage,
  StudioMessageRole,
  StudioMessageStatus,
  StudioModelverseApiKey,
  StudioMode,
  StudioOAuthStatus,
  StudioOAuthTokens,
  StudioSession,
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
  status: StudioMessageStatus
  attachments: string | null
  created_at: string
}

type DbSettingRow = {
  key: string
  value: string
  updated_at: string
}

type CreateSessionInput = {
  mode: StudioMode
  title?: string
}

type CreateMessageInput = {
  sessionId: string
  role: StudioMessageRole
  content: string
  status?: StudioMessageStatus
  attachments?: StudioAttachment[]
}

const DEFAULT_SESSION_TITLE = "New chat"
const STUDIO_MODELVERSE_API_KEY_SETTING = "modelverse_api_key"
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
  `)
}

function migrateSchema(database: Database.Database) {
  const columns = database
    .prepare(`PRAGMA table_info(studio_messages)`)
    .all() as Array<{ name: string }>

  if (!columns.some((column) => column.name === "attachments")) {
    database.exec(`ALTER TABLE studio_messages ADD COLUMN attachments TEXT`)
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
        (item as StudioAttachment).type === "image" &&
        typeof (item as StudioAttachment).dataUrl === "string"
    )
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
        SELECT id, session_id, role, content, status, attachments, created_at
        FROM studio_messages
        WHERE session_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(sessionId) as DbMessageRow[]

  return rows.map(mapMessage)
}

export function createStudioMessage({
  sessionId,
  role,
  content,
  status = "complete",
  attachments = [],
}: CreateMessageInput) {
  const database = getDb()
  const createdAt = nowIso()
  const message: StudioMessage = {
    id: randomUUID(),
    sessionId,
    role,
    content,
    status,
    attachments,
    createdAt,
  }

  const createMessageTransaction = database.transaction(() => {
    database
      .prepare(
        `
          INSERT INTO studio_messages
            (id, session_id, role, content, status, attachments, created_at)
          VALUES
            (@id, @sessionId, @role, @content, @status, @attachments, @createdAt)
        `
      )
      .run({
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        status: message.status,
        attachments: attachments.length
          ? JSON.stringify(attachments)
          : null,
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
  })

  createMessageTransaction()

  return message
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
