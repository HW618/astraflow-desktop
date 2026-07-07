"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { driver, type DriveStep, type Driver } from "driver.js"

import { useI18n } from "@/components/i18n-provider"

const STUDIO_ONBOARDING_STORAGE_KEY = "astraflow.studio-onboarding.v1"
const STUDIO_ONBOARDING_FORCE_STORAGE_KEY = "astraflow.studio-onboarding.force"
const STUDIO_ONBOARDING_START_EVENT = "astraflow:onboarding:start"

type TourStepCopy = {
  selector: string
  title: string
  description: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
}

function requestStudioOnboardingTour() {
  if (typeof window === "undefined") {
    return
  }

  writeOnboardingStorage(STUDIO_ONBOARDING_FORCE_STORAGE_KEY, "1")
  window.dispatchEvent(new Event(STUDIO_ONBOARDING_START_EVENT))
}

function readOnboardingStorage(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeOnboardingStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}

function removeOnboardingStorage(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}

function hasSeenStudioOnboarding() {
  const value = readOnboardingStorage(STUDIO_ONBOARDING_STORAGE_KEY)

  return value === "seen" || value === "done"
}

function markStudioOnboardingSeen(value: "seen" | "done") {
  writeOnboardingStorage(STUDIO_ONBOARDING_STORAGE_KEY, value)
}

function isVisibleTarget(element: Element) {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  )
}

function createDriveStep(step: TourStepCopy): DriveStep | null {
  const element = document.querySelector(step.selector)

  if (!element || !isVisibleTarget(element)) {
    return null
  }

  return {
    element,
    disableActiveInteraction: true,
    popover: {
      title: step.title,
      description: step.description,
      side: step.side,
      align: step.align,
    },
  }
}

function getStudioTourSteps(
  t: ReturnType<typeof useI18n>["t"]
): TourStepCopy[] {
  return [
    {
      selector: "[data-tour-id='studio-sidebar-toggle']",
      title: t.studioOnboardingSidebarTitle,
      description: t.studioOnboardingSidebarDescription,
      side: "right",
      align: "start",
    },
    {
      selector: "[data-tour-id='studio-new-session']",
      title: t.studioOnboardingNewSessionTitle,
      description: t.studioOnboardingNewSessionDescription,
      side: "right",
      align: "start",
    },
    {
      selector: "[data-tour-id='studio-local-projects']",
      title: t.studioOnboardingProjectsTitle,
      description: t.studioOnboardingProjectsDescription,
      side: "right",
      align: "center",
    },
    {
      selector: "[data-tour-id='studio-composer-project']",
      title: t.studioOnboardingProjectBindingTitle,
      description: t.studioOnboardingProjectBindingDescription,
      side: "top",
      align: "start",
    },
    {
      selector: "[data-tour-id='studio-composer-environment']",
      title: t.studioOnboardingEnvironmentTitle,
      description: t.studioOnboardingEnvironmentDescription,
      side: "top",
      align: "start",
    },
    {
      selector: "[data-tour-id='studio-composer-runtime']",
      title: t.studioOnboardingRuntimeTitle,
      description: t.studioOnboardingRuntimeDescription,
      side: "top",
      align: "center",
    },
    {
      selector: "[data-tour-id='studio-composer-runtime']",
      title: t.studioOnboardingLocalModelTitle,
      description: t.studioOnboardingLocalModelDescription,
      side: "top",
      align: "center",
    },
    {
      selector: "[data-tour-id='studio-composer-model']",
      title: t.studioOnboardingModelTitle,
      description: t.studioOnboardingModelDescription,
      side: "top",
      align: "center",
    },
    {
      selector: "[data-tour-id='studio-composer-permission']",
      title: t.studioOnboardingPermissionTitle,
      description: t.studioOnboardingPermissionDescription,
      side: "top",
      align: "start",
    },
    {
      selector: "[data-tour-id='studio-composer']",
      title: t.studioOnboardingComposerTitle,
      description: t.studioOnboardingComposerDescription,
      side: "top",
      align: "center",
    },
  ]
}

function StudioOnboardingTour() {
  const pathname = usePathname()
  const { t } = useI18n()
  const driverRef = React.useRef<Driver | null>(null)

  const startTour = React.useCallback(
    (force = false) => {
      if (typeof window === "undefined") {
        return
      }

      if (driverRef.current?.isActive()) {
        return
      }

      const forceRequested =
        readOnboardingStorage(STUDIO_ONBOARDING_FORCE_STORAGE_KEY) === "1"

      removeOnboardingStorage(STUDIO_ONBOARDING_FORCE_STORAGE_KEY)

      if (!force && !forceRequested && hasSeenStudioOnboarding()) {
        return
      }

      markStudioOnboardingSeen("seen")

      const steps = getStudioTourSteps(t)
        .map(createDriveStep)
        .filter((step): step is DriveStep => step !== null)

      if (steps.length === 0) {
        return
      }

      driverRef.current?.destroy()

      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches

      const tour = driver({
        steps,
        animate: !reduceMotion,
        duration: reduceMotion ? 0 : 360,
        allowClose: true,
        allowKeyboardControl: true,
        allowScroll: false,
        disableActiveInteraction: true,
        overlayColor: "oklch(0.18 0.012 264)",
        overlayOpacity: 0.36,
        popoverClass: "astraflow-driver-popover",
        popoverOffset: 12,
        stagePadding: 8,
        stageRadius: 16,
        showButtons: ["previous", "next", "close"],
        showProgress: true,
        progressText: t.studioOnboardingProgress,
        nextBtnText: t.studioOnboardingNext,
        prevBtnText: t.studioOnboardingPrevious,
        doneBtnText: t.studioOnboardingDone,
        onDestroyed: () => {
          driverRef.current = null
          markStudioOnboardingSeen("done")
        },
      })

      driverRef.current = tour
      tour.drive()
    },
    [t]
  )

  React.useEffect(() => {
    if (!pathname.startsWith("/studio")) {
      driverRef.current?.destroy()
      return
    }

    const timeout = window.setTimeout(() => startTour(false), 900)

    function handleStartTour() {
      window.setTimeout(() => startTour(true), 120)
    }

    window.addEventListener(STUDIO_ONBOARDING_START_EVENT, handleStartTour)

    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener(STUDIO_ONBOARDING_START_EVENT, handleStartTour)
    }
  }, [pathname, startTour])

  React.useEffect(() => {
    return () => {
      driverRef.current?.destroy()
    }
  }, [])

  return null
}

export { requestStudioOnboardingTour, StudioOnboardingTour }
