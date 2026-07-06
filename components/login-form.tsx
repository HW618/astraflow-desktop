"use client"

import * as React from "react"
import {
  RiArrowRightLine,
  RiExternalLinkLine,
  RiLoader4Line,
} from "@remixicon/react"

import { AstraFlowLogo } from "@/components/astraflow-logo"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { navigateOAuthPopup, openOAuthPopupShell } from "@/lib/oauth-popup"

type OAuthStatus = {
  configured: boolean
  email: string | null
  expiresAt: number | null
  updatedAt: string | null
}

type OAuthFlowSnapshot = {
  state: string
  status: "pending" | "complete" | "error"
  authorizationUrl: string
  redirectUri: string
  port: number
  message: string | null
}

type OAuthStatusResponse =
  | {
      ok: true
      data: {
        auth: OAuthStatus
        flow: OAuthFlowSnapshot | null
      }
    }
  | {
      ok: false
      message?: string
    }

type OAuthStartResponse =
  | {
      ok: true
      data: OAuthFlowSnapshot
    }
  | {
      ok: false
      message?: string
    }

type OAuthCompleteResponse =
  | {
      ok: true
      data: {
        auth: OAuthStatus
        flow: OAuthFlowSnapshot
        message: string
      }
    }
  | {
      ok: false
      message?: string
    }

type ModelverseApiKeyOption = {
  id: string
  name: string
}

type ModelverseApiKeysResponse =
  | {
      ok: true
      data: {
        projectId: string
        items: ModelverseApiKeyOption[]
        selected: ModelverseApiKeyOption | null
      }
    }
  | {
      ok: false
      message?: string
    }

type SaveModelverseApiKeyResponse =
  | {
      ok: true
      data: {
        projectId: string
        selected: ModelverseApiKeyOption
      }
    }
  | {
      ok: false
      message?: string
    }

function formatExpiry(expiresAt: number | null) {
  if (!expiresAt) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(expiresAt)
}

async function fetchOAuthStatus(state?: string) {
  const search = state ? `?state=${encodeURIComponent(state)}` : ""
  const response = await fetch(`/api/studio/oauth/status${search}`)
  const payload = (await response.json()) as OAuthStatusResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to load login status."
    )
  }

  return payload.data
}

async function startOAuthFlow() {
  const response = await fetch("/api/studio/oauth/start", { method: "POST" })
  const payload = (await response.json()) as OAuthStartResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to start UCloud login."
    )
  }

  return payload.data
}

async function completeOAuthFlow(callbackUrl: string) {
  const response = await fetch("/api/studio/oauth/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callbackUrl }),
  })
  const payload = (await response.json()) as OAuthCompleteResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to complete UCloud login."
    )
  }

  return payload.data
}

async function fetchModelverseApiKeys() {
  const response = await fetch("/api/studio/modelverse-api-keys")
  const payload = (await response.json()) as ModelverseApiKeysResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to load Modelverse API keys."
    )
  }

  return payload.data
}

async function saveModelverseApiKey(apiKeyId: string, projectId: string) {
  const response = await fetch("/api/studio/modelverse-api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKeyId, projectId }),
  })
  const payload = (await response.json()) as SaveModelverseApiKeyResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to save Modelverse API key."
    )
  }

  return payload.data
}

function LoginForm() {
  const { t } = useI18n()
  const initialStatusLoadedRef = React.useRef(false)
  const finalizeStartedRef = React.useRef(false)
  const [auth, setAuth] = React.useState<OAuthStatus>({
    configured: false,
    email: null,
    expiresAt: null,
    updatedAt: null,
  })
  const [flow, setFlow] = React.useState<OAuthFlowSnapshot | null>(null)
  const [phase, setPhase] = React.useState<
    "idle" | "starting" | "waiting" | "syncing" | "done"
  >("idle")
  const [message, setMessage] = React.useState("")
  const [error, setError] = React.useState("")
  const [callbackUrl, setCallbackUrl] = React.useState("")
  const [callbackSubmitting, setCallbackSubmitting] = React.useState(false)

  const finalizeLogin = React.useCallback(async () => {
    if (finalizeStartedRef.current) {
      return
    }

    finalizeStartedRef.current = true
    setPhase("syncing")
    setError("")
    setMessage(t.loginSyncingModelverse)

    try {
      const apiKeys = await fetchModelverseApiKeys()
      const preferredKeyId = apiKeys.selected?.id ?? apiKeys.items[0]?.id

      if (preferredKeyId) {
        await saveModelverseApiKey(preferredKeyId, apiKeys.projectId)
      }
    } catch {
      // UCloud OAuth is enough to enter the app; Modelverse key setup can be
      // completed later from settings if this best-effort sync fails.
    }

    setPhase("done")
    setMessage(t.loginComplete)
    window.location.replace("/studio")
  }, [t])

  const reloadStatus = React.useCallback(
    async (
      state?: string,
      {
        finalize = false,
      }: {
        finalize?: boolean
      } = {}
    ) => {
      const next = await fetchOAuthStatus(state)

      setAuth(next.auth)
      setFlow(next.flow)

      if (next.flow?.status === "error") {
        throw new Error(next.flow.message || t.loginFailed)
      }

      if (next.auth.configured && finalize) {
        setFlow((current) =>
          current?.status === "pending"
            ? {
                ...current,
                status: "complete",
                message: current.message ?? "UCloud login succeeded.",
              }
            : current
        )
        await finalizeLogin()
      }

      return next
    },
    [finalizeLogin, t]
  )

  React.useEffect(() => {
    if (initialStatusLoadedRef.current) {
      return
    }

    initialStatusLoadedRef.current = true
    queueMicrotask(() => {
      void reloadStatus(undefined, { finalize: false }).catch((nextError) => {
        setPhase("idle")
        setError(
          nextError instanceof Error
            ? nextError.message
            : t.loginStatusLoadFailed
        )
      })
    })
  }, [reloadStatus, t])

  React.useEffect(() => {
    if (!flow || flow.status !== "pending") {
      return
    }

    const timer = window.setInterval(() => {
      void reloadStatus(flow.state, { finalize: true }).catch((nextError) => {
        setPhase("idle")
        setFlow((current) =>
          current?.status === "pending"
            ? {
                ...current,
                status: "error",
                message:
                  nextError instanceof Error
                    ? nextError.message
                    : t.loginFailed,
              }
            : current
        )
        setError(
          nextError instanceof Error
            ? nextError.message
            : t.loginFailed
        )
      })
    }, 1200)

    return () => {
      window.clearInterval(timer)
    }
  }, [flow, reloadStatus, t])

  async function handleLogin() {
    try {
      setPhase("starting")
      setError("")
      setCallbackUrl("")

      if (auth.configured) {
        await finalizeLogin()
        return
      }

      setMessage(t.loginOpeningUCloud)

      const popup = openOAuthPopupShell()
      const nextFlow = await startOAuthFlow()

      setFlow(nextFlow)
      setPhase("waiting")
      setMessage(t.loginFinishInBrowser)

      navigateOAuthPopup(popup, nextFlow.authorizationUrl)
    } catch (nextError) {
      setPhase("idle")
      setError(
        nextError instanceof Error
          ? nextError.message
          : t.loginStartFailed
      )
    }
  }

  async function handleCompleteFromCallback() {
    try {
      setCallbackSubmitting(true)
      setError("")
      setMessage(t.loginCompleting)

      const next = await completeOAuthFlow(callbackUrl)

      setAuth(next.auth)
      setFlow(next.flow)
      setCallbackUrl("")
      setMessage(next.message)

      await finalizeLogin()
    } catch (nextError) {
      setPhase("waiting")
      setError(
        nextError instanceof Error
          ? nextError.message
          : t.loginCompleteFailed
      )
    } finally {
      setCallbackSubmitting(false)
    }
  }

  const isBusy =
    phase === "starting" ||
    phase === "syncing" ||
    phase === "done" ||
    callbackSubmitting
  const expiryText = formatExpiry(auth.expiresAt)
  const canPasteCallback = flow?.status === "pending"

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border-border/70 bg-card/92 shadow-2xl shadow-black/6 dark:shadow-black/40 supports-backdrop-filter:backdrop-blur-xl">
        <CardHeader className="pb-3 text-center">
          <div className="flex justify-center">
            <AstraFlowLogo
              className="h-10"
              fetchPriority="high"
              loading="eager"
            />
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <Button
            type="button"
            className="h-11 w-full justify-center rounded-2xl text-sm"
            onClick={handleLogin}
            disabled={isBusy}
          >
            {isBusy ? (
              <RiLoader4Line
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : (
              <RiArrowRightLine data-icon="inline-start" />
            )}
            <span>
              {phase === "waiting"
                ? t.loginRestartUCloud
                : t.loginContinueWithUCloud}
            </span>
          </Button>

          <Separator />

          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            {auth.email ? (
              <p className="text-foreground">{t.loginSignedInAs(auth.email)}</p>
            ) : null}
            {expiryText ? <p>{t.loginSessionExpires(expiryText)}</p> : null}
            {flow ? <p>{t.loginOAuthCallback(flow.redirectUri)}</p> : null}
            {message ? <p>{message}</p> : null}
            {error ? <p className="text-destructive">{error}</p> : null}
          </div>

          {flow?.authorizationUrl && phase === "waiting" ? (
            <div className="flex flex-col gap-3">
              <Button variant="outline" className="w-full rounded-2xl" asChild>
                <a
                  href={flow.authorizationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <RiExternalLinkLine data-icon="inline-start" />
                  <span>{t.loginOpenUCloudAgain}</span>
                </a>
              </Button>

              {canPasteCallback ? (
                <div className="flex flex-col gap-2">
                  <Input
                    value={callbackUrl}
                    onChange={(event) => setCallbackUrl(event.target.value)}
                    placeholder={t.loginCallbackPlaceholder}
                    disabled={callbackSubmitting}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full rounded-2xl"
                    onClick={handleCompleteFromCallback}
                    disabled={callbackSubmitting || !callbackUrl.trim()}
                  >
                    {callbackSubmitting ? (
                      <RiLoader4Line
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <RiArrowRightLine data-icon="inline-start" />
                    )}
                    <span>{t.loginCompleteWithCallback}</span>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

export { LoginForm }
