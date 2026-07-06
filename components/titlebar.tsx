"use client"

import * as React from "react"

import { SidebarToggleButton } from "@/components/sidebar-toggle-button"
import { cn } from "@/lib/utils"

type TitlebarProps = {
  children?: React.ReactNode
  showSidebarToggle?: boolean
  className?: string
}

/* Shared titlebar row rendered identically on web and in Electron. The row is
   always --titlebar-height tall; on macOS Electron --titlebar-inset-left
   shifts the toggle right to clear the native traffic lights. */
function Titlebar({
  children,
  showSidebarToggle = false,
  className,
}: TitlebarProps) {
  return (
    <div
      data-electron-drag-header
      className={cn(
        "relative h-(--titlebar-height) w-full shrink-0",
        className
      )}
    >
      {showSidebarToggle ? (
        <div
          data-tour-id="studio-sidebar-toggle"
          className="absolute top-[calc(50%+var(--titlebar-buttons-offset))] left-(--titlebar-toggle-left) shrink-0 -translate-y-1/2"
        >
          <SidebarToggleButton />
        </div>
      ) : null}
      {children ? (
        <div className="absolute top-[calc(50%+var(--titlebar-buttons-offset))] right-3 flex -translate-y-1/2 items-center gap-2">
          {children}
        </div>
      ) : null}
    </div>
  )
}

export { Titlebar }
