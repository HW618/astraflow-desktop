import { randomUUID } from "node:crypto"

import type { StructuredToolInterface } from "@langchain/core/tools"

import type { AgentEvent } from "@/lib/agent/events"
import {
  hasPermissionRule,
  isReadOnlyToolKind,
  requestPermission,
  type PermissionOption,
} from "@/lib/agent/permission-broker"
import type { StudioPermissionMode } from "@/lib/studio-types"

const PERMISSION_DENIED_READONLY = "Permission denied by readonly mode"
const PERMISSION_DENIED_REJECTED = "Permission denied by user"
const PERMISSION_DENIED_CANCELLED = "Permission request cancelled"
const PERMISSION_INPUT_PREVIEW_MAX_CHARS = 12_000

const DEFAULT_PERMISSION_OPTIONS: PermissionOption[] = [
  {
    optionId: "allow_once",
    name: "Allow once",
    kind: "allow_once",
  },
  {
    optionId: "allow_always",
    name: "Allow always",
    kind: "allow_always",
  },
  {
    optionId: "reject_once",
    name: "Reject",
    kind: "reject_once",
  },
]

type PermissionToolKind = "read" | "search" | "fetch" | "edit" | "execute"

export type PermissionGatewayContext = {
  sessionId: string
  permissionMode: StudioPermissionMode
  projectId: string | null
  emit: (event: AgentEvent) => void
  signal: AbortSignal
}

type PermissionCheckResult =
  | { allowed: true }
  | { allowed: false; message: string }

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function stringifyPermissionInput(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function truncatePermissionInput(input: string) {
  if (input.length <= PERMISSION_INPUT_PREVIEW_MAX_CHARS) {
    return input
  }

  return `${input.slice(
    0,
    PERMISSION_INPUT_PREVIEW_MAX_CHARS
  )}\n...[truncated ${input.length - PERMISSION_INPUT_PREVIEW_MAX_CHARS} chars]`
}

function getPermissionInputPreview(input: unknown) {
  const record = getRecord(input)
  const previewInput =
    record?.type === "tool_call" && "args" in record ? record.args : input

  return truncatePermissionInput(stringifyPermissionInput(previewInput))
}

export function getPermissionToolKind(toolName: string): PermissionToolKind {
  const normalized = toolName.trim().toLowerCase()

  if (
    [
      "execute",
      "shell",
      "bash",
      "run_command",
      "run_code",
      "sandbox_start_service",
      "terminal",
    ].includes(normalized)
  ) {
    return "execute"
  }

  if (
    [
      "write",
      "write_file",
      "edit",
      "edit_file",
      "str_replace",
      "upload_file",
      "download_file",
    ].includes(normalized)
  ) {
    return "edit"
  }

  if (["web_fetch", "fetch", "http", "https"].includes(normalized)) {
    return "fetch"
  }

  if (
    [
      "web_search",
      "search",
      "grep",
      "glob",
      "rg",
      "find",
      "list_installed_skills",
      "list_installed_mcp_servers",
      "studio_list_image_models",
      "studio_list_video_models",
      "studio_list_media_generation_models",
      "studio_list_media_generations",
      "studio_get_media_generation",
      "request_user_input",
    ].includes(normalized)
  ) {
    return "search"
  }

  if (
    [
      "read",
      "read_file",
      "read_raw",
      "ls",
      "list",
      "list_files",
      "sandbox_get_host",
    ].includes(normalized)
  ) {
    return "read"
  }

  return "execute"
}

function isReadOnlyToolName(toolName: string) {
  return isReadOnlyToolKind(getPermissionToolKind(toolName))
}

export async function requestToolPermission({
  context,
  input,
  toolName,
}: {
  context: PermissionGatewayContext
  input: unknown
  toolName: string
}): Promise<PermissionCheckResult> {
  if (isReadOnlyToolName(toolName)) {
    return { allowed: true }
  }

  if (context.permissionMode === "readonly") {
    return { allowed: false, message: PERMISSION_DENIED_READONLY }
  }

  if (
    hasPermissionRule({
      projectId: context.projectId,
      sessionId: context.sessionId,
      toolName,
    })
  ) {
    return { allowed: true }
  }

  if (context.signal.aborted) {
    return { allowed: false, message: PERMISSION_DENIED_CANCELLED }
  }

  const requestId = randomUUID()
  const options = DEFAULT_PERMISSION_OPTIONS.map((option) => ({ ...option }))
  const inputPreview = getPermissionInputPreview(input)

  context.emit({
    type: "permission_request",
    requestId,
    toolName,
    input: inputPreview,
    options,
    status: "pending",
    selectedOptionId: null,
    decisions: [],
  })

  const decision = await requestPermission({
    sessionId: context.sessionId,
    requestId,
    toolName,
    inputPreview,
    options,
    signal: context.signal,
  })

  if ("cancelled" in decision) {
    context.emit({
      type: "permission_request",
      requestId,
      toolName,
      input: inputPreview,
      options,
      status: "resolved",
      selectedOptionId: null,
      decisions: ["cancelled"],
    })

    return { allowed: false, message: PERMISSION_DENIED_CANCELLED }
  }

  const selectedOption =
    options.find((option) => option.optionId === decision.optionId) ?? null
  const decisionLabel =
    decision.feedback || selectedOption?.name || decision.optionId

  context.emit({
    type: "permission_request",
    requestId,
    toolName,
    input: inputPreview,
    options,
    status: "resolved",
    selectedOptionId: decision.optionId,
    decisions: [decisionLabel],
  })

  if (selectedOption?.kind.startsWith("allow")) {
    return { allowed: true }
  }

  return {
    allowed: false,
    message: decision.feedback || PERMISSION_DENIED_REJECTED,
  }
}

export function wrapToolsWithPermissionGateway(
  tools: StructuredToolInterface[],
  context: PermissionGatewayContext
) {
  return tools.map((agentTool) => {
    const invoke = agentTool.invoke.bind(agentTool) as (
      input: unknown,
      config?: unknown
    ) => Promise<unknown>
    const call = agentTool.call.bind(agentTool) as (
      input: unknown,
      config?: unknown,
      tags?: string[]
    ) => Promise<unknown>

    return new Proxy(agentTool, {
      get(target, property, receiver) {
        if (property === "invoke") {
          return async (input: unknown, config?: unknown) => {
            const permission = await requestToolPermission({
              context,
              input,
              toolName: target.name,
            })

            if (!permission.allowed) {
              return permission.message
            }

            return invoke(input, config)
          }
        }

        if (property === "call") {
          return async (
            input: unknown,
            config?: unknown,
            tags?: string[]
          ) => {
            const permission = await requestToolPermission({
              context,
              input,
              toolName: target.name,
            })

            if (!permission.allowed) {
              return permission.message
            }

            return call(input, config, tags)
          }
        }

        return Reflect.get(target, property, receiver)
      },
    })
  })
}
