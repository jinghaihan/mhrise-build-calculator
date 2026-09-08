import type { ArmorPiece, ArmorSlot, BuildRequest, SkillValue } from '../src/model'
import { describe, expect, it } from 'vitest'
import { createArmorVariant } from '../src/armor'
import { createWikiId, createWikiRef } from '../src/ids'
import { findUnreachableRequirements } from '../src/milp'
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
  it('proves a skill is unreachable without rejecting skills supplied by decorations', () => {
    const missing = skill('999999999', 3)
    const build = request('unreachable-milp', [missing])
    const unreachable = findUnreachableRequirements({
      ...build,
      decorations: build.decorations.filter(decoration => decoration.skills[0].skillId !== missing.skillId),
    })

    expect(unreachable).toEqual([{ maximum: 0, requirement: missing }])
    expect(findUnreachableRequirements({ ...build, requiredSkills: [skill(String(attack), 1)] })).toEqual([])
  })

  it('returns distinct armor sets and remaps cached jewels to each set sockets', () => {
    const build = request('socket-cache', [skill(String(attack), 2)])
    const emptyArmor = Object.fromEntries(Object.entries(build.armorBySlot).map(([slot, variants]) => [
      slot,
      variants.map(variant => ({ ...variant, slots: [0, 0, 0] as const })),
    ])) as unknown as BuildRequest['armorBySlot']
    const result = solveBuild({
      ...build,
      armorBySlot: { ...emptyArmor, head: [armor('head', '1010', [0, 1, 0]), armor('head', '1011', [1, 0, 0])] },
      talismans: [{ ...build.talismans[0], slots: [0, 0, 0] }],
      weapon: { ...build.weapon, slots: [0, 0, 0] },
    }, { maxSolutions: 2 })
    expect(result).toHaveLength(2)
    expect(new Set(result.map(solution => solution.armor.head.base.ref.id)).size).toBe(2)
    for (const solution of result) {
      expect(solution.decorations).toHaveLength(1)
      const placement = solution.decorations[0]
      expect(placement.host).toBe('head')
      expect(solution.armor.head.slots[placement.slotIndex]).toBe(1)
    }
  })

  it('keeps a usable talisman when candidates differ only in unrelated skills', () => {
    const build = request('equivalent-talismans', [skill(String(attack), 1)])
    const extra = {
      ...build.talismans[0],
      ref: createWikiRef('talisman', '3002'),
      maxSkills: undefined,
      skills: [...build.talismans[0].skills, skill('9999', 1)],
    }
    expect(solveBuild({ ...build, talismans: [build.talismans[0], extra] }, { maxSolutions: 1 })).toHaveLength(1)
    expect(solveBuild({ ...build, talismans: [extra, build.talismans[0]] }, { maxSolutions: 1 })).toHaveLength(1)
  })

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
  it('matches full cross-build enumeration with different candidate scopes and talismans', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const heads = Array.from({ length: 4 }, (_, index) => armor('head', String(5000 + index), [1, 0, 0], 80 + (seed * (index + 1)) % 23))
      const requests = Array.from({ length: 3 }, (_, index) => {
        const build = request(`build-${index}`, [skill(String(attack), 1)])
        return {
          ...build,
          armorBySlot: { ...build.armorBySlot, head: heads.filter((_, head) => head !== (seed + index) % 4) },
          talismans: [build.talismans[0], { ...build.talismans[0], ref: createWikiRef('talisman', String(6000 + index)) }],
        }
      })
      const candidates = requests.map(build => solveBuild(build, { preserveEquipmentIdentity: true, maxSolutions: Number.POSITIVE_INFINITY }))
      const scores: number[][] = []
      for (const a of candidates[0]) {
        for (const b of candidates[1]) {
          for (const c of candidates[2]) {
            const solutions = [a, b, c]
            scores.push([
              new Set(solutions.flatMap(solution => Object.values(solution.armor).map(variant => variant.variantId))).size,
              -solutions.reduce((sum, solution) => sum + solution.defense, 0),
              new Set(solutions.map(solution => solution.talisman.ref.id)).size,
            ])
          }
        }
      }
      scores.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
      const plan = optimizeEquipmentReuse(requests)
      expect([plan?.score.uniqueArmorPieces, -plan!.score.totalDefense, plan?.score.uniqueTalismans], `seed ${seed}`).toEqual(scores[0])
      expect(plan?.solutions.map(solution => solution.id)).toEqual(requests.map(build => build.id))
    }
  })

  it('keeps a shared low-defense piece beyond the single-build result limit', () => {
    const shared = armor('head', '1900', [1, 0, 0], 50)
    const buildA = request('many-heads', [skill(String(attack), 1)])
    const buildB = request('fixed-head', [skill(String(attack), 1)])
    const plan = optimizeEquipmentReuse([
      { ...buildA, armorBySlot: { ...buildA.armorBySlot, head: [
        ...Array.from({ length: 205 }, (_, index) => armor('head', String(2000 + index), [1, 0, 0], 200 + index)),
        shared,
      ] } },
      { ...buildB, armorBySlot: { ...buildB.armorBySlot, head: [shared] } },
    ], { maxSolutions: 1 })
    expect(plan?.score.uniqueArmorPieces).toBe(5)
    expect(plan?.score.totalDefense).toBe(900)
    expect(plan?.solutions.map(solution => solution.id)).toEqual(['many-heads', 'fixed-head'])
    expect(plan?.solutions.every(solution => solution.armor.head.variantId === shared.variantId)).toBe(true)
  })

  it('ranks reuse before defense, and total defense before talisman count', () => {
    const high = armor('head', '1900', [1, 0, 0], 200)
    const low = armor('head', '1901', [1, 0, 0], 50)
    const requests = ['a', 'b', 'c'].map((id, index) => {
      const build = request(id, [skill(String(attack), 1)])
      return {
        ...build,
        armorBySlot: { ...build.armorBySlot, head: [low, high] },
        talismans: [{ ...build.talismans[0], ref: createWikiRef('talisman', String(4000 + index)) }],
      }
    })
    const plan = optimizeEquipmentReuse(requests)
    expect(plan?.score).toEqual({ uniqueArmorPieces: 5, totalDefense: 1800, uniqueTalismans: 3, armorReuseCount: 10 })
  })

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
