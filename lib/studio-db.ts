import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

import type {
  StudioMessage,
  StudioMessageRole,
  StudioMessageStatus,
  StudioMode,
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
  created_at: string
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
}

const DEFAULT_SESSION_TITLE = "New chat"

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
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS studio_sessions_updated_at_idx
      ON studio_sessions(updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_messages_session_id_created_at_idx
      ON studio_messages(session_id, created_at ASC);
  `)
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

function mapMessage(row: DbMessageRow): StudioMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
  }
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

export function listStudioMessages(sessionId: string) {
  const rows = getDb()
    .prepare(
      `
        SELECT id, session_id, role, content, status, created_at
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
}: CreateMessageInput) {
  const database = getDb()
  const createdAt = nowIso()
  const message: StudioMessage = {
    id: randomUUID(),
    sessionId,
    role,
    content,
    status,
    createdAt,
  }

  const createMessageTransaction = database.transaction(() => {
    database
      .prepare(
        `
          INSERT INTO studio_messages
            (id, session_id, role, content, status, created_at)
          VALUES
            (@id, @sessionId, @role, @content, @status, @createdAt)
        `
      )
      .run(message)

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
