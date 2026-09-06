import type { WikiId } from './ids'
import type {
  BuildSolution,
  Decoration,
  DecorationPlacement,
  SkillValue,
  Talisman,
  Weapon,
} from './model'
import type { SlotLevels } from './slots'
import { addSkillValues, meetsSkillRequirements } from './skills'

export interface AvailableSlot {
  readonly host: DecorationPlacement['host']
  readonly index: number
  readonly level: number
}

export function collectAvailableSlots(
  weapon: Weapon,
  armor: BuildSolution['armor'],
  talisman: Talisman,
): AvailableSlot[] {
  const slots: AvailableSlot[] = []
  appendSlots(slots, 'weapon', weapon.slots)

  for (const host of ['head', 'chest', 'arms', 'waist', 'legs'] as const) {
    appendSlots(slots, host, armor[host].slots)
  }

  appendSlots(slots, 'talisman', talisman.slots)
  return slots.sort((left, right) => right.level - left.level)
}

export function findDecorationPlacements(
  availableSlots: readonly AvailableSlot[],
  decorations: readonly Decoration[],
  currentSkills: readonly SkillValue[],
  requirements: readonly SkillValue[],
  maxResults = Number.POSITIVE_INFINITY,
): DecorationPlacement[][] {
  const results: DecorationPlacement[][] = []
  const usefulDecorations = decorations.filter(decoration =>
    decoration.skills.some(skill =>
      requirements.some(
        requirement =>
          requirement.skillId === skill.skillId
          && getCurrentSkillLevel(currentSkills, skill.skillId) < requirement.level,
      ),
    ),
  )
  const remainingMaximums = createRemainingMaximums(
    availableSlots,
    usefulDecorations,
    requirements,
  )

  function search(
    slotIndex: number,
    skills: readonly SkillValue[],
    placements: readonly DecorationPlacement[],
  ): void {
    if (results.length >= maxResults) {
      return
    }

    if (meetsSkillRequirements(skills, requirements)) {
      results.push([...placements])
      return
    }

    if (slotIndex >= availableSlots.length) {
      return
    }

    if (!canReachRequirements(skills, requirements, remainingMaximums[slotIndex])) {
      return
    }

    const slot = availableSlots[slotIndex]
    search(slotIndex + 1, skills, placements)

    for (const decoration of usefulDecorations) {
      if (decoration.slotLevel > slot.level) {
        continue
      }

      search(
        slotIndex + 1,
        addSkillValues(skills, decoration.skills),
        [
          ...placements,
          {
            decoration,
            host: slot.host,
            slotIndex: slot.index,
          },
        ],
      )
    }
  }

  search(0, currentSkills, [])
  return results
}

function createRemainingMaximums(
  slots: readonly AvailableSlot[],
  decorations: readonly Decoration[],
  requirements: readonly SkillValue[],
): readonly (readonly number[])[] {
  const maximums = Array.from(
    { length: slots.length + 1 },
    () => requirements.map(() => 0),
  )

  for (let slotIndex = slots.length - 1; slotIndex >= 0; slotIndex -= 1) {
    const slot = slots[slotIndex]
    maximums[slotIndex] = requirements.map((requirement, requirementIndex) => {
      const maximumDecorationLevel = Math.max(
        0,
        ...decorations
          .filter(decoration => decoration.slotLevel <= slot.level)
          .map(decoration => getCurrentSkillLevel(decoration.skills, requirement.skillId)),
      )

      return maximumDecorationLevel + maximums[slotIndex + 1][requirementIndex]
    })
  }

  return maximums
}

function canReachRequirements(
  skills: readonly SkillValue[],
  requirements: readonly SkillValue[],
  remainingMaximums: readonly number[],
): boolean {
  return requirements.every((requirement, index) => {
    const currentLevel = getCurrentSkillLevel(skills, requirement.skillId)
    const maximumRemainingLevel = remainingMaximums[index] ?? 0
    return currentLevel + maximumRemainingLevel >= requirement.level
  })
}

function appendSlots(
  target: AvailableSlot[],
  host: AvailableSlot['host'],
  slots: SlotLevels,
): void {
  slots.forEach((level, index) => {
    if (level > 0) {
      target.push({ host, index, level })
    }
  })
}

function getCurrentSkillLevel(skills: readonly SkillValue[], skillId: WikiId): number {
  return skills.find(skill => skill.skillId === skillId)?.level ?? 0
}
