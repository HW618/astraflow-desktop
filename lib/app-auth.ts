import { redirect } from "next/navigation"

import { getStudioModelverseApiKey } from "@/lib/studio-db"
import { ensureValidStudioOAuthTokens } from "@/lib/ucloud-oauth"

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
