import { NextResponse } from "next/server"
import { z } from "zod"

import { listCodeBoxSandboxDirectories } from "@/lib/codebox-runtime"

export const runtime = "nodejs"

type SandboxRouteContext = {
  params: Promise<{ sandboxId: string }>
}

const directoryQuerySchema = z.object({
  path: z.string().trim().optional(),
})

export async function GET(request: Request, context: SandboxRouteContext) {
  const { sandboxId } = await context.params

  try {
    const parsed = directoryQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams)
    )

    return NextResponse.json({
      ok: true,
      data: await listCodeBoxSandboxDirectories({
        sandboxId: decodeURIComponent(sandboxId),
        path: parsed.path,
      }),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to list workspace directories.",
      },
      { status: error instanceof Error ? 400 : 500 }
    )
  }
}
