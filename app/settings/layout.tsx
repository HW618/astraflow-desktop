import type { ReactNode } from "react"
import { connection } from "next/server"

import { SettingsShell } from "@/components/settings-shell"
import { requireAppAuth } from "@/lib/app-auth"

export default async function SettingsLayout({
  children,
}: {
  children: ReactNode
}) {
  await connection()
  await requireAppAuth()

  return <SettingsShell>{children}</SettingsShell>
}
