"use client"

import Image from "next/image"

import { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"

type AstraFlowLogoProps = {
  className?: string
  fetchPriority?: "high" | "low" | "auto"
  loading?: "eager" | "lazy"
}

const logos = {
  en: {
    light: { src: "/logo/en-logo.png", width: 530, height: 160 },
    dark: { src: "/logo/en-logo-白.png", width: 530, height: 160 },
  },
  zh: {
    light: { src: "/logo/logo.png", width: 700, height: 160 },
    dark: { src: "/logo/logo-白.png", width: 700, height: 160 },
  },
} as const

function AstraFlowLogo({
  className,
  fetchPriority,
  loading,
}: AstraFlowLogoProps) {
  const { locale } = useI18n()
  const logo = logos[locale]

  return (
    <>
      <Image
        src={logo.light.src}
        alt="AstraFlow"
        width={logo.light.width}
        height={logo.light.height}
        className={cn("block h-8 w-auto dark:hidden", className)}
        fetchPriority={fetchPriority}
        loading={loading}
      />
      <Image
        src={logo.dark.src}
        alt="AstraFlow"
        width={logo.dark.width}
        height={logo.dark.height}
        className={cn("hidden h-8 w-auto dark:block", className)}
        fetchPriority={fetchPriority}
        loading={loading}
      />
    </>
  )
}

export { AstraFlowLogo }
