"use client"

import * as React from "react"

import {
  defaultLocale,
  locales,
  translations,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n"

const STORAGE_KEY = "astraflow-locale"

function isLocale(value: string | null): value is Locale {
  return value !== null && (locales as readonly string[]).includes(value)
}

let currentLocale: Locale = defaultLocale
let initialized = false
const listeners = new Set<() => void>()

function readStored(): Locale {
  if (typeof window === "undefined") {
    return defaultLocale
  }
  return isLocale(window.localStorage.getItem(STORAGE_KEY))
    ? (window.localStorage.getItem(STORAGE_KEY) as Locale)
    : defaultLocale
}

function subscribe(listener: () => void) {
  if (!initialized) {
    initialized = true
    currentLocale = readStored()
    document.documentElement.lang = currentLocale
  }
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
    document.documentElement.lang = next
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
      t: (key: TranslationKey) =>
        translations[locale][key] ?? translations[defaultLocale][key],
    }),
    [locale]
  )
}

export { I18nProvider, useI18n }
