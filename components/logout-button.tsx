"use client"

import * as React from "react"
import { RiLogoutBoxRLine, RiLoader4Line } from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"

type LogoutButtonProps = {
  className?: string
}

async function logout() {
  const response = await fetch("/api/studio/oauth/logout", {
    method: "POST",
    cache: "no-store",
  })

  if (!response.ok) {
    let detail: unknown = null

    try {
      detail = await response.json()
    } catch {
      detail = await response.text().catch(() => null)
    }

    console.warn("Logout request failed.", detail)
  }
}

function LogoutButton({ className }: LogoutButtonProps = {}) {
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)

  async function handleLogout() {
    try {
      setPending(true)
      await logout()
    } catch (error) {
      console.warn("Logout request failed.", error)
    } finally {
      window.location.replace("/login")
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      disabled={pending}
      aria-label={t.logout}
      title={t.logout}
      className={className}
    >
      {pending ? (
        <RiLoader4Line data-icon="inline-start" className="animate-spin" />
      ) : (
        <RiLogoutBoxRLine data-icon="inline-start" />
      )}
      <span>{t.logout}</span>
    </Button>
  )
}

export { LogoutButton }
