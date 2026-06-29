"use client"

import {
  RiCheckLine,
  RiCodeLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiPlayLine,
} from "@remixicon/react"
import { marked } from "marked"
import { memo, useId, useMemo, useState } from "react"
import ReactMarkdown, { Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"

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
import { cn } from "@/lib/utils"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  autoPreviewHtml?: boolean
  components?: Partial<Components>
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown)
  return tokens.map((token) => token.raw)
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

function isCompleteHtmlFenceBlock(block: string) {
  const opener = block.match(/^(?: {0,3})([`~]{3,})([^\n]*)\n/)

  if (!opener) {
    return false
  }

  const fence = opener[1]
  const language = opener[2].trim().split(/\s+/)[0] ?? ""

  if (!isHtmlLanguage(language)) {
    return false
  }

  const lines = block.replace(/\n$/, "").split("\n")
  const closingLine = lines.at(-1)?.trim() ?? ""
  const fenceCharacter = fence[0]

  return (
    closingLine.length >= fence.length &&
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

function MarkdownCodeBlock({
  code,
  language,
  autoPreviewHtml,
}: {
  code: string
  language: string
  autoPreviewHtml: boolean
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
          <CodeBlockCode code={code} language={language} />
        )}
      </CodeBlock>
    </TooltipProvider>
  )
}

function createMarkdownComponents(autoPreviewHtml: boolean): Partial<Components> {
  return {
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
              "bg-primary-foreground rounded-sm px-1 font-mono text-sm",
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
        />
      )
    },
    pre: function PreComponent({ children }) {
      return <>{children}</>
    },
  }
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    autoPreviewHtml,
    components,
  }: {
    content: string
    autoPreviewHtml: boolean
    components?: Partial<Components>
  }) {
    const markdownComponents = useMemo(
      () => components ?? createMarkdownComponents(autoPreviewHtml),
      [autoPreviewHtml, components]
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
      prevProps.components === nextProps.components
    )
  }
)

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock"

function MarkdownComponent({
  children,
  id,
  className,
  autoPreviewHtml = true,
  components,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children])

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          autoPreviewHtml={autoPreviewHtml && isCompleteHtmlFenceBlock(block)}
          components={components}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
