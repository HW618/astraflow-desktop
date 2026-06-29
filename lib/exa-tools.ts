import { tool } from "langchain"
import { z } from "zod"

import { getStudioExaApiKey } from "@/lib/studio-db"

const EXA_SEARCH_URL = "https://api.exa.ai/search"
const MAX_WEB_SEARCH_RESULTS = 8

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

export function createExaWebSearchTool(apiKey: string) {
  return tool(
    async ({
      query,
      numResults,
      type,
      includeDomains,
      excludeDomains,
    }) => {
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

export function createStudioAgentTools() {
  const exaApiKey = getStoredExaApiKey()

  return exaApiKey ? [createExaWebSearchTool(exaApiKey)] : []
}
