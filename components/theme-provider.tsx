"use client"

import * as React from "react"

type Theme = "light" | "dark" | "system"
type ResolvedTheme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  enableSystem?: boolean
  storageKey?: string
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)
const THEME_STORAGE_KEY = "theme"
const themeListeners = new Set<() => void>()
let themeSnapshot: Omit<ThemeContextValue, "setTheme"> = {
  theme: "system",
  resolvedTheme: "light",
}

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system"
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function resolveTheme(theme: Theme, enableSystem: boolean): ResolvedTheme {
  if (theme === "system") {
    return enableSystem ? getSystemTheme() : "light"
  }

  return theme
}

function applyDocumentTheme(theme: Theme, enableSystem: boolean) {
  const resolvedTheme = resolveTheme(theme, enableSystem)
  const root = document.documentElement

  root.classList.toggle("dark", resolvedTheme === "dark")
  root.style.colorScheme = resolvedTheme

  return resolvedTheme
}

function readStoredTheme(storageKey: string, defaultTheme: Theme) {
  try {
    const storedTheme = window.localStorage.getItem(storageKey)

    return isTheme(storedTheme) ? storedTheme : defaultTheme
  } catch {
    return defaultTheme
  }
}

function persistTheme(storageKey: string, theme: Theme) {
  try {
    window.localStorage.setItem(storageKey, theme)
  } catch {
    // Storage can be unavailable in private or locked-down contexts.
  }
}

function updateThemeSnapshot(nextSnapshot: typeof themeSnapshot) {
  if (
    themeSnapshot.theme === nextSnapshot.theme &&
    themeSnapshot.resolvedTheme === nextSnapshot.resolvedTheme
  ) {
    return
  }

  themeSnapshot = nextSnapshot
  themeListeners.forEach((listener) => listener())
}

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener)

  return () => {
    themeListeners.delete(listener)
  }
}

function getThemeSnapshot() {
  return themeSnapshot
}

function getServerThemeSnapshot() {
  return themeSnapshot
}

function initializeTheme(
  storageKey: string,
  defaultTheme: Theme,
  enableSystem: boolean
) {
  const initialTheme = readStoredTheme(storageKey, defaultTheme)

  updateThemeSnapshot({
    theme: initialTheme,
    resolvedTheme: applyDocumentTheme(initialTheme, enableSystem),
  })
}

function ThemeProvider({
  children,
  defaultTheme = "system",
  enableSystem = true,
  storageKey = THEME_STORAGE_KEY,
}: ThemeProviderProps) {
  const snapshot = React.useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  )

  React.useEffect(() => {
    initializeTheme(storageKey, defaultTheme, enableSystem)
  }, [defaultTheme, enableSystem, storageKey])

  React.useEffect(() => {
    if (!enableSystem || snapshot.theme !== "system") {
      return
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      updateThemeSnapshot({
        theme: "system",
        resolvedTheme: applyDocumentTheme("system", true),
      })
    }

    media.addEventListener("change", onChange)

    return () => {
      media.removeEventListener("change", onChange)
    }
  }, [enableSystem, snapshot.theme])

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      persistTheme(storageKey, nextTheme)
      updateThemeSnapshot({
        theme: nextTheme,
        resolvedTheme: applyDocumentTheme(nextTheme, enableSystem),
      })
    },
    [enableSystem, storageKey]
  )

  const value = React.useMemo(
    () => ({
      theme: snapshot.theme,
      resolvedTheme: snapshot.resolvedTheme,
      setTheme,
    }),
    [setTheme, snapshot.resolvedTheme, snapshot.theme]
  )

  return (
    <ThemeContext.Provider value={value}>
      <ThemeHotkey />
      {children}
    </ThemeContext.Provider>
  )
}

function useTheme() {
  const value = React.useContext(ThemeContext)

  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider.")
  }

  return value
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider, useTheme }
