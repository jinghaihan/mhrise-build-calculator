import type { ArmorSlot, ArmorVariant, BuildSolution, Decoration, DecorationPlacement } from '@mhrise-build-tools/core'
import { createArmorVariant, createWikiRef } from '@mhrise-build-tools/core'
import { describe, expect, it } from 'vitest'
import { armorSkillChanges, equipmentRows, summarizeDecorations } from '../src/result-details'

const attack = createWikiRef('skill', '1').id
const defense = createWikiRef('skill', '2').id
const jewel: Decoration = { ref: createWikiRef('decoration', '10'), slotLevel: 2, skills: [{ skillId: attack, level: 1 }] }

function armor(slot: ArmorSlot): ArmorVariant {
  return createArmorVariant({
    ref: createWikiRef('armor', '100'),
    slot,
    baseDefense: 100,
    baseSkills: [{ skillId: attack, level: 1 }, { skillId: defense, level: 2 }],
    costBudget: 20,
    slots: [2, 1, 0],
  })
}

function solution(decorations: DecorationPlacement[]): BuildSolution {
  return {
    id: 'test',
    armor: { head: armor('head'), chest: armor('chest'), arms: armor('arms'), waist: armor('waist'), legs: armor('legs') },
    defense: 500,
    skills: [{ skillId: attack, level: 7 }],
    decorations,
    weapon: { ref: createWikiRef('weapon', '20'), slots: [3, 2, 0], skills: [] },
    talisman: { ref: createWikiRef('talisman', '30'), slots: [2, 0, 0], skills: [], allowedSlots: undefined, maxSkillCount: undefined, maxSkills: undefined },
  }
}

describe('build result details', () => {
  it('counts each jewel by its identity and retains every placement', () => {
    const otherJewel = { ...jewel, ref: createWikiRef('decoration', '11') }
    const placements: DecorationPlacement[] = [
      { decoration: jewel, host: 'weapon', slotIndex: 1 },
      { decoration: jewel, host: 'head', slotIndex: 0 },
      { decoration: otherJewel, host: 'talisman', slotIndex: 0 },
    ]
    const groups = summarizeDecorations(placements)
    expect(groups.map(group => group.count)).toEqual([2, 1])
    expect(groups[0].placements).toEqual(placements.slice(0, 2))
    expect(groups.reduce((total, group) => total + group.count, 0)).toBe(placements.length)
    expect(summarizeDecorations([])).toEqual([])
  })

  it('preserves seven hosts, socket indices, capacities and empty sockets', () => {
    const rows = equipmentRows(solution([
      { decoration: jewel, host: 'weapon', slotIndex: 1 },
      { decoration: jewel, host: 'talisman', slotIndex: 0 },
    ]))
    expect(rows.map(row => row.host)).toEqual(['weapon', 'head', 'chest', 'arms', 'waist', 'legs', 'talisman'])
    expect(rows[0].sockets).toEqual([
      { level: 3, index: 0, decoration: undefined },
      { level: 2, index: 1, decoration: jewel },
      { level: 0, index: 2, decoration: undefined },
    ])
    expect(rows[1].sockets.every(socket => !socket.decoration)).toBe(true)
    expect(rows[6].sockets[0].decoration).toBe(jewel)
    expect(rows.flatMap(row => row.sockets).filter(socket => socket.decoration)).toHaveLength(2)
  })

  it('shows net skill additions and removals without unchanged skills', () => {
    const base = armor('head')
    expect(armorSkillChanges(base)).toEqual([])
    expect(armorSkillChanges({ ...base, skills: [{ skillId: attack, level: 3 }] })).toEqual([
      { skillId: attack, level: 2 },
      { skillId: defense, level: -2 },
    ])
  })
})
