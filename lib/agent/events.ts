export type AgentTodo = {
  text: string
  status: "pending" | "in_progress" | "completed"
}

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
      parentTaskId?: string
    }
  | {
      type: "media_generation"
      kind: "image" | "video"
      generationId: string
      status:
        | "queued"
        | "running"
        | "polling"
        | "complete"
        | "partial"
        | "error"
        | "cancelled"
      modelName: string
      prompt: string
      phase?: string | null
      progress?: number | null
      rawStatus?: string | null
      outputs: Array<{
        id: string
        index: number
        sessionFileId?: string | null
        contentUrl: string
        url: string | null
        storagePath: string | null
        mimeType: string | null
        width: number | null
        height: number | null
        durationSeconds?: number | null
      }>
      errorMessage?: string | null
      providerTaskId?: string | null
      providerRequestId?: string | null
      parentTaskId?: string
    }
  | {
      type: "plan_update"
      todos: AgentTodo[]
    }
  | {
      type: "subagent_start"
      taskId: string
      name: string
      taskInput?: string
      parentTaskId?: string
    }
  | {
      type: "subagent_update"
      taskId: string
      name?: string
      status?: "running" | "complete" | "error"
      taskInput?: string
      content?: string
      contentDelta?: string
      summary?: string
      error?: string
      todos?: AgentTodo[]
      parentTaskId?: string
    }
  | {
      type: "subagent_end"
      taskId: string
      name: string
      summary?: string
      status?: "complete" | "error"
      error?: string
    }
  | {
      type: "file_change"
      path: string
      kind: "create" | "edit" | "delete"
      status?: "complete" | "error"
      error?: string
      parentTaskId?: string
    }
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
