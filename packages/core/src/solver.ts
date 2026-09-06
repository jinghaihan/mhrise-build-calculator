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
  const selectedArmor: Partial<Record<ArmorSlot, ArmorVariant>> = {}
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
  const exploredArmorStates = new Map<string, number>()
  const useStateMemo = maxSolutions === 1 && !preserveEquipmentIdentity
  const armorBySlot = Object.fromEntries(ARMOR_SLOTS.map(slot => [
    slot,
    orderArmorCandidates(
      workingRequest.armorBySlot[slot],
      workingRequest.requiredSkills,
    ),
  ])) as unknown as typeof request.armorBySlot
  const maximumRemainingDefense = createMaximumRemainingDefense(armorBySlot)
  const orderedTalismans = [...legalTalismans].sort((left, right) => compareTalismanCandidates(
    right,
    left,
    request.requiredSkills,
  ))

  function searchArmor(slotIndex: number, skills: readonly SkillValue[]): void {
    if (cannotImproveResults(slotIndex)) {
      return
    }

    if (useStateMemo) {
      const stateKey = createArmorStateKey(slotIndex, skills, selectedArmor)
      const defense = getPartialArmorDefense(selectedArmor)
      const previousDefense = exploredArmorStates.get(stateKey)
      if (previousDefense !== undefined && previousDefense >= defense) {
        return
      }
      exploredArmorStates.set(stateKey, defense)
    }

    if (!canReachRequirements(workingRequest, bounds, slotIndex, skills)) {
      return
    }

    if (slotIndex >= ARMOR_SLOTS.length) {
      searchTalismans(skills)
      return
    }

    const slot = ARMOR_SLOTS[slotIndex]
    const candidates = armorBySlot[slot]

    for (const armor of candidates) {
      selectedArmor[slot] = armor
      searchArmor(slotIndex + 1, addSkillValues(skills, armor.skills))
    }

    delete selectedArmor[slot]
  }

  function searchTalismans(skills: readonly SkillValue[]): void {
    const armor = createCompleteArmor(selectedArmor)

    for (const talisman of orderedTalismans) {
      if (solutions.length >= maxSolutions) {
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

  function cannotImproveResults(slotIndex: number): boolean {
    if (solutions.length < maxSolutions) {
      return false
    }

    const partialDefense = getPartialArmorDefense(selectedArmor)
    const maximumDefense = partialDefense + (maximumRemainingDefense[slotIndex] ?? 0)
    const lowestStoredDefense = solutions[solutions.length - 1]?.defense ?? Number.NEGATIVE_INFINITY
    return maximumDefense < lowestStoredDefense
  }

  function addSolution(solution: BuildSolution): void {
    solutions.push(solution)
    solutions.sort(compareSolutions)

    if (solutions.length > maxSolutions) {
      solutions.pop()
    }
  }

  searchArmor(0, [])
  return solutions
}

function compareSolutions(left: BuildSolution, right: BuildSolution): number {
  return right.defense - left.defense
    || left.decorations.length - right.decorations.length
    || left.talisman.ref.id.localeCompare(right.talisman.ref.id)
}

function createMaximumRemainingDefense(
  armorBySlot: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
): readonly number[] {
  const maximums: number[] = Array.from({ length: ARMOR_SLOTS.length + 1 }).fill(0) as number[]

  for (let index = ARMOR_SLOTS.length - 1; index >= 0; index -= 1) {
    const slot = ARMOR_SLOTS[index]
    const maximum = Math.max(0, ...(armorBySlot[slot]?.map(armor => armor.defense) ?? []))
    maximums[index] = maximum + maximums[index + 1]
  }

  return maximums
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

function skillKey(skills: readonly SkillValue[]): string {
  return [...skills]
    .sort((left, right) => String(left.skillId).localeCompare(String(right.skillId)))
    .map(skill => `${skill.skillId}:${skill.level}`)
    .join(',')
}

function createArmorStateKey(
  slotIndex: number,
  skills: readonly SkillValue[],
  selectedArmor: Partial<Record<ArmorSlot, ArmorVariant>>,
): string {
  const slots = ARMOR_SLOTS
    .slice(0, slotIndex)
    .flatMap(slot => selectedArmor[slot]?.slots ?? [])
    .sort((left, right) => right - left)
    .join(',')

  return `${slotIndex}|${skillKey(skills)}|${slots}`
}

function getPartialArmorDefense(
  selectedArmor: Partial<Record<ArmorSlot, ArmorVariant>>,
): number {
  return Object.values(selectedArmor).reduce((total, armor) => total + (armor?.defense ?? 0), 0)
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

function createCompleteArmor(
  selectedArmor: Partial<Record<ArmorSlot, ArmorVariant>>,
): Record<ArmorSlot, ArmorVariant> {
  const armor = {} as Record<ArmorSlot, ArmorVariant>

  for (const slot of ARMOR_SLOTS) {
    const variant = selectedArmor[slot]

    if (!variant) {
      throw new Error(`Missing armor for slot: ${slot}`)
    }

    armor[slot] = variant
  }

  return armor
}
