export const locales = ["en", "zh"] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = "en"

export const localeLabels: Record<Locale, string> = {
  en: "EN",
  zh: "中文",
}

export const translations = {
  en: {
    "nav.explore": "Explore",
    "nav.studio": "Studio",
    "nav.toggleTheme": "Toggle theme",
    "nav.toggleLanguage": "Switch language",
  },
  zh: {
    "nav.explore": "探索",
    "nav.studio": "Studio",
    "nav.toggleTheme": "切换主题",
    "nav.toggleLanguage": "切换语言",
  },
} satisfies Record<Locale, Record<string, string>>

export type TranslationKey = keyof (typeof translations)[typeof defaultLocale]
