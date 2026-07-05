# AstraFlow Desktop ACP 兼容与内置 Agent 能力增强调研方案

> 日期：2026-07-05  
> 范围：Codex / Claude Code / OpenCode / DeepAgents 的会话、计划、子代理、权限、工具事件兼容；Codex Desktop 式渲染方案；现有图像/视频生成能力接入内置 agent。  
> 方法：主线程联网核验官方文档、GitHub、npm；并派发 4 个只读 subagent 分别调研 Codex、Claude/OpenCode、DeepAgents、图像/视频生成接入。

## 1. 结论

AstraFlow Desktop 的方向不应该是把所有 agent 压成同一种纯文本聊天流，而应该建立一个**可回放的 agent trace 层**：外部 ACP 客户端、Codex app-server、Claude SDK、OpenCode native server、DeepAgents 都先归一成 `session -> turn -> item/task` 的结构化事件，再由 UI 渲染 plan、subagent、tool、permission、diff、media job。

当前仓库已经有很好的基础：

- `AgentRuntime` / `AgentEvent` 已存在：`lib/agent/runtime.ts`、`lib/agent/events.ts`。
- 内置 runtime 已迁到 `deepagents@1.10.5`：`lib/agent/adapters/astraflow-runtime.ts`。
- ACP runtime 已能接入 Codex、Claude Code、OpenCode：`lib/agent/acp/acp-runtime.ts`、`lib/agent/adapters/acp-runtimes.ts`。
- UI 已能渲染 text、reasoning、tool、plan、permission：`components/studio-message-parts-renderer.tsx`。
- 图像/视频生成 API、OpenAPI 字段生成、媒体存储已存在。

最大缺口是：

- `subagent_start` / `subagent_end` / `file_change` / `run_meta` 目前在 `run-orchestrator` 中被忽略，用户看不到每个 session 内子代理的实时工作。
- ACP adapter 只保留最低公共字段，丢了 tool `kind/title/locations/content/rawInput/rawOutput` 等富信息。
- `StudioMessagePart` 还没有 `subagent`、`file_change`、`media_generation` 等结构。
- 图像/视频能力还只服务于独立 Workbench，没有抽成 agent tool 可复用的 service/job 层。

## 2. 版本核验

2026-07-05 通过 `npm view` 核验：

| 包 | 最新/当前版本 | 仓库状态 |
|---|---:|---|
| `@agentclientprotocol/sdk` | `1.1.0` | 当前已安装 |
| `@agentclientprotocol/codex-acp` | `1.1.0` | 当前已安装 |
| `@agentclientprotocol/claude-agent-acp` | `0.55.0` | 当前已安装 |
| `opencode-ai` | `1.17.13` | 当前已安装 |
| `deepagents` | `1.10.5` | 当前已安装 |
| `@openai/codex-sdk` | `0.142.5` | 可选直连依赖 |
| `@anthropic-ai/claude-agent-sdk` | `0.3.201` | 可选直连依赖 |

本仓库依赖见 `package.json`。

## 3. 这些客户端有什么

### 3.1 ACP 公共层

ACP v1 是通用最低公共接口，适合做默认兼容层：

- 连接：JSON-RPC 2.0，常见本地 subprocess stdio。
- 会话：`session/new`、`session/load`、`session/resume`、`session/prompt`、`session/cancel`。
- 输出：`session/update` 发送 agent/user/thought message chunks、tool calls、tool updates、plans。
- 权限：agent 可调用 `session/request_permission`，client 返回 `allow_once`、`allow_always`、`reject_once`、`reject_always` 等 option。
- 工具：tool `kind` 支持 read/edit/delete/move/search/execute/think/fetch/other；tool content 支持 text、image/resource、diff、terminal；locations 可做 follow-along。
- 计划：`plan` / `plan_update` 是完整替换语义，entries 状态为 `pending | in_progress | completed`。

来源：ACP overview、tool calls、agent plan、session setup：  
https://agentclientprotocol.com/protocol/v1/overview  
https://agentclientprotocol.com/protocol/v1/tool-calls  
https://agentclientprotocol.com/protocol/v1/agent-plan  
https://agentclientprotocol.com/protocol/v1/session-setup

### 3.2 Codex

Codex 的最完整集成面不是简单 SDK，而是 `codex app-server`：

- 官方 app-server 模型是 `Thread -> Turn -> Item`。Thread 是会话，Turn 是一次用户交互，Item 是消息、reasoning、命令、文件改动、MCP 调用、review、context compaction、协作/子线程等。
- app-server 用 JSON-RPC，支持 stdio、Unix socket，websocket 仍标注 experimental/unsupported。
- schema 与 CLI 版本强绑定，官方要求用 `codex app-server generate-ts` 或 `generate-json-schema` 从当前 CLI 生成类型。
- Codex Desktop 的产品模式包括多 project/thread、worktree 并行、automations、Git diff/review pane、skills、in-app browser、approval review。
- Subagent 在 Codex app-server 里更接近“子线程/协作 item”，而不是 ACP 的一等 `subagent` 事件。UI 应按 parent/child thread 展示。

来源：  
https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md  
https://developers.openai.com/codex/app/features  
https://developers.openai.com/codex/app/worktrees  
https://developers.openai.com/codex/sdk

### 3.3 Claude Code

Claude Code 有两条接入：

- ACP：`@agentclientprotocol/claude-agent-acp@0.55.0`，适合作默认兼容。
- SDK：`@anthropic-ai/claude-agent-sdk@0.3.201`，适合后续 premium adapter。

Claude Agent SDK 能力：

- `query()` 返回异步消息流，支持 partial stream event。
- `resume`、`resumeSessionAt`、`sessionStore` 支持持久化恢复。
- `PermissionMode` 包括 `default`、`acceptEdits`、`bypassPermissions`、`plan`、`dontAsk`、`auto`。
- `canUseTool` 提供细粒度审批，参数里有 `toolUseID` 和 `agentID`，可以定位 subagent 内的权限请求。
- SDK message union 已包含 `SDKTaskStartedMessage`、`SDKTaskProgressMessage`、`SDKTaskUpdatedMessage` 等 task/subagent 事件。
- hooks、MCP、skills、plugins、setting sources 可做运行时专门适配。

来源：  
https://code.claude.com/docs/en/agent-sdk/overview  
https://code.claude.com/docs/en/agent-sdk/typescript  
https://github.com/agentclientprotocol/claude-agent-acp

### 3.4 OpenCode

OpenCode 当前适合先通过 ACP 兼容：

- 官方支持 `opencode acp`，通过 stdio JSON-RPC 与编辑器通信。
- 有 primary agents 与 subagents：Build、Plan、General、Explore、Scout。
- Plan agent 默认限制写入和 bash；subagent 可自动或通过 `@mention` 调用。
- 权限可按 read/edit/bash/task/websearch/skill 等维度配置。

后续可加 native server/SDK adapter：

- `opencode serve` 有 HTTP/OpenAPI。
- native 事件比 ACP 更丰富，包括 `message.part.delta/updated`、`permission.asked/replied`、`todo.updated`、`question.asked/replied`、`session.status`、`session.diff/error`。
- OpenCode 子代理会产生 child session，UI 可以按 parent/child session 展示。

来源：  
https://opencode.ai/docs/acp/  
https://opencode.ai/docs/agents/  
https://opencode.ai/docs/server/

### 3.5 DeepAgents

DeepAgents 是 AstraFlow 内置 agent 的正确底座：

- 内置 `write_todos` 规划、`task` 子代理、文件系统工具、上下文压缩、skills、memory、sandbox/backend。
- JS `createDeepAgent` 支持 custom tools、middleware、backend、subagents、checkpointer、interruptOn。
- `streamEvents(..., { version: "v3" })` 暴露 `run.messages`、`run.toolCalls`、`run.subagents`。
- 每个 subagent handle 可继续读取 `name`、`taskInput`、`messages`、`toolCalls`、`values`、`subagents`、`output`。
- 原生 HITL 要配 checkpointer，并用 `thread_id=sessionId` 恢复。

来源：  
https://docs.langchain.com/oss/javascript/deepagents/overview  
https://docs.langchain.com/oss/javascript/deepagents/subagents  
https://docs.langchain.com/oss/javascript/deepagents/streaming  
https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop  
https://github.com/langchain-ai/deepagents

## 4. 我们需要做什么

### 4.1 建立 Agent Trace 核心模型

新增或扩展统一事件，不再只把 agent 输出看成 assistant message parts：

```ts
type AgentTraceRef = {
  runtimeId: "astraflow" | "codex" | "claude-code" | "opencode"
  provider: "deepagents" | "acp" | "codex-app-server" | "claude-sdk" | "opencode-native"
  providerSessionId?: string
  threadId?: string
  turnId?: string
  itemId?: string
  parentTaskId?: string
  parentThreadId?: string
}
```

`AgentEvent` 应补充：

- `subagent_update`：`taskId/name/status/taskInput/summary/parentTaskId/providerThreadId`。
- `tool_call_delta`：保留 ACP/app-server 的 title、kind、locations、content、rawInput、rawOutput。
- `file_change`：path、kind、diff、status、source item/tool。
- `media_generation`：generationId、modality、status、progress、outputIds。
- `run_meta` 落库：provider session/thread/turn ref、usage、model、version。
- `provider_event` append-only：只进 debug/replay log，不直接暴露给 UI。

### 4.2 让用户看到每个 session 的 subagent 在做什么

UI 应采用 Codex Desktop 式分层：

- 左侧 session/thread 列表保留主会话，并允许显示子线程/子任务计数。
- 主消息流按 turn 展示。
- assistant 消息内部按 item/task 展示：plan、reasoning、tool、subagent、permission、file change、media job。
- subagent 渲染为可折叠 card：
  - header：名称、状态、运行时、耗时、工具数、子任务数。
  - body：任务输入、流式摘要、内部 tool timeline、子 todo、最终 summary。
  - 若 provider 有 child session/thread id，提供“打开子会话”入口。
- tool 调用继续可内联，但带 `parentTaskId` 时优先归属到 subagent card，而不是只平铺在主消息里。

当前 `run-orchestrator.ts` 已收到 subagent 事件但忽略，这是第一优先级修补点。

### 4.3 ACP 默认兼容层增强

保持现有 `AcpRuntime` 作为默认兼容层，但 mapper 不能只输出最低字段：

- 保留 `sessionUpdate` 原始字段中的 `kind/title/locations/content/rawInput/rawOutput/_meta`。
- plan entry 保留 priority。
- permission option 保留 kind、display name、provider metadata。
- 动态 runtime capabilities：基于 initialize response 和 runtime id 决定 `resume/subagents/terminal/configOptions`，不要把 Codex/Claude/OpenCode 都固定成同一组能力。
- 为 Codex ACP、Claude ACP、OpenCode ACP 录制 fixture，做 golden mapper tests。

### 4.4 Codex 专门适配

分两阶段：

1. 短期继续使用 `@agentclientprotocol/codex-acp`，但不要丢 ACP 富字段。
2. 中期新增 `CodexAppServerRuntime`：
   - spawn `codex app-server --stdio`。
   - 用 `codex app-server generate-ts` 生成协议类型，按当前 CLI 版本 pin。
   - 映射 `thread/started`、`turn/started`、`item/started`、`item/*/delta`、`item/completed`、`turn/completed`。
   - 把 commandExecution、fileChange、mcpToolCall、webSearch、review、contextCompaction、collab/subagent item 分别渲染。
   - 审批按 `threadId + turnId + itemId` 归属到当前 turn。

这条路径能真正复刻 Codex Desktop 的“每个 thread / item / 子代理活动可见”体验。

### 4.5 Claude 专门适配

短期用 ACP，后续加 `ClaudeAgentSdkRuntime`：

- 用 `query()` 流式消费 SDKMessage。
- `SDKTaskStarted/Progress/Updated` 映射 `subagent_update`。
- `canUseTool` 对接现有 PermissionBroker，并利用 `agentID` 标注子代理来源。
- `resume` / `sessionStore` 保存到 `runtime_session_ref`。
- `hooks` 只作为观测/审计，不要在 UI 文案中暗示安全隔离。
- ExitPlanMode 用专门权限文案：“退出计划并进入执行模式”。

### 4.6 OpenCode 专门适配

短期增强 ACP；中期可选 native：

- ACP-only：把 `task` tool、`think` tool、`_meta` 推断成 subagent card。
- Native：通过 `opencode serve` / SDK 读取 `todo.updated`、`message.part.*`、`session.status`、`session.diff`、child session parentID。
- OpenCode 的 Build/Plan/General/Explore/Scout 应映射为 runtime-specific agent presets，不要只显示一个 OpenCode runtime。

### 4.7 DeepAgents 内置 runtime

当前最应先做：

- 在 `astraflow-runtime.ts` 中同时消费 `subagent.messages`、`subagent.toolCalls`、`subagent.values`、`subagent.subagents`、`subagent.output`。
- `AgentEvent` 增加 `subagent_update`，而不是只发 start/end。
- `StudioMessagePart` 增加 `subagent`。
- `SnapshotAccumulator` 维护 `subagent` part，并把 `parentTaskId` 的 tool 放入对应 subagent。
- 原生 HITL 若要启用，必须先加 durable checkpointer；否则 capability 文案应说明是 AstraFlow 自研 permission gateway，不是 DeepAgents interrupt/resume。

## 5. 图像/视频生成如何接入内置 agent

### 5.1 当前已有能力

- 图像生成：`app/api/studio/sessions/[sessionId]/image-generations/route.ts`
  - `POST` 输入 `modelId/modelName/operationId/prompt/params/attachments`。
  - 支持 OpenAI Images、OpenAI Images Edit、Gemini generateContent、async task。
  - 当前多为同步生成后返回 `201`。
- 视频生成：`app/api/studio/sessions/[sessionId]/video-generations/route.ts`
  - `POST` 输入 `modelId/modelName/operationId/params/media/attachments`。
  - 创建 generation 后通过 `after()` 后台执行，返回 `202`。
  - `GET` 会触发未完成任务 resume/poll。
- 模型发现：
  - `app/api/studio/image/models/route.ts`
  - `app/api/studio/video/models/route.ts`
  - 都走 UCloud OAuth + `ListUFSquareModel`，再匹配本地 OpenAPI/generated fields。
- 字段和 provider adapter：
  - `lib/image-openapi.ts`
  - `lib/video-openapi.ts`
  - `lib/generated/image-openapi-fields.ts`
  - `lib/generated/video-openapi-fields.ts`
- 媒体存储：
  - `lib/studio-media-storage.ts`
  - 内容读取 route：`image-outputs/[outputId]/content`、`video-outputs/[outputId]/content`

### 5.2 不要让 agent 直接调内部 HTTP route

应抽出共享 service：

```ts
type MediaGenerationService = {
  listModels(modality: "image" | "video"): Promise<ModelOption[]>
  submit(input: MediaGenerationSubmit): Promise<MediaGenerationJob>
  get(jobId: string): Promise<MediaGenerationJob>
  pollDueJobs(): Promise<void>
}
```

Workbench route 和 agent tool 共用同一个 service，避免 payload builder、OpenAPI 字段、输出抽取、DB 更新重复实现。

### 5.3 暴露给 agent 的 tools

建议第一批 tools：

- `studio_list_image_models`
- `studio_list_video_models`
- `studio_generate_image`
- `studio_generate_video`
- `studio_get_media_generation`
- `studio_list_media_generations`

输入引用统一为：

```ts
type MediaReference =
  | { type: "session_file"; id: string }
  | { type: "image_output"; id: string }
  | { type: "video_output"; id: string }
  | { type: "url"; url: string }
```

不要让模型直接塞大 base64。需要上传时由 service 读取 storage 并按 generated field 的 `mediaKind/mediaShape/payloadPath` 构造 provider payload。

### 5.4 队列和进度

视频现在依赖 `after()` + 进程内 Set，桌面单进程可用，但重启后不稳。建议统一 image/video job：

- `queued | running | polling | complete | partial | error | cancelled`
- `providerTaskId`、`providerRequestId`
- `phase`、`progress`、`rawStatus`
- `attempt`、`lastPolledAt`、`nextPollAt`
- `leaseOwner`、`leaseExpiresAt`

图像也建议改成异步 job，避免长 tool call 阻塞 agent loop。

### 5.5 权限和费用

生成图像/视频默认是“执行型且可能计费”：

- list/status：read，无需审批。
- generate：execute 或新增 `generate_media` 权限类型。
- 审批卡必须展示模型、操作类型、提示词摘要、分辨率/时长/数量、引用媒体数量、API key/project、费用/额度提示。
- 高清、多张图、长视频、视频编辑默认更高风险，保留 “allow once” 和 “reject”。

### 5.6 结果回填

完成后：

- 继续保存到 `studio_image_outputs` / `studio_video_outputs`。
- 返回结构化 `media_generation` part，显示进度和最终缩略图/播放器。
- 同步登记到 session files，便于下一轮 agent 用作引用输入。
- chat 最终文本只放简短说明和内容链接，媒体本体由 part 渲染。

来源：  
https://www.ucloud-global.com/en/docs/modelverse/api_doc/image-generation  
https://www.ucloud-global.com/en/docs/modelverse/modelverse/video_api/OpenAI-Sora2-T2V  
https://www.ucloud-global.com/en/docs/modelverse/modelverse/quick-start  
https://developers.openai.com/api/docs/guides/video-generation  
https://developers.openai.com/api/docs/guides/background

## 6. 可维护实施路线

### P0：类型和持久化地基

- 增加 `StudioMessagePart`：`subagent`、`file_change`、`media_generation`。
- 增加 provider ref 字段或 side table：runtime id、provider session/thread/turn/item id、schema/package version。
- 增加 append-only provider event log，用于 replay/debug/migration。

### P1：DeepAgents subagent 可视化

- 扩展 `AgentEvent` 和 `SnapshotAccumulator`。
- 消费 DeepAgents subagent messages/toolCalls/values/output。
- UI 做可折叠 subagent card。
- 验证一个 session 内多个 subagent 并发时，用户能看到每个 subagent 的当前状态和工具调用。

### P2：ACP 富事件兼容

- `AcpRuntime.mapAcpSessionUpdate` 保留 tool kind/title/location/content/raw input/output。
- plan 保留 priority。
- permission 保留 option metadata。
- 增加 Claude/OpenCode/Codex ACP fixture tests。

### P3：媒体生成 tool 化

- 从 image/video route 抽 service。
- 建持久化 job/lease。
- 加 `studio_generate_image` / `studio_generate_video` / status tools。
- UI 加 `media_generation` part。

### P4：Codex app-server direct adapter

- 生成 app-server TS schema。
- 映射 Thread/Turn/Item 生命周期。
- 实现 command/file/MCP/web/review/collab item renderer。
- 支持 child thread/subagent trace。

### P5：Claude SDK / OpenCode native adapter

- Claude SDK：task events、canUseTool、sessionStore、hooks。
- OpenCode native：todo/session/diff/child session events。
- 保持 ACP 作为 fallback。

### P6：测试和升级制度

- `bun run lint`
- `bun run typecheck`
- adapter fixture replay
- generated OpenAPI fixture tests
- version compatibility matrix
- 每次升级 `@agentclientprotocol/*`、`deepagents`、`opencode-ai`、Codex CLI 时跑 replay tests。

## 7. 风险

- ACP 和 Codex app-server 都在快速演进；必须 pin 版本，按协议生成类型。
- Codex app-server websocket 仍是实验性，桌面内优先 stdio/Unix socket。
- Claude hooks 和 OpenCode native server 都在用户机器权限内运行，UI 不应把它们描述成安全沙箱。
- DeepAgents 原生 HITL 没有 checkpointer 时不可恢复，不能只靠 capability 标记。
- 媒体生成模型字段经常变化，OpenAPI/generated fields 必须是单一事实来源。
- 图像/视频生成可能产生费用，agent 自动调用必须有权限/额度确认。

## 8. 完成判定

这个项目的“完成”不应以能跑一个 runtime 为准，而应以以下能力验收：

- 同一个 AstraFlow session 中，用户能看到主 agent 和每个 subagent 的状态、任务输入、工具调用、最终摘要。
- Codex、Claude Code、OpenCode 至少能通过 ACP 使用文本、reasoning、tool、plan、permission。
- Codex direct adapter 能按 Thread/Turn/Item 保留富事件，而不是降级成纯文本。
- 内置 DeepAgents runtime 的 subagent stream 可实时渲染且可持久化 replay。
- agent 能发起图像/视频生成，用户能审批、看进度、看结果，并能在后续 prompt 中引用生成媒体。
- 所有 provider adapter 都有 fixture replay 测试，升级协议/包版本时能发现破坏性变更。
