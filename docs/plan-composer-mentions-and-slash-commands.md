# 规划：聊天输入框 @ 引用（文件/会话）与 / 命令菜单（多 runtime 兼容）

> 状态：规划稿（2026-07-06）。基于两份只读调研：代码库现状 + ACP/各 runtime 协议能力。

## 0. 现状结论（调研摘要）

- 输入框是原生 `textarea`（`PromptInput*` → `components/ui/textarea.tsx`），不是 contenteditable。
- 发送流程：前端 `handleSubmit()` 落库消息 → `startAssistantRun()` 只发 sessionId 等 → 服务端 `lib/studio-chat-runner.ts` 从 DB 重组 LangChain messages → `startRun(AgentRunInput)`。
- ACP 用的是 `@agentclientprotocol/sdk`（+ `codex-acp` / `claude-agent-acp`）。`session/update` 的 `available_commands_update` 目前**未处理**（落入 unknown 分支）；prompt 已支持 `text` / `image` / `resource_link` 三类 block。
- 各 runtime 协议能力矩阵：

| Runtime | slash 发现 | slash 执行 | 文件 mention |
|---|---|---|---|
| ACP（codex/claude-code/opencode） | `available_commands_update` → `AvailableCommand{name, description, input.hint}` | 把 `/cmd args` 作为首个 text block 发 `session/prompt`（codex-acp 会解析） | `resource_link`（baseline）；`resource`（需 `promptCapabilities.embeddedContext`，两个官方 adapter 均为 true） |
| claude-native（agent-sdk） | `Query.supportedCommands(): SlashCommand[]`、`SDKCommandsChangedMessage` | prompt 文本 `/cmd args` | 无专用类型；Claude Code 原生理解文本中的 `@path`；也可用 ContentBlockParam |
| codex-direct（app-server） | 无通用列表；有 `skills/list`、`thread/compact/start` 等专门 RPC | 静态映射：已知命令 → 专门 RPC，否则文本 | `UserInput{type:"mention", name, path}`（结构化！）另有 `localImage`、`skill` |
| opencode-native | 未找到官方类型证据 | 文本降级 | 文本降级（`@path`） |
| astraflow（内置 DeepAgent） | 自定义（客户端实现） | 客户端实现 | 已有 session files manifest 机制，可注入路径/内容 |

- 文件搜索：现有 Electron IPC 只有单目录 `sidePanelListDirectory`；**没有**递归/模糊搜索。会话列表来自 `/api/studio/sessions`（SQLite `studio_sessions`）。
- i18n：`lib/i18n.ts` 双字典（en 推导类型，zh 补齐）。

## 1. 总体设计

### 1.1 统一抽象（核心）

在 UI 与 runtime 之间加一层**能力与数据的统一模型**，各 adapter 负责编码/降级：

```ts
// lib/agent/composer-types.ts（新建）
export type PromptMention =
  | { kind: "file"; path: string; name: string; mimeType?: string }      // 绝对路径
  | { kind: "folder"; path: string; name: string }
  | { kind: "session"; sessionId: string; title: string }

export type SlashCommandDescriptor = {
  name: string                 // 不含 "/"
  description: string
  inputHint?: string           // ACP AvailableCommandInput.hint / claude argumentHint
  source: "runtime" | "builtin"  // runtime=agent 下发；builtin=客户端本地命令
  runtimeId?: string
}

export type ComposerCapabilities = {
  slashCommands: "dynamic" | "static" | "none"   // dynamic=运行时下发
  fileMentions: "structured" | "text" | "none"   // structured=协议级 block
  sessionMentions: boolean                        // 是否支持注入会话上下文（全部为 true，走文本降级）
}
```

`AgentRuntimeInfo`（lib/agent/runtime.ts）增加可选 `composer?: ComposerCapabilities` 与可选静态命令表；`AgentRunInput` 不变（mention 走消息元数据）。

### 1.2 消息数据流

- `StudioMessage` 增加可选 `mentions?: PromptMention[]`（DB：`studio_messages` 新列或塞进现有 parts/attachments JSON——推荐新增 `mentions` JSON 列，迁移简单）。
- 前端提交时：文本中保留人类可读 token（`@src/lib/i18n.ts`、`/compact …`），同时把解析后的 `mentions` 数组随消息落库。
- `lib/studio-chat-runner.ts` 组装 LangChain message 时把 `mentions` 放进 `additional_kwargs.mentions`，各 adapter 从最新用户消息读取并按能力编码：
  - **ACP**：每个 file mention → `{type:"resource_link", uri:"file://…", name}`；若 agent `promptCapabilities.embeddedContext === true` 且为小文本文件（如 <32KB），优先发 `{type:"resource"}` 内嵌内容。slash 命令 → 整条消息作为首个 text block（`/cmd args`），不做额外包装。
  - **claude-native**：mention 保持文本 `@relative/path`（Claude Code 原生支持）；slash 直接把 `/cmd args` 作为 prompt 发送。
  - **codex-direct**：`turn/start.input` 由单 text 改为 `UserInput[]`：文本切段 + `{type:"mention", name, path}`（图片可顺便升级为 `localImage`）。slash：`/compact` → `thread/compact/start` RPC；其余未知命令保持文本并在 UI 标注"该 runtime 可能不支持"。
  - **opencode-native**：mention/slash 均文本降级（`@path`、`/cmd`），OpenCode CLI 自己解析。
  - **astraflow**：file mention → 读文件内容（走现有 sandbox/session files 机制）注入 system/user 上下文；session mention → 拉取被引用会话消息生成摘要文本注入；slash 仅支持 builtin 命令。
- **@ 会话（所有 runtime 通用策略）**：客户端在发送前把被引用会话转成一段折叠上下文（标题 + 最近 N 条消息的精简 transcript，截断上限如 8KB），ACP 下用 `resource` block（uri 形如 `astraflow://session/<id>`），其他 runtime 前置为文本块。这样无需任何 agent 侧支持。

### 1.3 slash 命令来源与缓存

- **builtin 命令**（所有 runtime 可用，客户端执行）：如 `/plan`（切权限模式）、`/model`、`/reasoning`、`/clear`（新会话）等，定义在前端常量表。
- **runtime 动态命令**：
  - ACP：`lib/agent/events.ts` 新增 `AgentEvent{type:"available-commands", commands: SlashCommandDescriptor[]}`；`mapAcpSessionUpdate()` 增加 `available_commands_update` 分支。run 过程中收到后：a) 通过现有事件流透传给前端；b) 持久化到 `studio_sessions`（新列 `availableCommands` JSON）或内存缓存 keyed by `runtimeId+projectId`，使**下次打开输入框就有菜单**（首轮对话前无命令属可接受降级，菜单只显示 builtin）。
  - claude-native：run 建立 query 后调用 `supportedCommands()` 发同一事件；同样缓存。
  - codex-direct / opencode：静态表（codex 已知命令映射 RPC）。
- 前端获取：新 API `GET /api/studio/sessions/:id/commands`（读缓存）+ 事件流实时更新。

### 1.4 文件/会话候选数据源

- **文件搜索（新增）**：新 API 路由 `GET /api/studio/workspace/files?projectId=…&q=…&limit=30`（Next 服务端和 Electron 同机，直接可读项目目录；无需新 IPC）。实现：优先 `git ls-files`（快、天然忽略 gitignore），非 git 目录回退递归 readdir（忽略 node_modules/.git/点文件，深度与数量上限），内存缓存 + 简单 fuzzy 打分（子序列匹配）。无 projectId 时 @ 文件区块显示"请先绑定项目"。
- **会话搜索**：复用 `/api/studio/sessions`，前端按标题 fuzzy 过滤（数量不大）；排除当前会话。

## 2. UI 设计（ChatComposer）

保持 textarea 方案（不改 contenteditable），参考 Codex 桌面版交互：

- **触发**：在光标处输入 `@` 或行首/空白后输入 `/` → 弹出锚定在输入框上方的 Popover 菜单（复用 shadcn `Command`/cmdk 组件做过滤与键盘导航；菜单定位用输入框整体锚点即可，不必做精确 caret 定位，Codex 也是整框弹出）。
- **@ 菜单分区**：`文件与文件夹`（项目内搜索）、`会话`（历史 chat）、`添加本地文件`（触发现有附件选择）。继续输入即时过滤；↑↓ 导航、Enter/Tab 选中、Esc 关闭。
- **/ 菜单分区**：`命令`（builtin + runtime 动态命令，带 description 与 input hint 灰字）；选中后替换为 `/name `，若有 inputHint 显示占位提示。
- **选中后的表示**：文本中插入 token（`@src/lib/i18n.ts` / `/compact`），同时在输入框上方渲染 **mention chips**（可单个删除；删除 chip 同步移除文本 token，反之亦然——用正则同步，token 内含空格的路径用引号包裹）。
- **提交解析**：submit 时从 chips 状态（而非重新解析文本）得到 `mentions[]`；`/` 开头且命中 builtin 命令 → 客户端本地执行不发消息；命中 runtime 命令或未知 → 正常作为消息发送。
- **状态管理**：`ChatComposer` 内新增 `useComposerMenu` hook（触发检测、query 提取、候选获取 debounce 150ms、键盘处理），`components/ui/prompt-input.tsx` 需向外暴露 textarea ref/onKeyDown 拦截（菜单打开时吞掉 ↑↓/Enter/Esc）。

## 3. 改动文件清单

| 文件 | 改动 |
|---|---|
| `lib/agent/composer-types.ts` **新建** | PromptMention / SlashCommandDescriptor / ComposerCapabilities |
| `lib/agent/runtime.ts` | AgentRuntimeInfo 增加 `composer` 能力声明 |
| `lib/agent/events.ts` | 新增 `available-commands` 事件 |
| `lib/agent/acp/acp-runtime.ts` | 映射 `available_commands_update`；prompt 编码 mention → resource_link/resource；读取 initialize 的 promptCapabilities |
| `lib/agent/adapters/claude-native-runtime.ts` | `supportedCommands()` 上报；mention → `@path` 文本 |
| `lib/agent/adapters/codex-direct-runtime.ts` | `turn/start.input` 改 `UserInput[]`，mention 结构化；`/compact` 映射 RPC |
| `lib/agent/adapters/opencode-native-runtime.ts` | 文本降级编码 |
| `lib/agent/adapters/astraflow-runtime.ts` | mention 文件内容/会话摘要注入 |
| `lib/studio-chat-runner.ts` | mentions 透传到 additional_kwargs；会话 mention 展开成上下文 |
| `lib/studio-db.ts` + migration | `studio_messages.mentions` 列；`studio_sessions.available_commands` 缓存列 |
| `app/api/studio/workspace/files/route.ts` **新建** | 项目文件 fuzzy 搜索 |
| `app/api/studio/sessions/[sessionId]/commands/route.ts` **新建** | 命令列表（builtin+缓存的动态命令） |
| `app/api/studio/sessions/[sessionId]/messages/route.ts` | 接收并落库 mentions |
| `components/studio-chat-workbench.tsx` | ChatComposer：触发检测、菜单、chips、提交解析、builtin 命令执行 |
| `components/ui/prompt-input.tsx` | 暴露 ref/键盘拦截 |
| `lib/i18n.ts` | 菜单/空态/错误/命令描述等中英文案 |

## 4. 分期交付

- **M1 — slash 基础**：builtin 命令菜单 + ACP `available_commands_update` 接入 + claude-native `supportedCommands()`；命令以文本发送。风险最低、立刻可见。
- **M2 — @ 文件**：文件搜索 API + @ 菜单 + chips + 各 adapter mention 编码（ACP resource_link、codex-direct 结构化 mention、其余文本）。
- **M3 — @ 会话**：会话候选 + transcript 摘要注入（全 runtime 文本/resource 降级策略）。
- **M4 — 打磨**：embeddedContext 内嵌文件内容、codex `/compact` RPC 映射、命令缓存持久化、输入框 token 高亮。

## 5. 风险与决策点

1. **命令冷启动**：ACP 命令要等 session 建立后才下发 → 用缓存 + builtin 兜底，首次会话菜单不全属预期。
2. **textarea 无富文本**：token 与 chips 双向同步有边界情况（用户手动编辑 token 文本）→ 以文本为准做宽松重解析，chip 只是视图。
3. **大文件/大会话注入**：embedded resource 与会话摘要都要设截断上限，超限退回 resource_link/纯路径。
4. **codex-direct input 改造**：`turn/start` 从单 text 变 UserInput[] 会触碰现有图片处理逻辑，需回归测试。
