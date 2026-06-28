"use client"

import * as React from "react"
import { RiMoonLine, RiSunLine } from "@remixicon/react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const { t } = useI18n()
  // Avoid SSR/client hydration mismatch without setState-in-effect.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  const isDark = resolvedTheme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t.toggleTheme}
      title={t.toggleTheme}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted && isDark ? <RiSunLine /> : <RiMoonLine />}
    </Button>
  )
}

export { ThemeToggle }
