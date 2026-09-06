import type {
  ArmorAugmentation,
  ArmorAugmentComponent,
  ArmorPiece,
  ArmorVariant,
  SkillValue,
} from './model'
import { applySkillChanges, countActiveSkills } from './skills'
import { applySlotUpgrades } from './slots'

export const MAX_ARMOR_SKILLS = 5

export interface ArmorVariantGenerationOptions {
  readonly maxComponents?: number
  readonly maxVariants?: number
}

export function createArmorVariant(
  base: ArmorPiece,
  augmentation?: ArmorAugmentation,
): ArmorVariant {
  const appliedAugmentation = augmentation ?? {
    componentIds: [],
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
    ...(appliedAugmentation.componentIds ?? []),
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

export function generateArmorVariants(
  base: ArmorPiece,
  components: readonly ArmorAugmentComponent[],
  options: ArmorVariantGenerationOptions = {},
): ArmorVariant[] {
  const maxComponents = options.maxComponents ?? 7
  const maxVariants = options.maxVariants ?? Number.POSITIVE_INFINITY
  const variants = new Map<string, ArmorVariant>()

  function addVariant(augmentation: ArmorAugmentation): void {
    if (augmentation.cost < 0 || augmentation.cost > base.costBudget) {
      return
    }

    try {
      const variant = createArmorVariant(base, augmentation)
      variants.set(variant.variantId, variant)
    }
    catch {

    }
  }

  function search(
    depth: number,
    cost: number,
    defenseDelta: number,
    skillChanges: readonly SkillValue[],
    slotUpgrades: number,
    componentIds: readonly string[],
  ): void {
    addVariant({
      componentIds,
      cost,
      defenseDelta,
      skillChanges,
      slotUpgrades,
    })

    if (depth >= maxComponents || variants.size >= maxVariants) {
      return
    }

    for (const component of components) {
      search(
        depth + 1,
        cost + component.costDelta,
        defenseDelta + component.defenseDelta,
        [...skillChanges, ...component.skillChanges],
        slotUpgrades + component.slotUpgrades,
        [...componentIds, component.id],
      )

      if (variants.size >= maxVariants) {
        return
      }
    }
  }

  search(0, 0, 0, [], 0, [])
  return [...variants.values()]
}
