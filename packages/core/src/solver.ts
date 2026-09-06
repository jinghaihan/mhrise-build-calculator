import type { ArmorSlot, ArmorVariant, BuildRequest, BuildSolution, SkillValue } from './model'
import { collectAvailableSlots, findDecorationPlacements } from './decorations'
import { ARMOR_SLOTS } from './model'
import { addSkillValues, meetsSkillRequirements } from './skills'
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

  function searchArmor(slotIndex: number, skills: readonly SkillValue[]): void {
    if (solutions.length >= maxSolutions) {
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
    for (const talisman of request.talismans.filter(isTalismanLegal)) {
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
          id: request.id,
          skills: finalSkills,
          talisman,
          weapon: request.weapon,
        })
      }
    }
  }

  searchArmor(0, [])
  return solutions
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
