# AstraFlow 多 Agent 运行时平台改造 — 整体 Review 报告

> Reviewer：Fable 5（只读审查）。范围：main 分支 `e227cbc8..HEAD`（13 commits，35 文件，+8302/-1434）。日期：2026-07-04。
> 结论速览：架构分层达到方案设计意图，消息契约三处一致性过关；**权限管控覆盖面是最大短板**（默认运行时绕过审批）。修复优先级：S1/S2/S3 → C1/C2/C3 → 权限持久化恢复与超时。
>
> **修复状态（2026-07-04）**：S1–S8、C1–C10、契约小项及遗留债 1/2/3/5 已全部修复合入 main（两波 worktree 并行修复：安全/并发簇 6 支 + S1 权限网关 1 支），typecheck / lint / Playwright 回归全绿。遗留债 4（opencode 文档表述）经核实无需改动。

## 一、安全（最优先）

### S1 · critical · 权限审批对默认运行时形同虚设
`lib/agent/adapters/langchain-runtime.ts:563`、`lib/agent/adapters/deepagents-runtime.ts:684`、`lib/agent/runtime.ts:40`
已验证：全仓库仅 `acp-runtime.ts` 调用 `requestPermission`。默认运行时 `langchain`（`DEFAULT_AGENT_RUNTIME_ID`）与 `deepagents` 都声明 `hitl:false`、从不接入 broker，却持有 sandbox `execute`（任意 shell）、写文件、`web_fetch`、MCP 等高危能力。用户设 `readonly`/`ask`，UI 显示"已受权限管控"，实际模型可无审批执行任意命令。**本批改动最严重问题：权限系统在默认配置下不生效。**
修复：langchain/deepagents 工具执行层接入统一权限网关（middleware/interrupt），至少对 execute/写文件/网络类走 `requestPermission`；未做前 UI 必须标注这两个 runtime 不受权限模式约束，readonly 下禁用高危工具。

### S2 · high · 会话路由完全缺失鉴权
`app/api/studio/sessions/[sessionId]/route.ts:33,79`（无 `requireAuthenticatedRequest`，也无全局 middleware）
同目录兄弟路由（title/、image-generations）都有鉴权，唯独 PATCH/DELETE 没有。任意触达者可 PATCH 改 `projectId`（重绑会话到攻击者路径→影响 ACP cwd）、把 `permissionMode` 从 ask 降为 auto（绕审批）、或 DELETE 删任意会话（连带磁盘产物）。`sessions/route.ts`、`messages/route.ts` 同缺。
修复：PATCH/DELETE 开头补 `requireAuthenticatedRequest()`。

### S3 · high · 危险默认值：新会话默认 auto，auto 无条件放行一切
`lib/studio-db.ts:508/882`、`lib/agent/permission-broker.ts:75-79`
新建会话 `permission_mode` 默认 auto（非法值也回落 auto）。broker 的 auto 分支对任意工具直接 `findAllowOption`，不分 read/write/execute/delete。仅当会话关联本地项目才翻成 ask；无项目会话永远停 auto。默认新对话 + ACP，`rm -rf`/写任意文件被自动放行。
修复：默认改 ask；auto 仅对只读/安全类别放行。

### S4 · high · `allow_always` 粒度过粗 + 无项目时写全局规则跨项目泄漏
`lib/agent/permission-broker.ts:134-143`、`lib/studio-db.ts:2728-2762`
规则唯一键 `(project_id, tool_name)`，`tool_name` 来自 ACP 的 `kind ?? title`（粗类别如 execute）——对 execute 点一次"始终允许"=永久允许任意 shell。`hasStudioPermissionRule` 匹配 `project_id = ? OR project_id IS NULL`，无项目会话生成 `project_id=NULL` 全局规则，对所有项目生效。
修复：allow_always 绑定具体 session/project、不写 NULL 全局规则；粒度纳入输入指纹/路径前缀；提供撤销 UI。

### S5 · high(疑似) · ACP 写文件仅校验父目录 realpath，symlink 可逃逸 workspace
`lib/agent/acp/acp-runtime.ts:277-291,344-347`
读路径对最终目标 realpath（安全），写路径只对父目录 realpath 校验，最终 `resolve(parentRealPath, basename)` 交给 `writeFile`（跟随软链）。项目内有指向外部的软链时，写请求会写到软链目标。
修复：写前对已存在最终目标 lstat/realpath 后再 `assertPathInsideWorkspace`，或用 O_NOFOLLOW。

### S6 · medium(疑似) · 注册任意目录 + 立即跑 git → 恶意 .git/config 致本地命令执行
`app/api/studio/local-projects/route.ts:47-93,117-168`
git execFile+数组参数无注入，但 `git status` honor 目标 `.git/config` 的 `core.fsmonitor`/hooks。攻击者放置含恶意 .git/config 的目录 + 调注册 API → RCE。
修复：执行 git 前设 `GIT_CONFIG_GLOBAL=/dev/null`、`-c core.fsmonitor=false -c core.hooksPath=/dev/null`。

### S7 · medium(疑似) · 鉴权是全局应用状态而非请求身份 → CSRF 有效（S2/S6 放大器）
`lib/app-auth.ts:6-15`、`app/api/studio/chat/permission/route.ts:15-57`
`requireAuthenticatedRequest` 只判断服务端是否存过 OAuth token，与请求来源无关。桌面登录后恶意网页可跨源 POST 到 localhost:3011。审批端点不校验 sessionId 归属，requestId 可枚举。
修复：本地 API 加 Origin/Host 白名单或 CSRF token；审批端点校验 sessionId 归属；requestId 改随机值。

### S8 · medium · ACP 写路径校验前先 mkdir(recursive)，产生 workspace 外目录副作用
`lib/agent/acp/acp-runtime.ts:282-288`
先 mkdir 再 realpath 校验，被拒前目录树已创建。修复：先校验再 mkdir。

**安全核对通过项**：SQLite 迁移幂等；open-folder spawn+数组无注入、仅开已注册目录；Electron pick-folder 只调原生 dialog、preload 未暴露 ipcRenderer 本体。（既有 `openExternal(url)` 不在本次改动内，建议另查 scheme 校验。）

## 二、正确性 / 并发 / 资源

### C1 · high · 取消后立即重发产生同 session 双并发 run
`lib/agent/run-orchestrator.ts:843-854,899-906,939`
`cancelAgentRun` 同步置 cancelled，底层生成器可能还在 drain；去重只拦 queued/running。两个 run 向同一 SSE 交错推快照、各自烧 token。修复：去重覆盖"已 abort 但 promise 未 settle"，或等旧 promise settle。

### C2 · high · ACP 同 key 会话创建 TOCTOU，重复 spawn 且泄漏子进程
`lib/agent/acp/acp-runtime.ts:1012-1058,835-837`
无 in-flight promise 去重，并发时 spawn 两个子进程后者覆盖前者；孤儿 exit 回调提前返回且不 kill → 永久泄漏。修复：`Map<key,Promise<state>>` 串行化；提前返回分支仍 kill。

### C3 · high(疑似) · ACP 同会话并发 run 共享单 stream，prompt/nextUpdate 相互抢占
`lib/agent/acp/acp-runtime.ts:1101-1157,1199-1219`
queue/runSignal 互覆盖、两循环争抢同流。修复：同 key 同时刻只允许一个活跃 run。

### C4 · high(疑似) · tool_call/tool_result id 不一致 → 错配（贯穿多 adapter）
`langchain-runtime.ts:396-460`、`deepagents-runtime.ts:399-434`、`run-orchestrator.ts:522-544`
deepagents `call.callId || randomUUID()` 在 call 与 result 各算一次；langchain 两条 emit 路径 id 来源不同；orchestrator 按 toolName 兜底在同名并发时挂错。修复：每 adapter 统一 id 来源；orchestrator 回退加严或告警。

### C5 · medium · deepagents 子代理 write_todos 覆盖主代理计划
`deepagents-runtime.ts:388-397` + `run-orchestrator.ts:387-413`。修复：子代理来源不发 plan_update，或事件区分 task 归属。

### C6 · medium · abort 不真正终止执行 / 不 kill 子进程
deepagents（`e2b-backend.ts:250-288`）`commands.run` 未接 AbortSignal，abort 后仍占会话锁；ACP（`acp-runtime.ts:1060-1099,1150-1156`）5s kill 兜底定时器被 finally 清掉，仅协议层 graceful cancel。

### C7 · medium · 无服务关闭钩子，进程退出残留全部 ACP 子进程
`lib/agent/acp/acp-runtime.ts:75`。修复：注册全局清理钩子遍历 dispose。

### C8 · medium · runtime 不响应 abort 时 run Map 永久泄漏
`lib/agent/run-orchestrator.ts:796-807,949-951`。修复：abort 后 watchdog 超时强制 finalize。

### C9 · medium · cancel 不通知订阅者也不落库，UI 卡住
`lib/agent/run-orchestrator.ts:843-854`。修复：cancel 后立即推一次快照。

### C10 · low · deepagents sandbox:true 恒真但无 key 时退回内存 FS，系统提示误导
`deepagents-runtime.ts:603-610,196-198`。

**正确性核对通过**：orchestrator 持久化事务化、最终快照必落、崩溃恢复（reconcileInterruptedRuns）齐全；langchain finally 关 MCP client；deepagents execute 经 quoteShell 无注入；SSE listener unsubscribe 完整。

## 三、契约一致性

- StudioMessagePart 三处（zod / parseParts / 前端渲染）对 5 种 part 一致。parseParts 校验比 zod 少（reasoning 不校验 durationMs），损坏值可绕过（low）。
- plan_update、permission_request pending→resolved 三方与 events.ts 一致。
- `error` 类型 AgentEvent 被 orchestrator 静默丢弃（`run-orchestrator.ts:603-607`）——当前无 adapter 发 error 事件故不触发，属潜在缺口。
- ACP `tool_call_update(completed)` 无前置 tool_call 时产生无配对 tool_result（low）。

## 四、遗留债与建议

1. **权限持久化恢复缺失**（medium）：进程重启后 pending permission part 变"死按钮"。建议 reconcile 时把 pending permission part 置 cancelled。
2. **pending 权限无超时**（high，`permission-broker.ts:92-112`）：用户不响应则 Promise 永久 pending + Map 泄漏；idle dispose 不 reject pending。建议超时结算 + dispose 清理。
3. **deepagents HITL 无 checkpointer**（medium）：interrupt 触发会静默空回复。建议检测 run.interrupted 并发 error 说明。
4. **opencode**：代码已完整接线，被 stdio probe 门控（主流版本 HTTP-only 故 unavailable）；文档表述应更正为"已实现、探测门控"。
5. 前端小项：`reloadSessionProject` 无 stale-guard（medium）；runtime 全局存储与 permissionMode 按会话存储不联动（low）；plan part key 用 index（low）；侧边栏项目组与扁平列表会话重复显示（low，待确认设计意图）。

## 总体评价

架构落地基本达到方案文档设计意图：Orchestrator 与 Runtime 干净分层、AgentEvent→StudioMessagePart 归一化贯通四个 adapter、持久化/节流/live 推送扎实，是可扩展的好底座。但**权限管控是最大短板**：只覆盖 ACP，默认 langchain/deepagents 完全绕过（S1），叠加默认 auto 无条件放行（S3）、会话路由无鉴权（S2）、全局 CSRF 面（S7），使"工具审批"在默认配置下形同虚设——对外前必须修掉。并发/资源缺陷多在多 worktree 合并的"接缝处"，符合预期风险。下一轮优先级：**S1/S2/S3 → C1/C2/C3 → 权限持久化恢复与超时**。
