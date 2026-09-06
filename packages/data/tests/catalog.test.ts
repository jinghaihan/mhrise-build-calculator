import { createWikiRef } from '@mhrise-build-tools/core'
import { describe, expect, it } from 'vitest'
import { getLocalizedName, skillValue } from '../src/catalog'

describe('localized Kiranico records', () => {
  it('uses the requested locale and falls back to English', () => {
    const record = {
      names: { 'en': 'Weakness Exploit', 'zh-Hans': '弱点特效' },
      ref: createWikiRef('skill', '500079394'),
    }

    expect(getLocalizedName(record, 'zh-Hans')).toBe('弱点特效')
    expect(getLocalizedName(record, 'ja')).toBe('Weakness Exploit')
  })

  it('uses IDs when converting a wiki skill to a core value', () => {
    const ref = createWikiRef('skill', '500079394')

    expect(skillValue(ref, 3)).toEqual({
      level: 3,
      skillId: ref.id,
    })
  })
})
