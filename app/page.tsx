import { redirect } from "next/navigation"
import { connection } from "next/server"

import { getAppAuthState } from "@/lib/app-auth"

export default async function Page() {
  await connection()

  const auth = await getAppAuthState()

  redirect(auth.authenticated ? "/studio" : "/login")
}
