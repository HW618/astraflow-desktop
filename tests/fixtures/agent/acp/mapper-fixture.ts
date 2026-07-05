import type { SessionUpdate } from "@agentclientprotocol/sdk"

import type { AgentEvent } from "@/lib/agent/events"
import {
  deriveAcpRuntimeInfoFromInitialize,
  mapAcpSessionUpdatesForReplay,
} from "@/lib/agent/acp/acp-runtime"
import type { AgentRuntimeInfo } from "@/lib/agent/runtime"

function payload(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export const codexAcpUpdates = [
  {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text: "Launching Codex subagent.",
    },
  },
  {
    sessionUpdate: "agent_thought_chunk",
    content: {
      type: "text",
      text: "Need Codex ACP coverage.",
    },
  },
  {
    sessionUpdate: "tool_call",
    toolCallId: "tool_codex_spawn",
    title: "spawnAgent",
    kind: "other",
    status: "pending",
    locations: [{ path: "README.md", line: 1 }],
    rawInput: {
      prompt: "Reply exactly: subagent-ok: 2+2=4",
      senderThreadId: "thread_parent",
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_codex_spawn",
    status: "completed",
    rawOutput: {
      threadId: "thread_child",
      output: "subagent-ok: 2+2=4",
    },
  },
  {
    sessionUpdate: "plan",
    entries: [
      {
        content: "Dispatch Codex subagent",
        priority: "high",
        status: "completed",
      },
      {
        content: "Verify returned summary",
        priority: "medium",
        status: "in_progress",
      },
    ],
  },
] satisfies SessionUpdate[]

export const claudeAcpUpdates = [
  {
    sessionUpdate: "tool_call",
    toolCallId: "tool_claude_agent",
    title: "Agent",
    kind: "think",
    status: "in_progress",
    rawInput: {
      description: "Minimal smoke subagent",
      prompt: "Reply exactly: subagent-ok: 2+2=4",
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_claude_agent",
    status: "completed",
    rawOutput: {
      result: "subagent-ok: 2+2=4",
    },
  },
  {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text: "Claude subagent finished.",
    },
  },
  {
    sessionUpdate: "plan_update",
    plan: {
      type: "items",
      id: "claude-plan",
      entries: [
        {
          content: "Run Claude Agent tool",
          priority: "high",
          status: "completed",
        },
      ],
    },
  },
] satisfies SessionUpdate[]

export const openCodeAcpUpdates = [
  {
    sessionUpdate: "agent_thought_chunk",
    content: {
      type: "text",
      text: "OpenCode task can arrive as an update.",
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_opencode_task",
    title: "task",
    kind: "think",
    status: "completed",
    locations: [{ path: "package.json" }],
    rawInput: {
      description: "Minimal smoke subagent",
      prompt: "Reply exactly: subagent-ok: 2+2=4",
    },
    rawOutput: {
      task_result: "subagent-ok: 2+2=4",
    },
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "Task completed.",
        },
      },
    ],
  },
  {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text: "OpenCode task completed.",
    },
  },
] satisfies SessionUpdate[]

export const expectedAcpAgentEvents = [
  { type: "text_delta", delta: "Launching Codex subagent." },
  { type: "reasoning_delta", delta: "Need Codex ACP coverage." },
  {
    type: "tool_call",
    id: "tool_codex_spawn",
    name: "spawnAgent",
    input: payload({
      kind: "other",
      title: "spawnAgent",
      status: "pending",
      locations: [{ path: "README.md", line: 1 }],
      rawInput: {
        prompt: "Reply exactly: subagent-ok: 2+2=4",
        senderThreadId: "thread_parent",
      },
    }),
  },
  {
    type: "tool_result",
    id: "tool_codex_spawn",
    name: "spawnAgent",
    status: "complete",
    output: payload({
      threadId: "thread_child",
      output: "subagent-ok: 2+2=4",
    }),
  },
  {
    type: "plan_update",
    todos: [
      {
        text: "Dispatch Codex subagent",
        status: "completed",
        priority: "high",
      },
      {
        text: "Verify returned summary",
        status: "in_progress",
        priority: "medium",
      },
    ],
  },
  {
    type: "tool_call",
    id: "tool_claude_agent",
    name: "think",
    input: payload({
      kind: "think",
      title: "Agent",
      status: "in_progress",
      rawInput: {
        description: "Minimal smoke subagent",
        prompt: "Reply exactly: subagent-ok: 2+2=4",
      },
    }),
  },
  {
    type: "tool_result",
    id: "tool_claude_agent",
    name: "think",
    status: "complete",
    output: payload({
      result: "subagent-ok: 2+2=4",
    }),
  },
  { type: "text_delta", delta: "Claude subagent finished." },
  {
    type: "plan_update",
    todos: [
      {
        text: "Run Claude Agent tool",
        status: "completed",
        priority: "high",
      },
    ],
  },
  {
    type: "reasoning_delta",
    delta: "OpenCode task can arrive as an update.",
  },
  {
    type: "tool_call",
    id: "tool_opencode_task",
    name: "think",
    input: payload({
      kind: "think",
      title: "task",
      status: "completed",
      locations: [{ path: "package.json" }],
      rawInput: {
        description: "Minimal smoke subagent",
        prompt: "Reply exactly: subagent-ok: 2+2=4",
      },
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: "Task completed.",
          },
        },
      ],
    }),
  },
  {
    type: "tool_result",
    id: "tool_opencode_task",
    name: "think",
    status: "complete",
    output: payload({
      task_result: "subagent-ok: 2+2=4",
    }),
  },
  { type: "text_delta", delta: "OpenCode task completed." },
] satisfies AgentEvent[]

export function evaluateAcpMapperFixture() {
  const updates = [
    ...codexAcpUpdates,
    ...claudeAcpUpdates,
    ...openCodeAcpUpdates,
  ]

  return {
    actual: mapAcpSessionUpdatesForReplay(updates),
    expected: expectedAcpAgentEvents,
  }
}

export function evaluateAcpRuntimeInfoFixture() {
  const baseInfo = {
    id: "codex",
    label: "Codex",
    description: "Codex ACP",
    capabilities: {
      hitl: true,
      resume: true,
      subagents: false,
      plan: true,
      sandbox: false,
      mcp: true,
      skills: true,
    },
  } satisfies AgentRuntimeInfo

  return {
    actual: deriveAcpRuntimeInfoFromInitialize(baseInfo, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
        sessionCapabilities: {
          resume: null,
        },
        _meta: {
          subagents: true,
          skills: false,
        },
      },
    }),
    expected: {
      ...baseInfo,
      capabilities: {
        ...baseInfo.capabilities,
        resume: false,
        subagents: true,
        skills: false,
      },
    },
  }
}
