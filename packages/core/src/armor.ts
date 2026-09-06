import type { ArmorAugmentation, ArmorPiece, ArmorVariant } from './model'
import { applySkillChanges, countActiveSkills } from './skills'
import { applySlotUpgrades } from './slots'

export const MAX_ARMOR_SKILLS = 5

export function createArmorVariant(
  base: ArmorPiece,
  augmentation?: ArmorAugmentation,
): ArmorVariant {
  const appliedAugmentation = augmentation ?? {
    cost: 0,
    defenseDelta: 0,
    skillChanges: [],
    slotUpgrades: 0,
  }
  const skills = applySkillChanges(base.baseSkills, appliedAugmentation.skillChanges)

  if (appliedAugmentation.cost < 0 || appliedAugmentation.cost > base.costBudget) {
    throw new Error(
      `Armor augmentation cost ${appliedAugmentation.cost} is outside budget ${base.costBudget}`,
    )
  }

  if (skills.some(skill => skill.level < 0)) {
    throw new Error(`Armor skill level cannot be negative: ${base.ref.id}`)
  }

  if (countActiveSkills(skills) > MAX_ARMOR_SKILLS) {
    throw new Error(`Armor has more than ${MAX_ARMOR_SKILLS} active skills: ${base.ref.id}`)
  }

  const defense = base.baseDefense + appliedAugmentation.defenseDelta

  if (defense < 0) {
    throw new Error(`Armor defense cannot be negative: ${base.ref.id}`)
  }

  const slots = applySlotUpgrades(base.slots, appliedAugmentation.slotUpgrades)
  const variantId = [
    base.ref.id,
    appliedAugmentation.cost,
    appliedAugmentation.defenseDelta,
    appliedAugmentation.slotUpgrades,
    ...appliedAugmentation.skillChanges.map(skill => `${skill.skillId}:${skill.level}`),
  ].join('|')

  return {
    augmentation,
    base,
    defense,
    skills,
    slots,
    variantId,
  }
}
