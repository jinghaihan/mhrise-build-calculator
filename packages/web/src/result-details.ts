import type { ArmorVariant, BuildSolution, DecorationPlacement } from '@mhrise-build/core'
import { addSkillValues } from '@mhrise-build/core'

export function summarizeDecorations(placements: readonly DecorationPlacement[]) {
  const groups = new Map<string, { decoration: DecorationPlacement['decoration'], placements: DecorationPlacement[] }>()
  for (const placement of placements) {
    const id = placement.decoration.ref.id
    const group = groups.get(id) ?? { decoration: placement.decoration, placements: [] }
    group.placements.push(placement)
    groups.set(id, group)
  }
  return [...groups.values()].map(group => ({ ...group, count: group.placements.length }))
}

export function armorSkillChanges(variant: ArmorVariant) {
  return addSkillValues(variant.skills, variant.base.baseSkills.map(skill => ({ ...skill, level: -skill.level })))
}

export function equipmentRows(solution: BuildSolution) {
  return [
    { host: 'weapon' as const, slots: solution.weapon.slots, skills: solution.weapon.skills, armor: undefined },
    ...(['head', 'chest', 'arms', 'waist', 'legs'] as const).map(host => ({
      host,
      slots: solution.armor[host].slots,
      skills: solution.armor[host].skills,
      armor: solution.armor[host],
    })),
    { host: 'talisman' as const, slots: solution.talisman.slots, skills: solution.talisman.skills, armor: undefined },
  ].map(row => ({
    ...row,
    sockets: row.slots.map((level, index) => ({
      level,
      index,
      decoration: solution.decorations.find(placement => placement.host === row.host && placement.slotIndex === index)?.decoration,
    })),
  }))
}
