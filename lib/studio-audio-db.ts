import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

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
  generationId: string
  index: number
  url?: string | null
  dataUrl?: string | null
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

let audioDb: Database.Database | undefined

function getDatabasePath() {
  return (
    process.env.ASTRAFLOW_SQLITE_PATH?.trim() ??
    join(process.cwd(), ".data", "astraflow.sqlite")
  )
}

function nowIso() {
  return new Date().toISOString()
}

function getAudioDb() {
  if (audioDb) {
    return audioDb
  }

  const dbPath = getDatabasePath()
  mkdirSync(dirname(dbPath), { recursive: true })
  audioDb = new Database(dbPath)
  audioDb.pragma("journal_mode = WAL")
  audioDb.pragma("foreign_keys = ON")
  initializeAudioSchema(audioDb)

  return audioDb
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
      mime_type TEXT,
      duration_seconds REAL,
      metadata TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (generation_id) REFERENCES studio_audio_generations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS studio_audio_generations_session_idx
      ON studio_audio_generations(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_audio_outputs_generation_idx
      ON studio_audio_outputs(generation_id, output_index ASC);
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
        SELECT id, generation_id, output_index, url, data_url, mime_type,
               duration_seconds, metadata, saved_at, created_at
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
      input.rawResponse === undefined ? null : JSON.stringify(input.rawResponse),
      completedAt,
      generationId
    )
}

export function createStudioAudioOutput(
  input: CreateAudioOutputInput
): StudioAudioOutput {
  const id = randomUUID()
  const createdAt = nowIso()

  getAudioDb()
    .prepare(
      `
        INSERT INTO studio_audio_outputs
          (id, generation_id, output_index, url, data_url, mime_type,
           duration_seconds, metadata, saved_at, created_at)
        VALUES
          (@id, @generationId, @index, @url, @dataUrl, @mimeType,
           @durationSeconds, @metadata, NULL, @createdAt)
      `
    )
    .run({
      id,
      generationId: input.generationId,
      index: input.index,
      url: input.url ?? null,
      dataUrl: input.dataUrl ?? null,
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
        SELECT id, generation_id, output_index, url, data_url, mime_type,
               duration_seconds, metadata, saved_at, created_at
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
               outputs.duration_seconds, outputs.saved_at, outputs.created_at
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
    savedAt: row.saved_at,
    createdAt: row.created_at,
  }))
}

export function saveStudioAudioOutputData(
  outputId: string,
  dataUrl: string,
  mimeType?: string | null
) {
  const savedAt = nowIso()

  getAudioDb()
    .prepare(
      `
        UPDATE studio_audio_outputs
        SET data_url = ?,
            mime_type = COALESCE(?, mime_type),
            saved_at = ?
        WHERE id = ?
      `
    )
    .run(dataUrl, mimeType ?? null, savedAt, outputId)

  return getStudioAudioOutput(outputId)
}
