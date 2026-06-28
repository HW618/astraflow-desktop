"use client"

import * as React from "react"
import Link from "next/link"
import {
  RiDownloadLine,
  RiSearchLine,
  RiSparkling2Line,
} from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { StudioLibraryFile } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

type FileLibraryPageProps = {
  files: StudioLibraryFile[]
}

function getLocaleTag(locale: string) {
  return locale === "zh" ? "zh-CN" : "en-US"
}

function formatSavedTime(value: string, locale: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatDimensions(file: StudioLibraryFile) {
  if (!file.width || !file.height) {
    return null
  }

  return `${file.width} x ${file.height}`
}

function formatMimeType(mimeType: string | null) {
  if (!mimeType) {
    return "Image"
  }

  const subtype = mimeType.split("/")[1]?.split("+")[0]

  return subtype ? subtype.toUpperCase() : mimeType
}

function getFileSearchText(file: StudioLibraryFile) {
  return [
    file.prompt,
    file.modelName,
    file.manufacturer,
    file.mimeType,
    formatDimensions(file),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function FileLibraryPage({ files }: FileLibraryPageProps) {
  const { locale, t } = useI18n()
  const [query, setQuery] = React.useState("")
  const normalizedQuery = query.trim().toLowerCase()

  const filteredFiles = React.useMemo(() => {
    if (!normalizedQuery) {
      return files
    }

    return files.filter((file) =>
      getFileSearchText(file).includes(normalizedQuery)
    )
  }, [files, normalizedQuery])

  return (
    <main className="flex h-[calc(100vh-4rem)] min-h-0 flex-col bg-background">
      <header className="shrink-0 border-b px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading text-xl font-semibold tracking-normal">
              {t.fileLibraryTitle}
            </h1>
          </div>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b bg-background px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-80">
              <RiSearchLine
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.fileLibrarySearch}
                className="h-9 pl-8"
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {t.fileLibrarySummary(filteredFiles.length, files.length)}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {files.length === 0 ? (
            <LibraryEmptyState
              title={t.fileLibraryEmpty}
              actionLabel={t.fileLibraryCreate}
              actionHref="/studio"
            />
          ) : filteredFiles.length === 0 ? (
            <LibraryEmptyState title={t.fileLibraryNoMatches} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3 lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
              {filteredFiles.map((file) => (
                <LibraryFileCard key={file.id} file={file} locale={locale} />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

function LibraryEmptyState({
  title,
  actionLabel,
  actionHref,
}: {
  title: string
  actionLabel?: string
  actionHref?: string
}) {
  return (
    <div className="flex min-h-full items-center justify-center py-12">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <RiSparkling2Line className="size-5" aria-hidden />
        </div>
        <p className="text-sm font-medium">{title}</p>
        {actionLabel && actionHref ? (
          <Button asChild size="sm" className="mt-4">
            <Link href={actionHref}>{actionLabel}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function LibraryFileCard({
  file,
  locale,
}: {
  file: StudioLibraryFile
  locale: string
}) {
  const { t } = useI18n()
  const dimensions = formatDimensions(file)
  const details = [formatMimeType(file.mimeType), dimensions].filter(Boolean)

  return (
    <article className="group flex min-w-0 shrink-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="relative aspect-square bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={file.src}
          alt={file.prompt}
          loading="lazy"
          className="size-full object-contain"
        />
        <div className="absolute top-2 left-2">
          <Badge
            variant="secondary"
            className="bg-background/85 text-foreground shadow-sm backdrop-blur"
          >
            {t.fileLibraryImage}
          </Badge>
        </div>
        <div
          className={cn(
            "absolute right-2 bottom-2 flex opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-within:opacity-100"
          )}
        >
          <Button
            asChild
            size="sm"
            className="h-8 rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background"
          >
            <a href={file.downloadUrl} download>
              <RiDownloadLine aria-hidden />
              <span>{t.fileLibraryDownload}</span>
            </a>
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 min-h-10 text-sm leading-5 font-medium">
          {file.prompt}
        </p>
        <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{file.modelName}</span>
          <span className="shrink-0">
            {formatSavedTime(file.savedAt, locale)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {details.map((detail) => (
            <Badge key={detail} variant="outline">
              {detail}
            </Badge>
          ))}
        </div>
      </div>
    </article>
  )
}

export { FileLibraryPage }
