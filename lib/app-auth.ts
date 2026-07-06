import { redirect } from "next/navigation"
import { NextResponse } from "next/server"

import {
  getStudioAstraFlowApiKeySessionStatus,
  getStudioModelverseApiKey,
} from "@/lib/studio-db"
import { ensureValidStudioOAuthTokens } from "@/lib/ucloud-oauth"

const MUTATING_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"])
const LOOPBACK_HOSTS = new Set([
  "0.0.0.0",
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1",
])
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

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() ?? ""
}

function isPrivateIpv4Host(hostname: string) {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10))

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false
  }

  const [first, second] = parts

  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}

function isLocalDevelopmentHost(hostname: string) {
  const normalized = hostname.toLowerCase()

  return (
    isLoopbackHost(normalized) ||
    isPrivateIpv4Host(normalized) ||
    normalized.endsWith(".local")
  )
}

function isDevelopmentLocalPair(sourceUrl: URL, requestUrl: URL) {
  if (process.env.NODE_ENV === "production") {
    return false
  }

  return (
    sourceUrl.protocol === requestUrl.protocol &&
    effectivePort(sourceUrl) === effectivePort(requestUrl) &&
    isLocalDevelopmentHost(sourceUrl.hostname) &&
    isLocalDevelopmentHost(requestUrl.hostname)
  )
}

function isExactSameOrigin(sourceUrl: URL, requestUrl: URL) {
  return (
    sourceUrl.protocol === requestUrl.protocol &&
    sourceUrl.hostname.toLowerCase() === requestUrl.hostname.toLowerCase() &&
    effectivePort(sourceUrl) === effectivePort(requestUrl)
  )
}

function requestOriginCandidates(request: Request, requestUrl: URL) {
  const candidates = [requestUrl]
  const forwardedProto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ||
    requestUrl.protocol.replace(/:$/, "")
  const hosts = [
    firstHeaderValue(request.headers.get("x-forwarded-host")),
    firstHeaderValue(request.headers.get("host")),
  ].filter(Boolean)

  for (const host of hosts) {
    try {
      candidates.push(new URL(`${forwardedProto}://${host}`))
    } catch {
      // Ignore malformed proxy host headers and continue validating the rest.
    }
  }

  return candidates
}

function isAllowedRequestSource(source: string, requestOriginUrls: URL[]) {
  let sourceUrl: URL

  try {
    sourceUrl = new URL(source)
  } catch {
    return false
  }

  if (
    requestOriginUrls.some(
      (requestUrl) =>
        isExactSameOrigin(sourceUrl, requestUrl) ||
        isDevelopmentLocalPair(sourceUrl, requestUrl)
    )
  ) {
    return true
  }

  if (ELECTRON_APP_PROTOCOLS.has(sourceUrl.protocol)) {
    return true
  }

  return requestOriginUrls.some(
    (requestUrl) =>
      sourceUrl.protocol === requestUrl.protocol &&
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
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase()

  if (fetchSite === "same-origin") {
    return null
  }

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

  const requestOriginUrls = requestOriginCandidates(request, requestUrl)

  if (
    (origin && !isAllowedRequestSource(origin, requestOriginUrls)) ||
    (referer && !isAllowedRequestSource(referer, requestOriginUrls))
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
  const astraFlowApiKeySession = getStudioAstraFlowApiKeySessionStatus()
  const modelverseApiKey = getStudioModelverseApiKey()

  return {
    oauthConfigured: Boolean(tokens?.accessToken),
    apiKeyConfigured: Boolean(modelverseApiKey?.key),
    astraFlowApiKeyAuthenticated: astraFlowApiKeySession.authenticated,
    authenticated:
      Boolean(tokens?.accessToken) || astraFlowApiKeySession.authenticated,
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
