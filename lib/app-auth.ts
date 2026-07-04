import { redirect } from "next/navigation"
import { NextResponse } from "next/server"

import { getStudioModelverseApiKey } from "@/lib/studio-db"
import { ensureValidStudioOAuthTokens } from "@/lib/ucloud-oauth"

const MUTATING_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"])
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])
const ELECTRON_APP_PROTOCOLS = new Set(["app:", "electron:"])

function isLoopbackHost(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

function defaultPort(protocol: string) {
  if (protocol === "http:") {
    return "80"
  }

  if (protocol === "https:") {
    return "443"
  }

  return ""
}

function effectivePort(url: URL) {
  return url.port || defaultPort(url.protocol)
}

function isAllowedRequestSource(source: string, requestUrl: URL) {
  let sourceUrl: URL

  try {
    sourceUrl = new URL(source)
  } catch {
    return false
  }

  if (ELECTRON_APP_PROTOCOLS.has(sourceUrl.protocol)) {
    return true
  }

  if (sourceUrl.protocol !== requestUrl.protocol) {
    return false
  }

  return (
    isLoopbackHost(sourceUrl.hostname) &&
    isLoopbackHost(requestUrl.hostname) &&
    effectivePort(sourceUrl) === effectivePort(requestUrl)
  )
}

export function requireSameOriginRequest(request: Request) {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) {
    return null
  }

  const origin = request.headers.get("origin")?.trim()
  const referer = request.headers.get("referer")?.trim()

  if (!origin && !referer) {
    return null
  }

  let requestUrl: URL

  try {
    requestUrl = new URL(request.url)
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request URL." },
      { status: 403 }
    )
  }

  if (
    (origin && !isAllowedRequestSource(origin, requestUrl)) ||
    (referer && !isAllowedRequestSource(referer, requestUrl))
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid request origin." },
      { status: 403 }
    )
  }

  return null
}

export async function getAppAuthState() {
  const tokens = await ensureValidStudioOAuthTokens()
  const modelverseApiKey = getStudioModelverseApiKey()

  return {
    oauthConfigured: Boolean(tokens?.accessToken),
    apiKeyConfigured: Boolean(modelverseApiKey?.key),
    authenticated: Boolean(tokens?.accessToken),
  }
}

export async function requireAppAuth() {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    redirect("/login")
  }

  return auth
}

export async function requireAuthenticatedRequest(request?: Request) {
  if (request) {
    const originError = requireSameOriginRequest(request)

    if (originError) {
      return originError
    }
  }

  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  return null
}
