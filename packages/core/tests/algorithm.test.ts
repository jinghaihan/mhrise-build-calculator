import type { ArmorPiece, ArmorSlot, BuildRequest, SkillValue } from '../src/model'
import { describe, expect, it } from 'vitest'
import { createArmorVariant } from '../src/armor'
import { createWikiId, createWikiRef } from '../src/ids'
import { optimizeEquipmentReuse } from '../src/reuse'
import { solveBuild } from '../src/solver'

const attack = createWikiId('366824395')

function skill(skillId: string, level: number): SkillValue {
  return { skillId: createWikiId(skillId), level }
}

function armor(
  slot: ArmorSlot,
  id: string,
  slots: [number, number, number] = [1, 0, 0],
  baseDefense = 100,
) {
  const base: ArmorPiece = {
    baseSkills: [],
    baseDefense,
    costBudget: 20,
    ref: createWikiRef('armor', id),
    slot,
    slots,
  }

  return createArmorVariant(base)
}

function commonArmor(): BuildRequest['armorBySlot'] {
  return {
    arms: [armor('arms', '1003')],
    chest: [armor('chest', '1002')],
    head: [armor('head', '1001')],
    legs: [armor('legs', '1005')],
    waist: [armor('waist', '1004')],
  }
}

function request(id: string, requiredSkills: readonly SkillValue[]): BuildRequest {
  return {
    armorBySlot: commonArmor(),
    decorations: [
      {
        ref: createWikiRef('decoration', '2001'),
        skills: [skill(String(attack), 1)],
        slotLevel: 1,
      },
    ],
    id,
    requiredSkills,
    talismans: [
      {
        allowedSlots: undefined,
        maxSkillCount: 2,
        maxSkills: [skill(String(attack), 3)],
        ref: createWikiRef('talisman', '3001'),
        skills: [skill(String(attack), 1)],
        slots: [2, 0, 0],
      },
    ],
    weapon: {
      ref: createWikiRef('weapon', '4001'),
      skills: [],
      slots: [2, 0, 0],
    },
  }
}

describe('build solving', () => {
  it('combines armor, talisman and decorations to meet skill requirements', () => {
    const solutions = solveBuild(request('attack-build', [skill(String(attack), 2)]), {
      maxSolutions: 1,
    })

    expect(solutions).toHaveLength(1)
    expect(solutions[0].skills).toContainEqual(skill(String(attack), 2))
    expect(solutions[0].decorations).toHaveLength(1)
  })

  it('rejects talismans above their source maximum skill levels', () => {
    const build = request('invalid-talisman', [skill(String(attack), 4)])
    const invalidTalisman = {
      ...build.talismans[0],
      skills: [skill(String(attack), 4)],
    }
    const invalidBuild = { ...build, talismans: [invalidTalisman] }

    expect(solveBuild(invalidBuild)).toHaveLength(0)
  })

  it('orders individual solutions by total final armor defense', () => {
    const build = request('defense-order', [skill(String(attack), 1)])
    const lowerDefense = armor('head', '1007', [1, 0, 0], 100)
    const higherDefense = armor('head', '1008', [1, 0, 0], 200)
    const requestWithAlternatives = {
      ...build,
      armorBySlot: { ...build.armorBySlot, head: [lowerDefense, higherDefense] },
    }
    const solutions = solveBuild(requestWithAlternatives, { maxSolutions: 2 })

    expect(solutions[0].defense).toBe(600)
    expect(solutions[1].defense).toBe(500)
  })

  it('does not place a decoration into a smaller slot', () => {
    const build = request('slot-order', [skill(String(attack), 2)])
    const requestWithOnlySmallSlots = {
      ...build,
      decorations: [{
        ref: createWikiRef('decoration', '2002'),
        skills: [skill(String(attack), 1)],
        slotLevel: 2,
      }],
      talismans: [{ ...build.talismans[0], slots: [1, 0, 0] as const }],
      weapon: { ...build.weapon, slots: [1, 0, 0] as const },
    }

    expect(solveBuild(requestWithOnlySmallSlots)).toHaveLength(0)
  })

  it('short-circuits decoration searches that cannot reach a requirement', () => {
    expect(solveBuild(request('unreachable-skill', [skill(String(attack), 10)]))).toHaveLength(0)
  })
})

describe('equipment reuse optimization', () => {
  it('prefers one shared set when two builds can use the same armor variants', () => {
    const plan = optimizeEquipmentReuse([
      request('build-a', [skill(String(attack), 1)]),
      request('build-b', [skill(String(attack), 1)]),
    ])

    expect(plan?.score).toEqual({
      armorReuseCount: 5,
      totalDefense: 1000,
      uniqueArmorPieces: 5,
      uniqueTalismans: 1,
    })
    expect(plan?.sharedArmor['1001|0|0|0']).toEqual(['build-a', 'build-b'])
  })

  it('backtracks to reuse a shared variant instead of keeping the first candidate', () => {
    const shared = armor('head', '1001')
    const buildA = request('build-a', [skill(String(attack), 1)])
    const buildB = request('build-b', [skill(String(attack), 1)])

    const buildAWithAlternatives = {
      ...buildA,
      armorBySlot: { ...buildA.armorBySlot, head: [armor('head', '1006'), shared] },
    }
    const buildBWithSharedHead = {
      ...buildB,
      armorBySlot: { ...buildB.armorBySlot, head: [shared] },
    }

    const plan = optimizeEquipmentReuse([buildAWithAlternatives, buildBWithSharedHead])

    expect(plan?.score.uniqueArmorPieces).toBe(5)
    expect(plan?.sharedArmor['1001|0|0|0']).toEqual(['build-a', 'build-b'])
  })
})
