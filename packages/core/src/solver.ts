import type { ArmorSlot, ArmorVariant, BuildRequest, BuildSolution, SkillValue } from './model'
import { collectAvailableSlots, findDecorationPlacements } from './decorations'
import { getTotalArmorDefense } from './defense'
import { ARMOR_SLOTS } from './model'
import { addSkillValues, getSkillLevel, meetsSkillRequirements } from './skills'
import { isTalismanLegal } from './talismans'

export interface SolveOptions {
  readonly maxSolutions?: number
  /** Keep equivalent talismans and partial armor identities for reuse planning. */
  readonly preserveEquipmentIdentity?: boolean
}

const DEFAULT_MAX_SOLUTIONS = 200

export function solveBuild(
  request: BuildRequest,
  options: SolveOptions = {},
): BuildSolution[] {
  const maxSolutions = options.maxSolutions ?? DEFAULT_MAX_SOLUTIONS
  const solutions: BuildSolution[] = []
  const preserveEquipmentIdentity = options.preserveEquipmentIdentity ?? false
  const workingRequest = {
    ...request,
    decorations: preserveEquipmentIdentity
      ? request.decorations
      : dedupeDecorations(request.decorations),
    talismans: preserveEquipmentIdentity
      ? request.talismans.filter(isTalismanLegal)
      : dedupeTalismans(request.talismans.filter(isTalismanLegal)),
  }
  const legalTalismans = workingRequest.talismans
  const bounds = createSearchBounds(workingRequest, legalTalismans)
  const armorBySlot = Object.fromEntries(ARMOR_SLOTS.map(slot => [
    slot,
    orderArmorCandidates(createSearchCandidates(
      workingRequest.armorBySlot[slot],
      workingRequest.requiredSkills,
      preserveEquipmentIdentity,
      maxSolutions,
    ), workingRequest.requiredSkills),
  ])) as unknown as typeof request.armorBySlot
  const armorStates = createArmorStates(
    armorBySlot,
    workingRequest.requiredSkills,
    preserveEquipmentIdentity,
    maxSolutions,
  )
  const orderedTalismans = orderTalismanCandidates(
    legalTalismans,
    request.requiredSkills,
    preserveEquipmentIdentity,
  )

  function searchTalismans(
    skills: readonly SkillValue[],
    armor: Readonly<Record<ArmorSlot, ArmorVariant>>,
  ): void {
    if (!canReachRequirements(workingRequest, bounds, ARMOR_SLOTS.length, skills)) {
      return
    }

    for (const talisman of orderedTalismans) {
      if (solutions.length >= maxSolutions
        && getTotalArmorDefense(armor) <= (solutions[solutions.length - 1]?.defense ?? 0)) {
        return
      }

      const totalSkills = addSkillValues(skills, workingRequest.weapon.skills, talisman.skills)
      const slots = collectAvailableSlots(request.weapon, armor, talisman)

      if (!canReachWithDecorations(
        totalSkills,
        slots,
        workingRequest.decorations,
        workingRequest.requiredSkills,
      )) {
        continue
      }

      const placements = findDecorationPlacements(
        slots,
        workingRequest.decorations,
        totalSkills,
        workingRequest.requiredSkills,
        maxSolutions - solutions.length,
      )

      for (const decorations of placements) {
        const finalSkills = decorations.reduce(
          (current, placement) => addSkillValues(current, placement.decoration.skills),
          totalSkills,
        )

        if (!meetsSkillRequirements(finalSkills, workingRequest.requiredSkills)) {
          continue
        }

        addSolution({
          armor,
          decorations,
          defense: getTotalArmorDefense(armor),
          id: workingRequest.id,
          skills: finalSkills,
          talisman,
          weapon: workingRequest.weapon,
        })
      }
    }
  }

  function addSolution(solution: BuildSolution): void {
    solutions.push(solution)
    solutions.sort(compareSolutions)

    if (solutions.length > maxSolutions) {
      solutions.pop()
    }
  }

  for (const state of armorStates) {
    if (solutions.length >= maxSolutions
      && getArmorStateDefense(state.armor) <= (solutions[solutions.length - 1]?.defense ?? 0)) {
      break
    }
    searchTalismans(
      getArmorSkills(state.armor as Record<ArmorSlot, ArmorVariant>),
      state.armor as Record<ArmorSlot, ArmorVariant>,
    )
  }
  return solutions
}

function compareSolutions(left: BuildSolution, right: BuildSolution): number {
  return right.defense - left.defense
    || left.decorations.length - right.decorations.length
    || left.talisman.ref.id.localeCompare(right.talisman.ref.id)
}

interface ArmorSearchState {
  readonly armor: Readonly<Partial<Record<ArmorSlot, ArmorVariant>>>
  readonly requiredLevels: readonly number[]
  readonly slotCounts: readonly number[]
}

function createArmorStates(
  armorBySlot: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
  requirements: readonly SkillValue[],
  preserveEquipmentIdentity: boolean,
  maxSolutions: number,
): ArmorSearchState[] {
  let states: ArmorSearchState[] = [{
    armor: {},
    requiredLevels: requirements.map(() => 0),
    slotCounts: [0, 0, 0, 0, 0],
  }]

  for (const slot of ARMOR_SLOTS) {
    const next = new Map<string, ArmorSearchState[]>()

    for (const state of states) {
      for (const variant of armorBySlot[slot]) {
        const armor = { ...state.armor, [slot]: variant } as Record<ArmorSlot, ArmorVariant>
        const requiredLevels = requirements.map((requirement, index) => Math.min(
          requirement.level,
          state.requiredLevels[index] + getSkillLevel(variant.skills, requirement.skillId),
        ))
        const slotCounts = [...state.slotCounts]
        for (const level of variant.slots) {
          slotCounts[level] += 1
        }
        const nextState = { armor, requiredLevels, slotCounts }

        if (preserveEquipmentIdentity) {
          next.set(`${next.size}`, [nextState])
          continue
        }

        const key = `${requiredLevels.join(',')}|${slotCounts.join(',')}`
        const alternatives = next.get(key) ?? []
        alternatives.push(nextState)
        alternatives.sort((left, right) => getArmorStateDefense(right.armor)
          - getArmorStateDefense(left.armor))
        if (alternatives.length > maxSolutions) {
          alternatives.pop()
        }
        next.set(key, alternatives)
      }
    }

    states = [...next.values()].flat().sort((left, right) => compareArmorStates(
      left,
      right,
    ))

    if (!preserveEquipmentIdentity && maxSolutions === 1) {
      states = pruneDominatedArmorStates(states)
    }
  }

  return states
}

function compareArmorStates(
  left: ArmorSearchState,
  right: ArmorSearchState,
): number {
  return getArmorStateDefense(right.armor) - getArmorStateDefense(left.armor)
    || requiredSkillScore(right.requiredLevels) - requiredSkillScore(left.requiredLevels)
    || slotCountScore(right.slotCounts) - slotCountScore(left.slotCounts)
}

function pruneDominatedArmorStates(states: readonly ArmorSearchState[]): ArmorSearchState[] {
  const frontier: ArmorSearchState[] = []

  for (const state of states) {
    if (frontier.some(candidate => dominatesArmorState(candidate, state))) {
      continue
    }

    for (let index = frontier.length - 1; index >= 0; index -= 1) {
      if (dominatesArmorState(state, frontier[index])) {
        frontier.splice(index, 1)
      }
    }

    frontier.push(state)
  }

  return frontier
}

function dominatesArmorState(left: ArmorSearchState, right: ArmorSearchState): boolean {
  return left.requiredLevels.every((level, index) => level >= right.requiredLevels[index])
    && slotsCoverCounts(left.slotCounts, right.slotCounts)
    && getArmorStateDefense(left.armor) >= getArmorStateDefense(right.armor)
    && (
      left.requiredLevels.some((level, index) => level > right.requiredLevels[index])
      || left.slotCounts.some((count, index) => count > right.slotCounts[index])
      || getArmorStateDefense(left.armor) > getArmorStateDefense(right.armor)
    )
}

function slotsCoverCounts(left: readonly number[], right: readonly number[]): boolean {
  for (let level = 1; level <= 4; level += 1) {
    const leftCount = left.slice(level).reduce((total, count) => total + count, 0)
    const rightCount = right.slice(level).reduce((total, count) => total + count, 0)
    if (leftCount < rightCount) {
      return false
    }
  }

  return true
}

function requiredSkillScore(
  levels: readonly number[],
): number {
  return levels.reduce((total, level) => total + level, 0)
}

function slotCountScore(counts: readonly number[]): number {
  return counts.reduce((total, count, level) => total + count * level, 0)
}

function getArmorStateDefense(
  armor: Partial<Readonly<Record<ArmorSlot, ArmorVariant>>>,
): number {
  return Object.values(armor).reduce((total, variant) => total + (variant?.defense ?? 0), 0)
}

function getArmorSkills(
  armor: Readonly<Record<ArmorSlot, ArmorVariant>>,
): SkillValue[] {
  return addSkillValues(...ARMOR_SLOTS.map(slot => armor[slot].skills))
}

/**
 * Variants with the same requested skills, slots, and resistances are
 * interchangeable for one build, so retain the highest-defense representative.
 * Reuse planning disables this coalescing and keeps every equipment identity.
 */
function createSearchCandidates(
  candidates: readonly ArmorVariant[],
  requirements: readonly SkillValue[],
  preserveEquipmentIdentity: boolean,
  maxSolutions: number,
): ArmorVariant[] {
  if (preserveEquipmentIdentity) {
    return [...candidates]
  }

  const equivalent = new Map<string, ArmorVariant[]>()

  for (const candidate of candidates) {
    const key = [
      requirements.map(requirement => `${requirement.skillId}:${Math.min(
        getSkillLevel(candidate.skills, requirement.skillId),
        requirement.level,
      )}`).join(','),
      candidate.slots.join(','),
      candidate.resistances.dragon,
      candidate.resistances.fire,
      candidate.resistances.ice,
      candidate.resistances.thunder,
      candidate.resistances.water,
    ].join('|')
    const alternatives = equivalent.get(key) ?? []
    alternatives.push(candidate)
    alternatives.sort((left, right) => right.defense - left.defense)
    if (alternatives.length > maxSolutions) {
      alternatives.pop()
    }
    equivalent.set(key, alternatives)
  }

  return [...equivalent.values()].flat()
}

function dedupeDecorations(
  decorations: readonly BuildRequest['decorations'][number][],
): BuildRequest['decorations'] {
  return [...new Map(decorations.map(decoration => [
    `${decoration.slotLevel}|${skillKey(decoration.skills)}`,
    decoration,
  ])).values()]
}

function dedupeTalismans(
  talismans: readonly BuildRequest['talismans'][number][],
): BuildRequest['talismans'] {
  return [...new Map(talismans.map(talisman => [
    `${talisman.slots.join(',')}|${skillKey(talisman.skills)}`,
    talisman,
  ])).values()]
}

function orderTalismanCandidates(
  talismans: readonly BuildRequest['talismans'][number][],
  requirements: readonly SkillValue[],
  preserveEquipmentIdentity: boolean,
): BuildRequest['talismans'] {
  const ordered = [...talismans].sort((left, right) => compareTalismanCandidates(
    right,
    left,
    requirements,
  ))

  if (preserveEquipmentIdentity) {
    return ordered
  }

  return ordered.filter((candidate, candidateIndex) => !ordered.some((other, otherIndex) => {
    if (candidateIndex === otherIndex) {
      return false
    }

    return requirements.every(requirement => getSkillLevel(other.skills, requirement.skillId)
      >= getSkillLevel(candidate.skills, requirement.skillId))
    && slotsCover(other.slots, candidate.slots)
  }))
}

function slotsCover(left: readonly number[], right: readonly number[]): boolean {
  const sortedLeft = [...left].sort((a, b) => b - a)
  const sortedRight = [...right].sort((a, b) => b - a)
  return sortedRight.every((level, index) => (sortedLeft[index] ?? 0) >= level)
}

function skillKey(skills: readonly SkillValue[]): string {
  return [...skills]
    .sort((left, right) => String(left.skillId).localeCompare(String(right.skillId)))
    .map(skill => `${skill.skillId}:${skill.level}`)
    .join(',')
}

function canReachWithDecorations(
  currentSkills: readonly SkillValue[],
  slots: readonly { level: number }[],
  decorations: readonly BuildRequest['decorations'][number][],
  requirements: readonly SkillValue[],
): boolean {
  return requirements.every((requirement) => {
    const maximum = slots.reduce((total, slot) => total + Math.max(
      0,
      ...decorations
        .filter(decoration => decoration.slotLevel <= slot.level)
        .map(decoration => getSkillLevel(decoration.skills, requirement.skillId)),
    ), 0)

    return getSkillLevel(currentSkills, requirement.skillId) + maximum >= requirement.level
  })
}

function compareArmorCandidates(
  left: ArmorVariant,
  right: ArmorVariant,
  requirements: readonly SkillValue[],
): number {
  const leftSkillScore = requirements.reduce((total, requirement) => total
    + Math.min(getSkillLevel(left.skills, requirement.skillId), requirement.level), 0)
  const rightSkillScore = requirements.reduce((total, requirement) => total
    + Math.min(getSkillLevel(right.skills, requirement.skillId), requirement.level), 0)

  return leftSkillScore - rightSkillScore
    || left.slots.reduce((total, level) => total + level, 0)
    - right.slots.reduce((total, level) => total + level, 0)
    || left.defense - right.defense
}

function orderArmorCandidates(
  candidates: readonly ArmorVariant[],
  requirements: readonly SkillValue[],
): ArmorVariant[] {
  return [...candidates].sort((left, right) => compareArmorCandidates(
    right,
    left,
    requirements,
  ))
}

function compareTalismanCandidates(
  left: BuildRequest['talismans'][number],
  right: BuildRequest['talismans'][number],
  requirements: readonly SkillValue[],
): number {
  const leftSkillScore = requirements.reduce((total, requirement) => total
    + Math.min(getSkillLevel(left.skills, requirement.skillId), requirement.level), 0)
  const rightSkillScore = requirements.reduce((total, requirement) => total
    + Math.min(getSkillLevel(right.skills, requirement.skillId), requirement.level), 0)

  return leftSkillScore - rightSkillScore
    || left.slots.reduce((total, level) => total + level, 0)
    - right.slots.reduce((total, level) => total + level, 0)
}

interface SearchBounds {
  readonly armorSkills: readonly (readonly number[])[]
  readonly armorSlots: readonly (readonly number[])[]
  readonly decorationSkillsBySlotLevel: readonly (readonly number[])[]
  readonly talismanSkills: readonly number[]
  readonly talismanSlots: readonly number[]
}

function createSearchBounds(
  request: BuildRequest,
  legalTalismans: readonly BuildRequest['talismans'][number][],
): SearchBounds {
  const armorSkills = ARMOR_SLOTS.map(slot => request.requiredSkills.map(requirement => Math.max(
    0,
    ...request.armorBySlot[slot].map(armor => getSkillLevel(armor.skills, requirement.skillId)),
  )))
  const armorSlots = ARMOR_SLOTS.map(slot => [0, 1, 2].map(index => Math.max(
    0,
    ...request.armorBySlot[slot].map(armor => armor.slots[index]),
  )))
  const decorationSkillsBySlotLevel = Array.from(
    { length: 5 },
    (_, slotLevel) => request.requiredSkills.map(requirement => Math.max(
      0,
      ...request.decorations
        .filter(decoration => decoration.slotLevel <= slotLevel)
        .map(decoration => getSkillLevel(decoration.skills, requirement.skillId)),
    )),
  )

  return {
    armorSkills,
    armorSlots,
    decorationSkillsBySlotLevel,
    talismanSkills: request.requiredSkills.map(requirement => Math.max(
      0,
      ...legalTalismans.map(talisman => getSkillLevel(talisman.skills, requirement.skillId)),
    )),
    talismanSlots: [0, 1, 2].map(index => Math.max(
      0,
      ...legalTalismans.map(talisman => talisman.slots[index]),
    )),
  }
}

function canReachRequirements(
  request: BuildRequest,
  bounds: SearchBounds,
  slotIndex: number,
  currentSkills: readonly SkillValue[],
): boolean {
  const potentialSlotLevels = [
    ...request.weapon.slots,
    ...bounds.armorSlots.flat(),
    ...bounds.talismanSlots,
  ]

  return request.requiredSkills.every((requirement, requirementIndex) => {
    const armorMaximum = bounds.armorSkills
      .slice(slotIndex)
      .reduce((total, skills) => total + (skills[requirementIndex] ?? 0), 0)
    const decorationMaximum = potentialSlotLevels.reduce(
      (total, slotLevel) => total + (bounds.decorationSkillsBySlotLevel[slotLevel]?.[requirementIndex] ?? 0),
      0,
    )
    const potential = getSkillLevel(currentSkills, requirement.skillId)
      + getSkillLevel(request.weapon.skills, requirement.skillId)
      + (bounds.talismanSkills[requirementIndex] ?? 0)
      + armorMaximum
      + decorationMaximum

    return potential >= requirement.level
  })
}
