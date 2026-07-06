"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import * as React from "react"
import { RiArrowLeftLine, RiSearchLine } from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"
import { Bot, KeyRound, UserRound } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { SETTINGS_RETURN_PATH_KEY } from "@/lib/settings-return-path"
import { cn } from "@/lib/utils"

type SettingsNavItem = {
  href: string
  label: string
  icon: LucideIcon | RemixiconComponentType
}

type SettingsNavGroup = {
  label: string
  items: SettingsNavItem[]
}

function SettingsNavLink({
  item,
  active,
}: {
  item: SettingsNavItem
  active: boolean
}) {
  const Icon = item.icon

  return (
    <Link
      className={cn(
        "no-drag flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        active &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
      )}
      href={item.href}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

function SettingsShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { locale, t } = useI18n()
  const [query, setQuery] = React.useState("")

  const groups: SettingsNavGroup[] = [
    {
      label: t.settingsPersonalGroup,
      items: [
        {
          href: "/settings/profile",
          label: t.settingsProfileNav,
          icon: UserRound,
        },
      ],
    },
    {
      label: t.settingsIntegrationsGroup,
      items: [
        {
          href: "/settings/api-keys",
          label: t.settingsApiKeysNav,
          icon: KeyRound,
        },
        {
          href: "/settings/agents",
          label: t.settingsAgentsNav,
          icon: Bot,
        },
      ],
    },
  ]

  const normalizedQuery = query.trim().toLowerCase()
  const visibleGroups = normalizedQuery
    ? groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            item.label.toLowerCase().includes(normalizedQuery)
          ),
        }))
        .filter((group) => group.items.length > 0)
    : groups
  const noMatches = normalizedQuery !== "" && visibleGroups.length === 0

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  function backToApp() {
    let returnPath: string | null = null

    try {
      returnPath = window.sessionStorage.getItem(SETTINGS_RETURN_PATH_KEY)
    } catch {
      returnPath = null
    }

    router.push(
      returnPath && !returnPath.startsWith("/settings") ? returnPath : "/studio"
    )
  }

  return (
    <div className="flex h-dvh min-h-0 bg-background text-foreground">
      <aside
        className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        data-electron-drag-header
      >
        <div className="h-(--titlebar-height) shrink-0" aria-hidden />

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-4">
          <button
            type="button"
            className="no-drag -ml-0.5 flex h-8 w-fit items-center gap-1.5 rounded-lg px-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            onClick={backToApp}
          >
            <RiArrowLeftLine className="size-4" aria-hidden />
            <span>{t.settingsBackToApp}</span>
          </button>

          <div className="no-drag relative">
            <RiSearchLine
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              aria-label={t.settingsSearchPlaceholder}
              className="h-8 w-full rounded-lg border border-sidebar-border bg-background/60 pr-2.5 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
              placeholder={t.settingsSearchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <nav className="no-drag flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-1">
            {visibleGroups.map((group) => (
              <div className="grid gap-0.5" key={group.label}>
                <div className="px-2.5 pb-1 text-xs text-sidebar-foreground/55">
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <SettingsNavLink
                    active={isActive(item.href)}
                    item={item}
                    key={item.href}
                  />
                ))}
              </div>
            ))}
            {noMatches ? (
              <p className="px-2.5 text-sm text-muted-foreground">
                {locale === "zh" ? "没有匹配的设置。" : "No matching settings."}
              </p>
            ) : null}
          </nav>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 pt-14 pb-20 lg:px-10">
          {children}
        </div>
      </main>
    </div>
  )
}

export { SettingsShell }
