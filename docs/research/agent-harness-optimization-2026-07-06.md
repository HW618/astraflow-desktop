# AstraFlow Agent Harness Optimization Notes

Date: 2026-07-06

## Sources Checked

- LangChain Deep Agents overview: https://docs.langchain.com/oss/python/deepagents/overview
- LangChain Deep Agents customization: https://docs.langchain.com/oss/python/deepagents/customization
- OpenAI Agents SDK guide: https://developers.openai.com/api/docs/guides/agents
- Codex manual, local fresh fetch: `/tmp/openai-docs-cache/codex-manual.md`
- Anthropic, Building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, Effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, Writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents

## Main Findings

The stronger agent pattern is not just a larger prompt. The consistent advice across Codex, Deep Agents, OpenAI Agents SDK, and Anthropic is:

- Keep the harness simple but explicit: good tool names, clear tool contracts, and visible parameter surfaces matter more than hidden app logic.
- Let the model use tools in a loop, but give it a planning surface and small verification loops for multi-step tasks.
- Prefer just-in-time context over dumping everything into the prompt. Codex and Claude Code both lean on search/read primitives plus compact persistent guidance.
- Use subagents to isolate heavy independent subtasks so the main context receives a final summary rather than all intermediate work.
- Trace and evaluate tool usage. Tool ergonomics should be improved with realistic multi-call tasks, not only one-shot happy paths.

## Changes Landed

- Media model listing tools now expose compact `parameterSchema` summaries, including useful param keys, defaults, options, suggested values, and media fields.
- Image/video generation tools now explicitly tell the agent to inspect parameter schemas and actively pass provider params.
- Media generation service now merges OpenAPI field defaults into requests, so agent-created jobs still use documented defaults when the model omits optional fields.
- AstraFlow runtime prompt now encourages `write_todos`, independent `task` delegation, just-in-time context retrieval, narrow verification, and more decisive media model selection.

## Next Candidates

- Add replay/eval fixtures for common failures: no model chosen, missing video duration/resolution, image prompt without aspect ratio, reference image mapped to the wrong media field.
- Add tracing counters for tool-call choice quality: list-models-before-generate, params-used count, request_user_input rate, provider error reason, and retry/resume behavior.
- Consider a durable checkpointer/backend path for Deep Agents HITL and resume, because built-in interrupts currently report as disabled in the runtime path.
- Define narrow AstraFlow subagents, for example `media-planner`, `code-explorer`, and `runtime-reviewer`, only if evals show the default subagent is too generic.
