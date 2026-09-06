import { createWikiRef } from '@mhrise-build-tools/core'
import { describe, expect, it } from 'vitest'
import { parseMarkdownBuildRequirements } from '../src/markdown'

describe('markdown build input', () => {
  it('converts localized skill lines to stable Kiranico ids', () => {
    const catalog = {
      armors: [],
      decorations: [],
      skills: [{
        maxLevel: 7,
        names: { zh: '攻击' },
        ref: createWikiRef('skill', '366824395'),
      }, {
        maxLevel: 3,
        names: { zh: '弱点特效' },
        ref: createWikiRef('skill', '500079394'),
      }],
      talismans: [],
      weapons: [],
    }
    const requirements = parseMarkdownBuildRequirements(`
#### 物理配装
- [x] 攻击7
- [x] 弱点特效3
    `, catalog, { locale: 'zh' })

    expect(requirements).toEqual([{
      id: '物理配装',
      requiredSkills: [
        { level: 7, skillId: '366824395' },
        { level: 3, skillId: '500079394' },
      ],
      title: '物理配装',
    }])
  })
})
