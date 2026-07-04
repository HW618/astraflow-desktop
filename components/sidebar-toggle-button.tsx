"use client"

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

function SidebarToggleButton({
  className,
  tooltipAlign = "start",
  tooltipSide = "bottom",
}: SidebarToggleButtonProps) {
  const { t } = useI18n()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarTrigger
          aria-label={t.toggleSidebar}
          title={t.toggleSidebar}
          className={cn(
            "size-8 rounded-xl bg-sidebar-accent/85 text-sidebar-foreground/80 shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
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
          Cmd+B
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

export { SidebarToggleButton }
