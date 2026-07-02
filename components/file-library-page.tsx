"use client"

import * as React from "react"
import Link from "next/link"
import {
  RiDownloadLine,
  RiFileTextLine,
  RiFolderLine,
  RiMicLine,
  RiSearchLine,
  RiSparkling2Line,
} from "@remixicon/react"
import { toast } from "sonner"

import {
  AudioPlayer,
  AudioPlayerControlBar,
  AudioPlayerDurationDisplay,
  AudioPlayerElement,
  AudioPlayerMuteButton,
  AudioPlayerPlayButton,
  AudioPlayerTimeDisplay,
  AudioPlayerTimeRange,
} from "@/components/ai-elements/audio-player"
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
  if (file.kind !== "image" && file.kind !== "video") {
    return null
  }

  if (!file.width || !file.height) {
    return null
  }

  return `${file.width} x ${file.height}`
}

function formatDuration(file: StudioLibraryFile) {
  if (
    (file.kind !== "audio" && file.kind !== "video") ||
    !file.durationSeconds
  ) {
    return null
  }

  const totalSeconds = Math.max(0, Math.round(file.durationSeconds))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, "0")

  return `${minutes}:${seconds}`
}

function formatMimeType(file: StudioLibraryFile) {
  const { mimeType } = file

  if (!mimeType) {
    if (file.kind === "audio") {
      return "Audio"
    }

    if (file.kind === "video") {
      return "Video"
    }

    if (file.kind === "image") {
      return "Image"
    }

    return "File"
  }

  const subtype = mimeType.split("/")[1]?.split("+")[0]

  return subtype ? subtype.toUpperCase() : mimeType
}

function getFileSearchText(file: StudioLibraryFile) {
  return [
    file.kind,
    file.prompt,
    file.modelName,
    file.manufacturer,
    file.kind === "video" ? file.providerTaskId : null,
    file.kind === "video" ? file.providerRequestId : null,
    file.kind === "file" ? file.name : null,
    file.kind === "file" ? file.sandboxPath : null,
    file.mimeType,
    formatDimensions(file),
    formatDuration(file),
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
  const [isOpeningFolder, setIsOpeningFolder] = React.useState(false)
  const dimensions = formatDimensions(file)
  const duration = formatDuration(file)
  const details = [formatMimeType(file), dimensions, duration].filter(
    (detail): detail is string => Boolean(detail)
  )
  const fileSize =
    file.kind === "file" && typeof file.size === "number"
      ? formatFileSize(file.size)
      : null
  const kindLabel =
    file.kind === "audio"
      ? t.fileLibraryAudio
      : file.kind === "video"
        ? t.fileLibraryVideo
        : file.kind === "image"
          ? t.fileLibraryImage
          : t.fileLibraryFile
  const canOpenFolder = Boolean(file.canOpenFolder)

  async function handleOpenFolder() {
    if (!canOpenFolder || isOpeningFolder) {
      return
    }

    setIsOpeningFolder(true)

    try {
      const response = await fetch("/api/studio/files/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: file.kind, id: file.id }),
      })

      if (!response.ok) {
        throw new Error(t.fileLibraryOpenFolderFailed)
      }
    } catch {
      toast.error(t.fileLibraryOpenFolderFailed)
    } finally {
      setIsOpeningFolder(false)
    }
  }

  return (
    <article className="group flex min-w-0 shrink-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="relative aspect-square bg-muted">
        <LibraryMediaPreview file={file} />
        <div className="absolute top-2 left-2">
          <Badge
            variant="secondary"
            className="bg-background/85 text-foreground shadow-sm backdrop-blur"
          >
            {kindLabel}
          </Badge>
        </div>
        <div
          className={cn(
            "absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity",
            "group-focus-within:opacity-100 group-hover:opacity-100"
          )}
        >
          {canOpenFolder ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={handleOpenFolder}
              disabled={isOpeningFolder}
              title={t.fileLibraryOpenFolder}
              aria-label={t.fileLibraryOpenFolder}
              className="size-8 rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background"
            >
              <RiFolderLine aria-hidden />
            </Button>
          ) : null}
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
          {fileSize ? <Badge variant="outline">{fileSize}</Badge> : null}
        </div>
      </div>
    </article>
  )
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function LibraryMediaPreview({ file }: { file: StudioLibraryFile }) {
  if (file.kind === "image") {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={file.src}
          alt={file.prompt}
          loading="lazy"
          className="size-full object-contain"
        />
      </>
    )
  }

  if (file.kind === "video") {
    return (
      <video
        src={file.src}
        controls
        preload="metadata"
        className="size-full object-contain"
      />
    )
  }

  if (file.kind === "file") {
    return (
      <div className="flex size-full items-center justify-center p-5">
        <div className="flex min-w-0 flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm">
            <RiFileTextLine className="size-6" aria-hidden />
          </div>
          <span className="line-clamp-3 max-w-full text-xs break-words text-muted-foreground">
            {file.name}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex size-full items-center justify-center p-3">
      <div className="flex w-full min-w-0 flex-col items-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm">
          <RiMicLine className="size-5" aria-hidden />
        </div>
        <AudioPlayer className="w-full max-w-full min-w-0 rounded-lg border bg-background px-2 py-2">
          <AudioPlayerElement src={file.src} preload="metadata" />
          <AudioPlayerControlBar className="w-full max-w-full min-w-0 [&>[data-slot=button-group]]:w-full [&>[data-slot=button-group]]:min-w-0">
            <AudioPlayerPlayButton />
            <AudioPlayerTimeDisplay className="hidden sm:flex" />
            <AudioPlayerTimeRange className="min-w-0 flex-1 basis-0" />
            <AudioPlayerDurationDisplay className="hidden sm:flex" />
            <AudioPlayerMuteButton className="shrink-0" />
          </AudioPlayerControlBar>
        </AudioPlayer>
      </div>
    </div>
  )
}

export { FileLibraryPage }
