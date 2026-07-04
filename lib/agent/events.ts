export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | {
      type: "tool_call"
      id: string
      name: string
      input: string
      parentTaskId?: string
    }
  | {
      type: "tool_result"
      id: string
      name: string
      status: "complete" | "error"
      output?: string
      error?: string
    }
  | {
      type: "plan_update"
      todos: {
        text: string
        status: "pending" | "in_progress" | "completed"
      }[]
    }
  | { type: "subagent_start"; taskId: string; name: string }
  | { type: "subagent_end"; taskId: string; name: string; summary?: string }
  | { type: "file_change"; path: string; kind: "create" | "edit" | "delete" }
  | {
      type: "permission_request"
      requestId: string
      toolName: string
      input: string
      decisions?: string[]
      options?: { optionId: string; name: string; kind: string }[]
      selectedOptionId?: string | null
      status?: "pending" | "resolved"
    }
  | { type: "run_meta"; sessionRef?: string; usage?: unknown }
  | { type: "error"; message: string }
