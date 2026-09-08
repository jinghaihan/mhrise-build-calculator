import { describe, expect, it } from 'vitest'
import { detectBrowserLocale } from '../src/locale'

describe('browser locale detection', () => {
  it('maps browser language tags to supported locales', () => {
    expect(detectBrowserLocale(['zh-CN', 'en-US'])).toBe('zh')
    expect(detectBrowserLocale(['zh-TW', 'en-US'])).toBe('zh-Hant')
    expect(detectBrowserLocale(['en-US'])).toBe('en')
    expect(detectBrowserLocale(['ja-JP'])).toBe('ja')
    expect(detectBrowserLocale(['ko-KR'])).toBe('ko')
  })

  it('skips unsupported languages and falls back to English', () => {
    expect(detectBrowserLocale(['de-DE', 'fr-FR', 'ja-JP'])).toBe('ja')
    expect(detectBrowserLocale(['de-DE', 'fr-FR'])).toBe('en')
  })
})
