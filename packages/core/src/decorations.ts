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
