// Shared types for the chat composer's @-mention and slash-command features.
// UI code and runtime adapters both depend on these; adapters encode/downgrade
// them according to each protocol's capabilities.

export type PromptMention =
  | {
      kind: "file"
      // Absolute path on the machine running the agent.
      path: string
      name: string
      mimeType?: string
    }
  | {
      kind: "folder"
      path: string
      name: string
    }
  | {
      kind: "session"
      sessionId: string
      title: string
    }

export type SlashCommandDescriptor = {
  // Command name without the leading "/".
  name: string
  description: string
  // Grey placeholder shown after the command name while typing arguments
  // (ACP AvailableCommandInput.hint / claude-agent-sdk argumentHint).
  inputHint?: string
  // "builtin" commands are executed by the client itself; "runtime" commands
  // are sent to the agent as a "/name args" prompt.
  source: "runtime" | "builtin"
  runtimeId?: string
}

export type ComposerCapabilities = {
  // dynamic = the agent announces commands at runtime (ACP
  // available_commands_update, claude supportedCommands); static = a fixed
  // client-side table; none = only builtin commands are offered.
  slashCommands: "dynamic" | "static" | "none"
  // structured = protocol-level blocks (ACP resource_link, codex UserInput
  // mention); text = mentions are inlined as "@path" text.
  fileMentions: "structured" | "text" | "none"
  // Session mentions are always client-expanded into context, so this only
  // gates whether the UI offers them for this runtime.
  sessionMentions: boolean
}

export function parseSlashCommandText(
  text: string
): { name: string; args: string } | null {
  const match = /^\/([A-Za-z0-9][\w:-]*)(?:\s+([\s\S]*))?$/.exec(text.trim())

  if (!match) {
    return null
  }

  return { name: match[1], args: match[2]?.trim() ?? "" }
}
