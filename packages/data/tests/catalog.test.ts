import { createArmorVariant, createWikiRef } from '@mhrise-build/core'
import { describe, expect, it } from 'vitest'
import {
  createBuildRequest,
  createDataCatalog,
  findSkillByName,
  getLocalizedName,
  skillValue,
} from '../src/catalog'

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

  it('resolves display names only at the data boundary', () => {
    const skill = findSkillByName({
      armors: [],
      decorations: [],
      skills: [{
        maxLevel: 3,
        names: { 'zh-Hans': '弱点特效' },
        ref: createWikiRef('skill', '500079394'),
      }],
      talismans: [],
      weapons: [],
    }, '弱点特效', 'zh-Hans')

    expect(skill.ref.id).toBe('500079394')
  })

  it('resolves a build definition into a solver request', () => {
    const baseArmor = {
      baseDefense: 100,
      baseSkills: [],
      costBudget: 16,
      ref: createWikiRef('armor', '1001'),
      slot: 'head' as const,
      slots: [1, 0, 0] as const,
    }
    const catalog = createDataCatalog({
      armors: (['head', 'chest', 'arms', 'waist', 'legs'] as const).map((slot, index) => ({
        armor: createArmorVariant({ ...baseArmor, ref: createWikiRef('armor', String(1001 + index)), slot }).base,
        names: { en: slot },
        ref: createWikiRef('armor', String(1001 + index)),
      })),
      decorations: [{
        decoration: {
          ref: createWikiRef('decoration', '2001'),
          skills: [skillValue(createWikiRef('skill', '500079394'), 1)],
          slotLevel: 1,
        },
        names: { en: 'Attack Jewel' },
        ref: createWikiRef('decoration', '2001'),
      }],
      skills: [],
      talismans: [{
        names: { en: 'Charm' },
        ref: createWikiRef('talisman', '3001'),
        talisman: {
          allowedSlots: undefined,
          maxSkillCount: 2,
          maxSkills: undefined,
          ref: createWikiRef('talisman', '3001'),
          skills: [],
          slots: [2, 0, 0],
        },
      }],
      weapons: [{
        names: { en: 'Weapon' },
        ref: createWikiRef('weapon', '4001'),
        weapon: {
          ref: createWikiRef('weapon', '4001'),
          skills: [],
          slots: [2, 0, 0],
        },
      }],
    })
    const request = createBuildRequest(catalog, {
      armorIdsBySlot: {
        arms: ['1003'],
        chest: ['1002'],
        head: ['1001'],
        legs: ['1005'],
        waist: ['1004'],
      },
      decorationIds: ['2001'],
      id: 'resolved-build',
      requiredSkills: [skillValue(createWikiRef('skill', '500079394'), 1)],
      talismanIds: ['3001'],
      weaponId: '4001',
    })

    expect(request.id).toBe('resolved-build')
    expect(request.armorBySlot.head).toHaveLength(1)
    expect(request.decorations).toHaveLength(1)
  })
})
