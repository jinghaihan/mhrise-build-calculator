import type {
  ArmorAugmentation,
  ArmorAugmentComponent,
  ArmorElement,
  ArmorPiece,
  ArmorResistances,
  ArmorVariant,
  SkillValue,
} from './model'
import { applySkillChanges, countActiveSkills } from './skills'
import { applySlotUpgrades } from './slots'

export const MAX_ARMOR_SKILLS = 5

export const ARMOR_ELEMENTS: readonly ArmorElement[] = [
  'fire',
  'water',
  'thunder',
  'ice',
  'dragon',
]

const ZERO_ARMOR_RESISTANCES: ArmorResistances = {
  dragon: 0,
  fire: 0,
  ice: 0,
  thunder: 0,
  water: 0,
}

export function addArmorResistances(
  base: ArmorResistances,
  delta: Partial<ArmorResistances> = {},
): ArmorResistances {
  return {
    dragon: base.dragon + (delta.dragon ?? 0),
    fire: base.fire + (delta.fire ?? 0),
    ice: base.ice + (delta.ice ?? 0),
    thunder: base.thunder + (delta.thunder ?? 0),
    water: base.water + (delta.water ?? 0),
  }
}

function baseArmorResistances(base: ArmorPiece): ArmorResistances {
  return base.baseResistances ?? ZERO_ARMOR_RESISTANCES
}

export interface ArmorVariantGenerationOptions {
  readonly maxComponents?: number
  readonly maxVariants?: number
  readonly resistanceStrategy?: 'balanced' | 'source-order'
}

export function createArmorVariant(
  base: ArmorPiece,
  augmentation?: ArmorAugmentation,
): ArmorVariant {
  const appliedAugmentation = augmentation ?? {
    componentIds: [],
    cost: 0,
    defenseDelta: 0,
    resistanceDelta: {},
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
  const resistances = addArmorResistances(
    baseArmorResistances(base),
    appliedAugmentation.resistanceDelta,
  )
  const variantParts = [
    base.ref.id,
    ...(appliedAugmentation.componentIds ?? []),
    appliedAugmentation.cost,
    appliedAugmentation.defenseDelta,
    appliedAugmentation.slotUpgrades,
    ...appliedAugmentation.skillChanges.map(skill => `${skill.skillId}:${skill.level}`),
  ]
  const resistanceDelta = appliedAugmentation.resistanceDelta ?? {}
  if (Object.values(resistanceDelta).some(value => value !== 0)) {
    variantParts.push(JSON.stringify(resistanceDelta))
  }
  const variantId = variantParts.join('|')

  return {
    augmentation,
    base,
    defense,
    resistances,
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
  const resistanceStrategy = options.resistanceStrategy ?? 'balanced'
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
    resistanceDelta: ArmorResistances,
    skillChanges: readonly SkillValue[],
    slotUpgrades: number,
    componentIds: readonly string[],
  ): void {
    addVariant({
      componentIds,
      cost,
      defenseDelta,
      resistanceDelta,
      skillChanges,
      slotUpgrades,
    })

    if (depth >= maxComponents || variants.size >= maxVariants) {
      return
    }

    const nextComponents = resistanceStrategy === 'balanced'
      ? [...components].sort((left, right) => compareResistancePriority(
          left,
          right,
          addArmorResistances(baseArmorResistances(base), resistanceDelta),
        ))
      : components

    for (const component of nextComponents) {
      search(
        depth + 1,
        cost + component.costDelta,
        defenseDelta + component.defenseDelta,
        addArmorResistances(resistanceDelta, component.resistanceDelta),
        [...skillChanges, ...component.skillChanges],
        slotUpgrades + component.slotUpgrades,
        [...componentIds, component.id],
      )

      if (variants.size >= maxVariants) {
        return
      }
    }
  }

  search(0, 0, 0, ZERO_ARMOR_RESISTANCES, [], 0, [])
  return [...variants.values()]
}

function compareResistancePriority(
  left: ArmorAugmentComponent,
  right: ArmorAugmentComponent,
  current: ArmorResistances,
): number {
  return resistanceReductionValue(right, current) - resistanceReductionValue(left, current)
}

function resistanceReductionValue(
  component: ArmorAugmentComponent,
  current: ArmorResistances,
): number {
  return ARMOR_ELEMENTS.reduce((score, element) => {
    const delta = component.resistanceDelta?.[element] ?? 0
    if (delta >= 0) {
      return score
    }

    const target = current[element]
    return score + (-delta) * Math.max(target + 1, 0)
  }, 0)
}
