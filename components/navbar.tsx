"use client"

import Image from "next/image"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { LanguageToggle } from "@/components/language-toggle"
import { LogoutButton } from "@/components/logout-button"
import { ThemeToggle } from "@/components/theme-toggle"

function Navbar() {
  const { t } = useI18n()

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 w-full items-center justify-between gap-4 px-4">
        <div className="flex items-center lg:pl-2">
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
            <Link href="/explore">{t.explore}</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/studio">{t.studio}</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/files">{t.files}</Link>
          </Button>

          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

          <ThemeToggle />
          <LanguageToggle />
          <LogoutButton />
        </nav>
      </div>
    </header>
  )
}

export { Navbar }
