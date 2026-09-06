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

function armor(slot: ArmorSlot, id: string, slots: [number, number, number] = [1, 0, 0]) {
  const base: ArmorPiece = {
    baseSkills: [],
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
})

describe('equipment reuse optimization', () => {
  it('prefers one shared set when two builds can use the same armor variants', () => {
    const plan = optimizeEquipmentReuse([
      request('build-a', [skill(String(attack), 1)]),
      request('build-b', [skill(String(attack), 1)]),
    ])

    expect(plan?.score).toEqual({
      armorReuseCount: 5,
      uniqueArmorPieces: 5,
      uniqueTalismans: 1,
    })
    expect(plan?.sharedArmor['1001|0|0']).toEqual(['build-a', 'build-b'])
  })
})
