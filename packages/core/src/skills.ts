import type { WikiId } from './ids'
import type { SkillValue } from './model'

export function addSkillValues(...sources: readonly (readonly SkillValue[])[]): SkillValue[] {
  const totals = new Map<SkillValue['skillId'], number>()

  for (const source of sources) {
    for (const skill of source) {
      totals.set(skill.skillId, (totals.get(skill.skillId) ?? 0) + skill.level)
    }
  }

  return [...totals.entries()]
    .filter(([, level]) => level !== 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([skillId, level]) => ({ skillId, level }))
}

export function applySkillChanges(
  base: readonly SkillValue[],
  changes: readonly SkillValue[],
): SkillValue[] {
  return addSkillValues(base, changes)
}

export function countActiveSkills(skills: readonly SkillValue[]): number {
  return skills.filter(skill => skill.level > 0).length
}

export function getSkillLevel(skills: readonly SkillValue[], skillId: WikiId): number {
  return skills.find(skill => skill.skillId === skillId)?.level ?? 0
}

export function meetsSkillRequirements(
  skills: readonly SkillValue[],
  requirements: readonly SkillValue[],
): boolean {
  return requirements.every(
    requirement => getSkillLevel(skills, requirement.skillId) >= requirement.level,
  )
}
