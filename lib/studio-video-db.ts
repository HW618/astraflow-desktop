import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

import type {
  StudioSavedVideoOutput,
  StudioVideoGeneration,
  StudioVideoOutput,
  StudioVideoStatus,
} from "@/lib/studio-video-types"

type DbVideoGenerationRow = {
  id: string
  session_id: string
  model_square_id: string
  model_name: string
  manufacturer: string | null
  openapi_file: string | null
  operation_id: string | null
  provider_task_id: string | null
  provider_request_id: string | null
  prompt: string
  params: string
  status: StudioVideoStatus
  error_message: string | null
  raw_response: string | null
  created_at: string
  completed_at: string | null
}

type DbVideoOutputRow = {
  id: string
  generation_id: string
  output_index: number
  url: string | null
  data_url: string | null
  storage_path: string | null
  mime_type: string | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  metadata: string | null
  saved_at: string | null
  created_at: string
}

type DbSavedVideoOutputRow = {
  id: string
  generation_id: string
  session_id: string
  output_index: number
  prompt: string
  model_name: string
  manufacturer: string | null
  provider_task_id: string | null
  provider_request_id: string | null
  mime_type: string | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  storage_path: string | null
  saved_at: string
  created_at: string
}

type CreateVideoGenerationInput = {
  sessionId: string
  modelSquareId: string
  modelName: string
  manufacturer?: string | null
  openapiFile?: string | null
  operationId?: string | null
  providerTaskId?: string | null
  providerRequestId?: string | null
  prompt: string
  params: Record<string, unknown>
  status?: StudioVideoStatus
}

type CreateVideoOutputInput = {
  id?: string
  generationId: string
  index: number
  url?: string | null
  dataUrl?: string | null
  storagePath?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  metadata?: unknown
  autoSave?: boolean
}

type UpdateVideoGenerationInput = {
  status: StudioVideoStatus
  errorMessage?: string | null
  rawResponse?: unknown
  completedAt?: string | null
  providerTaskId?: string | null
  providerRequestId?: string | null
}

type RecordVideoGenerationTaskInput = {
  providerTaskId?: string | null
  providerRequestId?: string | null
}

let videoDb: Database.Database | undefined

function getDatabasePath() {
  return (
    process.env.ASTRAFLOW_SQLITE_PATH?.trim() ??
    join(process.cwd(), ".data", "astraflow.sqlite")
  )
}

function nowIso() {
  return new Date().toISOString()
}

function getVideoDb() {
  if (videoDb) {
    return videoDb
  }

  const dbPath = getDatabasePath()
  mkdirSync(dirname(dbPath), { recursive: true })
  videoDb = new Database(dbPath)
  videoDb.pragma("journal_mode = WAL")
  videoDb.pragma("synchronous = NORMAL")
  videoDb.pragma("busy_timeout = 5000")
  videoDb.pragma("foreign_keys = ON")
  initializeVideoSchema(videoDb)

  return videoDb
}

function initializeVideoSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS studio_video_generations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      model_square_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      manufacturer TEXT,
      openapi_file TEXT,
      operation_id TEXT,
      provider_task_id TEXT,
      provider_request_id TEXT,
      prompt TEXT NOT NULL,
      params TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      raw_response TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_video_outputs (
      id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL,
      output_index INTEGER NOT NULL,
      url TEXT,
      data_url TEXT,
      storage_path TEXT,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      duration_seconds REAL,
      metadata TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (generation_id) REFERENCES studio_video_generations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS studio_video_generations_session_idx
      ON studio_video_generations(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_video_outputs_generation_idx
      ON studio_video_outputs(generation_id, output_index ASC);

    CREATE INDEX IF NOT EXISTS studio_video_outputs_saved_idx
      ON studio_video_outputs(saved_at DESC, created_at DESC);
  `)

  ensureVideoGenerationTaskColumns(database)
  ensureVideoOutputStorageColumns(database)
}

function ensureVideoGenerationTaskColumns(database: Database.Database) {
  const columns = new Set(
    (
      database
        .prepare("PRAGMA table_info(studio_video_generations)")
        .all() as Array<{ name: string }>
    ).map((column) => column.name)
  )

  if (!columns.has("provider_task_id")) {
    database.exec(`
      ALTER TABLE studio_video_generations
      ADD COLUMN provider_task_id TEXT
    `)
  }

  if (!columns.has("provider_request_id")) {
    database.exec(`
      ALTER TABLE studio_video_generations
      ADD COLUMN provider_request_id TEXT
    `)
  }
}

function ensureVideoOutputStorageColumns(database: Database.Database) {
  const columns = new Set(
    (
      database
        .prepare("PRAGMA table_info(studio_video_outputs)")
        .all() as Array<{ name: string }>
    ).map((column) => column.name)
  )

  if (!columns.has("storage_path")) {
    database.exec(
      `ALTER TABLE studio_video_outputs ADD COLUMN storage_path TEXT`
    )
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS studio_video_outputs_saved_idx
      ON studio_video_outputs(saved_at DESC, created_at DESC);
  `)
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

function mapVideoOutput(row: DbVideoOutputRow): StudioVideoOutput {
  const src = row.data_url ?? row.url ?? ""

  return {
    id: row.id,
    generationId: row.generation_id,
    index: row.output_index,
    src,
    url: row.url,
    dataUrl: row.data_url,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  }
}

function mapVideoGeneration(
  row: DbVideoGenerationRow,
  outputs: StudioVideoOutput[]
): StudioVideoGeneration {
  return {
    id: row.id,
    sessionId: row.session_id,
    modelSquareId: row.model_square_id,
    modelName: row.model_name,
    manufacturer: row.manufacturer,
    openapiFile: row.openapi_file,
    operationId: row.operation_id,
    providerTaskId: row.provider_task_id,
    providerRequestId: row.provider_request_id,
    prompt: row.prompt,
    params: parseJsonRecord(row.params),
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    outputs,
  }
}

export function listStudioVideoGenerations(sessionId: string) {
  const database = getVideoDb()
  const rows = database
    .prepare(
      `
        SELECT id, session_id, model_square_id, model_name, manufacturer,
               openapi_file, operation_id, provider_task_id,
               provider_request_id, prompt, params, status, error_message,
               raw_response, created_at, completed_at
        FROM studio_video_generations
        WHERE session_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(sessionId) as DbVideoGenerationRow[]

  if (rows.length === 0) {
    return []
  }

  const outputRows = database
    .prepare(
      `
        SELECT id, generation_id, output_index, url, NULL AS data_url,
               storage_path, mime_type, width, height, duration_seconds,
               metadata, saved_at, created_at
        FROM studio_video_outputs
        WHERE generation_id IN (${rows.map(() => "?").join(",")})
        ORDER BY generation_id, output_index ASC
      `
    )
    .all(...rows.map((row) => row.id)) as DbVideoOutputRow[]

  const outputsByGeneration = new Map<string, StudioVideoOutput[]>()

  for (const output of outputRows) {
    const bucket = outputsByGeneration.get(output.generation_id) ?? []
    bucket.push(mapVideoOutput(output))
    outputsByGeneration.set(output.generation_id, bucket)
  }

  return rows.map((row) =>
    mapVideoGeneration(row, outputsByGeneration.get(row.id) ?? [])
  )
}

export function createStudioVideoGeneration(
  input: CreateVideoGenerationInput
): StudioVideoGeneration {
  const database = getVideoDb()
  const createdAt = nowIso()
  const id = randomUUID()
  const status = input.status ?? "running"

  const transaction = database.transaction(() => {
    database
      .prepare(
        `
          INSERT INTO studio_video_generations
            (id, session_id, model_square_id, model_name, manufacturer,
             openapi_file, operation_id, provider_task_id,
             provider_request_id, prompt, params, status, error_message,
             raw_response, created_at, completed_at)
          VALUES
            (@id, @sessionId, @modelSquareId, @modelName, @manufacturer,
             @openapiFile, @operationId, @providerTaskId,
             @providerRequestId, @prompt, @params, @status, NULL, NULL,
             @createdAt, NULL)
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
        providerTaskId: input.providerTaskId ?? null,
        providerRequestId: input.providerRequestId ?? null,
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
    providerTaskId: input.providerTaskId ?? null,
    providerRequestId: input.providerRequestId ?? null,
    prompt: input.prompt,
    params: input.params,
    status,
    errorMessage: null,
    createdAt,
    completedAt: null,
    outputs: [],
  }
}

export function updateStudioVideoGeneration(
  generationId: string,
  input: UpdateVideoGenerationInput
) {
  const completedAt = input.completedAt ?? nowIso()

  getVideoDb()
    .prepare(
      `
        UPDATE studio_video_generations
        SET status = ?,
            error_message = ?,
            raw_response = ?,
            provider_task_id = COALESCE(?, provider_task_id),
            provider_request_id = COALESCE(?, provider_request_id),
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
      input.providerTaskId ?? null,
      input.providerRequestId ?? null,
      completedAt,
      generationId
    )
}

export function recordStudioVideoGenerationTask(
  generationId: string,
  input: RecordVideoGenerationTaskInput
) {
  if (!input.providerTaskId && !input.providerRequestId) {
    return
  }

  getVideoDb()
    .prepare(
      `
        UPDATE studio_video_generations
        SET provider_task_id = COALESCE(?, provider_task_id),
            provider_request_id = COALESCE(?, provider_request_id)
        WHERE id = ?
      `
    )
    .run(
      input.providerTaskId ?? null,
      input.providerRequestId ?? null,
      generationId
    )
}

export function createStudioVideoOutput(
  input: CreateVideoOutputInput
): StudioVideoOutput {
  const id = input.id ?? randomUUID()
  const createdAt = nowIso()
  const savedAt = input.autoSave ? createdAt : null

  getVideoDb()
    .prepare(
      `
        INSERT INTO studio_video_outputs
          (id, generation_id, output_index, url, data_url, storage_path,
           mime_type, width, height, duration_seconds, metadata, saved_at,
           created_at)
        VALUES
          (@id, @generationId, @index, @url, @dataUrl, @storagePath,
           @mimeType, @width, @height, @durationSeconds, @metadata, @savedAt,
           @createdAt)
      `
    )
    .run({
      id,
      generationId: input.generationId,
      index: input.index,
      url: input.url ?? null,
      dataUrl: input.dataUrl ?? null,
      storagePath: input.storagePath ?? null,
      mimeType: input.mimeType ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      durationSeconds: input.durationSeconds ?? null,
      metadata:
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
      savedAt,
      createdAt,
    })

  return {
    id,
    generationId: input.generationId,
    index: input.index,
    src: input.dataUrl ?? input.url ?? "",
    url: input.url ?? null,
    dataUrl: input.dataUrl ?? null,
    storagePath: input.storagePath ?? null,
    mimeType: input.mimeType ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    durationSeconds: input.durationSeconds ?? null,
    savedAt,
    createdAt,
  }
}

export function getStudioVideoOutput(outputId: string) {
  const row = getVideoDb()
    .prepare(
      `
        SELECT id, generation_id, output_index, url, data_url, storage_path,
               mime_type, width, height, duration_seconds, metadata, saved_at,
               created_at
        FROM studio_video_outputs
        WHERE id = ?
      `
    )
    .get(outputId) as DbVideoOutputRow | undefined

  return row ? mapVideoOutput(row) : null
}

export function listStudioSavedVideoOutputs(): StudioSavedVideoOutput[] {
  const rows = getVideoDb()
    .prepare(
      `
        SELECT outputs.id, outputs.generation_id, generations.session_id,
               outputs.output_index, generations.prompt, generations.model_name,
               generations.manufacturer, generations.provider_task_id,
               generations.provider_request_id, outputs.mime_type,
               outputs.width, outputs.height, outputs.duration_seconds,
               outputs.storage_path, outputs.saved_at, outputs.created_at
        FROM studio_video_outputs AS outputs
        INNER JOIN studio_video_generations AS generations
          ON generations.id = outputs.generation_id
        WHERE outputs.saved_at IS NOT NULL
        ORDER BY outputs.saved_at DESC, outputs.created_at DESC
      `
    )
    .all() as DbSavedVideoOutputRow[]

  return rows.map((row) => ({
    id: row.id,
    generationId: row.generation_id,
    sessionId: row.session_id,
    index: row.output_index,
    prompt: row.prompt,
    modelName: row.model_name,
    manufacturer: row.manufacturer,
    providerTaskId: row.provider_task_id,
    providerRequestId: row.provider_request_id,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
    storagePath: row.storage_path,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  }))
}

export function saveStudioVideoOutputStorage(
  outputId: string,
  storagePath: string,
  mimeType?: string | null
) {
  const savedAt = nowIso()

  getVideoDb()
    .prepare(
      `
        UPDATE studio_video_outputs
        SET storage_path = ?,
            data_url = NULL,
            mime_type = COALESCE(?, mime_type),
            saved_at = ?
        WHERE id = ?
      `
    )
    .run(storagePath, mimeType ?? null, savedAt, outputId)

  return getStudioVideoOutput(outputId)
}
