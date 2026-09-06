import type { Talisman } from './model'

export function isTalismanLegal(talisman: Talisman): boolean {
  if (talisman.allowedSlots && !talisman.allowedSlots.some(slots => sameSlots(slots, talisman.slots))) {
    return false
  }

  if (talisman.maxSkillCount !== undefined && talisman.skills.length > talisman.maxSkillCount) {
    return false
  }

  if (!talisman.maxSkills) {
    return true
  }

  return talisman.skills.every(skill => talisman.maxSkills?.some(
    maximum => maximum.skillId === skill.skillId && maximum.level >= skill.level,
  ))
}

function sameSlots(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((level, index) => level === right[index])
}
