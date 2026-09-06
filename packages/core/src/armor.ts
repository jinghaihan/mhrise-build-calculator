import type {
  ArmorAugmentation,
  ArmorAugmentComponent,
  ArmorElement,
  ArmorPiece,
  ArmorResistances,
  ArmorVariant,
  SkillValue,
} from './model'
import { addSkillValues, applySkillChanges, countActiveSkills } from './skills'
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

/** The project rule for ordinary Qurious Crafting: one armor piece can receive seven operations. */
export const MAX_QURIOUS_OPERATIONS = 7

export interface ArmorVariantGenerationOptions {
  /** Explicitly lower the operation count for a bounded test or preview search. */
  readonly maxOperations?: number
  /** Explicitly cap returned variants; omitted means do not cap the legal state space. */
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

  if (appliedAugmentation.cost > base.costBudget) {
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
  const maxOperations = options.maxOperations ?? MAX_QURIOUS_OPERATIONS
  const maxVariants = options.maxVariants ?? Number.POSITIVE_INFINITY
  const resistanceStrategy = options.resistanceStrategy ?? 'balanced'
  const variants = new Map<string, ArmorVariant>()
  const uniqueComponents = pruneDominatedComponents(dedupeComponents(components))

  function addVariant(augmentation: ArmorAugmentation): void {
    if (augmentation.cost > base.costBudget) {
      return
    }

    try {
      const variant = createArmorVariant(base, augmentation)
      variants.set(variant.variantId, variant)
    }
    catch {

    }
  }

  const visitedStates = new Map<string, VisitedState[]>()
  const ordinaryComponents = uniqueComponents.filter((component) => {
    const role = component.role ?? 'normal'
    return role === 'normal' || role === 'cost-fill'
  })
  const componentOrder = new Map(
    [...ordinaryComponents]
      .filter(component => component.skillChanges.length === 0
        && component.role !== 'cost-fill')
      .sort(compareCommutativeComponents)
      .map((component, index) => [component.id, index] as const),
  )
  search(0, 0, 0, ZERO_ARMOR_RESISTANCES, [], 0, [], -1)

  function search(
    depth: number,
    cost: number,
    defenseDelta: number,
    resistanceDelta: ArmorResistances,
    skillChanges: readonly SkillValue[],
    slotUpgrades: number,
    componentIds: readonly string[],
    lastCommutativeIndex: number,
  ): void {
    // A roll cannot spend more than the initial budget. Negative cumulative
    // cost is legal because drawback rolls restore available budget.
    if (cost > base.costBudget) {
      return
    }

    const stateKey = [
      cost,
      resistanceDelta.dragon,
      resistanceDelta.fire,
      resistanceDelta.ice,
      resistanceDelta.thunder,
      resistanceDelta.water,
      skillKey(addSkillValues(skillChanges)),
      slotUpgrades,
      lastCommutativeIndex,
    ].join('|')
    const previousStates = visitedStates.get(stateKey) ?? []
    if (previousStates.some(previous => previous.depth <= depth
      && previous.defenseDelta >= defenseDelta)) {
      return
    }
    visitedStates.set(stateKey, [
      ...previousStates.filter(previous => previous.depth < depth
        || previous.defenseDelta > defenseDelta),
      { depth, defenseDelta },
    ])

    addVariant({
      componentIds,
      cost,
      defenseDelta,
      resistanceDelta,
      skillChanges,
      slotUpgrades,
    })

    if (cost === base.costBudget || depth >= maxOperations || variants.size >= maxVariants) {
      return
    }

    const nextComponents = resistanceStrategy === 'balanced'
      ? [...ordinaryComponents].sort((left, right) => compareResistancePriority(
          left,
          right,
          addArmorResistances(baseArmorResistances(base), resistanceDelta),
        ))
      : ordinaryComponents

    for (const component of nextComponents) {
      const role = component.role ?? 'normal'
      const nextCost = cost + component.costDelta

      const commutativeIndex = componentOrder.get(component.id)
      if (commutativeIndex !== undefined
        && lastCommutativeIndex >= 0
        && commutativeIndex < lastCommutativeIndex) {
        continue
      }

      if (role === 'cost-fill' && nextCost !== base.costBudget) {
        continue
      }

      const nextSkillChanges = [...skillChanges, ...component.skillChanges]
      const nextSkills = addSkillValues(base.baseSkills, nextSkillChanges)
      if (nextSkills.some(skill => skill.level < 0)) {
        continue
      }

      search(
        depth + 1,
        nextCost,
        defenseDelta + component.defenseDelta,
        addArmorResistances(resistanceDelta, component.resistanceDelta),
        nextSkillChanges,
        slotUpgrades + component.slotUpgrades,
        [...componentIds, component.id],
        commutativeIndex ?? -1,
      )

      if (variants.size >= maxVariants) {
        return
      }
    }
  }

  return [...variants.values()]
}

interface VisitedState {
  readonly defenseDelta: number
  readonly depth: number
}

function compareCommutativeComponents(
  left: ArmorAugmentComponent,
  right: ArmorAugmentComponent,
): number {
  return left.costDelta - right.costDelta
    || left.defenseDelta - right.defenseDelta
    || left.slotUpgrades - right.slotUpgrades
    || JSON.stringify(left.resistanceDelta ?? {}).localeCompare(
      JSON.stringify(right.resistanceDelta ?? {}),
    )
    || left.id.localeCompare(right.id)
}

function dedupeComponents(
  components: readonly ArmorAugmentComponent[],
): ArmorAugmentComponent[] {
  const unique = new Map<string, ArmorAugmentComponent>()

  for (const component of components) {
    const key = [
      component.costDelta,
      component.defenseDelta,
      component.slotUpgrades,
      component.role ?? 'normal',
      JSON.stringify(component.resistanceDelta ?? {}),
      skillKey(component.skillChanges),
    ].join('|')
    if (!unique.has(key)) {
      unique.set(key, component)
    }
  }

  return [...unique.values()]
}

/**
 * A same-cost roll is unnecessary when another roll has every final effect at
 * least as good and the same skill changes/role. Keeping the better roll is
 * exact for build search and removes duplicate source levels such as
 * resistance +1/+2 with equal cost.
 */
function pruneDominatedComponents(
  components: readonly ArmorAugmentComponent[],
): ArmorAugmentComponent[] {
  return components.filter((component, index) => !components.some((candidate, candidateIndex) => {
    if (index === candidateIndex
      || candidate.costDelta !== component.costDelta
      || (candidate.role ?? 'normal') !== (component.role ?? 'normal')
      || skillKey(candidate.skillChanges) !== skillKey(component.skillChanges)) {
      return false
    }

    const resistanceElements = ARMOR_ELEMENTS.every(element => (
      (candidate.resistanceDelta?.[element] ?? 0)
      >= (component.resistanceDelta?.[element] ?? 0)
    ))
    const noWorse = candidate.defenseDelta >= component.defenseDelta
      && candidate.slotUpgrades >= component.slotUpgrades
      && resistanceElements
    const strictlyBetter = candidate.defenseDelta > component.defenseDelta
      || candidate.slotUpgrades > component.slotUpgrades
      || ARMOR_ELEMENTS.some(element => (
        (candidate.resistanceDelta?.[element] ?? 0)
        > (component.resistanceDelta?.[element] ?? 0)
      ))

    return noWorse && strictlyBetter
  }))
}

function skillKey(skills: readonly SkillValue[]): string {
  return [...skills]
    .sort((left, right) => String(left.skillId).localeCompare(String(right.skillId)))
    .map(skill => `${skill.skillId}:${skill.level}`)
    .join(',')
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
    return score + (-delta) * Math.max(target, 0)
  }, 0)
}
