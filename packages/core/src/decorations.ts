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

/** Find one minimum-jewel solution, treating equal-sized sockets as interchangeable. */
export function findBestDecorationPlacement(
  availableSlots: readonly AvailableSlot[],
  decorations: readonly Decoration[],
  currentSkills: readonly SkillValue[],
  requirements: readonly SkillValue[],
): DecorationPlacement[] | undefined {
  const initialMissing = requirements.map(requirement => Math.max(0, requirement.level - getCurrentSkillLevel(currentSkills, requirement.skillId)))
  const candidates = decorations.map(decoration => ({
    decoration,
    levels: requirements.map(requirement => getCurrentSkillLevel(decoration.skills, requirement.skillId)),
  })).filter(candidate => candidate.levels.some((level, index) => level > 0 && initialMissing[index] > 0))
  const sockets = [1, 2, 3, 4].map(level => availableSlots.filter(slot => slot.level === level))
  interface Choice { candidateIndex: number, socketIndex: number }
  const memo = new Map<string, readonly Choice[] | undefined>()

  function search(counts: readonly number[], missing: readonly number[]): readonly Choice[] | undefined {
    if (missing.every(level => level === 0))
      return []
    const key = `${counts.join(',')}|${missing.join(',')}`
    if (memo.has(key))
      return memo.get(key)

    const usable = candidates.flatMap((candidate, candidateIndex) => {
      const socketIndex = counts.findIndex((count, index) => count > 0 && index + 1 >= candidate.decoration.slotLevel)
      return socketIndex < 0 ? [] : [{ candidateIndex, socketIndex }]
    })
    let choices: typeof usable | undefined
    for (const [index, level] of missing.entries()) {
      if (level === 0)
        continue
      const matching = usable.filter(choice => candidates[choice.candidateIndex].levels[index] > 0)
      const maximum = counts.reduce((total, count, socketIndex) => total + count * Math.max(0, ...matching.filter(choice => candidates[choice.candidateIndex].decoration.slotLevel <= socketIndex + 1)
        .map(choice => candidates[choice.candidateIndex].levels[index])), 0)
      if (maximum < level) {
        memo.set(key, undefined)
        return undefined
      }
      if (!choices || matching.length < choices.length)
        choices = matching
    }

    let best: readonly Choice[] | undefined
    for (const choice of choices ?? []) {
      const nextCounts = [...counts]
      nextCounts[choice.socketIndex] -= 1
      const nextMissing = missing.map((level, index) => Math.max(0, level - candidates[choice.candidateIndex].levels[index]))
      const rest = search(nextCounts, nextMissing)
      if (rest && (!best || rest.length + 1 < best.length)) {
        best = [choice, ...rest]
        if (best.length === 1)
          break
      }
    }
    memo.set(key, best)
    return best
  }

  return search(sockets.map(slots => slots.length), initialMissing)?.map((choice) => {
    const slot = sockets[choice.socketIndex].pop()!
    return { decoration: candidates[choice.candidateIndex].decoration, host: slot.host, slotIndex: slot.index }
  })
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
  ).sort((left, right) => right.slotLevel - left.slotLevel)
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
