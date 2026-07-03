import { redirect } from "next/navigation"
import { connection } from "next/server"

import { LoginForm } from "@/components/login-form"
import { getAppAuthState } from "@/lib/app-auth"

export default async function LoginPage() {
  await connection()

  const auth = await getAppAuthState()

  if (auth.authenticated) {
    redirect("/studio")
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(83,139,255,0.14),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(20,184,166,0.14),_transparent_28%),linear-gradient(180deg,_rgba(247,246,242,1)_0%,_rgba(255,255,255,1)_100%)] px-6 py-12">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(27,27,24,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(27,27,24,0.04)_1px,transparent_1px)] bg-[size:32px_32px] opacity-35" />
      <div className="relative w-full max-w-md">
        <LoginForm />
      </div>
    </main>
  )
}
