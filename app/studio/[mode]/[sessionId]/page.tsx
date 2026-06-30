import { notFound } from "next/navigation"

import { StudioShell } from "@/components/studio-shell"
import { studioModes, type StudioMode } from "@/lib/studio-types"

type StudioSessionPageProps = {
  params: Promise<{
    mode: string
    sessionId: string
  }>
}

function isStudioMode(value: string): value is StudioMode {
  return studioModes.includes(value as StudioMode)
}

export default async function StudioSessionPage({
  params,
}: StudioSessionPageProps) {
  const { mode, sessionId } = await params

  if (!isStudioMode(mode)) {
    notFound()
  }

  return <StudioShell initialMode={mode} initialSessionId={sessionId} />
}
