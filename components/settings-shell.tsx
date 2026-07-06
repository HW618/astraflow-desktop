"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  RiArrowLeftLine,
  RiKey2Line,
  RiRobot2Line,
  RiSearchLine,
  RiUser3Line,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type SettingsNavItem = {
  href: string
  label: string
  icon: RemixiconComponentType
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
        "no-drag flex h-10 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground",
        active && "bg-background text-foreground shadow-sm ring-1 ring-border/70"
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
  const { t } = useI18n()

  const personalItems: SettingsNavItem[] = [
    {
      href: "/settings/profile",
      label: t.settingsProfileNav,
      icon: RiUser3Line,
    },
    {
      href: "/settings/account",
      label: t.settingsAccountNav,
      icon: RiUser3Line,
    },
  ]
  const integrationItems: SettingsNavItem[] = [
    {
      href: "/settings/api-keys",
      label: t.settingsApiKeysNav,
      icon: RiKey2Line,
    },
    {
      href: "/settings/agents",
      label: t.settingsAgentsNav,
      icon: RiRobot2Line,
    },
  ]

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  function backToApp() {
    if (window.history.length > 1) {
      router.back()
      return
    }

    router.push("/studio")
  }

  return (
    <div className="flex h-dvh min-h-0 bg-background text-foreground">
      <aside
        className="flex w-72 shrink-0 flex-col border-r bg-muted/55"
        data-electron-drag-header
      >
        <div className="flex min-h-0 flex-1 flex-col gap-5 px-4 pt-4 pb-5">
          <button
            type="button"
            className="no-drag flex h-10 w-fit items-center gap-2 rounded-2xl px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            onClick={backToApp}
          >
            <RiArrowLeftLine className="size-4" aria-hidden />
            <span>{t.settingsBackToApp}</span>
          </button>

          <div className="no-drag relative">
            <RiSearchLine
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label={t.settingsSearchPlaceholder}
              className="h-9 rounded-2xl bg-background/80 pl-9"
              placeholder={t.settingsSearchPlaceholder}
              readOnly
            />
          </div>

          <nav className="grid gap-5">
            <div className="grid gap-1.5">
              <div className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t.settingsPersonalGroup}
              </div>
              {personalItems.map((item) => (
                <SettingsNavLink
                  active={isActive(item.href)}
                  item={item}
                  key={item.href}
                />
              ))}
            </div>

            <div className="grid gap-1.5">
              <div className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t.settingsIntegrationsGroup}
              </div>
              {integrationItems.map((item) => (
                <SettingsNavLink
                  active={isActive(item.href)}
                  item={item}
                  key={item.href}
                />
              ))}
            </div>
          </nav>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-5 py-8 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}

export { SettingsShell }
