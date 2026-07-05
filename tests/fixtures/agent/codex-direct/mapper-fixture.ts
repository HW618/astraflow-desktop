import type { AgentEvent } from "@/lib/agent/events"
import {
  mapCodexDirectNotificationsToAgentEvents,
  mapCodexDirectTurnToAgentEvents,
  type CodexDirectServerNotification,
  type CodexDirectTurn,
} from "@/lib/agent/adapters/codex-direct-runtime"

function payload(value: unknown) {
  return JSON.stringify(value, null, 2)
}

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
      type: "subAgentActivity",
      id: "subagent_activity_fixture",
      kind: "started",
      agentThreadId: "thread_child",
      agentPath: "general-purpose",
    },
    {
      type: "collabAgentToolCall",
      id: "collab_spawn_fixture",
      tool: "spawnAgent",
      status: "completed",
      senderThreadId: "thread_fixture",
      receiverThreadIds: ["thread_child"],
      prompt: "Reply exactly: subagent-ok: 2+2=4",
      model: "gpt-5",
      reasoningEffort: "medium",
      agentsStates: {
        thread_child: {
          status: "completed",
          message: "subagent-ok: 2+2=4",
        },
      },
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
    {
      type: "enteredReviewMode",
      id: "review_enter_fixture",
      review: "Review current patch.",
    },
    {
      type: "exitedReviewMode",
      id: "review_exit_fixture",
      review: "Review complete.",
    },
    {
      type: "contextCompaction",
      id: "compact_fixture",
    },
  ],
} satisfies CodexDirectTurn

export const codexDirectTurnAgentEvents = mapCodexDirectTurnToAgentEvents(
  codexDirectTurnFixture
) satisfies AgentEvent[]

const collabSpawnPayload = {
  tool: "spawnAgent",
  senderThreadId: "thread_fixture",
  receiverThreadIds: ["thread_child"],
  prompt: "Reply exactly: subagent-ok: 2+2=4",
  model: "gpt-5",
  reasoningEffort: "medium",
  agentsStates: {
    thread_child: {
      status: "completed",
      message: "subagent-ok: 2+2=4",
    },
  },
}

function traced<T extends AgentEvent>(event: T, itemId: string): T {
  return {
    ...event,
    trace: {
      runtimeId: "codex-direct",
      provider: "codex-app-server",
      turnId: "turn_fixture",
      itemId,
    },
  }
}

export const codexDirectExpectedTurnAgentEvents = [
  traced(
    { type: "reasoning_delta", delta: "Need a direct app-server bridge." },
    "reasoning_fixture"
  ),
  traced(
    { type: "text_delta", delta: "The mapper is ready." },
    "msg_fixture"
  ),
  traced(
    {
      type: "subagent_start",
      taskId: "thread_child",
      name: "general-purpose",
    },
    "subagent_activity_fixture"
  ),
  traced(
    {
      type: "tool_call",
      id: "collab_spawn_fixture",
      name: "spawnAgent",
      input: payload(collabSpawnPayload),
    },
    "collab_spawn_fixture"
  ),
  traced(
    {
      type: "tool_result",
      id: "collab_spawn_fixture",
      name: "spawnAgent",
      status: "complete",
      output: payload(collabSpawnPayload),
    },
    "collab_spawn_fixture"
  ),
  traced(
    {
      type: "subagent_start",
      taskId: "thread_child",
      name: "Codex subagent",
      taskInput: "Reply exactly: subagent-ok: 2+2=4",
      parentTaskId: "thread_fixture",
    },
    "collab_spawn_fixture"
  ),
  traced(
    {
      type: "subagent_end",
      taskId: "thread_child",
      name: "Codex subagent",
      status: "complete",
      summary: "subagent-ok: 2+2=4",
    },
    "collab_spawn_fixture"
  ),
  traced(
    {
      type: "file_change",
      path: "lib/agent/adapters/codex-direct-runtime.ts",
      kind: "create",
      status: "complete",
    },
    "patch_fixture"
  ),
  traced(
    {
      type: "tool_call",
      id: "mcp_fixture",
      name: "mcp__filesystem__read_file",
      input: payload({ path: "package.json" }),
    },
    "mcp_fixture"
  ),
  traced(
    {
      type: "tool_result",
      id: "mcp_fixture",
      name: "mcp__filesystem__read_file",
      status: "complete",
      output: payload({
        content: [{ type: "text", text: "{}" }],
        structuredContent: null,
        _meta: null,
      }),
    },
    "mcp_fixture"
  ),
  traced(
    {
      type: "tool_call",
      id: "review_enter_fixture",
      name: "codex_review_mode",
      input: payload({
        action: "enteredReviewMode",
        review: "Review current patch.",
      }),
    },
    "review_enter_fixture"
  ),
  traced(
    {
      type: "tool_result",
      id: "review_enter_fixture",
      name: "codex_review_mode",
      status: "complete",
      output: payload({
        action: "enteredReviewMode",
        review: "Review current patch.",
      }),
    },
    "review_enter_fixture"
  ),
  traced(
    {
      type: "tool_call",
      id: "review_exit_fixture",
      name: "codex_review_mode",
      input: payload({
        action: "exitedReviewMode",
        review: "Review complete.",
      }),
    },
    "review_exit_fixture"
  ),
  traced(
    {
      type: "tool_result",
      id: "review_exit_fixture",
      name: "codex_review_mode",
      status: "complete",
      output: payload({
        action: "exitedReviewMode",
        review: "Review complete.",
      }),
    },
    "review_exit_fixture"
  ),
  traced(
    {
      type: "tool_call",
      id: "compact_fixture",
      name: "context_compaction",
      input: payload({ itemId: "compact_fixture" }),
    },
    "compact_fixture"
  ),
  traced(
    {
      type: "tool_result",
      id: "compact_fixture",
      name: "context_compaction",
      status: "complete",
      output: payload({ itemId: "compact_fixture" }),
    },
    "compact_fixture"
  ),
] satisfies AgentEvent[]

export function evaluateCodexDirectMapperFixture() {
  return {
    actual: codexDirectTurnAgentEvents,
    expected: codexDirectExpectedTurnAgentEvents,
  }
}
