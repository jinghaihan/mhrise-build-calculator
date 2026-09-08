import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createWikiRef } from '@mhrise-build/core'
import { describe, expect, it } from 'vitest'
import localizedNames from '../locales/names.json'
import { parseMarkdownBuildRequirements } from '../src/markdown'
import { expandMarkdownBuildRequirements } from '../src/markdown-planner'
import { parseSourceSnapshot } from '../src/snapshot'

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
+ 武器：凶刀【催花雨】
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
      weaponOptions: [{ name: '凶刀【催花雨】', type: 'explicit' }],
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

  it('expands the ammo shorthand as normal, spread, and pierce alternatives', () => {
    const catalog = {
      armors: [],
      decorations: [],
      skills: [{
        maxLevel: 3,
        names: { zh: '通常弹・连射箭强化' },
        ref: createWikiRef('skill', '599465498'),
      }, {
        maxLevel: 3,
        names: { zh: '散弹・扩散箭强化' },
        ref: createWikiRef('skill', '762691032'),
      }, {
        maxLevel: 3,
        names: { zh: '贯穿弹・贯穿箭强化' },
        ref: createWikiRef('skill', '748441147'),
      }],
      talismans: [],
      weapons: [],
    }
    const [requirements] = parseMarkdownBuildRequirements(`
#### 弓弹种
- [x] 弹种强化3
`, catalog)

    expect(requirements.requiredSkillGroups).toEqual([[
      { level: 3, skillId: '599465498' },
      { level: 3, skillId: '762691032' },
      { level: 3, skillId: '748441147' },
    ]])
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
      weaponOptions: [],
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

  it('keeps alternative levels for the same skill', () => {
    const catalog = {
      armors: [],
      decorations: [],
      skills: [{
        maxLevel: 3,
        names: { zh: '弱点特效【属性】' },
        ref: createWikiRef('skill', '7200'),
      }],
      talismans: [],
      weapons: [],
    }
    const [requirements] = parseMarkdownBuildRequirements(`
#### 属性会心
- [x] 弱点特效【属性】3/1
`, catalog)

    expect(requirements.requiredSkillGroups).toEqual([[
      { level: 3, skillId: '7200' },
      { level: 1, skillId: '7200' },
    ]])
  })

  it('parses a real build-note fixture with all alternative groups', () => {
    const snapshot = parseSourceSnapshot(readFileSync(fileURLToPath(
      new URL('../snapshots/source-snapshot.json', import.meta.url),
    ), 'utf8'), localizedNames)
    const fixturePath = fileURLToPath(new URL('./fixtures/monster-hunter-rise.md', import.meta.url))
    const [requirements] = parseMarkdownBuildRequirements(
      readFileSync(fixturePath, 'utf8'),
      snapshot.catalog,
    )
    const definitions = expandMarkdownBuildRequirements(requirements, { weaponId: 'fixture-weapon' })

    expect(requirements.id).toBe('弓-属性配装')
    expect(requirements.requiredSkills.length).toBe(4)
    expect(requirements.requiredSkillGroups.filter(group => group.length > 1).map(group => group.length))
      .toEqual([5, 3, 2])
    expect(definitions).toHaveLength(30)
    expect(requirements.weaponOptions).toEqual(expect.arrayContaining([
      { element: 'fire', name: '开天的亥伯龙神', type: '连射' },
      { element: 'fire', name: '穿杨蛮炎弓·改', type: '连射' },
      { element: 'water', name: '投箭远境真射弓·改', type: '连射' },
      { element: 'dragon', name: '出现or湮没', type: '连射' },
    ]))
  })
})
