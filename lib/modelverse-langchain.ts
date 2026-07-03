import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOpenAI } from "@langchain/openai"

import {
  getChatModelConfig,
  resolveChatReasoningEffort,
  type ChatReasoningEffort,
  type SupportedChatModel,
} from "@/lib/chat-models"
import { MODELVERSE_BASE_URL as MODELVERSE_ANTHROPIC_BASE_URL } from "@/lib/modelverse-config"
import {
  getStoredModelverseApiKey,
  MODELVERSE_BASE_URL,
} from "@/lib/modelverse-openai"

function getLangChainApiKey() {
  const apiKey = getStoredModelverseApiKey()

  if (!apiKey) {
    throw new Error("Modelverse API key is not configured locally.")
  }

  return apiKey
}

type OpenAIReasoningEffort = Extract<
  ChatReasoningEffort,
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
>

type AnthropicReasoningEffort = Extract<
  ChatReasoningEffort,
  "low" | "medium" | "high" | "xhigh" | "max"
>

export function createModelverseChatModel(
  model: SupportedChatModel,
  requestedReasoningEffort: ChatReasoningEffort
) {
  const apiKey = getLangChainApiKey()
  const config = getChatModelConfig(model)
  const reasoningEffort = resolveChatReasoningEffort(
    model,
    requestedReasoningEffort
  )

  if (config.provider === "langchain_anthropic") {
    const outputEffort = reasoningEffort as AnthropicReasoningEffort

    return new ChatAnthropic({
      apiKey,
      model: config.providerModel,
      anthropicApiUrl: MODELVERSE_ANTHROPIC_BASE_URL,
      streaming: true,
      thinking:
        reasoningEffort === "none"
          ? { type: "disabled" }
          : { type: "adaptive", display: "summarized" },
      outputConfig:
        reasoningEffort === "none" ? undefined : { effort: outputEffort },
    })
  }

  if (config.reasoningMode === "glm_reasoning_effort") {
    return new ChatOpenAI({
      apiKey,
      model: config.providerModel,
      streaming: true,
      useResponsesApi: false,
      modelKwargs: {
        thinking: {
          type: reasoningEffort === "none" ? "disabled" : "enabled",
        },
        reasoning_effort: reasoningEffort,
      },
      configuration: {
        baseURL: MODELVERSE_BASE_URL,
      },
    })
  }

  if (config.reasoningMode === "kimi_thinking") {
    return new ChatOpenAI({
      apiKey,
      model: config.providerModel,
      streaming: true,
      useResponsesApi: false,
      modelKwargs: {
        thinking: {
          type: reasoningEffort === "none" ? "disabled" : "enabled",
        },
      },
      configuration: {
        baseURL: MODELVERSE_BASE_URL,
      },
    })
  }

  const openAIReasoningEffort = reasoningEffort as OpenAIReasoningEffort

  return new ChatOpenAI({
    apiKey,
    model: config.providerModel,
    streaming: true,
    useResponsesApi: false,
    reasoning: { effort: openAIReasoningEffort },
    modelKwargs: {
      reasoning_effort: openAIReasoningEffort,
    },
    configuration: {
      baseURL: MODELVERSE_BASE_URL,
    },
  })
}
