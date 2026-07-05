"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type ShikiHighlightOptions = {
  lang: string
  theme: string
  tokenizeMaxLineLength?: number
  tokenizeTimeLimit?: number
}

type ShikiCodeToHtml = (
  code: string,
  options: ShikiHighlightOptions
) => Promise<string>

type ShikiHighlighter = {
  codeToHtml: ShikiCodeToHtml
  loadLanguage: (...languages: unknown[]) => Promise<void>
  loadTheme: (...themes: string[]) => Promise<void>
}

type ShikiWebBundle = {
  codeToHtml: ShikiCodeToHtml
  getSingletonHighlighter: (options?: {
    langs?: string[]
    themes?: string[]
    warnings?: boolean
  }) => Promise<ShikiHighlighter>
}

const maxHighlightedCodeLength = 30_000
const maxHighlightedLineLength = 2_000
const maxHighlightCacheEntries = 80

const highlightedCodeCache = new Map<string, string>()
const pendingHighlightCache = new Map<string, Promise<string | null>>()
const loadedExtraLanguages = new Set<string>()
const extraLanguageRegistrations = new Map<string, Promise<unknown | null>>()

let shikiWebBundlePromise: Promise<ShikiWebBundle> | null = null

const extraLanguageLoaders: Record<
  string,
  () => Promise<{ default: unknown }>
> = {
  cs: () => import("@shikijs/langs/cs"),
  csharp: () => import("@shikijs/langs/csharp"),
  dart: () => import("@shikijs/langs/dart"),
  diff: () => import("@shikijs/langs/diff"),
  docker: () => import("@shikijs/langs/docker"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  dotenv: () => import("@shikijs/langs/dotenv"),
  elixir: () => import("@shikijs/langs/elixir"),
  go: () => import("@shikijs/langs/go"),
  hcl: () => import("@shikijs/langs/hcl"),
  ini: () => import("@shikijs/langs/ini"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  kt: () => import("@shikijs/langs/kt"),
  lua: () => import("@shikijs/langs/lua"),
  make: () => import("@shikijs/langs/make"),
  makefile: () => import("@shikijs/langs/makefile"),
  nginx: () => import("@shikijs/langs/nginx"),
  powershell: () => import("@shikijs/langs/powershell"),
  prisma: () => import("@shikijs/langs/prisma"),
  proto: () => import("@shikijs/langs/proto"),
  protobuf: () => import("@shikijs/langs/protobuf"),
  ps1: () => import("@shikijs/langs/ps1"),
  rb: () => import("@shikijs/langs/rb"),
  rs: () => import("@shikijs/langs/rs"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  swift: () => import("@shikijs/langs/swift"),
  terraform: () => import("@shikijs/langs/terraform"),
  toml: () => import("@shikijs/langs/toml"),
}

function normalizeShikiLanguage(language: string) {
  const normalized = language.trim().toLowerCase()

  if (!normalized || ["plain", "text", "txt"].includes(normalized)) {
    return "plaintext"
  }

  return normalized
}

function normalizeShikiTheme(theme: string) {
  return theme.trim() || "github-light"
}

function getHighlightCacheKey(code: string, language: string, theme: string) {
  return `${theme}\u0000${language}\u0000${code}`
}

function getCachedHighlightedCode(key: string) {
  const cached = highlightedCodeCache.get(key)

  if (typeof cached !== "string") {
    return null
  }

  highlightedCodeCache.delete(key)
  highlightedCodeCache.set(key, cached)

  return cached
}

function setCachedHighlightedCode(key: string, html: string) {
  if (highlightedCodeCache.has(key)) {
    highlightedCodeCache.delete(key)
  }

  highlightedCodeCache.set(key, html)

  while (highlightedCodeCache.size > maxHighlightCacheEntries) {
    const oldestKey = highlightedCodeCache.keys().next().value

    if (!oldestKey) {
      break
    }

    highlightedCodeCache.delete(oldestKey)
  }
}

function loadShikiWebBundle() {
  shikiWebBundlePromise ??= import("shiki/bundle/web")
    .then((mod) => mod as unknown as ShikiWebBundle)
    .catch((error) => {
      shikiWebBundlePromise = null
      throw error
    })

  return shikiWebBundlePromise
}

function getExtraLanguageRegistration(language: string) {
  const loader = extraLanguageLoaders[language]

  if (!loader) {
    return Promise.resolve(null)
  }

  let registration = extraLanguageRegistrations.get(language)

  if (!registration) {
    registration = loader()
      .then((mod) => mod.default)
      .catch(() => null)
    extraLanguageRegistrations.set(language, registration)
  }

  return registration
}

function getShikiOptions(
  language: string,
  theme: string
): ShikiHighlightOptions {
  return {
    lang: language,
    theme,
    tokenizeMaxLineLength: maxHighlightedLineLength,
    tokenizeTimeLimit: 500,
  }
}

async function highlightWithShiki(
  code: string,
  language: string,
  theme: string
) {
  const shiki = await loadShikiWebBundle()

  try {
    return await shiki.codeToHtml(code, getShikiOptions(language, theme))
  } catch {
    const extraLanguage = await getExtraLanguageRegistration(language)

    if (extraLanguage) {
      try {
        const highlighter = await shiki.getSingletonHighlighter({
          langs: [],
          themes: [theme],
          warnings: false,
        })

        await highlighter.loadTheme(theme)

        if (!loadedExtraLanguages.has(language)) {
          await highlighter.loadLanguage(extraLanguage)
          loadedExtraLanguages.add(language)
        }

        return highlighter.codeToHtml(code, getShikiOptions(language, theme))
      } catch {
        // Fall through to plaintext.
      }
    }
  }

  try {
    return await shiki.codeToHtml(code, getShikiOptions("plaintext", theme))
  } catch {
    return null
  }
}

function getHighlightedCode(
  key: string,
  code: string,
  language: string,
  theme: string
) {
  const cached = getCachedHighlightedCode(key)

  if (cached) {
    return Promise.resolve(cached)
  }

  let pending = pendingHighlightCache.get(key)

  if (!pending) {
    pending = highlightWithShiki(code, language, theme)
      .then((html) => {
        if (html) {
          setCachedHighlightedCode(key, html)
        }

        return html
      })
      .finally(() => {
        pendingHighlightCache.delete(key)
      })
    pendingHighlightCache.set(key, pending)
  }

  return pending
}

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip border",
        "rounded-xl border-border bg-card text-card-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
  streaming?: boolean
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlockCode({
  code,
  language = "tsx",
  theme = "github-light",
  streaming = false,
  className,
  ...props
}: CodeBlockCodeProps) {
  const normalizedLanguage = normalizeShikiLanguage(language)
  const normalizedTheme = normalizeShikiTheme(theme)
  const shouldHighlight =
    !streaming && code.length > 0 && code.length <= maxHighlightedCodeLength
  const cacheKey = shouldHighlight
    ? getHighlightCacheKey(code, normalizedLanguage, normalizedTheme)
    : null
  const [highlighted, setHighlighted] = React.useState<{
    key: string
    html: string
  } | null>(null)

  React.useEffect(() => {
    let isMounted = true

    if (!cacheKey || !shouldHighlight) {
      return () => {
        isMounted = false
      }
    }

    void getHighlightedCode(
      cacheKey,
      code,
      normalizedLanguage,
      normalizedTheme
    ).then((html) => {
      if (isMounted && html) {
        setHighlighted({ key: cacheKey, html })
      }
    })

    return () => {
      isMounted = false
    }
  }, [cacheKey, code, normalizedLanguage, normalizedTheme, shouldHighlight])

  const classNames = cn(
    "w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
    className
  )
  const highlightedHtml =
    cacheKey && highlighted?.key === cacheKey ? highlighted.html : null

  return highlightedHtml ? (
    <div
      className={classNames}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      {...props}
    />
  ) : (
    <div className={classNames} {...props}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }
