import type { AgentEvent } from "@/lib/agent/events"
import {
  createClaudeSdkMapperState,
  mapClaudeSdkMessagesToAgentEvents,
  type ClaudeSdkMappableMessage,
} from "@/lib/agent/adapters/claude-native-runtime"

export const claudeNativeSdkMessageFixture = [
  {
    type: "system",
    subtype: "init",
    session_id: "claude-session-1",
    claude_code_version: "2.1.198",
    model: "claude-sonnet-4-6",
    permissionMode: "default",
    tools: ["Read", "Task"],
    mcp_servers: [],
    skills: ["repo-map"],
  },
  {
    type: "stream_event",
    uuid: "stream-1",
    session_id: "claude-session-1",
    parent_tool_use_id: null,
    event: {
      type: "message_start",
      message: { id: "msg_1", usage: {}, model: "claude-sonnet-4-6" },
    },
  },
  {
    type: "stream_event",
    uuid: "stream-2",
    session_id: "claude-session-1",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "I will inspect " },
    },
  },
  {
    type: "stream_event",
    uuid: "stream-3",
    session_id: "claude-session-1",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "thinking_delta", thinking: "Need adapter coverage." },
    },
  },
  {
    type: "assistant",
    uuid: "assistant-1",
    session_id: "claude-session-1",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      id: "msg_1",
      model: "claude-sonnet-4-6",
      content: [
        { type: "text", text: "I will inspect files." },
        { type: "thinking", thinking: "Need adapter coverage." },
        {
          type: "tool_use",
          id: "toolu_read",
          name: "Read",
          input: { file_path: "lib/agent/events.ts" },
        },
      ],
      usage: {},
    },
  },
  {
    type: "user",
    uuid: "user-tool-result-1",
    session_id: "claude-session-1",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_read",
          content: "export type AgentEvent = ...",
        },
      ],
    },
  },
  {
    type: "assistant",
    uuid: "assistant-2",
    session_id: "claude-session-1",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      id: "msg_2",
      model: "claude-sonnet-4-6",
      content: [
        {
          type: "tool_use",
          id: "toolu_task",
          name: "Task",
          input: { description: "Map SDK task stream" },
        },
      ],
      usage: {},
    },
  },
  {
    type: "system",
    subtype: "task_started",
    uuid: "task-started-1",
    session_id: "claude-session-1",
    task_id: "task_1",
    tool_use_id: "toolu_task",
    subagent_type: "Explore",
    description: "Map SDK task stream",
    prompt: "Inspect SDK events and map them.",
  },
  {
    type: "assistant",
    uuid: "assistant-subagent-1",
    session_id: "claude-session-1",
    parent_tool_use_id: "toolu_task",
    subagent_type: "Explore",
    message: {
      role: "assistant",
      id: "msg_sub_1",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "Found SDKTaskStartedMessage." }],
      usage: {},
    },
  },
  {
    type: "system",
    subtype: "task_progress",
    uuid: "task-progress-1",
    session_id: "claude-session-1",
    task_id: "task_1",
    tool_use_id: "toolu_task",
    subagent_type: "Explore",
    description: "Map SDK task stream",
    summary: "Mapping task lifecycle events",
    usage: { total_tokens: 42, tool_uses: 1, duration_ms: 1200 },
  },
  {
    type: "system",
    subtype: "task_notification",
    uuid: "task-done-1",
    session_id: "claude-session-1",
    task_id: "task_1",
    tool_use_id: "toolu_task",
    status: "completed",
    output_file: "/tmp/task_1.txt",
    summary: "SDK task stream mapped.",
  },
  {
    type: "result",
    subtype: "success",
    uuid: "result-1",
    session_id: "claude-session-1",
    duration_ms: 2100,
    duration_api_ms: 1500,
    is_error: false,
    num_turns: 1,
    stop_reason: "end_turn",
    total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 20 },
    modelUsage: {
      "claude-sonnet-4-6": {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0.01,
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
    },
    permission_denials: [],
  },
] satisfies ClaudeSdkMappableMessage[]

export const claudeNativeExpectedAgentEvents = [
  {
    type: "run_meta",
    sessionRef: "claude-session-1",
    usage: {
      claude_code_version: "2.1.198",
      model: "claude-sonnet-4-6",
      permissionMode: "default",
      tools: ["Read", "Task"],
      skills: ["repo-map"],
    },
  },
  { type: "text_delta", delta: "I will inspect " },
  { type: "reasoning_delta", delta: "Need adapter coverage." },
  { type: "text_delta", delta: "files." },
  {
    type: "tool_call",
    id: "toolu_read",
    name: "Read",
    input: '{\n  "file_path": "lib/agent/events.ts"\n}',
  },
  {
    type: "tool_result",
    id: "toolu_read",
    name: "Read",
    status: "complete",
    output: "export type AgentEvent = ...",
  },
  {
    type: "tool_call",
    id: "toolu_task",
    name: "Task",
    input: '{\n  "description": "Map SDK task stream"\n}',
  },
  {
    type: "subagent_start",
    taskId: "task_1",
    name: "Explore",
    taskInput: "Inspect SDK events and map them.",
  },
  {
    type: "subagent_update",
    taskId: "task_1",
    name: "Explore",
    status: "running",
    contentDelta: "Found SDKTaskStartedMessage.",
  },
  {
    type: "subagent_update",
    taskId: "task_1",
    name: "Explore",
    status: "running",
    taskInput: "Map SDK task stream",
    summary: "Mapping task lifecycle events",
    contentDelta: "Mapping task lifecycle events",
  },
  {
    type: "subagent_end",
    taskId: "task_1",
    name: "Explore",
    status: "complete",
    summary: "SDK task stream mapped.",
  },
  {
    type: "run_meta",
    sessionRef: "claude-session-1",
    usage: {
      duration_ms: 2100,
      duration_api_ms: 1500,
      num_turns: 1,
      stop_reason: "end_turn",
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 20 },
      modelUsage: {
        "claude-sonnet-4-6": {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0.01,
          contextWindow: 200000,
          maxOutputTokens: 8192,
        },
      },
    },
  },
] satisfies AgentEvent[]

export function evaluateClaudeNativeMapperFixture() {
  const actual = mapClaudeSdkMessagesToAgentEvents(
    claudeNativeSdkMessageFixture,
    createClaudeSdkMapperState()
  )

  return {
    actual,
    expected: claudeNativeExpectedAgentEvents,
    pass:
      JSON.stringify(actual) ===
      JSON.stringify(claudeNativeExpectedAgentEvents),
  }
}
