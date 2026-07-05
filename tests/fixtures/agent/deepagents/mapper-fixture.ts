import type { AgentEvent } from "@/lib/agent/events"
import { mapDeepAgentsSubagentValueForReplay } from "@/lib/agent/adapters/astraflow-runtime"

export const deepAgentsSubagentValueFixture = {
  status: "running",
  todos: [
    {
      content: "Inspect media agent support",
      status: "completed",
      priority: "high",
    },
    {
      content: "Verify nested subagent display",
      status: "in_progress",
      priority: "medium",
    },
  ],
  messages: [
    {
      content: [
        {
          type: "text",
          text: "Nested subagent reported progress.",
        },
      ],
    },
  ],
}

export const expectedDeepAgentsSubagentValueEvents = [
  {
    type: "subagent_update",
    taskId: "task_child",
    parentTaskId: "task_parent",
    status: "running",
    summary: "Nested subagent reported progress.",
    todos: [
      {
        text: "Inspect media agent support",
        status: "completed",
        priority: "high",
      },
      {
        text: "Verify nested subagent display",
        status: "in_progress",
        priority: "medium",
      },
    ],
  },
] satisfies AgentEvent[]

export function evaluateDeepAgentsMapperFixture() {
  const event = mapDeepAgentsSubagentValueForReplay(
    deepAgentsSubagentValueFixture,
    "task_child",
    "task_parent"
  )

  return {
    actual: event ? [event] : [],
    expected: expectedDeepAgentsSubagentValueEvents,
  }
}
