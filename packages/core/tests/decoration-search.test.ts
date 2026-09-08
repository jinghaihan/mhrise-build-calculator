import type { AvailableSlot } from '../src/decorations'
import { describe, expect, it } from 'vitest'
import { findBestDecorationPlacement, findDecorationPlacements } from '../src/decorations'
import { createWikiId, createWikiRef } from '../src/ids'

const attack = createWikiId('1')
const defense = createWikiId('2')
const decorations = [
  { ref: createWikiRef('decoration', '10'), slotLevel: 1, skills: [{ skillId: attack, level: 1 }] },
  { ref: createWikiRef('decoration', '11'), slotLevel: 2, skills: [{ skillId: attack, level: 2 }] },
  { ref: createWikiRef('decoration', '12'), slotLevel: 1, skills: [{ skillId: defense, level: 1 }] },
  { ref: createWikiRef('decoration', '13'), slotLevel: 2, skills: [{ skillId: attack, level: 1 }, { skillId: defense, level: 1 }] },
]

describe('minimum decoration search', () => {
  it('matches exhaustive slot assignment for varied skills, sockets and compound jewels', () => {
    for (const levels of [[1, 1], [2, 1, 1], [1, 2, 2], [4, 2, 1], []]) {
      const slots: AvailableSlot[] = levels.map((level, index) => ({ host: 'weapon', index, level }))
      for (let a = 0; a <= 4; a += 1) {
        for (let b = 0; b <= 3; b += 1) {
          const requirements = [{ skillId: attack, level: a }, { skillId: defense, level: b }]
          const exhaustive = findDecorationPlacements(slots, decorations, [], requirements)
          const best = findBestDecorationPlacement(slots, decorations, [], requirements)
          expect(best?.length ?? Infinity).toBe(Math.min(...exhaustive.map(plan => plan.length)))
          if (best) {
            expect(new Set(best.map(placement => placement.slotIndex)).size).toBe(best.length)
            expect(best.every(placement => placement.decoration.slotLevel <= slots[placement.slotIndex].level)).toBe(true)
          }
        }
      }
    }
  })
})
