import type { ArmorSlot, ArmorVariant, BuildRequest, SkillValue } from '../src/model'
import type { SolveProgress } from '../src/solver'
import { describe, expect, it } from 'vitest'
import { createArmorVariant } from '../src/armor'
import { collectAvailableSlots, findBestDecorationPlacement } from '../src/decorations'
import { createWikiRef } from '../src/ids'
import { ARMOR_SLOTS } from '../src/model'
import { addSkillValues } from '../src/skills'
import { solveBuild } from '../src/solver'

const skillA = createWikiRef('skill', '1').id
const skillB = createWikiRef('skill', '2').id

function fixture(seed: number): BuildRequest {
  let state = seed + 1
  function random(max: number): number {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % max
  }
  function skills(): SkillValue[] {
    return [{ skillId: skillA, level: random(3) }, { skillId: skillB, level: random(3) }]
  }
  return {
    id: `case-${seed}`,
    armorBySlot: Object.fromEntries(ARMOR_SLOTS.map((slot, index) => [slot, Array.from({ length: index === seed % 5 ? 1 : 3 }, (_, variant) => createArmorVariant({
      ref: createWikiRef('armor', String(100 + index * 10 + variant)),
      slot,
      slots: [random(3), 0, 0],
      baseDefense: 100 + random(20),
      baseSkills: skills(),
      costBudget: 20,
    }))])) as unknown as BuildRequest['armorBySlot'],
    requiredSkills: [{ skillId: skillA, level: 4 + random(8) }, { skillId: skillB, level: 4 + random(8) }],
    decorations: [
      { ref: createWikiRef('decoration', '10'), slotLevel: 1, skills: [{ skillId: skillA, level: 1 }] },
      { ref: createWikiRef('decoration', '11'), slotLevel: 1, skills: [{ skillId: skillB, level: 1 }] },
      { ref: createWikiRef('decoration', '12'), slotLevel: 2, skills: [{ skillId: skillA, level: 1 }, { skillId: skillB, level: 1 }] },
    ],
    weapon: { ref: createWikiRef('weapon', '20'), skills: skills(), slots: [random(3), 0, 0] },
    talismans: [{
      ref: createWikiRef('talisman', '30'),
      skills: skills(),
      slots: [random(3), 0, 0],
      allowedSlots: undefined,
      maxSkills: undefined,
      maxSkillCount: undefined,
    }],
  }
}

// Deliberately enumerates every full armor set, without solver state merging
// or reachability checks, to catch incorrect filtering in the optimized path.
function exhaustiveScores(request: BuildRequest): number[][] {
  const scores: number[][] = []
  const armor = {} as Record<ArmorSlot, ArmorVariant>
  function visit(index: number): void {
    if (index < ARMOR_SLOTS.length) {
      const slot = ARMOR_SLOTS[index]
      for (const variant of request.armorBySlot[slot]) {
        armor[slot] = variant
        visit(index + 1)
      }
      return
    }
    for (const talisman of request.talismans) {
      const skills = addSkillValues(request.weapon.skills, talisman.skills, ...Object.values(armor).map(variant => variant.skills))
      const placement = findBestDecorationPlacement(collectAvailableSlots(request.weapon, armor, talisman), request.decorations, skills, request.requiredSkills)
      if (placement)
        scores.push([Object.values(armor).reduce((sum, variant) => sum + variant.defense, 0), placement.length])
    }
  }
  visit(0)
  return scores.sort((a, b) => b[0] - a[0] || a[1] - b[1])
}

describe('armor combination search', () => {
  it('handles 25 requested skills without materializing all skill subsets', () => {
    const request = fixture(0)
    const requiredSkills = Array.from({ length: 25 }, (_, index) => ({ skillId: createWikiRef('skill', String(1000 + index)).id, level: 1 }))
    const armorBySlot = Object.fromEntries(ARMOR_SLOTS.map((slot, index) => [slot, [createArmorVariant({
      ...request.armorBySlot[slot][0].base,
      baseSkills: requiredSkills.slice(index * 5, index * 5 + 5),
    })]])) as unknown as BuildRequest['armorBySlot']
    const result = solveBuild({ ...request, armorBySlot, requiredSkills }, { maxSolutions: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].decorations).toHaveLength(0)
  })

  it('matches exhaustive feasibility, defense and jewel counts for 80 varied requests', () => {
    for (let seed = 0; seed < 80; seed += 1) {
      const request = fixture(seed)
      const expected = exhaustiveScores(request)
      for (const maxSolutions of [1, 5]) {
        const actual = solveBuild(request, { maxSolutions }).map(solution => [solution.defense, solution.decorations.length])
        expect(actual, `seed ${seed}, top ${maxSolutions}`).toEqual(expected.slice(0, maxSolutions))
      }
    }
  })

  it('checks the restricted slot first and rejects impossible requirements before expanding every slot', () => {
    const request = fixture(4)
    const progress: SolveProgress[] = []
    const result = solveBuild({ ...request, requiredSkills: [{ skillId: skillA, level: 100 }] }, {
      preserveEquipmentIdentity: true,
      onProgress: update => progress.push(update),
    })
    expect(result).toEqual([])
    expect(progress.filter(update => update.stage === 'combining')).toEqual([
      { stage: 'combining', current: 0, total: 1 },
      { stage: 'combining', current: 1, total: 1 },
    ])
    expect(progress.at(-1)).toEqual({ stage: 'searching', current: 0, total: 0 })
  })
})
