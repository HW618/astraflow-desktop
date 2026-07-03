"use client"

import * as React from "react"

import { defaultLocale, dictionaries, locales, type Locale } from "@/lib/i18n"

const STORAGE_KEY = "astraflow-locale"

function isLocale(value: string | null): value is Locale {
  return value !== null && (locales as readonly string[]).includes(value)
}

function readSystemLocale(): Locale {
  if (typeof window === "undefined") {
    return defaultLocale
  }

  const browserLocales = [
    ...window.navigator.languages,
    window.navigator.language,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ]

  return browserLocales.some((value) =>
    value.toLowerCase().startsWith("zh")
  )
    ? "zh"
    : "en"
}

let currentLocale: Locale = defaultLocale
let initialized = false
const listeners = new Set<() => void>()

function syncDocumentLocale() {
  if (typeof document !== "undefined") {
    document.documentElement.lang = currentLocale
  }
}

function readStored(): Locale {
  if (typeof window === "undefined") {
    return defaultLocale
  }
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isLocale(stored) ? stored : readSystemLocale()
}

function subscribe(listener: () => void) {
  if (!initialized) {
    initialized = true
    currentLocale = readStored()
  }
  syncDocumentLocale()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setLocale(next: Locale) {
  if (next === currentLocale) {
    return
  }
  currentLocale = next
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next)
    syncDocumentLocale()
  }
  listeners.forEach((listener) => listener())
}

// Passthrough wrapper so the provider can host future locale-scoped context.
function I18nProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function useI18n() {
  const locale = React.useSyncExternalStore(
    subscribe,
    () => currentLocale,
    () => defaultLocale
  )

  return React.useMemo(
    () => ({
      locale,
      setLocale,
      t: dictionaries[locale],
    }),
    [locale]
  )
}

export { I18nProvider, useI18n }
