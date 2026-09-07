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
  const decorationFeasibility = new Map<string, boolean>()
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
  const orderedTalismans = orderTalismanCandidates(
    legalTalismans,
    request.requiredSkills,
    preserveEquipmentIdentity,
  )

  if (!preserveEquipmentIdentity && maxSolutions === 1) {
    searchBestArmorCombination(workingRequest, armorBySlot, bounds, searchTalismans)
    return solutions
  }

  const armorStates = createArmorStates(
    armorBySlot,
    workingRequest.requiredSkills,
    preserveEquipmentIdentity,
    maxSolutions,
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

      const decorationKey = [
        workingRequest.requiredSkills.map(requirement => `${requirement.skillId}:${Math.min(
          getSkillLevel(totalSkills, requirement.skillId),
          requirement.level,
        )}`).join(','),
        slots.map(slot => slot.level).sort((left, right) => right - left).join(','),
      ].join('|')
      const knownFeasibility = decorationFeasibility.get(decorationKey)
      if (knownFeasibility === false) {
        continue
      }

      if (knownFeasibility === undefined) {
        const feasible = findDecorationPlacements(
          slots,
          workingRequest.decorations,
          totalSkills,
          workingRequest.requiredSkills,
          1,
        ).length > 0
        decorationFeasibility.set(decorationKey, feasible)
        if (!feasible) {
          continue
        }
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

  function searchBestArmorCombination(
    searchRequest: BuildRequest,
    candidates: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
    searchBounds: SearchBounds,
    finish: (
      skills: readonly SkillValue[],
      armor: Readonly<Record<ArmorSlot, ArmorVariant>>,
    ) => void,
  ): void {
    const searchSlots = [...ARMOR_SLOTS].sort((left, right) => {
      const rightConstraint = armorSlotConstraintScore(right, candidates, searchRequest.requiredSkills)
      const leftConstraint = armorSlotConstraintScore(left, candidates, searchRequest.requiredSkills)
      return rightConstraint - leftConstraint
        || candidates[left].length - candidates[right].length
    })
    const suffixMaximumDefense = createSuffixMaximumDefense(candidates, searchSlots)
    const bestPartialDefense = searchSlots.map(() => new Map<string, number>())
    const optimisticDecorationFeasibility = new Map<string, boolean>()

    const seedArmor = createGreedyArmorSeed(candidates, searchSlots, searchRequest.requiredSkills)
    if (seedArmor) {
      finish(
        getArmorSkills(seedArmor),
        seedArmor,
      )
    }

    search(0, {}, [], [0, 0, 0, 0], 0)

    function search(
      slotIndex: number,
      armor: Readonly<Partial<Record<ArmorSlot, ArmorVariant>>>,
      skills: readonly SkillValue[],
      slotCapacities: readonly number[],
      defense: number,
    ): void {
      const bestDefense = solutions[solutions.length - 1]?.defense
      if (bestDefense !== undefined
        && defense + suffixMaximumDefense[slotIndex] < bestDefense) {
        return
      }

      const stateKey = [
        ...searchRequest.requiredSkills.map(requirement => Math.min(
          requirement.level,
          getSkillLevel(skills, requirement.skillId),
        )),
        ...slotCapacities,
      ].join('|')
      const previousDefense = bestPartialDefense[slotIndex]?.get(stateKey)
      if (previousDefense !== undefined && previousDefense >= defense) {
        return
      }
      bestPartialDefense[slotIndex]?.set(stateKey, defense)

      if (!canReachRemainingArmorSkills(
        searchRequest,
        searchBounds,
        candidates,
        searchSlots,
        slotIndex,
        skills,
      )) {
        return
      }

      const optimisticKey = `${slotIndex}|${stateKey}`
      const optimisticFeasibility = optimisticDecorationFeasibility.get(optimisticKey)
      if (optimisticFeasibility === false) {
        return
      }
      if (optimisticFeasibility === undefined) {
        const feasible = canReachWithOptimisticDecorations(
          searchRequest,
          searchBounds,
          candidates,
          searchSlots,
          slotIndex,
          armor,
          skills,
        )
        optimisticDecorationFeasibility.set(optimisticKey, feasible)
        if (!feasible) {
          return
        }
      }

      if (slotIndex >= searchSlots.length) {
        finish(skills, armor as Record<ArmorSlot, ArmorVariant>)
        return
      }

      const slot = searchSlots[slotIndex]
      for (const variant of candidates[slot]) {
        search(
          slotIndex + 1,
          { ...armor, [slot]: variant },
          addSkillValues(skills, variant.skills),
          addSlotCapacities(slotCapacities, variant.slots),
          defense + variant.defense,
        )
      }
    }
  }
}

function addSlotCapacities(
  current: readonly number[],
  slots: readonly number[],
): number[] {
  const next = [...current]

  for (const level of slots) {
    for (let minimumLevel = 1; minimumLevel <= level; minimumLevel += 1) {
      next[minimumLevel - 1] += 1
    }
  }

  return next
}

function createGreedyArmorSeed(
  candidates: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
  searchSlots: readonly ArmorSlot[],
  requirements: readonly SkillValue[],
): Record<ArmorSlot, ArmorVariant> | undefined {
  const selected = {} as Record<ArmorSlot, ArmorVariant>
  let skills: SkillValue[] = []

  for (const slot of searchSlots) {
    const candidate = candidates[slot].reduce<ArmorVariant | undefined>((best, current) => {
      if (!best) {
        return current
      }

      const bestGain = skillGain(best, skills, requirements)
      const currentGain = skillGain(current, skills, requirements)
      if (currentGain !== bestGain) {
        return currentGain > bestGain ? current : best
      }

      return current.defense > best.defense ? current : best
    }, undefined)

    if (!candidate) {
      return undefined
    }

    selected[slot] = candidate
    skills = addSkillValues(skills, candidate.skills)
  }

  return selected
}

function skillGain(
  candidate: ArmorVariant,
  current: readonly SkillValue[],
  requirements: readonly SkillValue[],
): number {
  return requirements.reduce((total, requirement) => total + Math.max(
    0,
    Math.min(
      requirement.level,
      getSkillLevel(current, requirement.skillId) + getSkillLevel(
        candidate.skills,
        requirement.skillId,
      ),
    ) - getSkillLevel(current, requirement.skillId),
  ), 0)
}

function armorSlotConstraintScore(
  slot: ArmorSlot,
  candidates: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
  requirements: readonly SkillValue[],
): number {
  return requirements.reduce((total, requirement) => {
    const providers = candidates[slot].filter(variant =>
      getSkillLevel(variant.skills, requirement.skillId) > 0).length
    return total + (providers > 0 ? 1 / providers : 0)
  }, 0)
}

function createSuffixMaximumDefense(
  candidates: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
  searchSlots: readonly ArmorSlot[],
): readonly number[] {
  const maximums = Array.from({ length: searchSlots.length + 1 }).fill(0) as number[]

  for (let index = searchSlots.length - 1; index >= 0; index -= 1) {
    const slot = searchSlots[index]
    maximums[index] = maximums[index + 1] + Math.max(
      0,
      ...candidates[slot].map(variant => variant.defense),
    )
  }

  return maximums
}

function canReachRemainingArmorSkills(
  request: BuildRequest,
  bounds: SearchBounds,
  candidates: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
  searchSlots: readonly ArmorSlot[],
  slotIndex: number,
  currentSkills: readonly SkillValue[],
): boolean {
  return request.requiredSkills.every((requirement) => {
    const remainingArmorMaximum = searchSlots.slice(slotIndex).reduce((total, slot) => total
      + Math.max(0, ...candidates[slot].map(armor => getSkillLevel(
        armor.skills,
        requirement.skillId,
      ))), 0)
    const requirementIndex = request.requiredSkills.indexOf(requirement)
    const potentialSlotLevels = [
      ...request.weapon.slots,
      ...bounds.armorSlots.flat(),
      ...bounds.talismanSlots,
    ]
    const decorationMaximum = potentialSlotLevels.reduce((total, slotLevel) => total
      + (bounds.decorationSkillsBySlotLevel[slotLevel]?.[requirementIndex] ?? 0), 0)

    return getSkillLevel(currentSkills, requirement.skillId)
      + getSkillLevel(request.weapon.skills, requirement.skillId)
      + (bounds.talismanSkills[requirementIndex] ?? 0)
      + remainingArmorMaximum
      + decorationMaximum >= requirement.level
  })
}

function canReachWithOptimisticDecorations(
  request: BuildRequest,
  bounds: SearchBounds,
  candidates: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
  searchSlots: readonly ArmorSlot[],
  slotIndex: number,
  armor: Readonly<Partial<Record<ArmorSlot, ArmorVariant>>>,
  currentSkills: readonly SkillValue[],
): boolean {
  const optimisticSkills = addSkillValues(
    request.weapon.skills,
    currentSkills,
    ...searchSlots.slice(slotIndex).map(slot => request.requiredSkills.map(requirement => ({
      level: Math.max(
        0,
        ...candidates[slot].map(variant => getSkillLevel(
          variant.skills,
          requirement.skillId,
        )),
      ),
      skillId: requirement.skillId,
    }))),
    request.requiredSkills.map((requirement, index) => ({
      level: bounds.talismanSkills[index] ?? 0,
      skillId: requirement.skillId,
    })),
  )
  const slotLevels = [
    ...request.weapon.slots,
    ...Object.values(armor).flatMap(variant => variant?.slots ?? []),
    ...searchSlots.slice(slotIndex).flatMap(slot => bounds.armorSlots[ARMOR_SLOTS.indexOf(slot)]),
    ...bounds.talismanSlots,
  ].filter(level => level > 0)
  const slots = slotLevels.map((level, index) => ({
    host: 'weapon' as const,
    index,
    level,
  }))

  return findDecorationPlacements(
    slots,
    request.decorations,
    optimisticSkills,
    request.requiredSkills,
    1,
  ).length > 0
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
    slotCounts: [0, 0, 0, 0],
  }]

  for (const slot of ARMOR_SLOTS) {
    const next = new Map<string, ArmorSearchState | ArmorSearchState[]>()

    for (const state of states) {
      for (const variant of armorBySlot[slot]) {
        const armor = { ...state.armor, [slot]: variant } as Record<ArmorSlot, ArmorVariant>
        const requiredLevels = requirements.map((requirement, index) => Math.min(
          requirement.level,
          state.requiredLevels[index] + getSkillLevel(variant.skills, requirement.skillId),
        ))
        const slotCounts = [...state.slotCounts]
        for (const level of variant.slots) {
          for (let minimumLevel = 1; minimumLevel <= level; minimumLevel += 1) {
            slotCounts[minimumLevel - 1] += 1
          }
        }
        const nextState = { armor, requiredLevels, slotCounts }

        if (preserveEquipmentIdentity) {
          next.set(`${next.size}`, [nextState])
          continue
        }

        const key = `${requiredLevels.join(',')}|${slotCounts.join(',')}`
        if (maxSolutions === 1) {
          const previous = next.get(key) as ArmorSearchState | undefined
          if (!previous || getArmorStateDefense(nextState.armor) > getArmorStateDefense(previous.armor)) {
            next.set(key, nextState)
          }
          continue
        }

        const alternatives = next.get(key) ?? []
        ;(alternatives as ArmorSearchState[]).push(nextState)
        ;(alternatives as ArmorSearchState[]).sort((left, right) => getArmorStateDefense(right.armor)
          - getArmorStateDefense(left.armor))
        if ((alternatives as ArmorSearchState[]).length > maxSolutions) {
          ;(alternatives as ArmorSearchState[]).pop()
        }
        next.set(key, alternatives)
      }
    }

    states = [...next.values()].flatMap(value => Array.isArray(value) ? value : [value]).sort((left, right) => compareArmorStates(
      left,
      right,
    ))

    if (!preserveEquipmentIdentity && maxSolutions === 1) {
      states = pruneWorseArmorStates(states)
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
  const ordered = [...states].sort((left, right) => getArmorStateDefense(right.armor)
    - getArmorStateDefense(left.armor))
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
    const dominated = ((coveringSlotsByMask.get(mask) ?? 0n) & slotCoverMasks[slotId]) !== 0n

    if (!dominated) {
      kept.push(state)
      const slotBit = 1n << BigInt(slotId)
      let subset = mask
      do {
        coveringSlotsByMask.set(subset, (coveringSlotsByMask.get(subset) ?? 0n) | slotBit)
        subset = (subset - 1) & mask
      } while (subset !== mask)
    }
  }

  return kept
}

function isNoWorseArmorState(left: ArmorSearchState, right: ArmorSearchState): boolean {
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
  for (let index = 0; index < 4; index += 1) {
    if ((left[index] ?? 0) < (right[index] ?? 0)) {
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
  return counts.reduce((total, count, index) => total + count * (index + 1), 0)
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
    const isWorse = !!((coveringSlotsByMask.get(mask) ?? 0n) & slotCoverMasks[slotId])

    if (!isWorse) {
      kept.push(candidate)
      const slotBit = 1n << BigInt(slotId)
      let subset = mask
      do {
        coveringSlotsByMask.set(subset, (coveringSlotsByMask.get(subset) ?? 0n) | slotBit)
        subset = (subset - 1) & mask
      } while (subset !== mask)
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
