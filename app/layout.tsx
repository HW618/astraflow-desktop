import { Geist_Mono, Inter, Roboto } from "next/font/google"

import "./globals.css"
import { AppNavbar } from "@/components/app-navbar"
import { ThemeProvider } from "@/components/theme-provider"
import { I18nProvider } from "@/components/i18n-provider"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

const interHeading = Inter({ subsets: ["latin"], variable: "--font-heading" })

const roboto = Roboto({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
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
            <AppNavbar />
            {children}
            <Toaster />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
