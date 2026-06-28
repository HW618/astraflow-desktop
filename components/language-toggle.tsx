"use client"

import { RiTranslate2 } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { localeLabels } from "@/lib/i18n"

function LanguageToggle() {
  const { locale, setLocale, t } = useI18n()
  const next = locale === "en" ? "zh" : "en"

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t.toggleLanguage}
      title={t.toggleLanguage}
      onClick={() => setLocale(next)}
    >
      <RiTranslate2 data-icon="inline-start" />
      {localeLabels[locale]}
    </Button>
  )
}

export { LanguageToggle }
