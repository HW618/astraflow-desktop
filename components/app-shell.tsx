"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import { SidebarToggleButton } from "@/components/sidebar-toggle-button"
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"

const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 420
const SIDEBAR_DEFAULT_WIDTH = 260
const LEGACY_SIDEBAR_DEFAULT_WIDTH = 176
const PREVIOUS_SIDEBAR_DEFAULT_WIDTH = 288
// Below this drag position, hand off from resizing to the hidden sidebar state.
const SIDEBAR_COLLAPSE_AT = 176
const SIDEBAR_WIDTH_STORAGE_KEY = "astraflow.sidebar-width"

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value))
}

function SidebarResizeHandle({
  width,
  onWidthChange,
  onResizingChange,
}: {
  width: number
  onWidthChange: (width: number) => void
  onResizingChange: (resizing: boolean) => void
}) {
  const { open, setOpen, isMobile } = useSidebar()
  const openRef = React.useRef(open)

  React.useEffect(() => {
    openRef.current = open
  }, [open])

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    onResizingChange(true)

    function handleMove(moveEvent: PointerEvent) {
      const pointerX = moveEvent.clientX

      if (pointerX < SIDEBAR_COLLAPSE_AT) {
        if (openRef.current) {
          openRef.current = false
          onResizingChange(false)
          setOpen(false)
        }
        return
      }

      if (!openRef.current) {
        openRef.current = true
        onWidthChange(clampSidebarWidth(pointerX))
        onResizingChange(false)
        setOpen(true)
        return
      }

      onResizingChange(true)
      onWidthChange(clampSidebarWidth(pointerX))
    }

    function handleUp() {
      onResizingChange(false)
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
  }

  if (isMobile) {
    return null
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      className="fixed bottom-0 z-20 hidden w-2 -translate-x-1/2 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px hover:after:bg-border md:block"
      style={{
        left: open ? width : "var(--sidebar-collapsed-resize-left)",
        top: "var(--electron-titlebar-height)",
      }}
      onPointerDown={handlePointerDown}
    />
  )
}

function ElectronTitlebar() {
  return (
    <div className="electron-titlebar shrink-0 overflow-hidden bg-background" />
  )
}

function ElectronCollapsedDragCorner() {
  const { open, isMobile } = useSidebar()

  if (open || isMobile) {
    return null
  }

  return <div aria-hidden className="electron-drag-corner" />
}

function MobileSidebarTrigger() {
  const { isMobile } = useSidebar()

  if (!isMobile) {
    return null
  }

  return (
    <div className="absolute top-2 left-2 z-30">
      <SidebarToggleButton />
    </div>
  )
}

function DesktopCollapsedSidebarTrigger() {
  const { open, isMobile } = useSidebar()

  if (open || isMobile) {
    return null
  }

  return (
    <div className="electron-collapsed-sidebar-trigger fixed top-2 left-2 z-50 hidden md:block">
      <SidebarToggleButton />
    </div>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = React.useState(false)

  React.useEffect(() => {
    queueMicrotask(() => {
      const stored = Number.parseInt(
        window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "",
        10
      )

      if (
        stored === LEGACY_SIDEBAR_DEFAULT_WIDTH ||
        stored === PREVIOUS_SIDEBAR_DEFAULT_WIDTH
      ) {
        setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)
      } else if (Number.isFinite(stored)) {
        setSidebarWidth(clampSidebarWidth(stored))
      }
    })
  }, [])

  React.useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  if (pathname === "/login") {
    return (
      <div className="flex h-svh min-h-0 flex-col bg-background">
        <ElectronTitlebar />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    )
  }

  return (
    <SidebarProvider
      className={
        isResizing
          ? "h-svh min-h-0 flex-col select-none **:data-[slot=sidebar-container]:transition-none **:data-[slot=sidebar-gap]:transition-none"
          : "h-svh min-h-0 flex-col"
      }
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--sidebar-width-mobile": "19rem",
          "--sidebar-top-offset": "var(--electron-titlebar-height)",
        } as React.CSSProperties
      }
    >
      <ElectronCollapsedDragCorner />
      <DesktopCollapsedSidebarTrigger />
      <div className="flex min-h-0 w-full flex-1">
        <React.Suspense fallback={null}>
          <AppSidebar />
        </React.Suspense>
        <SidebarResizeHandle
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          onResizingChange={setIsResizing}
        />
        <SidebarInset className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
          <MobileSidebarTrigger />
          <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

export { AppShell }
