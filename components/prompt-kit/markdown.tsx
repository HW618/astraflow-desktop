"use client"

import {
  RiCheckLine,
  RiCodeLine,
  RiDownloadLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiPlayLine,
  RiSaveLine,
} from "@remixicon/react"
import { marked } from "marked"
import { memo, type MouseEvent, useId, useMemo, useState } from "react"
import ReactMarkdown, { Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"

import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "@/components/prompt-kit/code-block"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import { cn } from "@/lib/utils"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  autoPreviewHtml?: boolean
  mediaSaveSessionId?: string | null
  mediaUrlMap?: Record<string, string>
  openLinksInWorkspace?: boolean
  streaming?: boolean
  components?: Partial<Components>
}

type MarkdownSourceBlock = {
  key: string
  content: string
  kind: string
  streamingSensitive: boolean
}

type MarkdownRenderBlock = MarkdownSourceBlock & {
  mutable: boolean
}

const markdownExternalProtocols = new Set([
  "http:",
  "https:",
  "mailto:",
  "vscode:",
  "vscode-insiders:",
])

type StudioMarkdownMediaKind = "image" | "video" | "audio"

type StudioMarkdownMediaRoute = {
  kind: StudioMarkdownMediaKind
  outputId?: string
  contentUrl: string
  downloadUrl: string
  saveUrl?: string | null
  sourceUrl?: string | null
  filename: string
}

const mediaRouteConfig = {
  image: {
    segment: "image-outputs",
    extension: "png",
  },
  video: {
    segment: "video-outputs",
    extension: "mp4",
  },
  audio: {
    segment: "audio-outputs",
    extension: "mp3",
  },
} satisfies Record<
  StudioMarkdownMediaKind,
  { segment: string; extension: string }
>

const externalImageExtensions = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])

function hashMarkdownBlock(value: string) {
  let hash = 5381

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }

  return (hash >>> 0).toString(36)
}

function withSearchParam(href: string, key: string, value: string) {
  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const url = new URL(href, baseUrl)
    url.searchParams.set(key, value)

    return href.startsWith("/")
      ? `${url.pathname}${url.search}`
      : url.toString()
  } catch {
    const separator = href.includes("?") ? "&" : "?"
    return `${href}${separator}${encodeURIComponent(key)}=${encodeURIComponent(
      value
    )}`
  }
}

function getStudioMarkdownMediaRoute(href: string | undefined | null) {
  const trimmedHref = typeof href === "string" ? href.trim() : ""

  if (!trimmedHref) {
    return null
  }

  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const parsed = new URL(trimmedHref, baseUrl)
    const match = parsed.pathname.match(
      /^\/api\/studio\/(image-outputs|video-outputs|audio-outputs)\/([^/]+)\/content\/?$/
    )

    if (!match) {
      return null
    }

    const entry = Object.entries(mediaRouteConfig).find(
      ([, config]) => config.segment === match[1]
    )

    if (!entry) {
      return null
    }

    const [kind, config] = entry as [
      StudioMarkdownMediaKind,
      (typeof mediaRouteConfig)[StudioMarkdownMediaKind],
    ]
    const outputId = decodeURIComponent(match[2])
    const contentUrl = trimmedHref.startsWith("http")
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}`

    return {
      kind,
      outputId,
      contentUrl,
      downloadUrl: withSearchParam(contentUrl, "download", "1"),
      saveUrl: `/api/studio/${config.segment}/${encodeURIComponent(outputId)}/save`,
      filename: `${kind}-${outputId}.${config.extension}`,
    } satisfies StudioMarkdownMediaRoute
  } catch {
    return null
  }
}

function getFilenameExtension(filename: string) {
  const extension = filename.split(".").at(-1)?.trim().toLowerCase() ?? ""

  return /^[a-z0-9]{2,8}$/.test(extension) ? extension : ""
}

function getExternalImageFilename(url: URL, alt: string | undefined) {
  const pathName = decodeURIComponent(url.pathname)
  const basename = pathName.split("/").filter(Boolean).at(-1) ?? ""
  const extension = getFilenameExtension(basename) || "png"
  const stem =
    basename.replace(/\.[^.]+$/, "").trim() ||
    alt?.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "image"

  return `${stem.slice(0, 80) || "image"}.${extension}`
}

function getExternalMarkdownImageRoute(
  href: string | undefined | null,
  alt: string | undefined
) {
  const trimmedHref = typeof href === "string" ? href.trim() : ""

  if (!trimmedHref) {
    return null
  }

  try {
    const parsed = new URL(trimmedHref)

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null
    }

    const contentUrl = parsed.toString()

    return {
      kind: "image",
      contentUrl,
      downloadUrl: contentUrl,
      saveUrl: null,
      sourceUrl: contentUrl,
      filename: getExternalImageFilename(parsed, alt),
    } satisfies StudioMarkdownMediaRoute
  } catch {
    return null
  }
}

function isLikelyExternalImageUrl(href: string | undefined | null) {
  if (!href) {
    return false
  }

  try {
    const parsed = new URL(href)
    const extension = getFilenameExtension(parsed.pathname)

    return externalImageExtensions.has(extension)
  } catch {
    return false
  }
}

function getMediaUrlLookupKeys(href: string) {
  const keys = [href]

  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const parsed = new URL(href, baseUrl)

    keys.push(parsed.toString(), `${parsed.origin}${parsed.pathname}`)

    if (href.startsWith("/")) {
      keys.push(parsed.pathname)
    }
  } catch {
    // Use the original href only.
  }

  return keys
}

function resolveMappedMediaUrl(
  href: string | undefined | null,
  mediaUrlMap: Record<string, string> | undefined
) {
  if (!href || !mediaUrlMap) {
    return href ?? undefined
  }

  for (const key of getMediaUrlLookupKeys(href)) {
    const mapped = mediaUrlMap[key]

    if (mapped) {
      return mapped
    }
  }

  return href
}

function getMarkdownTokenKind(token: ReturnType<typeof marked.lexer>[number]) {
  return typeof token.type === "string" ? token.type : "block"
}

function looksLikeMarkdownTable(block: string) {
  const lines = block
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return false
  }

  const hasPipeRow = lines[0].includes("|")
  const hasSeparator = /^:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*$/.test(
    lines[1].replace(/^\|/, "").replace(/\|$/, "").trim()
  )

  return hasPipeRow && hasSeparator
}

function hasUnclosedFence(block: string) {
  let openFence: { character: string; length: number } | null = null

  for (const line of block.split("\n")) {
    const match = line.match(/^(?: {0,3})([`~]{3,})/)

    if (!match) {
      continue
    }

    const fence = match[1]
    const character = fence[0]

    if (!openFence) {
      openFence = { character, length: fence.length }
      continue
    }

    if (character === openFence.character && fence.length >= openFence.length) {
      openFence = null
    }
  }

  return Boolean(openFence)
}

function isStreamingSensitiveBlock(block: string, kind: string) {
  return (
    kind === "table" ||
    looksLikeMarkdownTable(block) ||
    hasUnclosedFence(block) ||
    isHtmlFenceBlock(block)
  )
}

export function parseMarkdownIntoBlocks(
  markdown: string
): MarkdownSourceBlock[] {
  const tokens = marked.lexer(markdown)

  return tokens.map((token, index) => {
    const content = token.raw
    const kind = getMarkdownTokenKind(token)

    return {
      key: `${index}-${kind}-${hashMarkdownBlock(content)}`,
      content,
      kind,
      streamingSensitive: isStreamingSensitiveBlock(content, kind),
    }
  })
}

function getStreamingTailStartIndex(blocks: MarkdownSourceBlock[]) {
  if (blocks.length <= 1) {
    return 0
  }

  let tailStartIndex = blocks.length - 1

  for (let index = tailStartIndex; index >= 0; index -= 1) {
    if (!blocks[index].streamingSensitive) {
      break
    }

    tailStartIndex = index
  }

  return tailStartIndex
}

function createMarkdownRenderBlocks(
  markdown: string,
  streaming: boolean
): MarkdownRenderBlock[] {
  const blocks = parseMarkdownIntoBlocks(markdown)

  if (!streaming) {
    return blocks.map((block) => ({ ...block, mutable: false }))
  }

  const tailStartIndex = getStreamingTailStartIndex(blocks)
  const stableBlocks = blocks
    .slice(0, tailStartIndex)
    .map((block) => ({ ...block, mutable: false }))
  const tailContent = blocks
    .slice(tailStartIndex)
    .map((block) => block.content)
    .join("")

  if (!tailContent) {
    return stableBlocks
  }

  return [
    ...stableBlocks,
    {
      key: `tail-${tailStartIndex}`,
      content: tailContent,
      kind: "stream-tail",
      streamingSensitive: true,
      mutable: true,
    },
  ]
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext"
  const match = className.match(/language-([^\s]+)/)
  return match ? match[1] : "plaintext"
}

function getLanguageLabel(language: string) {
  return language === "plaintext" ? "Code" : language.toUpperCase()
}

function isHtmlLanguage(language: string) {
  return ["html", "htm"].includes(language.toLowerCase())
}

function getFenceBlockLanguage(block: string) {
  const opener = block.match(/^(?: {0,3})([`~]{3,})([^\n]*)\n/)

  if (!opener) {
    return null
  }

  return {
    fence: opener[1],
    language: opener[2].trim().split(/\s+/)[0] ?? "",
  }
}

function isHtmlFenceBlock(block: string) {
  const opener = getFenceBlockLanguage(block)

  return opener ? isHtmlLanguage(opener.language) : false
}

function isCompleteHtmlFenceBlock(block: string) {
  const opener = getFenceBlockLanguage(block)

  if (!opener) {
    return false
  }

  if (!isHtmlLanguage(opener.language)) {
    return false
  }

  const lines = block.replace(/\n$/, "").split("\n")
  const closingLine = lines.at(-1)?.trim() ?? ""
  const fenceCharacter = opener.fence[0]

  return (
    closingLine.length >= opener.fence.length &&
    [...closingLine].every((character) => character === fenceCharacter)
  )
}

function openHtmlPreview(code: string) {
  const blob = new Blob([code], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  const previewWindow = window.open(url, "_blank", "noopener,noreferrer")

  if (!previewWindow) {
    URL.revokeObjectURL(url)
    return
  }

  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function getOpenableMarkdownUrl(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref || trimmedHref.startsWith("#")) {
    return null
  }

  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const parsed = new URL(trimmedHref, baseUrl)
    return markdownExternalProtocols.has(parsed.protocol)
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function getWorkspaceMarkdownTarget(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref || trimmedHref.startsWith("#")) {
    return null
  }

  if (trimmedHref.startsWith("/api/")) {
    try {
      const baseUrl =
        typeof window === "undefined"
          ? "http://localhost"
          : window.location.href

      return new URL(trimmedHref, baseUrl).toString()
    } catch {
      return null
    }
  }

  if (
    trimmedHref.startsWith("/") ||
    trimmedHref.startsWith("~/") ||
    trimmedHref.startsWith("file://")
  ) {
    return trimmedHref
  }

  try {
    const parsed = new URL(trimmedHref)

    return ["http:", "https:", "file:"].includes(parsed.protocol)
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function openMarkdownTargetInWorkspace(
  href: string,
  source: StudioOpenMarkdownTargetDetail["source"]
) {
  const target = getWorkspaceMarkdownTarget(href)

  if (!target) {
    return false
  }

  window.dispatchEvent(
    new CustomEvent<StudioOpenMarkdownTargetDetail>(
      STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
      {
        detail: {
          href: target,
          source,
        },
      }
    )
  )
  return true
}

function openMarkdownLink(url: string) {
  if (window.astraflowDesktop?.openExternal) {
    void window.astraflowDesktop.openExternal(url)
    return true
  }

  return Boolean(window.open(url, "_blank", "noopener,noreferrer"))
}

function CodeActionButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function MarkdownMediaActions({
  media,
  saveSessionId,
}: {
  media: StudioMarkdownMediaRoute
  saveSessionId?: string | null
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const canSave = Boolean(media.saveUrl || (media.sourceUrl && saveSessionId))

  async function handleSave(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (saving) {
      return
    }

    setSaving(true)

    try {
      const response = media.saveUrl
        ? await fetch(media.saveUrl, { method: "POST" })
        : await fetch("/api/studio/media-url/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: media.filename,
              kind: media.kind,
              sessionId: saveSessionId,
              url: media.sourceUrl,
            }),
          })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? "Save failed.")
      }

      setSaved(true)
      toast.success("Saved to Files")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <TooltipProvider>
      <span className="not-prose inline-flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="secondary"
              size="icon-sm"
              className="size-8 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
              aria-label="Download"
            >
              <a
                href={media.downloadUrl}
                download={media.filename}
                onClick={(event) => event.stopPropagation()}
              >
                <RiDownloadLine aria-hidden />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Download</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="size-8 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
              aria-label="Save to Files"
              disabled={!canSave || saving}
              onClick={handleSave}
            >
              {saved ? (
                <RiCheckLine aria-hidden />
              ) : (
                <RiSaveLine aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {canSave ? "Save to Files" : "Cannot save this image"}
          </TooltipContent>
        </Tooltip>
      </span>
    </TooltipProvider>
  )
}

function MarkdownMediaLink({
  anchorProps,
  children,
  href,
  media,
  onClick,
  openableUrl,
  openLinksInWorkspace,
  saveSessionId,
}: {
  anchorProps: React.AnchorHTMLAttributes<HTMLAnchorElement>
  children: React.ReactNode
  href: string
  media: StudioMarkdownMediaRoute
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
  openableUrl: string | null
  openLinksInWorkspace: boolean
  saveSessionId?: string | null
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)

    if (event.defaultPrevented || event.button !== 0) {
      return
    }

    if (openLinksInWorkspace && openMarkdownTargetInWorkspace(href, "link")) {
      event.preventDefault()
      return
    }

    if (openableUrl && openMarkdownLink(openableUrl)) {
      event.preventDefault()
    }
  }

  return (
    <span className="not-prose inline-flex max-w-full items-center gap-1.5 align-middle">
      <a
        {...anchorProps}
        href={href}
        target={openableUrl ? "_blank" : undefined}
        rel={openableUrl ? "noreferrer" : undefined}
        onClick={handleClick}
      >
        {children}
      </a>
      <MarkdownMediaActions media={media} saveSessionId={saveSessionId} />
    </span>
  )
}

function MarkdownCodeBlock({
  code,
  language,
  autoPreviewHtml,
  streaming,
}: {
  code: string
  language: string
  autoPreviewHtml: boolean
  streaming: boolean
}) {
  const canPreview = isHtmlLanguage(language)
  const [view, setView] = useState<"code" | "preview">(
    canPreview && autoPreviewHtml ? "preview" : "code"
  )
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <TooltipProvider>
      <CodeBlock className="my-4 rounded-2xl shadow-sm">
        <CodeBlockGroup className="gap-3 border-b bg-muted/40 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <RiCodeLine aria-hidden className="size-4 text-muted-foreground" />
            <span className="truncate text-sm font-medium">
              {getLanguageLabel(language)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canPreview ? (
              <>
                <CodeActionButton
                  label="Show code"
                  className={cn(view === "code" && "bg-secondary")}
                  onClick={() => setView("code")}
                >
                  <RiCodeLine aria-hidden />
                </CodeActionButton>
                <CodeActionButton
                  label="Preview HTML"
                  className={cn(view === "preview" && "bg-secondary")}
                  onClick={() => setView("preview")}
                >
                  <RiPlayLine aria-hidden />
                </CodeActionButton>
                <CodeActionButton
                  label="Open preview"
                  onClick={() => openHtmlPreview(code)}
                >
                  <RiExternalLinkLine aria-hidden />
                </CodeActionButton>
              </>
            ) : null}
            <CodeActionButton label="Copy code" onClick={handleCopy}>
              {copied ? (
                <RiCheckLine aria-hidden className="text-foreground" />
              ) : (
                <RiFileCopyLine aria-hidden />
              )}
            </CodeActionButton>
          </div>
        </CodeBlockGroup>
        {view === "preview" && canPreview ? (
          <div className="h-[420px] bg-white">
            <iframe
              title="HTML preview"
              sandbox="allow-scripts allow-forms allow-popups allow-modals"
              srcDoc={code}
              className="size-full border-0 bg-white"
            />
          </div>
        ) : (
          <CodeBlockCode
            code={code}
            language={language}
            streaming={streaming}
          />
        )}
      </CodeBlock>
    </TooltipProvider>
  )
}

function createMarkdownComponents(
  autoPreviewHtml: boolean,
  mediaSaveSessionId: string | null | undefined,
  mediaUrlMap: Record<string, string> | undefined,
  openLinksInWorkspace: boolean,
  streaming: boolean
): Partial<Components> {
  return {
    a: function LinkComponent(props) {
      const { href, children, node, onClick, ...anchorProps } = props
      void node

      const mappedHref = resolveMappedMediaUrl(href, mediaUrlMap)
      const openableUrl = mappedHref ? getOpenableMarkdownUrl(mappedHref) : null
      const media =
        getStudioMarkdownMediaRoute(mappedHref) ??
        (isLikelyExternalImageUrl(mappedHref)
          ? getExternalMarkdownImageRoute(mappedHref, undefined)
          : null)

      function handleClick(event: MouseEvent<HTMLAnchorElement>) {
        onClick?.(event)

        if (event.defaultPrevented || event.button !== 0) {
          return
        }

        if (
          openLinksInWorkspace &&
          mappedHref &&
          openMarkdownTargetInWorkspace(mappedHref, "link")
        ) {
          event.preventDefault()
          return
        }

        if (!openableUrl) {
          return
        }

        if (openMarkdownLink(openableUrl)) {
          event.preventDefault()
        }
      }

      if (href && media) {
        return (
          <MarkdownMediaLink
            anchorProps={anchorProps}
            href={mappedHref ?? href}
            media={media}
            onClick={onClick}
            openableUrl={openableUrl}
            openLinksInWorkspace={openLinksInWorkspace}
            saveSessionId={mediaSaveSessionId}
          >
            {children}
          </MarkdownMediaLink>
        )
      }

      return (
        <a
          {...anchorProps}
          href={mappedHref ?? href}
          target={openableUrl ? "_blank" : undefined}
          rel={openableUrl ? "noreferrer" : undefined}
          onClick={handleClick}
        >
          {children}
        </a>
      )
    },
    img: function ImageComponent(props) {
      const { src, alt, node, onClick, ...imageProps } = props
      void node
      const imageSrc = typeof src === "string" ? src : undefined
      const resolvedImageSrc = resolveMappedMediaUrl(imageSrc, mediaUrlMap)
      const media =
        getStudioMarkdownMediaRoute(resolvedImageSrc) ??
        getExternalMarkdownImageRoute(resolvedImageSrc, alt ?? undefined)

      function handleClick(event: MouseEvent<HTMLImageElement>) {
        onClick?.(event)

        if (
          event.defaultPrevented ||
          !openLinksInWorkspace ||
          !resolvedImageSrc ||
          !openMarkdownTargetInWorkspace(resolvedImageSrc, "image")
        ) {
          return
        }

        event.preventDefault()
      }

      if (media) {
        return (
          <span className="not-prose group relative my-3 block w-fit max-w-full overflow-hidden rounded-xl border bg-card shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              {...imageProps}
              src={resolvedImageSrc}
              alt={alt ?? ""}
              className={cn(
                "m-0 max-h-[min(68vh,720px)] max-w-full cursor-zoom-in object-contain",
                typeof imageProps.className === "string" &&
                  imageProps.className
              )}
              onClick={handleClick}
            />
            <span className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <MarkdownMediaActions
                media={media}
                saveSessionId={mediaSaveSessionId}
              />
            </span>
          </span>
        )
      }

      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...imageProps}
          src={resolvedImageSrc ?? src}
          alt={alt ?? ""}
          className={cn(
            "cursor-zoom-in",
            typeof imageProps.className === "string" && imageProps.className
          )}
          onClick={handleClick}
        />
      )
    },
    code: function CodeComponent({ className, children, ...props }) {
      const hasLanguage = Boolean(className?.includes("language-"))
      const isInline =
        !hasLanguage &&
        (!props.node?.position?.start.line ||
          props.node?.position?.start.line === props.node?.position?.end.line)

      if (isInline) {
        return (
          <span
            className={cn(
              "rounded-sm bg-primary-foreground px-1 font-mono text-sm",
              className
            )}
            {...props}
          >
            {children}
          </span>
        )
      }

      const language = extractLanguage(className)
      const code = String(children).replace(/\n$/, "")

      return (
        <MarkdownCodeBlock
          code={code}
          language={language}
          autoPreviewHtml={autoPreviewHtml}
          streaming={streaming}
        />
      )
    },
    pre: function PreComponent({ children }) {
      return <>{children}</>
    },
  }
}

const MarkdownBlockRenderer = memo(
  function MarkdownBlockRenderer({
    content,
    autoPreviewHtml,
    mediaSaveSessionId,
    mediaUrlMap,
    openLinksInWorkspace,
    streaming,
    components,
  }: {
    content: string
    autoPreviewHtml: boolean
    mediaSaveSessionId?: string | null
    mediaUrlMap?: Record<string, string>
    openLinksInWorkspace: boolean
    streaming: boolean
    components?: Partial<Components>
  }) {
    const markdownComponents = useMemo(
      () => ({
        ...createMarkdownComponents(
          autoPreviewHtml,
          mediaSaveSessionId,
          mediaUrlMap,
          openLinksInWorkspace,
          streaming
        ),
        ...components,
      }),
      [
        autoPreviewHtml,
        components,
        mediaSaveSessionId,
        mediaUrlMap,
        openLinksInWorkspace,
        streaming,
      ]
    )

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return (
      prevProps.content === nextProps.content &&
      prevProps.autoPreviewHtml === nextProps.autoPreviewHtml &&
      prevProps.mediaSaveSessionId === nextProps.mediaSaveSessionId &&
      prevProps.mediaUrlMap === nextProps.mediaUrlMap &&
      prevProps.openLinksInWorkspace === nextProps.openLinksInWorkspace &&
      prevProps.streaming === nextProps.streaming &&
      prevProps.components === nextProps.components
    )
  }
)

MarkdownBlockRenderer.displayName = "MarkdownBlockRenderer"

function MarkdownComponent({
  children,
  id,
  className,
  autoPreviewHtml = true,
  mediaSaveSessionId,
  mediaUrlMap,
  openLinksInWorkspace = false,
  streaming = false,
  components,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blocks = useMemo(
    () => createMarkdownRenderBlocks(children, streaming),
    [children, streaming]
  )

  return (
    <div className={className}>
      {blocks.map((block) => (
        <MarkdownBlockRenderer
          key={block.mutable ? `${blockId}-tail` : `${blockId}-${block.key}`}
          content={block.content}
          autoPreviewHtml={
            autoPreviewHtml &&
            !block.mutable &&
            isCompleteHtmlFenceBlock(block.content)
          }
          mediaSaveSessionId={mediaSaveSessionId}
          mediaUrlMap={mediaUrlMap}
          openLinksInWorkspace={openLinksInWorkspace}
          streaming={block.mutable}
          components={components}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown, MarkdownBlockRenderer }
