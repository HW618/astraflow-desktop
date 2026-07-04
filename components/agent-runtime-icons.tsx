"use client"
import Image from "next/image"
import { RiClaudeFill, RiOpenaiFill } from "@remixicon/react"
import { Bot, Network } from "lucide-react"

import { cn } from "@/lib/utils"

type AgentRuntimeIconProps = {
  runtimeId: string
  className?: string
}

function AgentRuntimeIcon({ runtimeId, className }: AgentRuntimeIconProps) {
  if (runtimeId === "langchain") {
    return (
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center overflow-hidden",
          className
        )}
      >
        <Image
          src="/icon/icon.svg"
          alt=""
          width={224}
          height={254}
          className="h-4 w-auto object-contain"
          unoptimized
        />
      </span>
    )
  }

  const Icon =
    runtimeId === "deepagents"
      ? Network
      : runtimeId === "codex"
        ? RiOpenaiFill
        : runtimeId === "claude-code"
          ? RiClaudeFill
          : Bot

  return (
    <Icon
      aria-hidden
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  )
}

export { AgentRuntimeIcon }
