import type { ArmorPiece } from '../src/model'
import { describe, expect, it } from 'vitest'
import { createArmorVariant, MAX_ARMOR_SKILLS } from '../src/armor'
import { createWikiId, createWikiRef } from '../src/ids'

function skill(skillId: string, level: number) {
  return { skillId: createWikiId(skillId), level }
}

function baseArmor(): ArmorPiece {
  return {
    baseSkills: [],
    baseDefense: 100,
    costBudget: 20,
    ref: createWikiRef('armor', '1010'),
    slot: 'head',
    slots: [1, 0, 0],
  }
}

describe('armor legality', () => {
  it('rejects an augmentation over the armor cost budget', () => {
    const base = baseArmor()

    expect(() => createArmorVariant(base, {
      cost: base.costBudget + 1,
      defenseDelta: 0,
      skillChanges: [],
      slotUpgrades: 0,
    })).toThrow('outside budget')
  })

  it(`rejects more than ${MAX_ARMOR_SKILLS} active skills`, () => {
    const base: ArmorPiece = {
      ...baseArmor(),
      baseSkills: Array.from(
        { length: MAX_ARMOR_SKILLS },
        (_, index) => skill(String(5000 + index), 1),
      ),
      ref: createWikiRef('armor', '1011'),
    }

    expect(() => createArmorVariant(base, {
      cost: 1,
      defenseDelta: 0,
      skillChanges: [skill('6000', 1)],
      slotUpgrades: 0,
    })).toThrow(`more than ${MAX_ARMOR_SKILLS}`)
  })
})
