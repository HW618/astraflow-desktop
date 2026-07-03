import { NextResponse } from "next/server"
import { z } from "zod"

import { prepareCodeBoxSshAccess } from "@/lib/codebox-runtime"

export const runtime = "nodejs"

type SandboxRouteContext = {
  params: Promise<{ sandboxId: string }>
}

const sshRequestSchema = z.object({
  prepareRemote: z.boolean().optional().default(false),
  writeConfig: z.boolean().optional().default(false),
  workspacePath: z.string().trim().optional(),
})

export async function POST(request: Request, context: SandboxRouteContext) {
  const { sandboxId } = await context.params

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = sshRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: await prepareCodeBoxSshAccess({
        sandboxId: decodeURIComponent(sandboxId),
        prepareRemote: parsed.data.prepareRemote,
        writeConfig: parsed.data.writeConfig,
        workspacePath: parsed.data.workspacePath,
      }),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to prepare SSH access.",
      },
      { status: error instanceof Error ? 400 : 500 }
    )
  }
}
