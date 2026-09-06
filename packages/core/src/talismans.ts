import type { Talisman } from './model'

export function isTalismanLegal(talisman: Talisman): boolean {
  if (!talisman.maxSkills) {
    return true
  }

  return talisman.skills.every(skill =>
    talisman.maxSkills?.some(
      maximum => maximum.skillId === skill.skillId && maximum.level >= skill.level,
    ),
  )
}
