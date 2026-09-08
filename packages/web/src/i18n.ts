import type { AppLocale } from '@mhrise-build/data'
import { normalizeLocale, SUPPORTED_LOCALES } from '@mhrise-build/data'
import { useStorage } from '@vueuse/core'
import { watch } from 'vue'
import { createI18n } from 'vue-i18n'
import { detectBrowserLocale } from './locale'
import en from './locales/en.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zhHant from './locales/zh-Hant.json'
import zh from './locales/zh.json'

export const preferredLocale = useStorage<AppLocale>('mhrise-build-calculator-locale', detectBrowserLocale())

export const i18n = createI18n({
  legacy: false,
  fallbackLocale: 'zh',
  flatJson: true,
  globalInjection: true,
  locale: normalizeLocale(preferredLocale.value),
  messages: {
    [SUPPORTED_LOCALES[0]]: zh,
    [SUPPORTED_LOCALES[1]]: zhHant,
    [SUPPORTED_LOCALES[2]]: en,
    [SUPPORTED_LOCALES[3]]: ja,
    [SUPPORTED_LOCALES[4]]: ko,
  },
})

watch(preferredLocale, (value) => {
  i18n.global.locale.value = normalizeLocale(value)
})
