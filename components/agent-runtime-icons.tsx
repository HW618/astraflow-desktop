"use client"
import Image from "next/image"
import { RiClaudeFill, RiOpenaiFill } from "@remixicon/react"
import { Bot } from "lucide-react"

import { cn } from "@/lib/utils"

type AgentRuntimeIconProps = {
  runtimeId: string
  className?: string
}

function AgentRuntimeIcon({ runtimeId, className }: AgentRuntimeIconProps) {
  if (
    runtimeId === "astraflow" ||
    runtimeId === "langchain" ||
    runtimeId === "deepagents"
  ) {
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
          className="h-full w-auto object-contain"
          unoptimized
        />
      </span>
    )
  }

  const Icon =
    runtimeId === "codex" || runtimeId === "codex-direct"
      ? RiOpenaiFill
      : runtimeId === "claude-code" || runtimeId === "claude-native"
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
