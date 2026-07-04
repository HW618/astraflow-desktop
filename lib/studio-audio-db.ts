import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"

import {
  ensureSqliteTableColumns,
  getStudioDatabase,
  type SqliteColumnDefinition,
} from "@/lib/studio-db"

import type {
  StudioAudioGeneration,
  StudioAudioOutput,
  StudioAudioStatus,
  StudioSavedAudioOutput,
} from "@/lib/studio-audio-types"

type DbAudioGenerationRow = {
  id: string
  session_id: string
  model_square_id: string
  model_name: string
  manufacturer: string | null
  openapi_file: string | null
  operation_id: string | null
  prompt: string
  params: string
  status: StudioAudioStatus
  error_message: string | null
  raw_response: string | null
  created_at: string
  completed_at: string | null
}

type DbAudioOutputRow = {
  id: string
  generation_id: string
  output_index: number
  url: string | null
  data_url: string | null
  storage_path: string | null
  mime_type: string | null
  duration_seconds: number | null
  metadata: string | null
  saved_at: string | null
  created_at: string
}

type DbSavedAudioOutputRow = {
  id: string
  generation_id: string
  session_id: string
  output_index: number
  prompt: string
  model_name: string
  manufacturer: string | null
  mime_type: string | null
  duration_seconds: number | null
  storage_path: string | null
  saved_at: string
  created_at: string
}

type CreateAudioGenerationInput = {
  sessionId: string
  modelSquareId: string
  modelName: string
  manufacturer?: string | null
  openapiFile?: string | null
  operationId?: string | null
  prompt: string
  params: Record<string, unknown>
  status?: StudioAudioStatus
}

type CreateAudioOutputInput = {
  id?: string
  generationId: string
  index: number
  url?: string | null
  dataUrl?: string | null
  storagePath?: string | null
  mimeType?: string | null
  durationSeconds?: number | null
  metadata?: unknown
}

type UpdateAudioGenerationInput = {
  status: StudioAudioStatus
  errorMessage?: string | null
  rawResponse?: unknown
  completedAt?: string | null
}

let audioSchemaReady = false

const audioTableColumns = {
  studio_audio_generations: [
    { name: "id", definition: "id TEXT" },
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    {
      name: "model_square_id",
      definition: "model_square_id TEXT NOT NULL DEFAULT ''",
    },
    { name: "model_name", definition: "model_name TEXT NOT NULL DEFAULT ''" },
    { name: "manufacturer", definition: "manufacturer TEXT" },
    { name: "openapi_file", definition: "openapi_file TEXT" },
    { name: "operation_id", definition: "operation_id TEXT" },
    { name: "prompt", definition: "prompt TEXT NOT NULL DEFAULT ''" },
    { name: "params", definition: "params TEXT NOT NULL DEFAULT '{}'" },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT 'queued'" },
    { name: "error_message", definition: "error_message TEXT" },
    { name: "raw_response", definition: "raw_response TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "completed_at", definition: "completed_at TEXT" },
  ],
  studio_audio_outputs: [
    { name: "id", definition: "id TEXT" },
    {
      name: "generation_id",
      definition: "generation_id TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "output_index",
      definition: "output_index INTEGER NOT NULL DEFAULT 0",
    },
    { name: "url", definition: "url TEXT" },
    { name: "data_url", definition: "data_url TEXT" },
    { name: "storage_path", definition: "storage_path TEXT" },
    { name: "mime_type", definition: "mime_type TEXT" },
    { name: "duration_seconds", definition: "duration_seconds REAL" },
    { name: "metadata", definition: "metadata TEXT" },
    { name: "saved_at", definition: "saved_at TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
  ],
} satisfies Record<string, SqliteColumnDefinition[]>

function nowIso() {
  return new Date().toISOString()
}

function getAudioDb() {
  const database = getStudioDatabase()

  if (!audioSchemaReady) {
    initializeAudioSchema(database)
    audioSchemaReady = true
  }

  return database
}

function initializeAudioSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS studio_audio_generations (
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

    CREATE TABLE IF NOT EXISTS studio_audio_outputs (
      id TEXT PRIMARY KEY,
      generation_id TEXT NOT NULL,
      output_index INTEGER NOT NULL,
      url TEXT,
      data_url TEXT,
      storage_path TEXT,
      mime_type TEXT,
      duration_seconds REAL,
      metadata TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (generation_id) REFERENCES studio_audio_generations(id) ON DELETE CASCADE
    );
  `)

  migrateAudioSchema(database)
  ensureAudioSchemaIndexes(database)
}

function migrateAudioSchema(database: Database.Database) {
  for (const [tableName, columns] of Object.entries(audioTableColumns)) {
    ensureSqliteTableColumns(database, tableName, columns)
  }
}

function ensureAudioSchemaIndexes(database: Database.Database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS studio_audio_generations_session_idx
      ON studio_audio_generations(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_audio_outputs_generation_idx
      ON studio_audio_outputs(generation_id, output_index ASC);

    CREATE INDEX IF NOT EXISTS studio_audio_outputs_saved_idx
      ON studio_audio_outputs(saved_at DESC, created_at DESC);
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

function mapAudioOutput(row: DbAudioOutputRow): StudioAudioOutput {
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
    durationSeconds: row.duration_seconds,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  }
}

function mapAudioGeneration(
  row: DbAudioGenerationRow,
  outputs: StudioAudioOutput[]
): StudioAudioGeneration {
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

export function listStudioAudioGenerations(sessionId: string) {
  const database = getAudioDb()
  const rows = database
    .prepare(
      `
        SELECT id, session_id, model_square_id, model_name, manufacturer,
               openapi_file, operation_id, prompt, params, status,
               error_message, raw_response, created_at, completed_at
        FROM studio_audio_generations
        WHERE session_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(sessionId) as DbAudioGenerationRow[]

  if (rows.length === 0) {
    return []
  }

  const outputRows = database
    .prepare(
      `
        SELECT id, generation_id, output_index, url, NULL AS data_url,
               storage_path, mime_type, duration_seconds, metadata, saved_at,
               created_at
        FROM studio_audio_outputs
        WHERE generation_id IN (${rows.map(() => "?").join(",")})
        ORDER BY generation_id, output_index ASC
      `
    )
    .all(...rows.map((row) => row.id)) as DbAudioOutputRow[]

  const outputsByGeneration = new Map<string, StudioAudioOutput[]>()

  for (const output of outputRows) {
    const bucket = outputsByGeneration.get(output.generation_id) ?? []
    bucket.push(mapAudioOutput(output))
    outputsByGeneration.set(output.generation_id, bucket)
  }

  return rows.map((row) =>
    mapAudioGeneration(row, outputsByGeneration.get(row.id) ?? [])
  )
}

export function createStudioAudioGeneration(
  input: CreateAudioGenerationInput
): StudioAudioGeneration {
  const database = getAudioDb()
  const createdAt = nowIso()
  const id = randomUUID()
  const status = input.status ?? "running"

  const transaction = database.transaction(() => {
    database
      .prepare(
        `
          INSERT INTO studio_audio_generations
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

export function updateStudioAudioGeneration(
  generationId: string,
  input: UpdateAudioGenerationInput
) {
  const completedAt = input.completedAt ?? nowIso()

  getAudioDb()
    .prepare(
      `
        UPDATE studio_audio_generations
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

export function createStudioAudioOutput(
  input: CreateAudioOutputInput
): StudioAudioOutput {
  const id = input.id ?? randomUUID()
  const createdAt = nowIso()

  getAudioDb()
    .prepare(
      `
        INSERT INTO studio_audio_outputs
          (id, generation_id, output_index, url, data_url, storage_path,
           mime_type, duration_seconds, metadata, saved_at, created_at)
        VALUES
          (@id, @generationId, @index, @url, @dataUrl, @storagePath,
           @mimeType, @durationSeconds, @metadata, NULL, @createdAt)
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
      durationSeconds: input.durationSeconds ?? null,
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
    storagePath: input.storagePath ?? null,
    mimeType: input.mimeType ?? null,
    durationSeconds: input.durationSeconds ?? null,
    savedAt: null,
    createdAt,
  }
}

export function getStudioAudioOutput(outputId: string) {
  const row = getAudioDb()
    .prepare(
      `
        SELECT id, generation_id, output_index, url, data_url, storage_path,
               mime_type, duration_seconds, metadata, saved_at, created_at
        FROM studio_audio_outputs
        WHERE id = ?
      `
    )
    .get(outputId) as DbAudioOutputRow | undefined

  return row ? mapAudioOutput(row) : null
}

export function listStudioSavedAudioOutputs(): StudioSavedAudioOutput[] {
  const rows = getAudioDb()
    .prepare(
      `
        SELECT outputs.id, outputs.generation_id, generations.session_id,
               outputs.output_index, generations.prompt, generations.model_name,
               generations.manufacturer, outputs.mime_type,
               outputs.duration_seconds, outputs.storage_path, outputs.saved_at,
               outputs.created_at
        FROM studio_audio_outputs AS outputs
        INNER JOIN studio_audio_generations AS generations
          ON generations.id = outputs.generation_id
        WHERE outputs.saved_at IS NOT NULL
        ORDER BY outputs.saved_at DESC, outputs.created_at DESC
      `
    )
    .all() as DbSavedAudioOutputRow[]

  return rows.map((row) => ({
    id: row.id,
    generationId: row.generation_id,
    sessionId: row.session_id,
    index: row.output_index,
    prompt: row.prompt,
    modelName: row.model_name,
    manufacturer: row.manufacturer,
    mimeType: row.mime_type,
    durationSeconds: row.duration_seconds,
    storagePath: row.storage_path,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  }))
}

export function saveStudioAudioOutputStorage(
  outputId: string,
  storagePath: string,
  mimeType?: string | null
) {
  const savedAt = nowIso()

  getAudioDb()
    .prepare(
      `
        UPDATE studio_audio_outputs
        SET storage_path = ?,
            data_url = NULL,
            mime_type = COALESCE(?, mime_type),
            saved_at = ?
        WHERE id = ?
      `
    )
    .run(storagePath, mimeType ?? null, savedAt, outputId)

  return getStudioAudioOutput(outputId)
}
