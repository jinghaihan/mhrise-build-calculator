import type { ArmorSlot, ArmorVariant, BuildRequest, BuildSolution, SkillValue } from './model'
import { collectAvailableSlots, findDecorationPlacements } from './decorations'
import { getTotalArmorDefense } from './defense'
import { ARMOR_SLOTS } from './model'
import { addSkillValues, getSkillLevel, meetsSkillRequirements } from './skills'
import { isTalismanLegal } from './talismans'

export interface SolveOptions {
  readonly maxSolutions?: number
}

export function solveBuild(
  request: BuildRequest,
  options: SolveOptions = {},
): BuildSolution[] {
  const maxSolutions = options.maxSolutions ?? Number.POSITIVE_INFINITY
  const solutions: BuildSolution[] = []
  const selectedArmor: Partial<Record<ArmorSlot, ArmorVariant>> = {}
  const legalTalismans = request.talismans.filter(isTalismanLegal)
  const bounds = createSearchBounds(request, legalTalismans)

  function searchArmor(slotIndex: number, skills: readonly SkillValue[]): void {
    if (solutions.length >= maxSolutions) {
      return
    }

    if (!canReachRequirements(request, bounds, slotIndex, skills)) {
      return
    }

    if (slotIndex >= ARMOR_SLOTS.length) {
      searchTalismans(skills)
      return
    }

    const slot = ARMOR_SLOTS[slotIndex]
    const candidates = request.armorBySlot[slot]

    for (const armor of candidates) {
      selectedArmor[slot] = armor
      searchArmor(slotIndex + 1, addSkillValues(skills, armor.skills))
    }

    delete selectedArmor[slot]
  }

  function searchTalismans(skills: readonly SkillValue[]): void {
    for (const talisman of legalTalismans) {
      if (solutions.length >= maxSolutions) {
        return
      }

      const totalSkills = addSkillValues(skills, request.weapon.skills, talisman.skills)
      const armor = createCompleteArmor(selectedArmor)
      const slots = collectAvailableSlots(request.weapon, armor, talisman)
      const placements = findDecorationPlacements(
        slots,
        request.decorations,
        totalSkills,
        request.requiredSkills,
        maxSolutions - solutions.length,
      )

      for (const decorations of placements) {
        const finalSkills = decorations.reduce(
          (current, placement) => addSkillValues(current, placement.decoration.skills),
          totalSkills,
        )

        if (!meetsSkillRequirements(finalSkills, request.requiredSkills)) {
          continue
        }

        solutions.push({
          armor,
          decorations,
          defense: getTotalArmorDefense(armor),
          id: request.id,
          skills: finalSkills,
          talisman,
          weapon: request.weapon,
        })
      }
    }
  }

  searchArmor(0, [])
  return solutions.sort((left, right) => right.defense - left.defense
    || left.decorations.length - right.decorations.length)
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
