import localFont from "next/font/local"

import "./globals.css"
import "@xterm/xterm/css/xterm.css"
import { AppShell } from "@/components/app-shell"
import { ThemeProvider } from "@/components/theme-provider"
import { I18nProvider } from "@/components/i18n-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const interHeading = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-heading",
  display: "swap",
  weight: "100 900",
})

const roboto = localFont({
  src: "./fonts/roboto-latin.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
})

const fontMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 900",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        roboto.variable,
        interHeading.variable
      )}
    >
      <body>
        <ThemeProvider>
          <I18nProvider>
            <TooltipProvider>
              <AppShell>{children}</AppShell>
            </TooltipProvider>
            <Toaster />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
