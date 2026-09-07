import { normalizeLocale, SUPPORTED_LOCALES } from '@mhrise-build-tools/data'
import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zhHant from './locales/zh-Hant.json'
import zh from './locales/zh.json'

const storedLocale = localStorage.getItem('mhrise-build-tools-locale')

export const i18n = createI18n({
  legacy: false,
  fallbackLocale: 'zh',
  flatJson: true,
  globalInjection: true,
  locale: normalizeLocale(storedLocale ?? undefined),
  messages: {
    [SUPPORTED_LOCALES[0]]: zh,
    [SUPPORTED_LOCALES[1]]: zhHant,
    [SUPPORTED_LOCALES[2]]: en,
    [SUPPORTED_LOCALES[3]]: ja,
    [SUPPORTED_LOCALES[4]]: ko,
  },
})
