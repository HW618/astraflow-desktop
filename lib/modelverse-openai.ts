import OpenAI from "openai"

import { getStudioModelverseApiKey } from "@/lib/studio-db"

export const MODELVERSE_BASE_URL = "https://api.modelverse.cn/v1"

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful general-purpose AI assistant.

Provide accurate, practical answers.
Use Markdown when it improves readability.
Keep the response focused on the user's request.
State uncertainty clearly instead of making up facts.
When the task is ambiguous, make the most reasonable assumption and keep moving.`

export function getStoredModelverseApiKey() {
  return getStudioModelverseApiKey()?.key ?? null
}

export function createModelverseClient() {
  const apiKey = getStoredModelverseApiKey()

  if (!apiKey) {
    throw new Error("Modelverse API key is not configured locally.")
  }

  return new OpenAI({
    apiKey,
    baseURL: MODELVERSE_BASE_URL,
  })
}

const TITLE_MODEL = "gpt-5.4-mini"

const TITLE_SYSTEM_PROMPT = `You generate an ultra-short title for a studio conversation or image generation request based on the user's first message.

Rules:
- At most 10 characters for Chinese, or about 5 words for other languages.
- Match the user's language.
- Capture the core topic; no filler.
- Output ONLY the title text. No quotes, punctuation, prefixes, or explanation.`

function normalizeGeneratedTitle(raw: string) {
  const cleaned = raw
    .replace(/[\r\n]+/g, " ")
    .replace(/^["'「『]+|["'」』]+$/g, "")
    .replace(/[。.！!？?]+$/g, "")
    .trim()

  return cleaned.length > 12 ? cleaned.slice(0, 12) : cleaned
}

export async function generateChatTitle(prompt: string) {
  const client = createModelverseClient()

  const completion = await client.chat.completions.create({
    model: TITLE_MODEL,
    messages: [
      { role: "system", content: TITLE_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  })

  return normalizeGeneratedTitle(completion.choices[0]?.message?.content ?? "")
}
