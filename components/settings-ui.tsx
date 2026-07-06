"use client"

import * as React from "react"
import { RiLoader4Line } from "@remixicon/react"

import { cn } from "@/lib/utils"

// Shared building blocks for the full-screen settings surface. Every settings
// page is composed from the same three primitives so the whole area reads as
// one system: a page header, titled sections, and hairline-divided rows with
// the control pinned to the right.

function SettingsPage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex w-full flex-col gap-10", className)} {...props} />
  )
}

function SettingsPageHeader({
  title,
  description,
  busy = false,
}: {
  title: string
  description?: string
  busy?: boolean
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <RiLoader4Line
        aria-hidden
        className={cn(
          "mt-1.5 size-4 shrink-0 animate-spin text-muted-foreground transition-opacity",
          busy ? "opacity-100" : "opacity-0"
        )}
      />
    </header>
  )
}

function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("grid gap-2.5", className)}>
      {title || action ? (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
            {description ? (
              <p className="mt-0.5 text-[0.8125rem]/5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {action ? (
            <div className="flex shrink-0 items-center gap-2">{action}</div>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <div className="divide-y divide-border/60">{children}</div>
      </div>
    </section>
  )
}

function SettingsRow({
  label,
  description,
  children,
  className,
}: {
  label: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-12 items-center justify-between gap-6 px-4 py-2.5",
        className
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[0.8125rem]/5 text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {children}
        </div>
      ) : null}
    </div>
  )
}

// A read-only fact row: muted label on the left, selectable value on the
// right. Used for account/project metadata instead of stat-tile grids.
function SettingsValueRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-6 px-4 py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-sm select-text",
          mono && "font-mono text-[0.8125rem]"
        )}
      >
        {value}
      </span>
    </div>
  )
}

function SettingsEmptyRow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 px-4 py-10 text-center text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}

export {
  SettingsEmptyRow,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsValueRow,
}
