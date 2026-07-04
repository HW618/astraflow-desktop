import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto"

import {
  removeStudioDirectory,
  removeStudioFile,
  safeFileName,
} from "@/lib/studio-file-storage"

import {
  applyMcpConfigSecrets,
  getMcpConfigSecretNames,
  maskMcpTransportConfig,
  normalizeMcpServerId,
  normalizeMcpTransportConfig,
  type InstalledMcpServer,
  type McpKeyValue,
  type McpRegistryServer,
  type McpServerCapabilities,
  type McpServerPromptSummary,
  type McpServerResourceSummary,
  type McpServerSource,
  type McpServerToolSummary,
  type McpTransportConfig,
  type McpTransportType,
} from "@/lib/mcp"
import type {
  CodeBoxGithubStatus,
  CodeBoxSandbox,
  CodeBoxSandboxStatus,
  CodeBoxVolume,
} from "@/lib/codebox-types"
import type { InstalledSkill, SkillMeta } from "@/lib/skill-market"
import { studioPermissionModes } from "@/lib/studio-types"
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
  StudioLocalProject,
  StudioModelverseApiKey,
  StudioMode,
  StudioOAuthStatus,
  StudioOAuthTokens,
  StudioPermissionMode,
  StudioSession,
  StudioSessionFile,
  StudioSessionFileKind,
  StudioSessionSandbox,
} from "@/lib/studio-types"

type DbSessionRow = {
  id: string
  mode: StudioMode
  title: string
  project_id: string | null
  permission_mode: StudioPermissionMode
  created_at: string
  updated_at: string
}

type DbLocalProjectRow = {
  id: string
  name: string
  path: string
  created_at: string
  updated_at: string
  last_opened_at: string | null
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

type DbPermissionRuleRow = {
  id: string
  project_id: string | null
  tool_name: string
  created_at: string
}

type DbSessionSandboxRow = {
  session_id: string
  sandbox_id: string
  sandbox_domain: string | null
  template: string
  status: StudioSessionSandbox["status"]
  auto_pause_timeout_seconds: number
  volume_id: string | null
  volume_name: string | null
  volume_path: string | null
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

type DbInstalledSkillRow = {
  slug: string
  version: string
  skill_meta: string
  skill_md: string
  enabled: number
  install_path: string
  installed_file_count: number
  installed_size_bytes: number
  installed_at: string
  updated_at: string
}

type DbSessionSkillSyncRow = {
  session_id: string
  slug: string
  version: string
  sandbox_id: string
  sandbox_path: string
  synced_at: string
}

type DbInstalledMcpServerRow = {
  id: string
  name: string
  title: string
  description: string
  source: McpServerSource
  registry_name: string | null
  registry_version: string | null
  transport: McpTransportType
  config: string
  capabilities: string
  tools: string
  resources: string
  prompts: string
  enabled: number
  last_connected_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

type DbMcpServerSecretRow = {
  server_id: string
  name: string
  value: string
  updated_at: string
}

type DbMcpRegistryServerRow = {
  id: string
  name: string
  version: string
  title: string
  description: string
  status: string
  latest: number
  source: "official"
  transports: string
  server_json: string
  registry_meta: string
  updated_at: string
  synced_at: string
}

type DbCodeBoxVolumeRow = {
  volume_id: string
  name: string
  created_at: string
  last_seen_at: string
}

type DbCodeBoxSandboxRow = {
  sandbox_id: string
  name: string | null
  owner_key: string | null
  owner_email: string | null
  company_id: string | null
  project_id: string | null
  volume_id: string | null
  volume_name: string | null
  sandbox_domain: string | null
  template: string
  status: CodeBoxSandboxStatus
  code_server_url: string | null
  code_server_host: string | null
  code_server_port: number
  password: string | null
  workspace_path: string
  repo_url: string | null
  started_at: string | null
  end_at: string | null
  created_at: string
  updated_at: string
  last_used_at: string
}

type CodeBoxGithubTokens = CodeBoxGithubStatus & {
  accessToken: string
}

type CreateSessionInput = {
  mode: StudioMode
  title?: string
}

type CreateLocalProjectInput = {
  name: string
  path: string
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
  volumeId?: string | null
  volumeName?: string | null
  volumePath?: string | null
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

type UpsertInstalledSkillInput = {
  slug: string
  version: string
  skill: SkillMeta
  skillMd: string
  enabled?: boolean
  installPath: string
  installedFileCount: number
  installedSizeBytes: number
}

type UpsertSessionSkillSyncInput = {
  sessionId: string
  slug: string
  version: string
  sandboxId: string
  sandboxPath: string
}

type UpsertStudioMcpServerInput = {
  id?: string
  name: string
  title?: string
  description?: string
  source?: McpServerSource
  registryName?: string | null
  registryVersion?: string | null
  enabled?: boolean
  config: McpTransportConfig
  capabilities?: McpServerCapabilities
  tools?: McpServerToolSummary[]
  resources?: McpServerResourceSummary[]
  prompts?: McpServerPromptSummary[]
  lastConnectedAt?: string | null
  lastError?: string | null
}

type UpdateStudioMcpServerInput = Partial<
  Omit<UpsertStudioMcpServerInput, "id">
>

type UpdateStudioMcpServerDiscoveryInput = {
  id: string
  capabilities: McpServerCapabilities
  tools: McpServerToolSummary[]
  resources: McpServerResourceSummary[]
  prompts: McpServerPromptSummary[]
  lastConnectedAt?: string | null
  lastError?: string | null
}

type ListStudioMcpRegistryServersInput = {
  keyword?: string
  transport?: McpTransportType | "all" | ""
  status?: string
  source?: string
  offset?: number
  limit?: number
}

type UpsertCodeBoxVolumeInput = {
  volumeId: string
  name: string
  createdAt?: string
  lastSeenAt?: string
}

type UpsertCodeBoxSandboxInput = {
  sandboxId: string
  name?: string | null
  ownerKey?: string | null
  ownerEmail?: string | null
  companyId?: string | null
  projectId?: string | null
  volumeId?: string | null
  volumeName?: string | null
  sandboxDomain?: string | null
  template: string
  status?: CodeBoxSandboxStatus
  codeServerUrl?: string | null
  codeServerHost?: string | null
  codeServerPort: number
  password?: string | null
  workspacePath: string
  repoUrl?: string | null
  startedAt?: string | null
  endAt?: string | null
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
  storage_path: string | null
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
  storage_path: string | null
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
  id?: string
  generationId: string
  index: number
  url?: string | null
  dataUrl?: string | null
  storagePath?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  metadata?: unknown
  autoSave?: boolean
}

type UpdateImageGenerationInput = {
  status: StudioImageStatus
  errorMessage?: string | null
  rawResponse?: unknown
  completedAt?: string | null
}

const DEFAULT_SESSION_TITLE = "New chat"
const STUDIO_MODELVERSE_API_KEY_SETTING = "modelverse_api_key"
const SELECTED_UCLOUD_PROJECT_SETTING = "selected_ucloud_project"
const STUDIO_EXA_API_KEY_SETTING = "exa_api_key"
const STUDIO_OAUTH_SETTING = "ucloud_oauth_tokens"
const CODEBOX_GITHUB_SETTING = "codebox_github_tokens"
const STUDIO_SESSION_SANDBOX_VOLUME_SETTING = "studio_session_sandbox_volume"

let db: Database.Database | undefined
let codeBoxSandboxOwnerColumnsReady = false

export type SqliteColumnDefinition = {
  name: string
  definition: string
}

const studioTableColumns = {
  studio_sessions: [
    { name: "id", definition: "id TEXT" },
    { name: "mode", definition: "mode TEXT NOT NULL DEFAULT 'chat'" },
    { name: "title", definition: "title TEXT NOT NULL DEFAULT 'New chat'" },
    { name: "project_id", definition: "project_id TEXT" },
    {
      name: "permission_mode",
      definition: "permission_mode TEXT NOT NULL DEFAULT 'ask'",
    },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_local_projects: [
    { name: "id", definition: "id TEXT" },
    { name: "name", definition: "name TEXT NOT NULL DEFAULT ''" },
    { name: "path", definition: "path TEXT NOT NULL DEFAULT ''" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    { name: "last_opened_at", definition: "last_opened_at TEXT" },
  ],
  studio_messages: [
    { name: "id", definition: "id TEXT" },
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    { name: "role", definition: "role TEXT NOT NULL DEFAULT 'assistant'" },
    { name: "content", definition: "content TEXT NOT NULL DEFAULT ''" },
    { name: "model", definition: "model TEXT" },
    { name: "version_group_id", definition: "version_group_id TEXT" },
    {
      name: "version_index",
      definition: "version_index INTEGER NOT NULL DEFAULT 1",
    },
    {
      name: "active_version",
      definition: "active_version INTEGER NOT NULL DEFAULT 1",
    },
    { name: "activities", definition: "activities TEXT" },
    { name: "parts", definition: "parts TEXT" },
    {
      name: "reasoning_content",
      definition: "reasoning_content TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "reasoning_duration_ms",
      definition: "reasoning_duration_ms INTEGER",
    },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT 'complete'" },
    { name: "attachments", definition: "attachments TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_settings: [
    { name: "key", definition: "key TEXT" },
    { name: "value", definition: "value TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_permission_rules: [
    { name: "id", definition: "id TEXT" },
    { name: "project_id", definition: "project_id TEXT" },
    { name: "tool_name", definition: "tool_name TEXT NOT NULL DEFAULT ''" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_session_sandboxes: [
    { name: "session_id", definition: "session_id TEXT" },
    { name: "sandbox_id", definition: "sandbox_id TEXT NOT NULL DEFAULT ''" },
    { name: "sandbox_domain", definition: "sandbox_domain TEXT" },
    { name: "template", definition: "template TEXT NOT NULL DEFAULT ''" },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT 'unknown'" },
    {
      name: "auto_pause_timeout_seconds",
      definition: "auto_pause_timeout_seconds INTEGER NOT NULL DEFAULT 300",
    },
    { name: "volume_id", definition: "volume_id TEXT" },
    { name: "volume_name", definition: "volume_name TEXT" },
    { name: "volume_path", definition: "volume_path TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    {
      name: "last_used_at",
      definition: "last_used_at TEXT NOT NULL DEFAULT ''",
    },
  ],
  studio_session_files: [
    { name: "id", definition: "id TEXT" },
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    { name: "message_id", definition: "message_id TEXT" },
    { name: "kind", definition: "kind TEXT NOT NULL DEFAULT 'attachment'" },
    {
      name: "original_name",
      definition: "original_name TEXT NOT NULL DEFAULT ''",
    },
    { name: "mime_type", definition: "mime_type TEXT" },
    { name: "size", definition: "size INTEGER" },
    {
      name: "storage_path",
      definition: "storage_path TEXT NOT NULL DEFAULT ''",
    },
    { name: "sandbox_path", definition: "sandbox_path TEXT" },
    { name: "source_tool_call_id", definition: "source_tool_call_id TEXT" },
    { name: "saved_at", definition: "saved_at TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_installed_skills: [
    { name: "slug", definition: "slug TEXT" },
    { name: "version", definition: "version TEXT NOT NULL DEFAULT ''" },
    { name: "skill_meta", definition: "skill_meta TEXT NOT NULL DEFAULT '{}'" },
    { name: "skill_md", definition: "skill_md TEXT NOT NULL DEFAULT ''" },
    { name: "enabled", definition: "enabled INTEGER NOT NULL DEFAULT 1" },
    {
      name: "install_path",
      definition: "install_path TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "installed_file_count",
      definition: "installed_file_count INTEGER NOT NULL DEFAULT 0",
    },
    {
      name: "installed_size_bytes",
      definition: "installed_size_bytes INTEGER NOT NULL DEFAULT 0",
    },
    {
      name: "installed_at",
      definition: "installed_at TEXT NOT NULL DEFAULT ''",
    },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_session_skill_syncs: [
    { name: "session_id", definition: "session_id TEXT NOT NULL DEFAULT ''" },
    { name: "slug", definition: "slug TEXT NOT NULL DEFAULT ''" },
    { name: "version", definition: "version TEXT NOT NULL DEFAULT ''" },
    { name: "sandbox_id", definition: "sandbox_id TEXT NOT NULL DEFAULT ''" },
    {
      name: "sandbox_path",
      definition: "sandbox_path TEXT NOT NULL DEFAULT ''",
    },
    { name: "synced_at", definition: "synced_at TEXT NOT NULL DEFAULT ''" },
  ],
  codebox_volumes: [
    { name: "volume_id", definition: "volume_id TEXT" },
    { name: "name", definition: "name TEXT NOT NULL DEFAULT ''" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    {
      name: "last_seen_at",
      definition: "last_seen_at TEXT NOT NULL DEFAULT ''",
    },
  ],
  codebox_sandboxes: [
    { name: "sandbox_id", definition: "sandbox_id TEXT" },
    { name: "name", definition: "name TEXT" },
    { name: "owner_key", definition: "owner_key TEXT" },
    { name: "owner_email", definition: "owner_email TEXT" },
    { name: "company_id", definition: "company_id TEXT" },
    { name: "project_id", definition: "project_id TEXT" },
    { name: "volume_id", definition: "volume_id TEXT" },
    { name: "volume_name", definition: "volume_name TEXT" },
    { name: "sandbox_domain", definition: "sandbox_domain TEXT" },
    { name: "template", definition: "template TEXT NOT NULL DEFAULT ''" },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT 'unknown'" },
    { name: "code_server_url", definition: "code_server_url TEXT" },
    { name: "code_server_host", definition: "code_server_host TEXT" },
    {
      name: "code_server_port",
      definition: "code_server_port INTEGER NOT NULL DEFAULT 0",
    },
    { name: "password", definition: "password TEXT" },
    {
      name: "workspace_path",
      definition: "workspace_path TEXT NOT NULL DEFAULT ''",
    },
    { name: "repo_url", definition: "repo_url TEXT" },
    { name: "started_at", definition: "started_at TEXT" },
    { name: "end_at", definition: "end_at TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    {
      name: "last_used_at",
      definition: "last_used_at TEXT NOT NULL DEFAULT ''",
    },
  ],
  studio_mcp_servers: [
    { name: "id", definition: "id TEXT" },
    { name: "name", definition: "name TEXT NOT NULL DEFAULT ''" },
    { name: "title", definition: "title TEXT NOT NULL DEFAULT ''" },
    {
      name: "description",
      definition: "description TEXT NOT NULL DEFAULT ''",
    },
    { name: "source", definition: "source TEXT NOT NULL DEFAULT ''" },
    { name: "registry_name", definition: "registry_name TEXT" },
    { name: "registry_version", definition: "registry_version TEXT" },
    {
      name: "transport",
      definition: "transport TEXT NOT NULL DEFAULT 'stdio'",
    },
    { name: "config", definition: "config TEXT NOT NULL DEFAULT '{}'" },
    {
      name: "capabilities",
      definition: "capabilities TEXT NOT NULL DEFAULT '{}'",
    },
    { name: "tools", definition: "tools TEXT NOT NULL DEFAULT '[]'" },
    { name: "resources", definition: "resources TEXT NOT NULL DEFAULT '[]'" },
    { name: "prompts", definition: "prompts TEXT NOT NULL DEFAULT '[]'" },
    { name: "enabled", definition: "enabled INTEGER NOT NULL DEFAULT 1" },
    { name: "last_connected_at", definition: "last_connected_at TEXT" },
    { name: "last_error", definition: "last_error TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_mcp_server_secrets: [
    { name: "server_id", definition: "server_id TEXT NOT NULL DEFAULT ''" },
    { name: "name", definition: "name TEXT NOT NULL DEFAULT ''" },
    { name: "value", definition: "value TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_mcp_registry_servers: [
    { name: "id", definition: "id TEXT" },
    { name: "name", definition: "name TEXT NOT NULL DEFAULT ''" },
    { name: "version", definition: "version TEXT NOT NULL DEFAULT ''" },
    { name: "title", definition: "title TEXT NOT NULL DEFAULT ''" },
    {
      name: "description",
      definition: "description TEXT NOT NULL DEFAULT ''",
    },
    { name: "status", definition: "status TEXT NOT NULL DEFAULT ''" },
    { name: "latest", definition: "latest INTEGER NOT NULL DEFAULT 0" },
    { name: "source", definition: "source TEXT NOT NULL DEFAULT 'official'" },
    { name: "transports", definition: "transports TEXT NOT NULL DEFAULT '[]'" },
    {
      name: "server_json",
      definition: "server_json TEXT NOT NULL DEFAULT '{}'",
    },
    {
      name: "registry_meta",
      definition: "registry_meta TEXT NOT NULL DEFAULT '{}'",
    },
    { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    { name: "synced_at", definition: "synced_at TEXT NOT NULL DEFAULT ''" },
  ],
  studio_image_generations: [
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
  studio_image_outputs: [
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
    { name: "width", definition: "width INTEGER" },
    { name: "height", definition: "height INTEGER" },
    { name: "metadata", definition: "metadata TEXT" },
    { name: "saved_at", definition: "saved_at TEXT" },
    { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
  ],
} satisfies Record<string, SqliteColumnDefinition[]>

function quoteSqliteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQLite identifier: ${identifier}`)
  }

  return `"${identifier}"`
}

export function ensureSqliteTableColumns(
  database: Database.Database,
  tableName: string,
  columns: SqliteColumnDefinition[]
) {
  const existingColumns = new Set(
    (
      database
        .prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`)
        .all() as Array<{ name: string }>
    ).map((column) => column.name)
  )

  for (const column of columns) {
    if (existingColumns.has(column.name)) {
      continue
    }

    database.exec(
      `ALTER TABLE ${quoteSqliteIdentifier(tableName)} ADD COLUMN ${
        column.definition
      }`
    )
    existingColumns.add(column.name)
  }
}

function ensureCodeBoxSandboxOwnerColumns(database = getDb()) {
  if (codeBoxSandboxOwnerColumnsReady) {
    return
  }

  ensureSqliteTableColumns(
    database,
    "codebox_sandboxes",
    studioTableColumns.codebox_sandboxes
  )
  ensureSchemaIndexes(database)

  codeBoxSandboxOwnerColumnsReady = true
}

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
  db.pragma("synchronous = NORMAL")
  db.pragma("busy_timeout = 5000")
  db.pragma("foreign_keys = ON")
  initializeSchema(db)
  migrateSchema(db)
  ensureSchemaIndexes(db)
  reconcileInterruptedRuns(db)

  return db
}

export function getStudioDatabase() {
  return getDb()
}

function reconcileInterruptedRuns(database: Database.Database) {
  // Streaming state only lives in an in-memory map (see studio-chat-runner),
  // so any message still marked as streaming when the process starts is a
  // leftover from a crash or forced shutdown and can never resume.
  cancelInterruptedRunPendingPermissionParts(database)

  database
    .prepare(
      `
        UPDATE studio_messages
        SET status = 'error'
        WHERE status = 'streaming'
      `
    )
    .run()
}

type InterruptedRunMessagePartsRow = {
  id: string
  parts: string | null
}

function cancelInterruptedRunPendingPermissionParts(
  database: Database.Database
) {
  const rows = database
    .prepare(
      `
        SELECT id, parts
        FROM studio_messages
        WHERE status = 'streaming'
          AND parts IS NOT NULL
      `
    )
    .all() as InterruptedRunMessagePartsRow[]

  if (rows.length === 0) {
    return
  }

  const updateParts = database.prepare(
    `
      UPDATE studio_messages
      SET parts = ?
      WHERE id = ?
    `
  )

  const updateTransaction = database.transaction(
    (messages: InterruptedRunMessagePartsRow[]) => {
      for (const message of messages) {
        const nextParts = serializeCancelledPendingPermissionParts(
          message.parts
        )

        if (nextParts !== null) {
          updateParts.run(nextParts, message.id)
        }
      }
    }
  )

  updateTransaction(rows)
}

function serializeCancelledPendingPermissionParts(raw: string | null) {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return null
    }

    let changed = false
    const parts = parsed.map((part) => {
      if (typeof part !== "object" || part === null || Array.isArray(part)) {
        return part
      }

      const record = part as Record<string, unknown>

      if (record.type !== "permission" || record.status !== "pending") {
        return part
      }

      changed = true

      return {
        ...record,
        status: "cancelled",
      }
    })

    return changed ? JSON.stringify(parts) : null
  } catch {
    return null
  }
}

function initializeSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS studio_sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      title TEXT NOT NULL,
      project_id TEXT,
      permission_mode TEXT NOT NULL DEFAULT 'ask',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_local_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_opened_at TEXT
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

    CREATE TABLE IF NOT EXISTS studio_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_permission_rules (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      tool_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, tool_name)
    );

    CREATE TABLE IF NOT EXISTS studio_session_sandboxes (
      session_id TEXT PRIMARY KEY,
      sandbox_id TEXT NOT NULL,
      sandbox_domain TEXT,
      template TEXT NOT NULL,
      status TEXT NOT NULL,
      auto_pause_timeout_seconds INTEGER NOT NULL,
      volume_id TEXT,
      volume_name TEXT,
      volume_path TEXT,
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

    CREATE TABLE IF NOT EXISTS studio_installed_skills (
      slug TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      skill_meta TEXT NOT NULL,
      skill_md TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      install_path TEXT NOT NULL,
      installed_file_count INTEGER NOT NULL DEFAULT 0,
      installed_size_bytes INTEGER NOT NULL DEFAULT 0,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_session_skill_syncs (
      session_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      version TEXT NOT NULL,
      sandbox_id TEXT NOT NULL,
      sandbox_path TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (session_id, slug),
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (slug) REFERENCES studio_installed_skills(slug) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS codebox_volumes (
      volume_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codebox_sandboxes (
      sandbox_id TEXT PRIMARY KEY,
      name TEXT,
      owner_key TEXT,
      owner_email TEXT,
      company_id TEXT,
      project_id TEXT,
      volume_id TEXT,
      volume_name TEXT,
      sandbox_domain TEXT,
      template TEXT NOT NULL,
      status TEXT NOT NULL,
      code_server_url TEXT,
      code_server_host TEXT,
      code_server_port INTEGER NOT NULL,
      password TEXT,
      workspace_path TEXT NOT NULL,
      repo_url TEXT,
      started_at TEXT,
      end_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      registry_name TEXT,
      registry_version TEXT,
      transport TEXT NOT NULL,
      config TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '{}',
      tools TEXT NOT NULL DEFAULT '[]',
      resources TEXT NOT NULL DEFAULT '[]',
      prompts TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_connected_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_mcp_server_secrets (
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (server_id, name),
      FOREIGN KEY (server_id) REFERENCES studio_mcp_servers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS studio_mcp_registry_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      latest INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'official',
      transports TEXT NOT NULL DEFAULT '[]',
      server_json TEXT NOT NULL,
      registry_meta TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

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
      storage_path TEXT,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      metadata TEXT,
      saved_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (generation_id) REFERENCES studio_image_generations(id) ON DELETE CASCADE
    );

  `)
}

function migrateSchema(database: Database.Database) {
  for (const [tableName, columns] of Object.entries(studioTableColumns)) {
    ensureSqliteTableColumns(database, tableName, columns)
  }

  database
    .prepare(
      `
        DELETE FROM studio_permission_rules
        WHERE project_id IS NULL
      `
    )
    .run()
}

function ensureSchemaIndexes(database: Database.Database) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS studio_sessions_updated_at_idx
      ON studio_sessions(updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_sessions_project_id_idx
      ON studio_sessions(project_id, updated_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS studio_permission_rules_scope_tool_idx
      ON studio_permission_rules(COALESCE(project_id, ''), tool_name);

    CREATE INDEX IF NOT EXISTS studio_permission_rules_project_idx
      ON studio_permission_rules(project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS studio_local_projects_updated_idx
      ON studio_local_projects(last_opened_at DESC, updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_messages_session_id_created_at_idx
      ON studio_messages(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_messages_version_group_idx
      ON studio_messages(session_id, version_group_id);

    CREATE INDEX IF NOT EXISTS studio_session_files_session_idx
      ON studio_session_files(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_session_files_saved_idx
      ON studio_session_files(saved_at DESC, created_at DESC);

    CREATE INDEX IF NOT EXISTS studio_installed_skills_enabled_idx
      ON studio_installed_skills(enabled, updated_at DESC);

    CREATE INDEX IF NOT EXISTS codebox_volumes_name_idx
      ON codebox_volumes(name);

    CREATE INDEX IF NOT EXISTS codebox_sandboxes_updated_idx
      ON codebox_sandboxes(updated_at DESC);

    CREATE INDEX IF NOT EXISTS codebox_sandboxes_owner_updated_idx
      ON codebox_sandboxes(owner_key, updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_mcp_servers_enabled_idx
      ON studio_mcp_servers(enabled, updated_at DESC);

    CREATE INDEX IF NOT EXISTS studio_mcp_registry_servers_name_idx
      ON studio_mcp_registry_servers(name, latest DESC);

    CREATE INDEX IF NOT EXISTS studio_mcp_registry_servers_synced_idx
      ON studio_mcp_registry_servers(synced_at DESC);

    CREATE INDEX IF NOT EXISTS studio_image_generations_session_idx
      ON studio_image_generations(session_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS studio_image_outputs_generation_idx
      ON studio_image_outputs(generation_id, output_index ASC);

    CREATE INDEX IF NOT EXISTS studio_image_outputs_saved_idx
      ON studio_image_outputs(saved_at DESC, created_at DESC);
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
    projectId: row.project_id,
    permissionMode: normalizePermissionMode(row.permission_mode),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizePermissionMode(value: unknown): StudioPermissionMode {
  return typeof value === "string" &&
    studioPermissionModes.includes(value as StudioPermissionMode)
    ? (value as StudioPermissionMode)
    : "ask"
}

function mapLocalProject(row: DbLocalProjectRow): StudioLocalProject {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
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
    volumeId: row.volume_id,
    volumeName: row.volume_name,
    volumePath: row.volume_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  }
}

function mapCodeBoxVolume(row: DbCodeBoxVolumeRow): CodeBoxVolume {
  return {
    volumeId: row.volume_id,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

function mapCodeBoxSandbox(row: DbCodeBoxSandboxRow): CodeBoxSandbox {
  return {
    sandboxId: row.sandbox_id,
    name: row.name,
    ownerKey: row.owner_key,
    companyId: row.company_id,
    projectId: row.project_id,
    template: row.template,
    status: row.status,
    volumeId: row.volume_id,
    volumeName: row.volume_name,
    codeServerUrl: row.code_server_url,
    codeServerHost: row.code_server_host,
    codeServerPort: row.code_server_port,
    password: row.password,
    workspacePath: row.workspace_path,
    repoUrl: row.repo_url,
    startedAt: row.started_at,
    endAt: row.end_at,
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

function parseSkillMeta(
  raw: string,
  fallbackSlug: string,
  fallbackVersion: string
) {
  try {
    const parsed = JSON.parse(raw) as SkillMeta

    return {
      ...parsed,
      Slug: parsed.Slug?.trim() || fallbackSlug,
      Version: parsed.Version?.trim() || fallbackVersion,
    }
  } catch {
    return {
      Slug: fallbackSlug,
      Version: fallbackVersion,
    }
  }
}

function mapInstalledSkill(row: DbInstalledSkillRow): InstalledSkill {
  return {
    slug: row.slug,
    version: row.version,
    skill: parseSkillMeta(row.skill_meta, row.slug, row.version),
    skillMd: row.skill_md,
    enabled: row.enabled !== 0,
    installPath: row.install_path,
    installedFileCount: row.installed_file_count,
    installedSizeBytes: row.installed_size_bytes,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  }
}

function parseJsonValue<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readMcpServerSecretMap(serverId: string) {
  const rows = getDb()
    .prepare(
      `
        SELECT server_id, name, value, updated_at
        FROM studio_mcp_server_secrets
        WHERE server_id = ?
      `
    )
    .all(serverId) as DbMcpServerSecretRow[]

  return Object.fromEntries(rows.map((row) => [row.name, row.value]))
}

function mapInstalledMcpServer(
  row: DbInstalledMcpServerRow,
  {
    includeSecrets = false,
  }: {
    includeSecrets?: boolean
  } = {}
): InstalledMcpServer {
  const parsedConfig = parseJsonValue<McpTransportConfig>(row.config, {
    type: row.transport,
    ...(row.transport === "stdio"
      ? { command: "", args: [], env: [] }
      : { url: "", headers: [] }),
  } as McpTransportConfig)
  const normalizedConfig = normalizeMcpTransportConfig(parsedConfig)
  const config = includeSecrets
    ? applyMcpConfigSecrets(normalizedConfig, readMcpServerSecretMap(row.id))
    : maskMcpTransportConfig(normalizedConfig)

  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    source: row.source,
    registryName: row.registry_name,
    registryVersion: row.registry_version,
    transport: row.transport,
    config,
    capabilities: parseJsonValue<McpServerCapabilities>(row.capabilities, {}),
    tools: parseJsonValue<McpServerToolSummary[]>(row.tools, []),
    resources: parseJsonValue<McpServerResourceSummary[]>(row.resources, []),
    prompts: parseJsonValue<McpServerPromptSummary[]>(row.prompts, []),
    enabled: row.enabled !== 0,
    lastConnectedAt: row.last_connected_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMcpRegistryServer(row: DbMcpRegistryServerRow): McpRegistryServer {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    title: row.title,
    description: row.description,
    status: row.status,
    latest: row.latest !== 0,
    source: row.source,
    transports: parseJsonValue<McpTransportType[]>(row.transports, []),
    serverJson: parseJsonValue<Record<string, unknown>>(row.server_json, {}),
    registryMeta: parseJsonValue<Record<string, unknown>>(
      row.registry_meta,
      {}
    ),
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
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

function isStudioPermissionOption(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { optionId?: unknown }).optionId === "string" &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { kind?: unknown }).kind === "string"
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

    return parsed
      .filter((item): item is StudioMessagePart => {
        if (typeof item !== "object" || item === null) {
          return false
        }

        const part = item as StudioMessagePart

        if (part.type === "text") {
          return (
            typeof part.id === "string" && typeof part.content === "string"
          )
        }

        if (part.type === "reasoning") {
          return (
            typeof part.id === "string" && typeof part.content === "string"
          )
        }

        if (part.type === "plan") {
          return (
            typeof part.id === "string" &&
            typeof part.content === "string" &&
            Array.isArray(part.todos) &&
            part.todos.every(
              (todo) =>
                typeof todo.text === "string" &&
                (todo.status === "pending" ||
                  todo.status === "in_progress" ||
                  todo.status === "completed")
            )
          )
        }

        if (part.type === "permission") {
          return (
            typeof part.id === "string" &&
            typeof part.toolName === "string" &&
            typeof part.input === "string" &&
            (part.status === "pending" ||
              part.status === "approved" ||
              part.status === "denied" ||
              part.status === "cancelled") &&
            Array.isArray(part.options) &&
            part.options.every(isStudioPermissionOption) &&
            (typeof part.selectedOptionId === "string" ||
              part.selectedOptionId === null)
          )
        }

        return (
          part.type === "tool" &&
          typeof part.id === "string" &&
          isStudioMessageActivity(part.activity)
        )
      })
      .map((part) =>
        part.type === "reasoning"
          ? {
              ...part,
              durationMs:
                typeof part.durationMs === "number" &&
                Number.isFinite(part.durationMs)
                  ? part.durationMs
                  : null,
            }
          : part
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

const ENCRYPTED_SETTING_PREFIX = "enc:v1:"

let cachedSecretKey: Buffer | null | undefined

function getSecretKey(): Buffer | null {
  if (cachedSecretKey !== undefined) {
    return cachedSecretKey
  }

  const raw = process.env.ASTRAFLOW_SECRET_KEY?.trim()

  if (raw && /^[0-9a-f]{64}$/i.test(raw)) {
    cachedSecretKey = Buffer.from(raw, "hex")
  } else {
    cachedSecretKey = null
  }

  return cachedSecretKey
}

// Encrypts a settings value with AES-256-GCM when a secret key is available.
// Without a key (e.g. plain `next dev`) the value is stored as-is, preserving
// the previous plaintext behavior.
function encryptSettingValue(value: string): string {
  const key = getSecretKey()

  if (!key) {
    return value
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return `${ENCRYPTED_SETTING_PREFIX}${Buffer.concat([iv, authTag, encrypted]).toString("base64")}`
}

// Decrypts a value produced by encryptSettingValue. Legacy plaintext values
// (no prefix) are returned unchanged, and undecryptable values fall back to
// the raw stored string so reads never throw.
function decryptSettingValue(value: string): string {
  if (!value.startsWith(ENCRYPTED_SETTING_PREFIX)) {
    return value
  }

  const key = getSecretKey()

  if (!key) {
    return value
  }

  try {
    const payload = Buffer.from(
      value.slice(ENCRYPTED_SETTING_PREFIX.length),
      "base64"
    )
    const iv = payload.subarray(0, 12)
    const authTag = payload.subarray(12, 28)
    const encrypted = payload.subarray(28)
    const decipher = createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(authTag)

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    return value
  }
}

function readSecretSetting(key: string) {
  const row = readStudioSetting(key)

  if (!row?.value) {
    return row
  }

  return { ...row, value: decryptSettingValue(row.value) }
}

function writeSecretSetting(key: string, value: string, updatedAt = nowIso()) {
  return writeStudioSetting(key, encryptSettingValue(value), updatedAt)
}

export function getStudioSessionSandboxVolumeRecord() {
  const row = readStudioSetting(STUDIO_SESSION_SANDBOX_VOLUME_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      volumeId?: string
      name?: string
    }

    if (!parsed.volumeId || !parsed.name) {
      return null
    }

    return {
      volumeId: parsed.volumeId,
      name: parsed.name,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function saveStudioSessionSandboxVolumeRecord({
  volumeId,
  name,
}: {
  volumeId: string
  name: string
}) {
  const updatedAt = writeStudioSetting(
    STUDIO_SESSION_SANDBOX_VOLUME_SETTING,
    JSON.stringify({ volumeId, name })
  )

  return {
    volumeId,
    name,
    updatedAt,
  }
}

export function clearStudioSessionSandboxVolumeRecord() {
  deleteStudioSetting(STUDIO_SESSION_SANDBOX_VOLUME_SETTING)
}

export function listStudioInstalledSkills({
  enabledOnly = false,
}: {
  enabledOnly?: boolean
} = {}) {
  const rows = getDb()
    .prepare(
      `
        SELECT
          slug,
          version,
          skill_meta,
          skill_md,
          enabled,
          install_path,
          installed_file_count,
          installed_size_bytes,
          installed_at,
          updated_at
        FROM studio_installed_skills
        ${enabledOnly ? "WHERE enabled = 1" : ""}
        ORDER BY updated_at DESC, slug ASC
      `
    )
    .all() as DbInstalledSkillRow[]

  return rows.map(mapInstalledSkill)
}

export function getStudioInstalledSkill(slug: string) {
  const normalizedSlug = slug.trim()

  if (!normalizedSlug) {
    return null
  }

  const row = getDb()
    .prepare(
      `
        SELECT
          slug,
          version,
          skill_meta,
          skill_md,
          enabled,
          install_path,
          installed_file_count,
          installed_size_bytes,
          installed_at,
          updated_at
        FROM studio_installed_skills
        WHERE slug = ?
      `
    )
    .get(normalizedSlug) as DbInstalledSkillRow | undefined

  return row ? mapInstalledSkill(row) : null
}

export function upsertStudioInstalledSkill({
  slug,
  version,
  skill,
  skillMd,
  enabled = true,
  installPath,
  installedFileCount,
  installedSizeBytes,
}: UpsertInstalledSkillInput) {
  const existing = getStudioInstalledSkill(slug)
  const installedAt = existing?.installedAt ?? nowIso()
  const updatedAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_installed_skills
          (
            slug,
            version,
            skill_meta,
            skill_md,
            enabled,
            install_path,
            installed_file_count,
            installed_size_bytes,
            installed_at,
            updated_at
          )
        VALUES
          (
            @slug,
            @version,
            @skillMeta,
            @skillMd,
            @enabled,
            @installPath,
            @installedFileCount,
            @installedSizeBytes,
            @installedAt,
            @updatedAt
          )
        ON CONFLICT(slug) DO UPDATE SET
          version = excluded.version,
          skill_meta = excluded.skill_meta,
          skill_md = excluded.skill_md,
          enabled = excluded.enabled,
          install_path = excluded.install_path,
          installed_file_count = excluded.installed_file_count,
          installed_size_bytes = excluded.installed_size_bytes,
          updated_at = excluded.updated_at
      `
    )
    .run({
      slug,
      version,
      skillMeta: JSON.stringify(skill),
      skillMd,
      enabled: enabled ? 1 : 0,
      installPath,
      installedFileCount,
      installedSizeBytes,
      installedAt,
      updatedAt,
    })

  return getStudioInstalledSkill(slug)
}

export function updateStudioInstalledSkillEnabled(
  slug: string,
  enabled: boolean
) {
  const updatedAt = nowIso()
  const result = getDb()
    .prepare(
      `
        UPDATE studio_installed_skills
        SET enabled = ?,
            updated_at = ?
        WHERE slug = ?
      `
    )
    .run(enabled ? 1 : 0, updatedAt, slug)

  return result.changes > 0 ? getStudioInstalledSkill(slug) : null
}

export function deleteStudioInstalledSkill(slug: string) {
  const database = getDb()
  const deleteTransaction = database.transaction(() => {
    database
      .prepare(
        `
          DELETE FROM studio_session_skill_syncs
          WHERE slug = ?
        `
      )
      .run(slug)

    const result = database
      .prepare(
        `
          DELETE FROM studio_installed_skills
          WHERE slug = ?
        `
      )
      .run(slug)

    return result.changes > 0
  })

  return deleteTransaction()
}

export function getStudioSessionSkillSync({
  sessionId,
  slug,
}: {
  sessionId: string
  slug: string
}) {
  const row = getDb()
    .prepare(
      `
        SELECT
          session_id,
          slug,
          version,
          sandbox_id,
          sandbox_path,
          synced_at
        FROM studio_session_skill_syncs
        WHERE session_id = ?
          AND slug = ?
      `
    )
    .get(sessionId, slug) as DbSessionSkillSyncRow | undefined

  return row
    ? {
        sessionId: row.session_id,
        slug: row.slug,
        version: row.version,
        sandboxId: row.sandbox_id,
        sandboxPath: row.sandbox_path,
        syncedAt: row.synced_at,
      }
    : null
}

export function upsertStudioSessionSkillSync({
  sessionId,
  slug,
  version,
  sandboxId,
  sandboxPath,
}: UpsertSessionSkillSyncInput) {
  const syncedAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_session_skill_syncs
          (session_id, slug, version, sandbox_id, sandbox_path, synced_at)
        VALUES
          (@sessionId, @slug, @version, @sandboxId, @sandboxPath, @syncedAt)
        ON CONFLICT(session_id, slug) DO UPDATE SET
          version = excluded.version,
          sandbox_id = excluded.sandbox_id,
          sandbox_path = excluded.sandbox_path,
          synced_at = excluded.synced_at
      `
    )
    .run({
      sessionId,
      slug,
      version,
      sandboxId,
      sandboxPath,
      syncedAt,
    })

  return getStudioSessionSkillSync({ sessionId, slug })
}

function prepareMcpConfigForStorage({
  config,
  serverId,
}: {
  config: McpTransportConfig
  serverId: string
}) {
  const normalizedConfig = normalizeMcpTransportConfig(config)
  const existingSecrets = readMcpServerSecretMap(serverId)
  const secretsToSave: Record<string, string> = {}
  const secretsToDelete = new Set<string>()
  const secretNames = new Set(getMcpConfigSecretNames(normalizedConfig))

  const prepareEntries = (entries: McpKeyValue[] | undefined) =>
    (entries ?? []).map((entry) => {
      if (!entry.isSecret) {
        return entry
      }

      const value = entry.value ?? ""

      if (value) {
        secretsToSave[entry.name] = value

        return {
          ...entry,
          value: "",
          hasValue: true,
        }
      }

      const hasExistingValue =
        Boolean(entry.hasValue) && existingSecrets[entry.name] !== undefined

      if (!hasExistingValue) {
        secretsToDelete.add(entry.name)
      }

      return {
        ...entry,
        value: "",
        hasValue: hasExistingValue,
      }
    })

  const storedConfig =
    normalizedConfig.type === "stdio"
      ? {
          ...normalizedConfig,
          env: prepareEntries(normalizedConfig.env),
        }
      : {
          ...normalizedConfig,
          headers: prepareEntries(normalizedConfig.headers),
        }

  return {
    storedConfig: maskMcpTransportConfig(storedConfig),
    secretNames,
    secretsToSave,
    secretsToDelete,
  }
}

export function listStudioMcpServers({
  enabledOnly = false,
  includeSecrets = false,
}: {
  enabledOnly?: boolean
  includeSecrets?: boolean
} = {}) {
  const rows = getDb()
    .prepare(
      `
        SELECT
          id,
          name,
          title,
          description,
          source,
          registry_name,
          registry_version,
          transport,
          config,
          capabilities,
          tools,
          resources,
          prompts,
          enabled,
          last_connected_at,
          last_error,
          created_at,
          updated_at
        FROM studio_mcp_servers
        ${enabledOnly ? "WHERE enabled = 1" : ""}
        ORDER BY updated_at DESC, title ASC
      `
    )
    .all() as DbInstalledMcpServerRow[]

  return rows.map((row) =>
    mapInstalledMcpServer(row, {
      includeSecrets,
    })
  )
}

export function getStudioMcpServer(
  id: string,
  {
    includeSecrets = false,
  }: {
    includeSecrets?: boolean
  } = {}
) {
  const normalizedId = id.trim()

  if (!normalizedId) {
    return null
  }

  const row = getDb()
    .prepare(
      `
        SELECT
          id,
          name,
          title,
          description,
          source,
          registry_name,
          registry_version,
          transport,
          config,
          capabilities,
          tools,
          resources,
          prompts,
          enabled,
          last_connected_at,
          last_error,
          created_at,
          updated_at
        FROM studio_mcp_servers
        WHERE id = ?
      `
    )
    .get(normalizedId) as DbInstalledMcpServerRow | undefined

  return row ? mapInstalledMcpServer(row, { includeSecrets }) : null
}

export function upsertStudioMcpServer(input: UpsertStudioMcpServerInput) {
  const id = normalizeMcpServerId(input.id || input.name)
  const existing = getStudioMcpServer(id)
  const createdAt = existing?.createdAt ?? nowIso()
  const updatedAt = nowIso()
  const title = input.title?.trim() || input.name.trim()
  const { storedConfig, secretNames, secretsToDelete, secretsToSave } =
    prepareMcpConfigForStorage({
      config: input.config,
      serverId: id,
    })
  const database = getDb()
  const saveTransaction = database.transaction(() => {
    database
      .prepare(
        `
          INSERT INTO studio_mcp_servers
            (
              id,
              name,
              title,
              description,
              source,
              registry_name,
              registry_version,
              transport,
              config,
              capabilities,
              tools,
              resources,
              prompts,
              enabled,
              last_connected_at,
              last_error,
              created_at,
              updated_at
            )
          VALUES
            (
              @id,
              @name,
              @title,
              @description,
              @source,
              @registryName,
              @registryVersion,
              @transport,
              @config,
              @capabilities,
              @tools,
              @resources,
              @prompts,
              @enabled,
              @lastConnectedAt,
              @lastError,
              @createdAt,
              @updatedAt
            )
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            title = excluded.title,
            description = excluded.description,
            source = excluded.source,
            registry_name = excluded.registry_name,
            registry_version = excluded.registry_version,
            transport = excluded.transport,
            config = excluded.config,
            capabilities = excluded.capabilities,
            tools = excluded.tools,
            resources = excluded.resources,
            prompts = excluded.prompts,
            enabled = excluded.enabled,
            last_connected_at = excluded.last_connected_at,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
        `
      )
      .run({
        id,
        name: input.name.trim(),
        title,
        description: input.description ?? "",
        source: input.source ?? "manual",
        registryName: input.registryName ?? null,
        registryVersion: input.registryVersion ?? null,
        transport: storedConfig.type,
        config: JSON.stringify(storedConfig),
        capabilities: JSON.stringify(input.capabilities ?? {}),
        tools: JSON.stringify(input.tools ?? []),
        resources: JSON.stringify(input.resources ?? []),
        prompts: JSON.stringify(input.prompts ?? []),
        enabled: input.enabled === false ? 0 : 1,
        lastConnectedAt: input.lastConnectedAt ?? null,
        lastError: input.lastError ?? null,
        createdAt,
        updatedAt,
      })

    const currentSecretNames = Object.keys(readMcpServerSecretMap(id))

    for (const secretName of currentSecretNames) {
      if (!secretNames.has(secretName) || secretsToDelete.has(secretName)) {
        database
          .prepare(
            `
              DELETE FROM studio_mcp_server_secrets
              WHERE server_id = ?
                AND name = ?
            `
          )
          .run(id, secretName)
      }
    }

    for (const [secretName, value] of Object.entries(secretsToSave)) {
      database
        .prepare(
          `
            INSERT INTO studio_mcp_server_secrets
              (server_id, name, value, updated_at)
            VALUES
              (?, ?, ?, ?)
            ON CONFLICT(server_id, name) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `
        )
        .run(id, secretName, value, updatedAt)
    }
  })

  saveTransaction()

  return getStudioMcpServer(id)
}

export function updateStudioMcpServer(
  id: string,
  updates: UpdateStudioMcpServerInput
) {
  const existing = getStudioMcpServer(id, { includeSecrets: true })

  if (!existing) {
    return null
  }

  return upsertStudioMcpServer({
    id: existing.id,
    name: updates.name ?? existing.name,
    title: updates.title ?? existing.title,
    description: updates.description ?? existing.description,
    source: updates.source ?? existing.source,
    registryName: updates.registryName ?? existing.registryName,
    registryVersion: updates.registryVersion ?? existing.registryVersion,
    enabled: updates.enabled ?? existing.enabled,
    config: updates.config ?? existing.config,
    capabilities: updates.capabilities ?? existing.capabilities,
    tools: updates.tools ?? existing.tools,
    resources: updates.resources ?? existing.resources,
    prompts: updates.prompts ?? existing.prompts,
    lastConnectedAt:
      updates.lastConnectedAt === undefined
        ? existing.lastConnectedAt
        : updates.lastConnectedAt,
    lastError:
      updates.lastError === undefined ? existing.lastError : updates.lastError,
  })
}

export function updateStudioMcpServerEnabled(id: string, enabled: boolean) {
  const updatedAt = nowIso()
  const result = getDb()
    .prepare(
      `
        UPDATE studio_mcp_servers
        SET enabled = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(enabled ? 1 : 0, updatedAt, id)

  return result.changes > 0 ? getStudioMcpServer(id) : null
}

export function updateStudioMcpServerDiscovery({
  id,
  capabilities,
  tools,
  resources,
  prompts,
  lastConnectedAt = nowIso(),
  lastError = null,
}: UpdateStudioMcpServerDiscoveryInput) {
  const updatedAt = nowIso()
  const result = getDb()
    .prepare(
      `
        UPDATE studio_mcp_servers
        SET capabilities = ?,
            tools = ?,
            resources = ?,
            prompts = ?,
            last_connected_at = ?,
            last_error = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      JSON.stringify(capabilities),
      JSON.stringify(tools),
      JSON.stringify(resources),
      JSON.stringify(prompts),
      lastConnectedAt,
      lastError,
      updatedAt,
      id
    )

  return result.changes > 0 ? getStudioMcpServer(id) : null
}

export function updateStudioMcpServerConnectionError(
  id: string,
  lastError: string
) {
  const updatedAt = nowIso()
  const result = getDb()
    .prepare(
      `
        UPDATE studio_mcp_servers
        SET last_error = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(lastError, updatedAt, id)

  return result.changes > 0 ? getStudioMcpServer(id) : null
}

export function deleteStudioMcpServer(id: string) {
  const result = getDb()
    .prepare(
      `
        DELETE FROM studio_mcp_servers
        WHERE id = ?
      `
    )
    .run(id)

  return result.changes > 0
}

export function upsertStudioMcpRegistryServers(servers: McpRegistryServer[]) {
  if (servers.length === 0) {
    return 0
  }

  const database = getDb()
  const saveTransaction = database.transaction(() => {
    let count = 0

    for (const server of servers) {
      const result = database
        .prepare(
          `
            INSERT INTO studio_mcp_registry_servers
              (
                id,
                name,
                version,
                title,
                description,
                status,
                latest,
                source,
                transports,
                server_json,
                registry_meta,
                updated_at,
                synced_at
              )
            VALUES
              (
                @id,
                @name,
                @version,
                @title,
                @description,
                @status,
                @latest,
                @source,
                @transports,
                @serverJson,
                @registryMeta,
                @updatedAt,
                @syncedAt
              )
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              version = excluded.version,
              title = excluded.title,
              description = excluded.description,
              status = excluded.status,
              latest = excluded.latest,
              source = excluded.source,
              transports = excluded.transports,
              server_json = excluded.server_json,
              registry_meta = excluded.registry_meta,
              updated_at = excluded.updated_at,
              synced_at = excluded.synced_at
          `
        )
        .run({
          id: server.id,
          name: server.name,
          version: server.version,
          title: server.title,
          description: server.description,
          status: server.status,
          latest: server.latest ? 1 : 0,
          source: server.source,
          transports: JSON.stringify(server.transports),
          serverJson: JSON.stringify(server.serverJson),
          registryMeta: JSON.stringify(server.registryMeta),
          updatedAt: server.updatedAt,
          syncedAt: server.syncedAt,
        })

      if (result.changes > 0) {
        count += 1
      }
    }

    return count
  })

  return saveTransaction()
}

export function listStudioMcpRegistryServers({
  keyword = "",
  transport = "",
  status = "",
  source = "",
  offset = 0,
  limit = 24,
}: ListStudioMcpRegistryServersInput = {}) {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const normalizedStatus = status.trim().toLowerCase()
  const normalizedSource = source.trim().toLowerCase()
  const rows = getDb()
    .prepare(
      `
        SELECT
          id,
          name,
          version,
          title,
          description,
          status,
          latest,
          source,
          transports,
          server_json,
          registry_meta,
          updated_at,
          synced_at
        FROM studio_mcp_registry_servers
        ORDER BY latest DESC, updated_at DESC, title ASC
      `
    )
    .all() as DbMcpRegistryServerRow[]
  const filtered = rows.map(mapMcpRegistryServer).filter((server) => {
    if (
      normalizedKeyword &&
      ![server.name, server.title, server.description, server.version]
        .join(" ")
        .toLowerCase()
        .includes(normalizedKeyword)
    ) {
      return false
    }

    if (
      transport &&
      transport !== "all" &&
      !server.transports.includes(transport)
    ) {
      return false
    }

    if (normalizedStatus && server.status.toLowerCase() !== normalizedStatus) {
      return false
    }

    if (normalizedSource && server.source.toLowerCase() !== normalizedSource) {
      return false
    }

    return true
  })
  const safeOffset = Math.max(0, offset)
  const safeLimit = Math.max(1, Math.min(limit, 100))

  return {
    data: filtered.slice(safeOffset, safeOffset + safeLimit),
    totalCount: filtered.length,
  }
}

export function getStudioMcpRegistryServer(id: string) {
  const row = getDb()
    .prepare(
      `
        SELECT
          id,
          name,
          version,
          title,
          description,
          status,
          latest,
          source,
          transports,
          server_json,
          registry_meta,
          updated_at,
          synced_at
        FROM studio_mcp_registry_servers
        WHERE id = ?
      `
    )
    .get(id) as DbMcpRegistryServerRow | undefined

  return row ? mapMcpRegistryServer(row) : null
}

export function listStudioLocalProjects() {
  const rows = getDb()
    .prepare(
      `
        SELECT id, name, path, created_at, updated_at, last_opened_at
        FROM studio_local_projects
        ORDER BY COALESCE(last_opened_at, updated_at) DESC, name ASC
      `
    )
    .all() as DbLocalProjectRow[]

  return rows.map(mapLocalProject)
}

export function getStudioLocalProject(projectId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT id, name, path, created_at, updated_at, last_opened_at
        FROM studio_local_projects
        WHERE id = ?
      `
    )
    .get(projectId) as DbLocalProjectRow | undefined

  return row ? mapLocalProject(row) : null
}

export function getStudioLocalProjectByPath(path: string) {
  const row = getDb()
    .prepare(
      `
        SELECT id, name, path, created_at, updated_at, last_opened_at
        FROM studio_local_projects
        WHERE path = ?
      `
    )
    .get(path) as DbLocalProjectRow | undefined

  return row ? mapLocalProject(row) : null
}

export function createStudioLocalProject({
  name,
  path,
}: CreateLocalProjectInput) {
  const existing = getStudioLocalProjectByPath(path)
  const timestamp = nowIso()

  if (existing) {
    getDb()
      .prepare(
        `
          UPDATE studio_local_projects
          SET name = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(name, timestamp, existing.id)

    return getStudioLocalProject(existing.id) ?? existing
  }

  const project: StudioLocalProject = {
    id: randomUUID(),
    name,
    path,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_local_projects
          (id, name, path, created_at, updated_at, last_opened_at)
        VALUES
          (@id, @name, @path, @createdAt, @updatedAt, @lastOpenedAt)
      `
    )
    .run(project)

  return project
}

export function touchStudioLocalProject(projectId: string) {
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_local_projects
        SET last_opened_at = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(timestamp, timestamp, projectId)

  return getStudioLocalProject(projectId)
}

export function deleteStudioLocalProject(projectId: string) {
  const database = getDb()

  const transaction = database.transaction(() => {
    database
      .prepare(
        `
          UPDATE studio_sessions
          SET project_id = NULL, updated_at = ?
          WHERE project_id = ?
        `
      )
      .run(nowIso(), projectId)

    database
      .prepare(
        `
          DELETE FROM studio_local_projects
          WHERE id = ?
        `
      )
      .run(projectId)

    database
      .prepare(
        `
          DELETE FROM studio_permission_rules
          WHERE project_id = ?
        `
      )
      .run(projectId)
  })

  transaction()
}

export function hasStudioPermissionRule({
  projectId,
  toolName,
}: {
  projectId: string | null
  toolName: string
}) {
  const normalizedToolName = toolName.trim()

  if (!normalizedToolName || !projectId) {
    return false
  }

  const row = getDb()
    .prepare(
      `
        SELECT id, project_id, tool_name, created_at
        FROM studio_permission_rules
        WHERE tool_name = ?
          AND project_id = ?
        LIMIT 1
      `
    )
    .get(normalizedToolName, projectId) as
    | DbPermissionRuleRow
    | undefined

  return Boolean(row)
}

export function createStudioPermissionRule({
  projectId,
  toolName,
}: {
  projectId: string | null
  toolName: string
}) {
  const normalizedToolName = toolName.trim()

  if (!normalizedToolName || !projectId) {
    return null
  }

  const id = randomUUID()
  const createdAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT OR IGNORE INTO studio_permission_rules
          (id, project_id, tool_name, created_at)
        VALUES
          (?, ?, ?, ?)
      `
    )
    .run(id, projectId, normalizedToolName, createdAt)

  return {
    id,
    projectId,
    toolName: normalizedToolName,
    createdAt,
  }
}

export function countStudioPermissionRules(projectId: string | null) {
  const row = getDb()
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM studio_permission_rules
        WHERE ${
          projectId === null ? "project_id IS NULL" : "project_id = ?"
        }
      `
    )
    .get(...(projectId === null ? [] : [projectId])) as
    | { count: number }
    | undefined

  return row?.count ?? 0
}

export function deleteStudioPermissionRules(projectId: string | null) {
  const result = getDb()
    .prepare(
      `
        DELETE FROM studio_permission_rules
        WHERE ${
          projectId === null ? "project_id IS NULL" : "project_id = ?"
        }
      `
    )
    .run(...(projectId === null ? [] : [projectId]))

  return result.changes
}

export function listStudioSessions() {
  const rows = getDb()
    .prepare(
      `
        SELECT
          id,
          mode,
          title,
          project_id,
          permission_mode,
          created_at,
          updated_at
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
        SELECT
          id,
          mode,
          title,
          project_id,
          permission_mode,
          created_at,
          updated_at
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
    projectId: null,
    permissionMode: "ask",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_sessions
          (
            id,
            mode,
            title,
            project_id,
            permission_mode,
            created_at,
            updated_at
          )
        VALUES
          (
            @id,
            @mode,
            @title,
            @projectId,
            @permissionMode,
            @createdAt,
            @updatedAt
          )
      `
    )
    .run(session)

  return session
}

export function updateStudioSessionTitle(sessionId: string, title: string) {
  const normalized = normalizeTitle(title)
  const updatedAt = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET title = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(normalized, updatedAt, sessionId)

  return getStudioSession(sessionId)
}

export function updateStudioSessionProject(
  sessionId: string,
  projectId: string | null
) {
  const updatedAt = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET project_id = ?,
            permission_mode = CASE
              WHEN ? IS NOT NULL AND permission_mode = 'auto' THEN 'ask'
              ELSE permission_mode
            END,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(projectId, projectId, updatedAt, sessionId)

  if (projectId) {
    touchStudioLocalProject(projectId)
  }

  return getStudioSession(sessionId)
}

export function updateStudioSessionPermissionMode(
  sessionId: string,
  permissionMode: StudioPermissionMode
) {
  const updatedAt = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET permission_mode = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(permissionMode, updatedAt, sessionId)

  return getStudioSession(sessionId)
}

export function deleteStudioSession(sessionId: string) {
  const database = getDb()

  // Collect on-disk artifacts before the DB rows (and their storage paths)
  // are gone. File removal is best-effort so it never blocks the deletion.
  const storagePaths = new Set<string>()

  const mediaQueries = [
    `SELECT outputs.storage_path AS storage_path
       FROM studio_image_outputs AS outputs
       INNER JOIN studio_image_generations AS generations
         ON generations.id = outputs.generation_id
       WHERE generations.session_id = ?`,
    `SELECT outputs.storage_path AS storage_path
       FROM studio_audio_outputs AS outputs
       INNER JOIN studio_audio_generations AS generations
         ON generations.id = outputs.generation_id
       WHERE generations.session_id = ?`,
    `SELECT outputs.storage_path AS storage_path
       FROM studio_video_outputs AS outputs
       INNER JOIN studio_video_generations AS generations
         ON generations.id = outputs.generation_id
       WHERE generations.session_id = ?`,
    `SELECT storage_path FROM studio_session_files WHERE session_id = ?`,
  ]

  for (const sql of mediaQueries) {
    try {
      const rows = database.prepare(sql).all(sessionId) as Array<{
        storage_path: string | null
      }>

      for (const row of rows) {
        if (row.storage_path) {
          storagePaths.add(row.storage_path)
        }
      }
    } catch {
      // Media tables may not exist yet; ignore and continue.
    }
  }

  const result = database
    .prepare(
      `
        DELETE FROM studio_sessions
        WHERE id = ?
      `
    )
    .run(sessionId)

  if (result.changes > 0) {
    for (const storagePath of storagePaths) {
      try {
        removeStudioFile(storagePath)
      } catch {
        // Best-effort cleanup; a missing or unreadable file must not fail.
      }
    }

    for (const directory of [
      join("attachments", safeFileName(sessionId)),
      join("generated", safeFileName(sessionId)),
    ]) {
      try {
        removeStudioDirectory(directory)
      } catch {
        // Best-effort cleanup; ignore removal errors.
      }
    }
  }

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

    // When a retry finalizes to an empty error, the newly created version has
    // already hidden the previous answer (active_version = 0 for the group).
    // Fall back to the most recent complete version so a working answer is not
    // replaced by a blank failure.
    if (
      nextStatus === "error" &&
      current.role === "assistant" &&
      current.versionGroupId &&
      nextContent.trim().length === 0
    ) {
      const fallback = database
        .prepare(
          `
            SELECT id
            FROM studio_messages
            WHERE session_id = ?
              AND role = 'assistant'
              AND version_group_id = ?
              AND id != ?
              AND status = 'complete'
            ORDER BY version_index DESC
            LIMIT 1
          `
        )
        .get(current.sessionId, current.versionGroupId, messageId) as
        { id: string } | undefined

      if (fallback) {
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
          .run(current.sessionId, current.versionGroupId)

        database
          .prepare(
            `
              UPDATE studio_messages
              SET active_version = 1
              WHERE id = ?
            `
          )
          .run(fallback.id)
      }
    }
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
               auto_pause_timeout_seconds, volume_id, volume_name,
               volume_path, created_at, updated_at, last_used_at
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
  volumeId = null,
  volumeName = null,
  volumePath = null,
}: UpsertSessionSandboxInput) {
  const existing = getStudioSessionSandbox(sessionId)
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_session_sandboxes
          (session_id, sandbox_id, sandbox_domain, template, status,
           auto_pause_timeout_seconds, volume_id, volume_name, volume_path,
           created_at, updated_at, last_used_at)
        VALUES
          (@sessionId, @sandboxId, @sandboxDomain, @template, @status,
           @autoPauseTimeoutSeconds, @volumeId, @volumeName, @volumePath,
           @createdAt, @updatedAt, @lastUsedAt)
        ON CONFLICT(session_id) DO UPDATE SET
          sandbox_id = excluded.sandbox_id,
          sandbox_domain = excluded.sandbox_domain,
          template = excluded.template,
          status = excluded.status,
          auto_pause_timeout_seconds = excluded.auto_pause_timeout_seconds,
          volume_id = excluded.volume_id,
          volume_name = excluded.volume_name,
          volume_path = excluded.volume_path,
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
      volumeId,
      volumeName,
      volumePath,
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

export function listCodeBoxVolumeRecords() {
  const rows = getDb()
    .prepare(
      `
        SELECT volume_id, name, created_at, last_seen_at
        FROM codebox_volumes
        ORDER BY last_seen_at DESC, name ASC
      `
    )
    .all() as DbCodeBoxVolumeRow[]

  return rows.map(mapCodeBoxVolume)
}

export function getCodeBoxVolumeRecord(volumeId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT volume_id, name, created_at, last_seen_at
        FROM codebox_volumes
        WHERE volume_id = ?
      `
    )
    .get(volumeId) as DbCodeBoxVolumeRow | undefined

  return row ? mapCodeBoxVolume(row) : null
}

export function upsertCodeBoxVolumeRecord({
  volumeId,
  name,
  createdAt,
  lastSeenAt,
}: UpsertCodeBoxVolumeInput) {
  const existing = getCodeBoxVolumeRecord(volumeId)
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO codebox_volumes
          (volume_id, name, created_at, last_seen_at)
        VALUES
          (@volumeId, @name, @createdAt, @lastSeenAt)
        ON CONFLICT(volume_id) DO UPDATE SET
          name = excluded.name,
          last_seen_at = excluded.last_seen_at
      `
    )
    .run({
      volumeId,
      name,
      createdAt: existing?.createdAt ?? createdAt ?? timestamp,
      lastSeenAt: lastSeenAt ?? timestamp,
    })

  return getCodeBoxVolumeRecord(volumeId)
}

export function deleteCodeBoxVolumeRecord(volumeId: string) {
  getDb()
    .prepare(
      `
        DELETE FROM codebox_volumes
        WHERE volume_id = ?
      `
    )
    .run(volumeId)
}

export function listCodeBoxSandboxRecords(ownerKey?: string | null) {
  ensureCodeBoxSandboxOwnerColumns()
  const normalizedOwnerKey = ownerKey?.trim()
  const rows = normalizedOwnerKey
    ? (getDb()
        .prepare(
          `
            SELECT sandbox_id, owner_key, owner_email, company_id, project_id, volume_id,
                   name, volume_name, sandbox_domain, template, status,
                   code_server_url, code_server_host, code_server_port,
                   password, workspace_path, repo_url, started_at, end_at,
                   created_at, updated_at, last_used_at
            FROM codebox_sandboxes
            WHERE owner_key = ?
            ORDER BY updated_at DESC
          `
        )
        .all(normalizedOwnerKey) as DbCodeBoxSandboxRow[])
    : (getDb()
        .prepare(
          `
            SELECT sandbox_id, owner_key, owner_email, company_id, project_id, volume_id,
                   name, volume_name, sandbox_domain, template, status,
                   code_server_url, code_server_host, code_server_port,
                   password, workspace_path, repo_url, started_at, end_at,
                   created_at, updated_at, last_used_at
            FROM codebox_sandboxes
            ORDER BY updated_at DESC
          `
        )
        .all() as DbCodeBoxSandboxRow[])

  return rows.map(mapCodeBoxSandbox)
}

export function getCodeBoxSandboxRecord(
  sandboxId: string,
  ownerKey?: string | null
) {
  ensureCodeBoxSandboxOwnerColumns()
  const normalizedOwnerKey = ownerKey?.trim()
  const row = normalizedOwnerKey
    ? (getDb()
        .prepare(
          `
            SELECT sandbox_id, owner_key, owner_email, company_id, project_id, volume_id,
                   name, volume_name, sandbox_domain, template, status,
                   code_server_url, code_server_host, code_server_port,
                   password, workspace_path, repo_url, started_at, end_at,
                   created_at, updated_at, last_used_at
            FROM codebox_sandboxes
            WHERE sandbox_id = ? AND owner_key = ?
          `
        )
        .get(sandboxId, normalizedOwnerKey) as DbCodeBoxSandboxRow | undefined)
    : (getDb()
        .prepare(
          `
            SELECT sandbox_id, owner_key, owner_email, company_id, project_id, volume_id,
                   name, volume_name, sandbox_domain, template, status,
                   code_server_url, code_server_host, code_server_port,
                   password, workspace_path, repo_url, started_at, end_at,
                   created_at, updated_at, last_used_at
            FROM codebox_sandboxes
            WHERE sandbox_id = ?
          `
        )
        .get(sandboxId) as DbCodeBoxSandboxRow | undefined)

  return row ? mapCodeBoxSandbox(row) : null
}

export function upsertCodeBoxSandboxRecord({
  sandboxId,
  name = null,
  ownerKey = null,
  ownerEmail = null,
  companyId = null,
  projectId = null,
  volumeId = null,
  volumeName = null,
  sandboxDomain = null,
  template,
  status = "running",
  codeServerUrl = null,
  codeServerHost = null,
  codeServerPort,
  password = null,
  workspacePath,
  repoUrl = null,
  startedAt = null,
  endAt = null,
}: UpsertCodeBoxSandboxInput) {
  ensureCodeBoxSandboxOwnerColumns()
  const existing = getCodeBoxSandboxRecord(sandboxId, ownerKey)
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO codebox_sandboxes
          (sandbox_id, name, owner_key, owner_email, company_id, project_id, volume_id,
           volume_name, sandbox_domain, template, status, code_server_url,
           code_server_host, code_server_port, password, workspace_path,
           repo_url, started_at, end_at, created_at, updated_at, last_used_at)
        VALUES
          (@sandboxId, @name, @ownerKey, @ownerEmail, @companyId, @projectId, @volumeId,
           @volumeName, @sandboxDomain, @template, @status, @codeServerUrl,
           @codeServerHost, @codeServerPort, @password, @workspacePath,
           @repoUrl, @startedAt, @endAt, @createdAt, @updatedAt, @lastUsedAt)
        ON CONFLICT(sandbox_id) DO UPDATE SET
          name = excluded.name,
          owner_key = excluded.owner_key,
          owner_email = excluded.owner_email,
          company_id = excluded.company_id,
          project_id = excluded.project_id,
          volume_id = excluded.volume_id,
          volume_name = excluded.volume_name,
          sandbox_domain = excluded.sandbox_domain,
          template = excluded.template,
          status = excluded.status,
          code_server_url = excluded.code_server_url,
          code_server_host = excluded.code_server_host,
          code_server_port = excluded.code_server_port,
          password = excluded.password,
          workspace_path = excluded.workspace_path,
          repo_url = excluded.repo_url,
          started_at = excluded.started_at,
          end_at = excluded.end_at,
          updated_at = excluded.updated_at,
          last_used_at = excluded.last_used_at
      `
    )
    .run({
      sandboxId,
      name,
      ownerKey,
      ownerEmail,
      companyId,
      projectId,
      volumeId,
      volumeName,
      sandboxDomain,
      template,
      status,
      codeServerUrl,
      codeServerHost,
      codeServerPort,
      password,
      workspacePath,
      repoUrl,
      startedAt,
      endAt,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
    })

  return getCodeBoxSandboxRecord(sandboxId, ownerKey)
}

export function touchCodeBoxSandboxRecord(
  sandboxId: string,
  status: CodeBoxSandboxStatus,
  ownerKey?: string | null
) {
  ensureCodeBoxSandboxOwnerColumns()
  const timestamp = nowIso()
  const normalizedOwnerKey = ownerKey?.trim()

  if (normalizedOwnerKey) {
    getDb()
      .prepare(
        `
          UPDATE codebox_sandboxes
          SET status = ?,
              updated_at = ?,
              last_used_at = ?
          WHERE sandbox_id = ? AND owner_key = ?
        `
      )
      .run(status, timestamp, timestamp, sandboxId, normalizedOwnerKey)
    return
  }

  getDb()
    .prepare(
      `
        UPDATE codebox_sandboxes
        SET status = ?,
            updated_at = ?,
            last_used_at = ?
        WHERE sandbox_id = ?
      `
    )
    .run(status, timestamp, timestamp, sandboxId)
}

export function updateCodeBoxSandboxNameRecord(
  sandboxId: string,
  name: string | null,
  ownerKey?: string | null
) {
  ensureCodeBoxSandboxOwnerColumns()
  const timestamp = nowIso()
  const normalizedOwnerKey = ownerKey?.trim()

  if (normalizedOwnerKey) {
    getDb()
      .prepare(
        `
          UPDATE codebox_sandboxes
          SET name = ?,
              updated_at = ?,
              last_used_at = ?
          WHERE sandbox_id = ? AND owner_key = ?
        `
      )
      .run(name, timestamp, timestamp, sandboxId, normalizedOwnerKey)

    return getCodeBoxSandboxRecord(sandboxId, normalizedOwnerKey)
  }

  getDb()
    .prepare(
      `
        UPDATE codebox_sandboxes
        SET name = ?,
            updated_at = ?,
            last_used_at = ?
        WHERE sandbox_id = ?
      `
    )
    .run(name, timestamp, timestamp, sandboxId)

  return getCodeBoxSandboxRecord(sandboxId)
}

export function deleteCodeBoxSandboxRecord(sandboxId: string) {
  ensureCodeBoxSandboxOwnerColumns()
  getDb()
    .prepare(
      `
        DELETE FROM codebox_sandboxes
        WHERE sandbox_id = ?
      `
    )
    .run(sandboxId)
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
    canOpenFolder: true,
    savedAt: row.saved_at ?? row.created_at,
    createdAt: row.created_at,
  }))
}

export function getStudioOAuthTokens(): StudioOAuthTokens | null {
  const row = readSecretSetting(STUDIO_OAUTH_SETTING)

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
  const updatedAt = writeSecretSetting(
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

export function getCodeBoxGithubTokens(): CodeBoxGithubTokens | null {
  const row = readSecretSetting(CODEBOX_GITHUB_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      accessToken?: string
      login?: string | null
      name?: string | null
      email?: string | null
    }

    if (!parsed.accessToken) {
      return null
    }

    return {
      configured: true,
      accessToken: parsed.accessToken,
      login: parsed.login ?? null,
      name: parsed.name ?? null,
      email: parsed.email ?? null,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function getCodeBoxGithubStatus(): CodeBoxGithubStatus {
  const tokens = getCodeBoxGithubTokens()

  return {
    configured: Boolean(tokens?.accessToken),
    login: tokens?.login ?? null,
    name: tokens?.name ?? null,
    email: tokens?.email ?? null,
    updatedAt: tokens?.updatedAt ?? null,
  }
}

export function saveCodeBoxGithubTokens({
  accessToken,
  login,
  name,
  email,
}: {
  accessToken: string
  login?: string | null
  name?: string | null
  email?: string | null
}) {
  const updatedAt = writeSecretSetting(
    CODEBOX_GITHUB_SETTING,
    JSON.stringify({
      accessToken,
      login: login ?? null,
      name: name ?? null,
      email: email ?? null,
    })
  )

  return {
    configured: true,
    login: login ?? null,
    name: name ?? null,
    email: email ?? null,
    updatedAt,
  } satisfies CodeBoxGithubStatus
}

export function clearCodeBoxGithubTokens() {
  deleteStudioSetting(CODEBOX_GITHUB_SETTING)
}

export function getStudioModelverseApiKey(): StudioModelverseApiKey | null {
  const row = readSecretSetting(STUDIO_MODELVERSE_API_KEY_SETTING)

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

    const selectedProjectId = getSelectedUCloudProjectId()

    if (selectedProjectId && parsed.projectId !== selectedProjectId) {
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
  const updatedAt = writeSecretSetting(
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

export function getSelectedUCloudProjectId() {
  const row = readStudioSetting(SELECTED_UCLOUD_PROJECT_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      projectId?: string
    }

    return parsed.projectId?.trim() || null
  } catch {
    return row.value.trim() || null
  }
}

export function saveSelectedUCloudProjectId(projectId: string) {
  const normalizedProjectId = projectId.trim()

  if (!normalizedProjectId) {
    deleteStudioSetting(SELECTED_UCLOUD_PROJECT_SETTING)
    return null
  }

  const updatedAt = writeStudioSetting(
    SELECTED_UCLOUD_PROJECT_SETTING,
    JSON.stringify({
      projectId: normalizedProjectId,
    })
  )

  return {
    projectId: normalizedProjectId,
    updatedAt,
  }
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
    storagePath: row.storage_path,
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
        SELECT id, generation_id, output_index, url, NULL AS data_url,
               storage_path, mime_type, width, height, metadata, saved_at,
               created_at
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
  const id = input.id ?? randomUUID()
  const createdAt = nowIso()
  const savedAt = input.autoSave ? createdAt : null

  getDb()
    .prepare(
      `
        INSERT INTO studio_image_outputs
          (id, generation_id, output_index, url, data_url, storage_path,
           mime_type, width, height, metadata, saved_at, created_at)
        VALUES
          (@id, @generationId, @index, @url, @dataUrl, @storagePath,
           @mimeType, @width, @height, @metadata, @savedAt, @createdAt)
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
    savedAt,
    createdAt,
  }
}

export function getStudioImageOutput(outputId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT id, generation_id, output_index, url, data_url, storage_path,
               mime_type, width, height, metadata, saved_at, created_at
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
               outputs.height, outputs.storage_path, outputs.saved_at,
               outputs.created_at
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
    storagePath: row.storage_path,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  }))
}

export function saveStudioImageOutputStorage(
  outputId: string,
  storagePath: string,
  mimeType?: string | null
) {
  const savedAt = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_image_outputs
        SET storage_path = ?,
            data_url = NULL,
            mime_type = COALESCE(?, mime_type),
            saved_at = ?
        WHERE id = ?
      `
    )
    .run(storagePath, mimeType ?? null, savedAt, outputId)

  return getStudioImageOutput(outputId)
}
