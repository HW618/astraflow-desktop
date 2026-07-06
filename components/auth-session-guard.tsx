"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

type OAuthStatusResponse =
  | {
      ok: true
      data: {
        auth: {
          configured: boolean
          expiresAt: number | null
        }
      }
    }
  | {
      ok: false
    }

type AuthFetchPatchState = {
  originalFetch: typeof window.fetch
  onUnauthorized: (() => void) | null
}

declare global {
  interface Window {
    __astraflowAuthFetchPatch__?: AuthFetchPatchState
  }
}

const DEFAULT_SESSION_CHECK_INTERVAL_MS = 60_000
const MIN_SESSION_CHECK_INTERVAL_MS = 2_000

function isLoginPath(pathname: string) {
  return pathname === "/login"
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

function isSameOriginApiRequest(input: RequestInfo | URL) {
  try {
    const url = new URL(requestUrl(input), window.location.href)
    return url.origin === window.location.origin && url.pathname.startsWith("/api/")
  } catch {
    return false
  }
}

function installAuthFetchPatch(onUnauthorized: () => void) {
  let state = window.__astraflowAuthFetchPatch__

  if (!state) {
    const originalFetch = window.fetch.bind(window)

    state = {
      originalFetch,
      onUnauthorized,
    }
    window.__astraflowAuthFetchPatch__ = state
    const patchState = state

    window.fetch = async (input, init) => {
      const response = await patchState.originalFetch(input, init)

      if (response.status === 401 && isSameOriginApiRequest(input)) {
        patchState.onUnauthorized?.()
      }

      return response
    }
  } else {
    state.onUnauthorized = onUnauthorized
  }

  return () => {
    const currentState = window.__astraflowAuthFetchPatch__

    if (currentState?.onUnauthorized === onUnauthorized) {
      currentState.onUnauthorized = null
    }
  }
}

function nextSessionCheckDelay(expiresAt: number | null) {
  if (!expiresAt) {
    return DEFAULT_SESSION_CHECK_INTERVAL_MS
  }

  return Math.min(
    DEFAULT_SESSION_CHECK_INTERVAL_MS,
    Math.max(MIN_SESSION_CHECK_INTERVAL_MS, expiresAt - Date.now() + 500)
  )
}

function AuthSessionGuard() {
  const pathname = usePathname()
  const redirectingRef = React.useRef(false)
  const protectedRoute = !isLoginPath(pathname)

  const redirectToLogin = React.useCallback(() => {
    if (redirectingRef.current || isLoginPath(window.location.pathname)) {
      return
    }

    redirectingRef.current = true
    window.location.replace("/login")
  }, [])

  React.useEffect(() => {
    if (!protectedRoute) {
      return
    }

    return installAuthFetchPatch(redirectToLogin)
  }, [protectedRoute, redirectToLogin])

  React.useEffect(() => {
    if (!protectedRoute) {
      return
    }

    let cancelled = false
    let timer: number | null = null
    let inFlight = false

    function clearTimer() {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }

    function scheduleNextCheck(expiresAt: number | null) {
      clearTimer()
      timer = window.setTimeout(checkSession, nextSessionCheckDelay(expiresAt))
    }

    async function checkSession() {
      if (cancelled || inFlight) {
        return
      }

      inFlight = true

      try {
        const response = await fetch("/api/studio/oauth/status", {
          cache: "no-store",
        })

        if (cancelled) {
          return
        }

        if (response.status === 401) {
          redirectToLogin()
          return
        }

        const payload = (await response.json()) as OAuthStatusResponse

        if (!payload.ok || !payload.data.auth.configured) {
          redirectToLogin()
          return
        }

        scheduleNextCheck(payload.data.auth.expiresAt)
      } catch {
        scheduleNextCheck(null)
      } finally {
        inFlight = false
      }
    }

    function checkWhenVisible() {
      if (document.visibilityState === "visible") {
        void checkSession()
      }
    }

    void checkSession()
    window.addEventListener("focus", checkSession)
    document.addEventListener("visibilitychange", checkWhenVisible)

    return () => {
      cancelled = true
      clearTimer()
      window.removeEventListener("focus", checkSession)
      document.removeEventListener("visibilitychange", checkWhenVisible)
    }
  }, [protectedRoute, redirectToLogin])

  return null
}

export { AuthSessionGuard }
