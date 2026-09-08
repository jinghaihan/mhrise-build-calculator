import type { AppLocale } from '@mhrise-build/data'

export function detectBrowserLocale(locales = browserLocales()): AppLocale {
  for (const locale of locales) {
    const normalized = locale.toLowerCase()

    if (normalized.startsWith('zh-hant')
      || normalized.startsWith('zh-tw')
      || normalized.startsWith('zh-hk')
      || normalized.startsWith('zh-mo')) {
      return 'zh-Hant'
    }

    if (normalized.startsWith('zh'))
      return 'zh'

    if (normalized.startsWith('en'))
      return 'en'

    if (normalized.startsWith('ja'))
      return 'ja'

    if (normalized.startsWith('ko'))
      return 'ko'
  }

  return 'en'
}

function browserLocales(): string[] {
  if (typeof navigator === 'undefined')
    return []

  return [...new Set([...navigator.languages, navigator.language].filter(Boolean))]
}
