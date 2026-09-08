import type { ArmorSlot, ArmorVariant, BuildRequest, BuildSolution, Decoration, DecorationPlacement, SkillValue } from './model'
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

  if (!preserveEquipmentIdentity) {
    return solveBuildByArmorSearch(
      workingRequest,
      armorBySlot,
      orderedTalismans,
      maxSolutions,
      options,
    )
  }

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

function solveBuildByArmorSearch(
  request: BuildRequest,
  armorBySlot: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
  orderedTalismans: readonly BuildRequest['talismans'][number][],
  maxSolutions: number,
  options: SolveOptions,
): BuildSolution[] {
  // Explore the most constrained armor slots first. The traversal remains
  // exhaustive, but a failed requirement can reject a branch before the large
  // candidate pools are reached.
  const slots = [...ARMOR_SLOTS].sort((left, right) => armorBySlot[left].length - armorBySlot[right].length)
  const candidates = slots.map(slot => armorBySlot[slot].map(variant => ({
    variant,
    levels: request.requiredSkills.map(requirement => getSkillLevel(variant.skills, requirement.skillId)),
    counts: slotCapacities(variant.slots),
  })).sort((left, right) => right.variant.defense - left.variant.defense
    || requiredSkillScore(right.levels) - requiredSkillScore(left.levels)
    || slotCountScore(right.counts) - slotCountScore(left.counts)))
  const feasibleCandidates = candidates.map(pool => [...pool].sort((left, right) => requiredSkillScore(right.levels)
    - requiredSkillScore(left.levels)
    || slotCountScore(right.counts) - slotCountScore(left.counts)
    || right.variant.defense - left.variant.defense))
  const jewelLevels = Array.from({ length: 5 }, (_, level) => request.requiredSkills.map(requirement =>
    request.decorations.reduce((best, jewel) => jewel.slotLevel <= level
      ? Math.max(best, getSkillLevel(jewel.skills, requirement.skillId))
      : best, 0)))
  const jewelPotential = (counts: readonly number[], skillIndex: number): number => counts.reduce((total, count, index) => total
    + count * (jewelLevels[index + 1][skillIndex] - jewelLevels[index][skillIndex]), 0)
  const weightVectors = [request.requiredSkills.map(() => 1)]
  const weightedJewelLevels = weightVectors.map(weights => Array.from({ length: 5 }, (_, level) => request.decorations.reduce((best, jewel) => {
    if (jewel.slotLevel > level)
      return best
    return Math.max(best, weightedSkillScore(jewel.skills, request.requiredSkills, weights))
  }, 0)))
  const weightedJewelPotential = (counts: readonly number[], weightIndex: number): number => counts.reduce((total, count, index) => total
    + count * (weightedJewelLevels[weightIndex][index + 1] - weightedJewelLevels[weightIndex][index]), 0)
  const external = request.requiredSkills.map((requirement, index) => getSkillLevel(request.weapon.skills, requirement.skillId)
    + jewelPotential(slotCapacities(request.weapon.slots), index)
    + request.talismans.reduce((best, talisman) => Math.max(best, getSkillLevel(talisman.skills, requirement.skillId)
    + jewelPotential(slotCapacities(talisman.slots), index)), 0))
  const remaining = Array.from({ length: slots.length + 1 }, () => request.requiredSkills.map(() => 0))
  const weightedRemaining = Array.from({ length: slots.length + 1 }, () => weightVectors.map(() => 0))
  const remainingArmorSkills = Array.from({ length: slots.length + 1 }, () => request.requiredSkills.map(() => 0))
  const remainingSlotCounts = Array.from({ length: slots.length + 1 }).fill(null).map(() => [0, 0, 0, 0])
  const talismanMaximumSkills = request.requiredSkills.map(requirement => request.talismans.reduce(
    (maximum, talisman) => Math.max(maximum, getSkillLevel(talisman.skills, requirement.skillId)),
    0,
  ))
  const talismanMaximumSlotCounts = [0, 0, 0, 0]
  const weaponSlotCounts = slotCapacities(request.weapon.slots)
  const weightedExternal = weightVectors.map((weights, weightIndex) => weightedSkillScore(
    request.weapon.skills,
    request.requiredSkills,
    weights,
  ) + weightedJewelPotential(weaponSlotCounts, weightIndex) + request.talismans.reduce((best, talisman) => Math.max(
    best,
    weightedSkillScore(talisman.skills, request.requiredSkills, weights)
    + weightedJewelPotential(slotCapacities(talisman.slots), weightIndex),
  ), 0))
  for (const talisman of request.talismans) {
    const capacities = slotCapacities(talisman.slots)
    for (const [index, capacity] of capacities.entries()) {
      talismanMaximumSlotCounts[index] = Math.max(talismanMaximumSlotCounts[index], capacity)
    }
  }
  const maximumDefense = Array.from<number>({ length: slots.length + 1 }).fill(0)
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    remaining[index] = request.requiredSkills.map((_, skillIndex) => remaining[index + 1][skillIndex]
      + candidates[index].reduce((best, candidate) => Math.max(best, candidate.levels[skillIndex] + jewelPotential(candidate.counts, skillIndex)), 0))
    weightedRemaining[index] = weightVectors.map((weights, weightIndex) => weightedRemaining[index + 1][weightIndex]
      + Math.max(0, ...candidates[index].map(candidate => weightedSkillLevelsScore(candidate.levels, weights)
        + weightedJewelPotential(candidate.counts, weightIndex))))
    remainingArmorSkills[index] = request.requiredSkills.map((_, skillIndex) => remainingArmorSkills[index + 1][skillIndex]
      + Math.max(0, ...candidates[index].map(candidate => candidate.levels[skillIndex])))
    remainingSlotCounts[index] = remainingSlotCounts[index + 1].map((count, slotLevel) => count
      + Math.max(0, ...candidates[index].map(candidate => candidate.counts[slotLevel])))
    maximumDefense[index] = maximumDefense[index + 1]
      + Math.max(0, ...candidates[index].map(candidate => candidate.variant.defense))
  }

  const decorationPlans = new Map<string, readonly { decoration: Decoration, level: number }[] | null>()
  const relaxedDecorationCache = new Map<string, boolean>()
  const talismanPlans = new Map<string, readonly {
    decorations: readonly { decoration: Decoration, host: DecorationPlacement['host'], slotIndex: number }[]
    talisman: BuildRequest['talismans'][number]
  }[]>()
  const solutions: BuildSolution[] = []
  const solutionKeys = new Set<string>()
  const armor = {} as Record<ArmorSlot, ArmorVariant>
  const initialLevels = request.requiredSkills.map(() => 0)
  const initialCounts = [0, 0, 0, 0]

  function addSolution(solution: BuildSolution): void {
    const key = JSON.stringify([
      Object.values(solution.armor).map(variant => variant.variantId),
      solution.talisman.ref.id,
      solution.decorations.map(placement => [placement.decoration.ref.id, placement.host, placement.slotIndex]),
    ])
    if (solutionKeys.has(key))
      return
    solutionKeys.add(key)
    solutions.push(solution)
    if (maxSolutions === Number.POSITIVE_INFINITY)
      return
    solutions.sort(compareSolutions)
    if (solutions.length > maxSolutions)
      solutions.pop()
    options.onSolutions?.([...solutions])
  }

  function searchTalismans(
    skills: readonly SkillValue[],
    currentArmor: Record<ArmorSlot, ArmorVariant>,
    talismans = orderedTalismans,
    stopAtFirst = false,
  ): void {
    const armorKey = [
      request.requiredSkills.map(requirement => `${requirement.skillId}:${getSkillLevel(skills, requirement.skillId)}`).join(','),
      ARMOR_SLOTS.map(slot => currentArmor[slot].slots.join(',')).join('|'),
    ].join('|')
    const cachedPlans = talismans === orderedTalismans ? talismanPlans.get(armorKey) : undefined
    if (cachedPlans) {
      for (const plan of cachedPlans) {
        addSolution({
          armor: { ...currentArmor },
          decorations: plan.decorations,
          defense: getTotalArmorDefense(currentArmor),
          id: request.id,
          skills: plan.decorations.reduce(
            (current, placement) => addSkillValues(current, placement.decoration.skills),
            addSkillValues(skills, request.weapon.skills, plan.talisman.skills),
          ),
          talisman: plan.talisman,
          weapon: request.weapon,
        })
      }
      return
    }

    const matches: {
      decorations: readonly { decoration: Decoration, host: DecorationPlacement['host'], slotIndex: number }[]
      talisman: BuildRequest['talismans'][number]
    }[] = []
    for (const talisman of talismans) {
      const totalSkills = addSkillValues(skills, request.weapon.skills, talisman.skills)
      const availableSlots = collectAvailableSlots(request.weapon, currentArmor, talisman)
      const decorationKey = [
        request.requiredSkills.map(requirement => `${requirement.skillId}:${Math.min(
          getSkillLevel(totalSkills, requirement.skillId),
          requirement.level,
        )}`).join(','),
        availableSlots.map(slot => slot.level).sort((left, right) => right - left).join(','),
      ].join('|')
      if (!decorationPlans.has(decorationKey)) {
        const plan = findBestDecorationPlacement(
          availableSlots,
          request.decorations,
          totalSkills,
          request.requiredSkills,
        )
        decorationPlans.set(decorationKey, plan?.map(placement => ({
          decoration: placement.decoration,
          level: availableSlots.find(slot => slot.host === placement.host && slot.index === placement.slotIndex)!.level,
        })) ?? null)
      }
      const plan = decorationPlans.get(decorationKey)
      if (!plan)
        continue

      const remainingSlots = [...availableSlots]
      const decorations = plan.map(({ decoration, level }) => {
        const index = remainingSlots.findIndex(slot => slot.level === level)
        const [slot] = remainingSlots.splice(index, 1)
        return { decoration, host: slot.host, slotIndex: slot.index }
      })
      const finalSkills = decorations.reduce(
        (current, placement) => addSkillValues(current, placement.decoration.skills),
        totalSkills,
      )
      if (!meetsSkillRequirements(finalSkills, request.requiredSkills))
        continue

      matches.push({ decorations, talisman })
      if (stopAtFirst)
        break
    }

    matches.sort((left, right) => left.decorations.length - right.decorations.length
      || left.talisman.ref.id.localeCompare(right.talisman.ref.id))
    const selectedMatches = maxSolutions === Number.POSITIVE_INFINITY
      ? matches
      : matches.slice(0, maxSolutions)
    if (talismans === orderedTalismans)
      talismanPlans.set(armorKey, selectedMatches)
    for (const plan of selectedMatches) {
      addSolution({
        armor: { ...currentArmor },
        decorations: plan.decorations,
        defense: getTotalArmorDefense(currentArmor),
        id: request.id,
        skills: plan.decorations.reduce(
          (current: readonly SkillValue[], placement) => addSkillValues(current, placement.decoration.skills),
          addSkillValues(skills, request.weapon.skills, plan.talisman.skills),
        ),
        talisman: plan.talisman,
        weapon: request.weapon,
      })
    }
  }

  function visit(
    slotIndex: number,
    requiredLevels: readonly number[],
    slotCounts: readonly number[],
    defense: number,
    stopAtFirst = false,
  ): void {
    if (stopAtFirst && solutions.length > 0)
      return
    if (solutions.length >= maxSolutions
      && defense + maximumDefense[slotIndex] < (solutions[solutions.length - 1]?.defense ?? 0)) {
      return
    }
    if (request.requiredSkills.some((requirement, index) => requiredLevels[index]
      + jewelPotential(slotCounts, index)
      + remaining[slotIndex][index]
      + external[index] < requirement.level)) {
      return
    }
    if (weightVectors.some((weights, weightIndex) => weightedRemaining[slotIndex][weightIndex]
      + weightedJewelPotential(slotCounts, weightIndex)
      + weightedExternal[weightIndex]
      < request.requiredSkills.reduce((total, requirement, skillIndex) => total
        + weights[skillIndex] * Math.max(0, requirement.level - requiredLevels[skillIndex]), 0))) {
      return
    }
    const missing = request.requiredSkills.map((requirement, index) => Math.max(0, requirement.level
      - requiredLevels[index]
      - getSkillLevel(request.weapon.skills, requirement.skillId)
      - talismanMaximumSkills[index]
      - remainingArmorSkills[slotIndex][index]))
    const optimisticSlotCounts = slotCounts.map((count, index) => count
      + remainingSlotCounts[slotIndex][index]
      + weaponSlotCounts[index]
      + talismanMaximumSlotCounts[index])
    const relaxedKey = `${missing.join(',')}|${optimisticSlotCounts.join(',')}`
    if (!relaxedDecorationCache.has(relaxedKey)) {
      relaxedDecorationCache.set(relaxedKey, canCoverMissingSkillTotal(
        missing,
        optimisticSlotCounts,
        request.decorations,
        request.requiredSkills,
      ))
    }
    if (!relaxedDecorationCache.get(relaxedKey))
      return
    if (slotIndex >= slots.length) {
      searchTalismans(
        getArmorSkills(armor),
        armor,
        orderedTalismans,
        stopAtFirst,
      )
      options.onProgress?.({ current: 1, stage: 'searching', total: 1 })
      return
    }

    const slot = slots[slotIndex]
    for (const candidate of (stopAtFirst ? feasibleCandidates[slotIndex] : candidates[slotIndex])) {
      const nextLevels = request.requiredSkills.map((requirement, index) => Math.min(
        requirement.level,
        requiredLevels[index] + candidate.levels[index],
      ))
      const nextCounts = slotCounts.map((count, index) => count + candidate.counts[index])
      armor[slot] = candidate.variant
      visit(slotIndex + 1, nextLevels, nextCounts, defense + candidate.variant.defense, stopAtFirst)
    }
  }

  options.onProgress?.({ current: 0, stage: 'searching', total: 0 })
  visit(0, initialLevels, initialCounts, 0, true)
  visit(0, initialLevels, initialCounts, 0)
  options.onProgress?.({ current: 1, stage: 'searching', total: 1 })
  return solutions.sort(compareSolutions)
}

function canCoverMissingSkillTotal(
  missing: readonly number[],
  slotCounts: readonly number[],
  decorations: readonly Decoration[],
  requirements: readonly SkillValue[],
): boolean {
  const missingTotal = missing.reduce((total, level) => total + level, 0)
  if (missingTotal === 0)
    return true

  const bestForSlotLevel = [0, 1, 2, 3, 4].map(level => decorations.reduce((best, decoration) => {
    if (decoration.slotLevel > level)
      return best

    return Math.max(best, requirements.reduce((total, requirement, index) => total
      + Math.min(missing[index], getSkillLevel(decoration.skills, requirement.skillId)), 0))
  }, 0))
  const maximumCovered = slotCounts.reduce((total, count, index) => total
    + count * (bestForSlotLevel[index + 1] - bestForSlotLevel[index]), 0)
  return maximumCovered >= missingTotal
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
    const dominance = !preserveEquipmentIdentity && Number.isFinite(maxSolutions)
      ? createArmorStateDominanceIndex(requirements, maxSolutions)
      : undefined
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

        if (dominance?.isCovered(nextState)) {
          continue
        }
        dominance?.add(nextState)

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

function weightedSkillScore(
  skills: readonly SkillValue[],
  requirements: readonly SkillValue[],
  weights: readonly number[],
): number {
  return requirements.reduce((total, requirement, index) => total
    + (weights[index] ?? 0) * Math.min(getSkillLevel(skills, requirement.skillId), requirement.level), 0)
}

function weightedSkillLevelsScore(
  levels: readonly number[],
  weights: readonly number[],
): number {
  return levels.reduce((total, level, index) => total + (weights[index] ?? 0) * level, 0)
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
  return Number.isFinite(maxSolutions)
    ? pruneDominatedArmorCandidates(reduced, requirements, maxSolutions)
    : reduced
}

function pruneDominatedArmorCandidates(
  candidates: readonly ArmorVariant[],
  requirements: readonly SkillValue[],
  maxAlternatives: number,
): ArmorVariant[] {
  const ordered = [...candidates].sort((left, right) => compareDominanceCandidates(
    right,
    left,
    requirements,
  ))
  const skillCoverage: bigint[][] = requirements.map(requirement => Array.from<bigint>({ length: requirement.level + 1 }).fill(0n))
  const slotCoverage: bigint[][] = Array.from({ length: 4 }).fill(null).map(() => Array.from<bigint>({ length: 5 }).fill(0n))
  const kept: ArmorVariant[] = []
  let allKept = 0n

  for (const candidate of ordered) {
    const skillLevels = requirements.map(requirement => Math.min(
      requirement.level,
      getSkillLevel(candidate.skills, requirement.skillId),
    ))
    const capacities = slotCapacities(candidate.slots)
    let covering = allKept

    for (const [index, level] of skillLevels.entries()) {
      if (level > 0) {
        covering &= skillCoverage[index][level]
      }
    }
    for (const [index, capacity] of capacities.entries()) {
      if (capacity > 0) {
        covering &= slotCoverage[index][capacity]
      }
    }

    if (countBitsUpTo(covering, maxAlternatives) >= maxAlternatives) {
      continue
    }

    const bit = 1n << BigInt(kept.length)
    allKept |= bit
    kept.push(candidate)
    for (const [index, level] of skillLevels.entries()) {
      for (let minimum = 1; minimum <= level; minimum += 1) {
        skillCoverage[index][minimum] |= bit
      }
    }
    for (const [index, capacity] of capacities.entries()) {
      for (let minimum = 1; minimum <= capacity; minimum += 1) {
        slotCoverage[index][minimum] |= bit
      }
    }
  }

  return kept
}

interface ArmorStateDominanceIndex {
  add: (state: ArmorSearchState) => void
  isCovered: (state: ArmorSearchState) => boolean
}

function createArmorStateDominanceIndex(
  requirements: readonly SkillValue[],
  maxAlternatives: number,
): ArmorStateDominanceIndex {
  const skillCoverage: bigint[][] = requirements.map(requirement => Array.from<bigint>({ length: requirement.level + 1 }).fill(0n))
  const slotCoverage: bigint[][] = Array.from({ length: 4 }).fill(null).map(() => Array.from<bigint>({ length: 16 }).fill(0n))
  const keptStates: ArmorSearchState[] = []
  let allKept = 0n

  return {
    add(state) {
      const bit = 1n << BigInt(keptStates.length)
      keptStates.push(state)
      allKept |= bit
      for (const [index, level] of state.requiredLevels.entries()) {
        for (let minimum = 1; minimum <= level; minimum += 1) {
          skillCoverage[index][minimum] |= bit
        }
      }
      for (const [index, capacity] of state.slotCounts.entries()) {
        for (let minimum = 1; minimum <= capacity; minimum += 1) {
          slotCoverage[index][minimum] |= bit
        }
      }
    },
    isCovered(state) {
      let covering = allKept
      for (const [index, level] of state.requiredLevels.entries()) {
        if (level > 0) {
          covering &= skillCoverage[index][level]
        }
      }
      for (const [index, capacity] of state.slotCounts.entries()) {
        if (capacity > 0) {
          covering &= slotCoverage[index][capacity]
        }
      }
      let count = 0
      let remaining = covering
      while (remaining !== 0n && count < maxAlternatives) {
        const bit = remaining & -remaining
        const index = bit.toString(2).length - 1
        if (keptStates[index].defense >= state.defense) {
          count += 1
        }
        remaining -= bit
      }
      return count >= maxAlternatives
    },
  }
}

function countBitsUpTo(value: bigint, limit: number): number {
  let count = 0
  let remaining = value
  while (remaining !== 0n && count < limit) {
    remaining &= remaining - 1n
    count += 1
  }
  return count
}

function compareDominanceCandidates(
  left: ArmorVariant,
  right: ArmorVariant,
  requirements: readonly SkillValue[],
): number {
  return left.defense - right.defense
    || compareArmorCandidates(left, right, requirements)
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
