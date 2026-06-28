"use client"

import Image from "next/image"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { LanguageToggle } from "@/components/language-toggle"
import { ThemeToggle } from "@/components/theme-toggle"

function Navbar() {
  const { t } = useI18n()

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 w-full items-center justify-between gap-4 px-4">
        <div className="flex items-center">
          <Image
            src="https://astraflow.ucloud.cn/static/logo-lg-zh.png"
            alt="AstraFlow"
            width={140}
            height={32}
            priority
            className="h-8 w-auto"
          />
        </div>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Button variant="ghost" size="sm" asChild>
            <a href="/explore">{t("nav.explore")}</a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href="/studio">{t("nav.studio")}</a>
          </Button>

          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

          <ThemeToggle />
          <LanguageToggle />
        </nav>
      </div>
    </header>
  )
}

export { Navbar }

