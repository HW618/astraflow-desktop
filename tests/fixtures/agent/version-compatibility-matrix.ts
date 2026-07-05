export const agentRuntimeVersionCompatibilityMatrix = [
  {
    packageName: "@agentclientprotocol/sdk",
    version: "1.1.0",
    coverage: "ACP session/update mapper fixture",
  },
  {
    packageName: "@agentclientprotocol/codex-acp",
    version: "1.1.0",
    coverage: "Codex ACP fallback runtime",
  },
  {
    packageName: "@agentclientprotocol/claude-agent-acp",
    version: "0.55.0",
    coverage: "Claude Code ACP fallback runtime",
  },
  {
    packageName: "@openai/codex",
    version: "0.142.5",
    coverage: "Generated Codex app-server TypeScript schema and direct runtime",
  },
  {
    packageName: "@anthropic-ai/claude-agent-sdk",
    version: "0.3.198",
    coverage: "Claude native task/subagent mapper fixture",
  },
  {
    packageName: "opencode-ai",
    version: "1.17.13",
    coverage: "OpenCode native event replay fixture",
  },
  {
    packageName: "deepagents",
    version: "1.10.5",
    coverage: "AstraFlow built-in DeepAgents runtime",
  },
] as const
