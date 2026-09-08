import type { ArmorSlot, ArmorVariant, BuildRequest, BuildSolution, Decoration, SkillValue } from './model'
import { collectAvailableSlots, findBestDecorationPlacement } from './decorations'
import { getTotalArmorDefense } from './defense'
import { ARMOR_SLOTS } from './model'
import { addSkillValues, getSkillLevel, meetsSkillRequirements } from './skills'
import { isTalismanLegal } from './talismans'

export interface SolveOptions {
  readonly maxSolutions?: number
  readonly onProgress?: (progress: SolveProgress) => void
  readonly onSolutions?: (solutions: readonly BuildSolution[]) => void
  /** Keep equivalent talismans and partial armor identities for reuse planning. */
  readonly preserveEquipmentIdentity?: boolean
}

export interface SolveProgress {
  readonly current: number
  readonly stage: 'combining' | 'searching'
  readonly total: number
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
  const decorationPlans = new Map<string, readonly { decoration: Decoration, level: number }[] | null>()
  const legalTalismans = workingRequest.talismans
  const armorBySlot = Object.fromEntries(ARMOR_SLOTS.map(slot => [
    slot,
    orderArmorCandidates(createSearchCandidates(
      workingRequest.armorBySlot[slot],
      workingRequest.requiredSkills,
      preserveEquipmentIdentity,
      maxSolutions,
    ), workingRequest.requiredSkills),
  ])) as unknown as typeof request.armorBySlot
  const orderedTalismans = orderTalismanCandidates(
    legalTalismans,
    request.requiredSkills,
    preserveEquipmentIdentity,
  )

  const armorStates = createArmorStates(
    armorBySlot,
    workingRequest.requiredSkills,
    preserveEquipmentIdentity,
    maxSolutions,
    workingRequest,
    options.onProgress,
  )
  options.onProgress?.({ current: 0, stage: 'searching', total: armorStates.length })
  let processedStates = 0
  function searchTalismans(
    skills: readonly SkillValue[],
    armor: Readonly<Record<ArmorSlot, ArmorVariant>>,
  ): void {
    for (const talisman of orderedTalismans) {
      if (solutions.length >= maxSolutions
        && getTotalArmorDefense(armor) < (solutions[solutions.length - 1]?.defense ?? 0)) {
        return
      }

      const totalSkills = addSkillValues(skills, workingRequest.weapon.skills, talisman.skills)
      const slots = collectAvailableSlots(request.weapon, armor, talisman)

      const decorationKey = [
        workingRequest.requiredSkills.map(requirement => `${requirement.skillId}:${Math.min(
          getSkillLevel(totalSkills, requirement.skillId),
          requirement.level,
        )}`).join(','),
        slots.map(slot => slot.level).sort((left, right) => right - left).join(','),
      ].join('|')
      if (!decorationPlans.has(decorationKey)) {
        const plan = findBestDecorationPlacement(
          slots,
          workingRequest.decorations,
          totalSkills,
          workingRequest.requiredSkills,
        )
        decorationPlans.set(decorationKey, plan?.map(placement => ({
          decoration: placement.decoration,
          level: slots.find(slot => slot.host === placement.host && slot.index === placement.slotIndex)!.level,
        })) ?? null)
      }
      const plan = decorationPlans.get(decorationKey)
      if (plan) {
        const remainingSlots = [...slots]
        const decorations = plan.map(({ decoration, level }) => {
          const index = remainingSlots.findIndex(slot => slot.level === level)
          const [slot] = remainingSlots.splice(index, 1)
          return { decoration, host: slot.host, slotIndex: slot.index }
        })
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
    if (maxSolutions === Number.POSITIVE_INFINITY)
      return
    solutions.sort(compareSolutions)

    if (solutions.length > maxSolutions) {
      solutions.pop()
    }
    options.onSolutions?.([...solutions])
  }

  for (const state of armorStates) {
    if (solutions.length >= maxSolutions
      && state.defense < (solutions[solutions.length - 1]?.defense ?? 0)) {
      break
    }
    searchTalismans(
      getArmorSkills(state.armor as Record<ArmorSlot, ArmorVariant>),
      state.armor as Record<ArmorSlot, ArmorVariant>,
    )
    processedStates += 1
    options.onProgress?.({
      current: processedStates,
      stage: 'searching',
      total: armorStates.length,
    })
  }
  options.onProgress?.({ current: armorStates.length, stage: 'searching', total: armorStates.length })
  return solutions.sort(compareSolutions)
}

function compareSolutions(left: BuildSolution, right: BuildSolution): number {
  return right.defense - left.defense
    || left.decorations.length - right.decorations.length
    || left.talisman.ref.id.localeCompare(right.talisman.ref.id)
}

interface ArmorSearchState {
  readonly armor: Readonly<Partial<Record<ArmorSlot, ArmorVariant>>>
  readonly defense: number
  readonly requiredLevels: readonly number[]
  readonly slotCounts: readonly number[]
}

function createArmorStates(
  armorBySlot: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
  requirements: readonly SkillValue[],
  preserveEquipmentIdentity: boolean,
  maxSolutions: number,
  request: BuildRequest,
  onProgress?: SolveOptions['onProgress'],
): ArmorSearchState[] {
  const slots = [...ARMOR_SLOTS].sort((left, right) => armorBySlot[left].length - armorBySlot[right].length)
  const candidates = slots.map(slot => armorBySlot[slot].map(variant => ({
    variant,
    levels: requirements.map(requirement => getSkillLevel(variant.skills, requirement.skillId)),
    counts: slotCapacities(variant.slots),
  })))
  const jewelLevels = Array.from({ length: 5 }, (_, level) => requirements.map(requirement =>
    request.decorations.reduce((best, jewel) => jewel.slotLevel <= level
      ? Math.max(best, getSkillLevel(jewel.skills, requirement.skillId))
      : best, 0)))
  function jewelPotential(counts: readonly number[], skillIndex: number): number {
    return counts.reduce((total, count, index) => total
      + count * (jewelLevels[index + 1][skillIndex] - jewelLevels[index][skillIndex]), 0)
  }
  // Each skill may optimistically use every socket. This can overestimate what
  // fits together, but never rejects a branch that can actually satisfy it.
  const external = requirements.map((requirement, index) => getSkillLevel(request.weapon.skills, requirement.skillId)
    + jewelPotential(slotCapacities(request.weapon.slots), index)
    + request.talismans.reduce((best, talisman) => Math.max(best, getSkillLevel(talisman.skills, requirement.skillId) + jewelPotential(slotCapacities(talisman.slots), index)), 0))
  const remaining = Array.from({ length: slots.length + 1 }, () => requirements.map(() => 0))
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    remaining[index] = requirements.map((_, skillIndex) => remaining[index + 1][skillIndex]
      + candidates[index].reduce((best, candidate) => Math.max(best, candidate.levels[skillIndex] + jewelPotential(candidate.counts, skillIndex)), 0))
  }
  let states: ArmorSearchState[] = [{
    armor: {},
    defense: 0,
    requiredLevels: requirements.map(() => 0),
    slotCounts: [0, 0, 0, 0],
  }]

  for (const [slotIndex, slot] of slots.entries()) {
    const next = new Map<string, ArmorSearchState | ArmorSearchState[]>()
    const total = states.length * candidates[slotIndex].length
    let current = 0
    onProgress?.({ current, stage: 'combining', total })

    for (const state of states) {
      for (const candidate of candidates[slotIndex]) {
        current += 1
        if (current % 4096 === 0)
          onProgress?.({ current, stage: 'combining', total })
        const requiredLevels = requirements.map((requirement, index) => Math.min(
          requirement.level,
          state.requiredLevels[index] + candidate.levels[index],
        ))
        const slotCounts = state.slotCounts.map((count, index) => count + candidate.counts[index])
        if (requirements.some((requirement, index) => requiredLevels[index]
          + jewelPotential(slotCounts, index) + remaining[slotIndex + 1][index] + external[index] < requirement.level)) {
          continue
        }
        const nextState = {
          armor: { ...state.armor, [slot]: candidate.variant },
          defense: state.defense + candidate.variant.defense,
          requiredLevels,
          slotCounts,
        }

        if (preserveEquipmentIdentity) {
          next.set(`${next.size}`, [nextState])
          continue
        }

        const key = `${requiredLevels.join(',')}|${slotCounts.join(',')}`
        if (maxSolutions === 1) {
          const previous = next.get(key) as ArmorSearchState | undefined
          if (!previous || nextState.defense > previous.defense) {
            next.set(key, nextState)
          }
          continue
        }

        const alternatives = next.get(key) ?? []
        ;(alternatives as ArmorSearchState[]).push(nextState)
        ;(alternatives as ArmorSearchState[]).sort((left, right) => right.defense - left.defense)
        if ((alternatives as ArmorSearchState[]).length > maxSolutions) {
          ;(alternatives as ArmorSearchState[]).pop()
        }
        next.set(key, alternatives)
      }
    }
    onProgress?.({ current: total, stage: 'combining', total })

    states = [...next.values()].flatMap(value => Array.isArray(value) ? value : [value]).sort((left, right) => compareArmorStates(
      left,
      right,
    ))

    if (!preserveEquipmentIdentity && maxSolutions === 1) {
      states = pruneWorseArmorStates(states)
    }
    if (states.length === 0)
      break
  }

  return states
}

function compareArmorStates(
  left: ArmorSearchState,
  right: ArmorSearchState,
): number {
  return right.defense - left.defense
    || requiredSkillScore(right.requiredLevels) - requiredSkillScore(left.requiredLevels)
    || slotCountScore(right.slotCounts) - slotCountScore(left.slotCounts)
}

function pruneWorseArmorStates(states: readonly ArmorSearchState[]): ArmorSearchState[] {
  if ((states[0]?.requiredLevels.length ?? 0) >= 31) {
    return pruneGenericArmorStates(states)
  }

  if (states.every(state => state.requiredLevels.every(level => level <= 1))) {
    return pruneBinarySkillArmorStates(states)
  }

  return pruneGenericArmorStates(states)
}

function pruneGenericArmorStates(states: readonly ArmorSearchState[]): ArmorSearchState[] {
  const frontier: ArmorSearchState[] = []

  for (const state of states) {
    if (frontier.some(candidate => isNoWorseArmorState(candidate, state))) {
      continue
    }

    for (let index = frontier.length - 1; index >= 0; index -= 1) {
      if (isNoWorseArmorState(state, frontier[index])) {
        frontier.splice(index, 1)
      }
    }

    frontier.push(state)
  }

  return frontier
}

function pruneBinarySkillArmorStates(
  states: readonly ArmorSearchState[],
): ArmorSearchState[] {
  const ordered = [...states].sort((left, right) => right.defense - left.defense)
  const slotPatternIds = new Map<string, number>()
  const slotCoverMasks: bigint[] = []
  const slotPatterns: number[][] = []

  for (const state of ordered) {
    const key = state.slotCounts.join(',')
    if (!slotPatternIds.has(key)) {
      slotPatternIds.set(key, slotPatterns.length)
      slotPatterns.push([...state.slotCounts])
    }
  }

  for (const counts of slotPatterns) {
    let coverMask = 0n
    for (const [key, patternId] of slotPatternIds) {
      const candidate = key.split(',').map(Number)
      if (slotsCoverCounts(candidate, counts)) {
        coverMask |= 1n << BigInt(patternId)
      }
    }
    slotCoverMasks.push(coverMask)
  }

  const coveringSlotsByMask = new Map<number, bigint>()
  const kept: ArmorSearchState[] = []

  for (const state of ordered) {
    const mask = state.requiredLevels.reduce(
      (value, level, index) => value | (level > 0 ? 1 << index : 0),
      0,
    )
    const slotId = slotPatternIds.get(state.slotCounts.join(','))!
    const dominated = hasCoveringSkillSlots(coveringSlotsByMask, mask, slotCoverMasks[slotId])

    if (!dominated) {
      kept.push(state)
      const slotBit = 1n << BigInt(slotId)
      coveringSlotsByMask.set(mask, (coveringSlotsByMask.get(mask) ?? 0n) | slotBit)
    }
  }

  return kept
}

function isNoWorseArmorState(left: ArmorSearchState, right: ArmorSearchState): boolean {
  return left.requiredLevels.every((level, index) => level >= right.requiredLevels[index])
    && slotsCoverCounts(left.slotCounts, right.slotCounts)
    && left.defense >= right.defense
    && (
      left.requiredLevels.some((level, index) => level > right.requiredLevels[index])
      || left.slotCounts.some((count, index) => count > right.slotCounts[index])
      || left.defense > right.defense
    )
}

function slotsCoverCounts(left: readonly number[], right: readonly number[]): boolean {
  for (let index = 0; index < 4; index += 1) {
    if ((left[index] ?? 0) < (right[index] ?? 0)) {
      return false
    }
  }

  return true
}

function hasCoveringSkillSlots(index: ReadonlyMap<number, bigint>, mask: number, slots: bigint): boolean {
  // Index only skill sets that actually occur. Expanding every subset of a
  // 25-skill partial set would otherwise create over 33 million entries.
  for (const [candidate, candidateSlots] of index) {
    if ((candidate & mask) === mask && (candidateSlots & slots) !== 0n)
      return true
  }
  return false
}

function requiredSkillScore(
  levels: readonly number[],
): number {
  return levels.reduce((total, level) => total + level, 0)
}

function slotCountScore(counts: readonly number[]): number {
  return counts.reduce((total, count, index) => total + count * (index + 1), 0)
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

  const equivalent = new Map<string, ArmorVariant | ArmorVariant[]>()

  for (const candidate of candidates) {
    const key = [
      requirements.map(requirement => `${requirement.skillId}:${Math.min(
        getSkillLevel(candidate.skills, requirement.skillId),
        requirement.level,
      )}`).join(','),
      slotCapacities(candidate.slots).join(','),
    ].join('|')
    if (maxSolutions === 1) {
      const previous = equivalent.get(key) as ArmorVariant | undefined
      if (!previous || candidate.defense > previous.defense) {
        equivalent.set(key, candidate)
      }
      continue
    }

    const alternatives = (equivalent.get(key) as ArmorVariant[] | undefined) ?? []
    alternatives.push(candidate)
    alternatives.sort((left, right) => right.defense - left.defense)
    if (alternatives.length > maxSolutions) {
      alternatives.pop()
    }
    equivalent.set(key, alternatives)
  }

  const reduced = [...equivalent.values()].flatMap(value => Array.isArray(value) ? value : [value])
  const pruned = maxSolutions === 1 ? pruneWorseArmorCandidates(reduced, requirements) : reduced
  return pruned
}

function pruneWorseArmorCandidates(
  candidates: readonly ArmorVariant[],
  requirements: readonly SkillValue[],
): ArmorVariant[] {
  if (requirements.length < 31 && requirements.every(requirement => requirement.level <= 1)) {
    return pruneBinaryArmorCandidates(candidates, requirements)
  }

  return pruneSameSlotArmorCandidates(candidates, requirements)
}

function pruneBinaryArmorCandidates(
  candidates: readonly ArmorVariant[],
  requirements: readonly SkillValue[],
): ArmorVariant[] {
  const ordered = [...candidates].sort((left, right) => right.defense - left.defense)
  const slotPatternIds = new Map<string, number>()
  const slotPatterns: number[][] = []

  for (const candidate of ordered) {
    const capacities = slotCapacities(candidate.slots)
    const key = capacities.join(',')
    if (!slotPatternIds.has(key)) {
      slotPatternIds.set(key, slotPatterns.length)
      slotPatterns.push(capacities)
    }
  }

  const slotCoverMasks = slotPatterns.map((counts) => {
    let mask = 0n
    for (const [key, patternId] of slotPatternIds) {
      if (slotsCoverCounts(key.split(',').map(Number), counts)) {
        mask |= 1n << BigInt(patternId)
      }
    }
    return mask
  })
  const coveringSlotsByMask = new Map<number, bigint>()
  const kept: ArmorVariant[] = []

  for (const candidate of ordered) {
    const mask = requirements.reduce((value, requirement, index) => value
      | (getSkillLevel(candidate.skills, requirement.skillId) > 0 ? 1 << index : 0), 0)
    const slotId = slotPatternIds.get(slotCapacities(candidate.slots).join(','))!
    const isWorse = hasCoveringSkillSlots(coveringSlotsByMask, mask, slotCoverMasks[slotId])

    if (!isWorse) {
      kept.push(candidate)
      const slotBit = 1n << BigInt(slotId)
      coveringSlotsByMask.set(mask, (coveringSlotsByMask.get(mask) ?? 0n) | slotBit)
    }
  }

  return kept
}

function pruneSameSlotArmorCandidates(
  candidates: readonly ArmorVariant[],
  requirements: readonly SkillValue[],
): ArmorVariant[] {
  const bySlots = new Map<string, ArmorVariant[]>()

  for (const candidate of candidates) {
    const key = slotCapacities(candidate.slots).join(',')
    const group = bySlots.get(key) ?? []
    group.push(candidate)
    bySlots.set(key, group)
  }

  return [...bySlots.values()].flatMap((group) => {
    const ordered = group.sort((left, right) => right.defense - left.defense)
    const kept: ArmorVariant[] = []

    for (const candidate of ordered) {
      const candidateSkills = requirements.map(requirement => Math.min(
        requirement.level,
        getSkillLevel(candidate.skills, requirement.skillId),
      ))
      const isWorse = kept.some((better) => {
        const betterSkills = requirements.map(requirement => Math.min(
          requirement.level,
          getSkillLevel(better.skills, requirement.skillId),
        ))
        return better.defense >= candidate.defense
          && betterSkills.every((level, index) => level >= candidateSkills[index])
      })

      if (!isWorse) {
        kept.push(candidate)
      }
    }

    return kept
  })
}

function slotCapacities(slots: readonly number[]): number[] {
  const capacities = [0, 0, 0, 0]
  for (const level of slots) {
    for (let minimumLevel = 1; minimumLevel <= level; minimumLevel += 1) {
      capacities[minimumLevel - 1] += 1
    }
  }
  return capacities
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

  const signatures = ordered.map(talisman => ({
    levels: requirements.map(requirement => Math.min(requirement.level, getSkillLevel(talisman.skills, requirement.skillId))),
    slots: [...talisman.slots].sort((left, right) => right - left),
    talisman,
  }))
  const unique = [...new Map(signatures.map(candidate => [
    `${candidate.levels.join(',')}|${candidate.slots.join(',')}`,
    candidate,
  ])).values()]
  return unique.filter((candidate, candidateIndex) => !unique.some((other, otherIndex) => {
    if (candidateIndex === otherIndex) {
      return false
    }

    return candidate.levels.every((level, index) => other.levels[index] >= level)
      && candidate.slots.every((level, index) => other.slots[index] >= level)
  })).map(candidate => candidate.talisman)
}

function skillKey(skills: readonly SkillValue[]): string {
  return [...skills]
    .sort((left, right) => String(left.skillId).localeCompare(String(right.skillId)))
    .map(skill => `${skill.skillId}:${skill.level}`)
    .join(',')
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
