import type { ArmorPiece } from '../src/model'
import { describe, expect, it } from 'vitest'
import {
  createArmorVariant,
  generateArmorVariants,
  MAX_ARMOR_SKILLS,
  MAX_QURIOUS_OPERATIONS,
} from '../src/armor'
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

  it('allows negative cumulative cost from drawback components', () => {
    expect(() => createArmorVariant(baseArmor(), {
      cost: -1,
      defenseDelta: 0,
      skillChanges: [],
      slotUpgrades: 0,
    })).not.toThrow()
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

  it('generates legal variants from reusable augmentation components', () => {
    const base = { ...baseArmor(), slots: [2, 1, 0] as const }
    const variants = generateArmorVariants(base, [{
      costDelta: 1,
      defenseDelta: 0,
      id: 'slot-plus-one',
      skillChanges: [],
      slotUpgrades: 1,
    }], { maxOperations: 2 })

    expect(variants.map(variant => variant.slots)).toEqual([
      [2, 1, 0],
      [2, 1, 1],
      [3, 1, 1],
    ])
  })

  it(`uses the confirmed seven-operation default`, () => {
    const base = { ...baseArmor(), slots: [1, 0, 0] as const }
    const variants = generateArmorVariants(base, [{
      costDelta: 1,
      defenseDelta: 0,
      id: 'slot-plus-one',
      skillChanges: [],
      slotUpgrades: 1,
    }])

    expect(MAX_QURIOUS_OPERATIONS).toBe(7)
    expect(variants).toHaveLength(8)
    expect(variants.at(-1)?.slots).toEqual([4, 3, 1])
  })

  it('stops when the remaining cost reaches zero', () => {
    const variants = generateArmorVariants(baseArmor(), [{
      costDelta: 20,
      defenseDelta: 0,
      id: 'spend-all-cost',
      skillChanges: [],
      slotUpgrades: 0,
    }, {
      costDelta: 1,
      defenseDelta: 0,
      id: 'slot-plus-one',
      skillChanges: [],
      slotUpgrades: 1,
    }])

    expect(variants.some(variant => variant.augmentation?.componentIds?.includes('spend-all-cost')))
      .toBe(true)
    expect(variants.some(variant => variant.augmentation?.componentIds?.includes('spend-all-cost')
      && variant.augmentation.componentIds.length === 2))
      .toBe(false)
  })

  it('applies elemental resistance changes to armor variants', () => {
    const base = {
      ...baseArmor(),
      baseResistances: {
        dragon: -2,
        fire: 1,
        ice: 0,
        thunder: 3,
        water: -1,
      },
    }
    const variant = createArmorVariant(base, {
      cost: 2,
      defenseDelta: 0,
      resistanceDelta: { fire: -1, water: 2 },
      skillChanges: [],
      slotUpgrades: 0,
    })

    expect(variant.resistances).toEqual({
      dragon: -2,
      fire: 0,
      ice: 0,
      thunder: 3,
      water: 1,
    })
  })

  it('prioritizes reducing the currently highest resistance', () => {
    const base = {
      ...baseArmor(),
      baseResistances: {
        dragon: 0,
        fire: 5,
        ice: 0,
        thunder: 0,
        water: 4,
      },
    }
    const variants = generateArmorVariants(base, [{
      costDelta: 1,
      defenseDelta: 0,
      id: 'water-minus',
      resistanceDelta: { water: -1 },
      skillChanges: [],
      slotUpgrades: 0,
    }, {
      costDelta: 1,
      defenseDelta: 0,
      id: 'fire-minus',
      resistanceDelta: { fire: -1 },
      skillChanges: [],
      slotUpgrades: 0,
    }], { maxOperations: 2 })

    expect(variants[1].augmentation?.componentIds).toEqual(['fire-minus'])
    expect(variants[2].augmentation?.componentIds).toEqual(['fire-minus', 'water-minus'])
  })
})
