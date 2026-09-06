import { createWikiRef } from '@mhrise-build-tools/core'
import { describe, expect, it } from 'vitest'
import { parseMarkdownBuildRequirements } from '../src/markdown'
import { expandMarkdownBuildRequirements } from '../src/markdown-planner'

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
      requiredSkillGroups: [
        [{ level: 7, skillId: '366824395' }],
        [{ level: 3, skillId: '500079394' }],
      ],
      title: '物理配装',
    }])
  })

  it('expands the elemental shorthand as five build alternatives', () => {
    const catalog = {
      armors: [],
      decorations: [],
      skills: ['火', '水', '雷', '冰', '龙'].map((element, index) => ({
        maxLevel: 5,
        names: { zh: `${element}属性攻击强化` },
        ref: createWikiRef('skill', String(6000 + index)),
      })),
      talismans: [],
      weapons: [],
    }
    const [requirements] = parseMarkdownBuildRequirements(`
#### 龙属性
- [x] 属性攻击强化5
`, catalog)
    const definitions = expandMarkdownBuildRequirements(requirements, { weaponId: 'weapon' })

    expect(requirements.requiredSkills).toEqual([])
    expect(requirements.requiredSkillGroups[0]).toHaveLength(5)
    expect(definitions).toHaveLength(5)
    expect(definitions.map(definition => definition.requiredSkills[0].skillId)).toEqual([
      '6000',
      '6001',
      '6002',
      '6003',
      '6004',
    ])
  })

  it('recognizes nested elemental sections and preserves their parent in the id', () => {
    const catalog = {
      armors: [],
      decorations: [],
      skills: [{
        maxLevel: 5,
        names: { zh: '火属性攻击强化' },
        ref: createWikiRef('skill', '7000'),
      }],
      talismans: [],
      weapons: [],
    }
    const [requirements] = parseMarkdownBuildRequirements(`
## 弓
### 属性配装
- [x] 火属性攻击强化5
## 双剑
### 属性配装
- [x] 火属性攻击强化5
`, catalog)

    expect(parseMarkdownBuildRequirements(`
## 弓
### 属性配装
- [x] 火属性攻击强化5
`, catalog)).toEqual([{
      id: '弓-属性配装',
      requiredSkills: [{ level: 5, skillId: '7000' }],
      requiredSkillGroups: [[{ level: 5, skillId: '7000' }]],
      title: '属性配装',
    }])
    expect(requirements.id).toBe('弓-属性配装')
  })

  it('keeps explicit inline alternatives as one requirement group', () => {
    const catalog = {
      armors: [],
      decorations: [],
      skills: ['火', '水', '冰'].map((element, index) => ({
        maxLevel: 3,
        names: { zh: `${element}属性攻击强化` },
        ref: createWikiRef('skill', String(7100 + index)),
      })),
      talismans: [],
      weapons: [],
    }
    const [requirements] = parseMarkdownBuildRequirements(`
#### 属性
- [x] 火属性攻击强化/水属性攻击强化/冰属性攻击强化3
`, catalog)

    expect(requirements.requiredSkills).toEqual([])
    expect(requirements.requiredSkillGroups[0]).toEqual([
      { level: 3, skillId: '7100' },
      { level: 3, skillId: '7101' },
      { level: 3, skillId: '7102' },
    ])
  })
})
