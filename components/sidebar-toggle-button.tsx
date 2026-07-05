"use client"

import * as React from "react"
import type { ComponentProps } from "react"

import { useI18n } from "@/components/i18n-provider"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type SidebarToggleButtonProps = {
  className?: string
  tooltipAlign?: ComponentProps<typeof TooltipContent>["align"]
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"]
}

function isMacPlatform() {
  if (typeof document === "undefined") {
    return true
  }

  const platform = document.documentElement.dataset.astraflowPlatform
  if (platform) {
    return platform === "darwin"
  }

  return /Mac|iP(hone|ad|od)/i.test(navigator.platform || navigator.userAgent)
}

function SidebarToggleButton({
  className,
  tooltipAlign = "start",
  tooltipSide = "bottom",
}: SidebarToggleButtonProps) {
  const { t } = useI18n()
  const isMac = React.useMemo(() => isMacPlatform(), [])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarTrigger
          aria-label={t.toggleSidebar}
          title={t.toggleSidebar}
          className={cn(
            "size-8 rounded-none bg-transparent text-sidebar-foreground/80 shadow-none hover:bg-transparent hover:text-sidebar-accent-foreground",
            className
          )}
        />
      </TooltipTrigger>
      <TooltipContent
        align={tooltipAlign}
        side={tooltipSide}
        sideOffset={8}
        className="gap-2 shadow-lg"
      >
        <span>{t.toggleSidebar}</span>
        <span
          data-slot="kbd"
          className="bg-background/15 px-1.5 py-0.5 text-[11px] font-semibold text-background/80"
        >
          {isMac ? "Cmd+B" : "Ctrl+B"}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

export { SidebarToggleButton }
