import { tool } from "langchain"
import { z } from "zod"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import TurndownService from "turndown"

import { createModelverseChatModel } from "@/lib/modelverse-langchain"
import { getStudioExaApiKey } from "@/lib/studio-db"

const EXA_SEARCH_URL = "https://api.exa.ai/search"
const MAX_WEB_SEARCH_RESULTS = 8
const WEB_FETCH_TIMEOUT_MS = 60_000
const WEB_FETCH_MAX_BYTES = 10 * 1024 * 1024
const WEB_FETCH_MAX_PROMPT_CHARS = 100_000
const WEB_FETCH_FALLBACK_CHARS = 40_000

const exaSearchTypeSchema = z
  .enum(["instant", "fast", "auto", "deep-lite", "deep", "deep-reasoning"])
  .default("auto")

type ExaSearchResult = {
  title?: string
  url?: string
  publishedDate?: string | null
  author?: string | null
  summary?: string
  highlights?: string[]
}

type ExaSearchResponse = {
  requestId?: string
  results?: ExaSearchResult[]
  costDollars?: {
    total?: number
  }
}

type FetchedWebContent = {
  url: string
  contentType: string
  markdown: string
}

function clampResultCount(numResults: number | undefined) {
  if (!numResults || Number.isNaN(numResults)) {
    return 5
  }

  return Math.min(Math.max(Math.trunc(numResults), 1), MAX_WEB_SEARCH_RESULTS)
}

function normalizeDomains(domains: string[] | undefined) {
  const normalized = (domains ?? [])
    .map((domain) => domain.trim())
    .filter(Boolean)

  return normalized.length > 0 ? normalized : undefined
}

function formatResult(result: ExaSearchResult, index: number) {
  const title = result.title?.trim() || "Untitled"
  const url = result.url?.trim() || "No URL"
  const publishedDate = result.publishedDate
    ? `\nPublished: ${result.publishedDate}`
    : ""
  const author = result.author ? `\nAuthor: ${result.author}` : ""
  const summary = result.summary?.trim()
    ? `\nSummary: ${result.summary.trim()}`
    : ""
  const highlights = result.highlights?.length
    ? `\nHighlights:\n${result.highlights
        .slice(0, 3)
        .map((highlight) => `- ${highlight}`)
        .join("\n")}`
    : ""

  return `${index + 1}. ${title}\nURL: ${url}${publishedDate}${author}${summary}${highlights}`
}

export function getStoredExaApiKey() {
  return getStudioExaApiKey()?.key ?? null
}

function normalizeWebFetchUrl(url: string) {
  const trimmed = url.trim()
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  return withProtocol.replace(/^http:\/\//i, "https://")
}

async function readResponseText(response: Response) {
  const contentLength = Number(response.headers.get("content-length"))

  if (Number.isFinite(contentLength) && contentLength > WEB_FETCH_MAX_BYTES) {
    throw new Error("Fetched content is larger than the 10 MB limit.")
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer()

    if (buffer.byteLength > WEB_FETCH_MAX_BYTES) {
      throw new Error("Fetched content is larger than the 10 MB limit.")
    }

    return new TextDecoder("utf-8").decode(buffer)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    totalBytes += value.byteLength

    if (totalBytes > WEB_FETCH_MAX_BYTES) {
      await reader.cancel()
      throw new Error("Fetched content is larger than the 10 MB limit.")
    }

    chunks.push(value)
  }

  const buffer = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder("utf-8").decode(buffer)
}

function markdownFromHtml(html: string) {
  const turndown = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  })

  return turndown.turndown(html)
}

function cleanFetchedMarkdown(markdown: string) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

async function fetchWebContent(url: string): Promise<FetchedWebContent> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(normalizeWebFetchUrl(url), {
      headers: {
        "User-Agent": "AstraFlow-WebFetch/1.0",
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }

    const contentType = response.headers.get("content-type") ?? ""
    const text = await readResponseText(response)
    const markdown = contentType.includes("text/html")
      ? markdownFromHtml(text)
      : text

    return {
      url: response.url,
      contentType,
      markdown: cleanFetchedMarkdown(markdown),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function messageContentToText(content: unknown) {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part
      }

      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text
      }

      return ""
    })
    .filter(Boolean)
    .join("\n")
}

async function applyPromptToFetchedContent(
  fetched: FetchedWebContent,
  prompt: string
) {
  const content = fetched.markdown.slice(0, WEB_FETCH_MAX_PROMPT_CHARS)

  try {
    const model = createModelverseChatModel("gpt-5.4-mini", "none")
    const result = await model.invoke([
      new SystemMessage(
        [
          "You extract useful information from fetched web page content.",
          "Follow the user's prompt exactly.",
          "Answer only from the provided page content.",
          "Include the source URL when the answer depends on the page.",
        ].join(" ")
      ),
      new HumanMessage(
        [
          `Source URL: ${fetched.url}`,
          `Content-Type: ${fetched.contentType || "unknown"}`,
          `User prompt: ${prompt}`,
          "",
          "Fetched page content:",
          content,
        ].join("\n")
      ),
    ])
    const text = messageContentToText(result.content).trim()

    if (text) {
      return text
    }
  } catch {
    // Return the fetched content excerpt below so the main model can continue.
  }

  return [
    "Prompt processing was unavailable. Here is the fetched page content excerpt:",
    fetched.markdown.slice(0, WEB_FETCH_FALLBACK_CHARS),
  ].join("\n\n")
}

export function createExaWebSearchTool(apiKey: string) {
  return tool(
    async ({ query, numResults, type, includeDomains, excludeDomains }) => {
      const resultCount = clampResultCount(numResults)
      const response = await fetch(EXA_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          query,
          type,
          numResults: resultCount,
          includeDomains: normalizeDomains(includeDomains),
          excludeDomains: normalizeDomains(excludeDomains),
          contents: {
            highlights: {
              maxCharacters: 1200,
            },
            summary: {
              query: "Summarize the facts most relevant to the search query.",
            },
          },
        }),
      })

      if (!response.ok) {
        return `web_search failed with HTTP ${response.status}: ${await response.text()}`
      }

      const data = (await response.json()) as ExaSearchResponse
      const results = data.results?.slice(0, resultCount) ?? []

      if (results.length === 0) {
        return `No web search results found for: ${query}`
      }

      const cost = data.costDollars?.total
      const costLine =
        typeof cost === "number" ? `\nEstimated cost: $${cost}` : ""

      return [
        `Web search results for: ${query}`,
        `Request ID: ${data.requestId ?? "unknown"}${costLine}`,
        ...results.map(formatResult),
      ].join("\n\n")
    },
    {
      name: "web_search",
      description:
        "Search the web with Exa and return grounded results with titles, URLs, publication dates, summaries, and highlights. Use for current events, recent facts, source-backed answers, or when the user asks to search the web.",
      schema: z.object({
        query: z.string().min(1).describe("The web search query."),
        numResults: z
          .number()
          .int()
          .min(1)
          .max(MAX_WEB_SEARCH_RESULTS)
          .optional()
          .default(5)
          .describe("Number of search results to return."),
        type: exaSearchTypeSchema.describe(
          "Exa search mode. Use auto for most searches, fast for interactive latency, and deep/deep-reasoning for harder research."
        ),
        includeDomains: z
          .array(z.string())
          .optional()
          .describe("Optional domains to include, such as ['openai.com']."),
        excludeDomains: z
          .array(z.string())
          .optional()
          .describe("Optional domains to exclude."),
      }),
    }
  )
}

export function createWebFetchTool() {
  return tool(
    async ({ url, prompt }) => {
      try {
        const fetched = await fetchWebContent(url)
        const answer = await applyPromptToFetchedContent(fetched, prompt)

        return [
          `Web fetch result for: ${url}`,
          `Fetched URL: ${fetched.url}`,
          `Prompt: ${prompt}`,
          "",
          answer,
        ].join("\n")
      } catch (error) {
        return `web_fetch failed for ${url}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      }
    },
    {
      name: "web_fetch",
      description:
        "Fetch a specific URL, convert the page content into readable Markdown, and answer or extract information from it using the provided prompt. Use when the user gives a URL or asks to read, summarize, or extract from a specific page.",
      schema: z.object({
        url: z.string().min(1).describe("The URL to fetch."),
        prompt: z
          .string()
          .min(1)
          .describe("What to extract, summarize, or answer from the page."),
      }),
    }
  )
}
