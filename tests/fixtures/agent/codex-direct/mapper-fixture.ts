import type { AgentEvent } from "@/lib/agent/events"
import {
  mapCodexDirectNotificationsToAgentEvents,
  mapCodexDirectTurnToAgentEvents,
  type CodexDirectServerNotification,
  type CodexDirectTurn,
} from "@/lib/agent/adapters/codex-direct-runtime"

export const codexDirectNotificationFixture = [
  {
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread_fixture",
      turnId: "turn_fixture",
      itemId: "msg_fixture",
      delta: "Done.",
    },
  },
  {
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "thread_fixture",
      turnId: "turn_fixture",
      itemId: "reasoning_fixture",
      summaryIndex: 0,
      delta: "Checking the workspace.",
    },
  },
  {
    method: "turn/plan/updated",
    params: {
      threadId: "thread_fixture",
      turnId: "turn_fixture",
      explanation: null,
      plan: [
        { step: "Inspect Codex app-server protocol", status: "completed" },
        { step: "Map thread items to AgentEvent", status: "inProgress" },
      ],
    },
  },
  {
    method: "item/started",
    params: {
      threadId: "thread_fixture",
      turnId: "turn_fixture",
      item: {
        type: "commandExecution",
        id: "cmd_fixture",
        command: "pwd",
        cwd: "/tmp",
        status: "inProgress",
        commandActions: [],
        aggregatedOutput: null,
        exitCode: null,
        durationMs: null,
      },
      startedAtMs: 1,
    },
  },
  {
    method: "item/completed",
    params: {
      threadId: "thread_fixture",
      turnId: "turn_fixture",
      item: {
        type: "commandExecution",
        id: "cmd_fixture",
        command: "pwd",
        cwd: "/tmp",
        status: "completed",
        commandActions: [],
        aggregatedOutput: "/tmp\n",
        exitCode: 0,
        durationMs: 4,
      },
      completedAtMs: 5,
    },
  },
] satisfies CodexDirectServerNotification[]

export const codexDirectNotificationAgentEvents =
  mapCodexDirectNotificationsToAgentEvents(
    codexDirectNotificationFixture
  ) satisfies AgentEvent[]

export const codexDirectTurnFixture = {
  id: "turn_fixture",
  status: "completed",
  error: null,
  startedAt: 1,
  completedAt: 2,
  durationMs: 1000,
  itemsView: "full",
  items: [
    {
      type: "reasoning",
      id: "reasoning_fixture",
      summary: ["Need a direct app-server bridge."],
      content: [],
    },
    {
      type: "agentMessage",
      id: "msg_fixture",
      text: "The mapper is ready.",
      phase: null,
      memoryCitation: null,
    },
    {
      type: "fileChange",
      id: "patch_fixture",
      status: "completed",
      changes: [
        {
          path: "lib/agent/adapters/codex-direct-runtime.ts",
          kind: { type: "add" },
          diff: "export {}",
        },
      ],
    },
    {
      type: "mcpToolCall",
      id: "mcp_fixture",
      server: "filesystem",
      tool: "read_file",
      status: "completed",
      arguments: { path: "package.json" },
      appContext: null,
      pluginId: null,
      result: {
        content: [{ type: "text", text: "{}" }],
        structuredContent: null,
        _meta: null,
      },
      error: null,
      durationMs: 3,
    },
  ],
} satisfies CodexDirectTurn

export const codexDirectTurnAgentEvents = mapCodexDirectTurnToAgentEvents(
  codexDirectTurnFixture
) satisfies AgentEvent[]
