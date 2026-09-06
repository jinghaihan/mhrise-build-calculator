import { describe, expect, it } from 'vitest'
import { createWikiId, createWikiRef } from '../src/ids'
import { isTalismanLegal } from '../src/talismans'

describe('talisman legality', () => {
  it('checks the allowed slot combinations from the source table', () => {
    const talisman = {
      allowedSlots: [[3, 2, 1] as const],
      maxSkillCount: 2,
      maxSkills: undefined,
      ref: createWikiRef('talisman', '3002'),
      skills: [],
      slots: [3, 2, 1] as const,
    }

    expect(isTalismanLegal(talisman)).toBe(true)
    expect(isTalismanLegal({ ...talisman, slots: [3, 1, 1] })).toBe(false)
  })

  it('checks each talisman skill against its maximum level', () => {
    const talisman = {
      allowedSlots: undefined,
      maxSkillCount: 2,
      maxSkills: [{ skillId: createWikiId('366824395'), level: 3 }],
      ref: createWikiRef('talisman', '3003'),
      skills: [{ skillId: createWikiId('366824395'), level: 3 }],
      slots: [2, 1, 0] as const,
    }

    expect(isTalismanLegal(talisman)).toBe(true)
    expect(isTalismanLegal({
      ...talisman,
      skills: [{ skillId: createWikiId('366824395'), level: 4 }],
    })).toBe(false)
  })

  it('rejects more skill entries than the source table allows', () => {
    const talisman = {
      allowedSlots: undefined,
      maxSkillCount: 2,
      maxSkills: undefined,
      ref: createWikiRef('talisman', '3004'),
      skills: [
        { skillId: createWikiId('1'), level: 1 },
        { skillId: createWikiId('2'), level: 1 },
        { skillId: createWikiId('3'), level: 1 },
      ],
      slots: [1, 1, 1] as const,
    }

    expect(isTalismanLegal(talisman)).toBe(false)
  })
})
