const sessionId = `smoke-deepagents-${Date.now()}`
const hasEnvironmentModelverseKey = Boolean(
  process.env.MODELVERSE_API_KEY?.trim() ||
  process.env.MODELVERSE_APIKEY?.trim() ||
  process.env.UCLOUD_MODELVERSE_API_KEY?.trim()
)

if (!hasEnvironmentModelverseKey) {
  console.error(
    "缺少环境 ModelVerse API key，无法发起真实 DeepAgents 端到端调用。"
  )
  process.exitCode = 1
} else {
  const [{ HumanMessage }, { deepAgentsRuntime }, { DEFAULT_CHAT_MODEL }] =
    await Promise.all([
      import("@langchain/core/messages"),
      import("@/lib/agent/adapters/deepagents-runtime"),
      import("@/lib/chat-models"),
    ])
  const controller = new AbortController()

  try {
    for await (const event of deepAgentsRuntime.startRun({
      sessionId,
      messages: [
        new HumanMessage(
          "列出 /home/user 下文件，然后在 /home/user/hello.txt 写入一行 hello from deepagents。"
        ),
      ],
      model: DEFAULT_CHAT_MODEL,
      reasoningEffort: "none",
      signal: controller.signal,
    })) {
      console.log(JSON.stringify(event))
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

export {}
