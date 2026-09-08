import type {
  ArmorAugmentation,
  ArmorAugmentComponent,
  ArmorElement,
  ArmorPiece,
  ArmorResistances,
  ArmorVariant,
  SkillValue,
} from './model'
import type { SlotLevels } from './slots'
import { addSkillValues, applySkillChanges, countActiveSkills, getSkillLevel } from './skills'
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

const preparedComponentsCache = new Map<string, readonly ArmorAugmentComponent[]>()

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
  /** Build requirements used only to remove augmentations that cannot improve this search. */
  readonly requiredSkills?: readonly SkillValue[]
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
  return generateArmorVariantsDp(base, components, options)
}

interface GenerationState {
  readonly componentIds: readonly string[]
  readonly cost: number
  readonly defenseDelta: number
  readonly depth: number
  readonly resistanceDelta: ArmorResistances
  readonly skillChanges: readonly SkillValue[]
  readonly skills: readonly SkillValue[]
  readonly slotUpgrades: number
  readonly slots: SlotLevels
}

function generateArmorVariantsDp(
  base: ArmorPiece,
  components: readonly ArmorAugmentComponent[],
  options: ArmorVariantGenerationOptions,
): ArmorVariant[] {
  const maxOperations = options.maxOperations ?? MAX_QURIOUS_OPERATIONS
  const maxVariants = options.maxVariants ?? Number.POSITIVE_INFINITY
  const requiredSkills = options.requiredSkills ?? []
  const resistanceStrategy = options.resistanceStrategy ?? 'balanced'
  const variants = new Map<string, ArmorVariant>()
  const preparedComponents = prepareOrdinaryComponents(
    components,
    resistanceStrategy,
  )
  const compactResistance = requiredSkills.length > 0 && resistanceStrategy === 'balanced'
  const preferredInitialResistance = compactResistance
    ? preferredNegativeResistanceComponents(
        preparedComponents,
        baseArmorResistances(base),
      )
    : undefined
  const ordinaryComponents = preparedComponents.filter((component) => {
    const role = component.role ?? 'normal'
    if (role !== 'normal' && role !== 'cost-fill') {
      return false
    }

    if (component.skillChanges.some(change => change.level < 0
      && getSkillLevel(base.baseSkills, change.skillId) <= 0)) {
      return false
    }

    return !compactResistance || !isNegativeResistanceComponent(component)
      || preferredInitialResistance?.get(resistanceComponentGroup(component)) === component.id
  })
  let states: GenerationState[] = [{
    componentIds: [],
    cost: 0,
    defenseDelta: 0,
    depth: 0,
    resistanceDelta: ZERO_ARMOR_RESISTANCES,
    skillChanges: [],
    skills: addSkillValues(base.baseSkills),
    slotUpgrades: 0,
    slots: base.slots,
  }]
  const frontier = new Map<string, GenerationState[]>()

  for (let depth = 0; depth <= maxOperations; depth += 1) {
    for (const state of states) {
      addVariant(state)
    }

    if (depth >= maxOperations || variants.size >= maxVariants) {
      break
    }

    const nextStates = new Map<string, GenerationState>()
    for (const state of states) {
      const currentResistances = addArmorResistances(
        baseArmorResistances(base),
        state.resistanceDelta,
      )
      const preferredNegativeResistance = resistanceStrategy === 'balanced'
        ? preferredNegativeResistanceComponents(preparedComponents, currentResistances)
        : undefined

      for (const component of ordinaryComponents) {
        const selectedComponent = compactResistance && isNegativeResistanceComponent(component)
          ? preparedComponents.find(candidate => candidate.id === preferredNegativeResistance
            ?.get(resistanceComponentGroup(component))) ?? component
          : component
        const role = selectedComponent.role ?? 'normal'
        const nextCost = state.cost + selectedComponent.costDelta
        if (nextCost > base.costBudget || (role === 'cost-fill' && nextCost !== base.costBudget)) {
          continue
        }

        if (resistanceStrategy === 'balanced'
          && isNegativeResistanceComponent(selectedComponent)
          && preferredNegativeResistance?.get(resistanceComponentGroup(selectedComponent)) !== selectedComponent.id) {
          continue
        }

        const nextSkillChanges = [...state.skillChanges, ...selectedComponent.skillChanges]
        const nextSkills = addSkillValues(base.baseSkills, nextSkillChanges)
        if (nextSkills.some(skill => skill.level < 0)
          || countActiveSkills(nextSkills) > MAX_ARMOR_SKILLS) {
          continue
        }

        if (requiredSkills.length > 0 && selectedComponent.skillChanges.some((change) => {
          if (change.level <= 0) {
            return false
          }
          const requiredLevel = getRequiredSkillLevel(requiredSkills, change.skillId)
          return requiredLevel > 0
            && getSkillLevel(nextSkills, change.skillId) > requiredLevel
        })) {
          continue
        }

        const nextSlotUpgrades = state.slotUpgrades + selectedComponent.slotUpgrades
        let nextSlots: SlotLevels
        try {
          nextSlots = applySlotUpgrades(base.slots, nextSlotUpgrades)
        }
        catch {
          continue
        }

        const nextState: GenerationState = {
          componentIds: [...state.componentIds, selectedComponent.id],
          cost: nextCost,
          defenseDelta: state.defenseDelta + selectedComponent.defenseDelta,
          depth: depth + 1,
          resistanceDelta: addArmorResistances(
            state.resistanceDelta,
            selectedComponent.resistanceDelta,
          ),
          skillChanges: nextSkillChanges,
          skills: nextSkills,
          slotUpgrades: nextSlotUpgrades,
          slots: nextSlots,
        }
        const key = generationStateKey(nextState, !compactResistance)
        const existing = nextStates.get(key)
        if (!existing || existing.defenseDelta < nextState.defenseDelta) {
          nextStates.set(key, nextState)
        }
      }
    }

    states = [...nextStates.values()].filter((state) => {
      const key = [
        activeSkillSetKey(state.skills),
        ...(compactResistance
          ? []
          : [
              state.resistanceDelta.dragon,
              state.resistanceDelta.fire,
              state.resistanceDelta.ice,
              state.resistanceDelta.thunder,
              state.resistanceDelta.water,
            ]),
      ].join('|')
      const previous = frontier.get(key) ?? []
      if (previous.some(candidate => dominatesGeneration(candidate, state))) {
        return false
      }
      frontier.set(key, [
        ...previous.filter(candidate => !dominatesGeneration(state, candidate)),
        state,
      ])
      return true
    })
  }

  return [...variants.values()]

  function addVariant(state: GenerationState): void {
    try {
      const variant = createArmorVariant(base, {
        componentIds: state.componentIds,
        cost: state.cost,
        defenseDelta: state.defenseDelta,
        resistanceDelta: state.resistanceDelta,
        skillChanges: state.skillChanges,
        slotUpgrades: state.slotUpgrades,
      })
      const key = armorVariantStateKey(variant, requiredSkills)
      const existing = variants.get(key)
      if (!existing || variant.defense > existing.defense) {
        variants.set(key, variant)
      }
    }
    catch {

    }
  }
}

function prepareOrdinaryComponents(
  components: readonly ArmorAugmentComponent[],
  resistanceStrategy: 'balanced' | 'source-order',
): readonly ArmorAugmentComponent[] {
  const key = `${resistanceStrategy}|${components.map(component => [
    component.id,
    component.costDelta,
    component.defenseDelta,
    component.slotUpgrades,
    component.role ?? 'normal',
    JSON.stringify(component.resistanceDelta ?? {}),
    skillKey(component.skillChanges),
  ].join(':')).join('|')}`
  const cached = preparedComponentsCache.get(key)
  if (cached) {
    return cached
  }

  const prepared = pruneDominatedComponents(dedupeComponents(components)).filter((component) => {
    const role = component.role ?? 'normal'
    return (role === 'normal' || role === 'cost-fill')
      && (resistanceStrategy === 'source-order' || !isPositiveResistanceComponent(component))
  })
  preparedComponentsCache.set(key, prepared)
  return prepared
}

function generationStateKey(state: GenerationState, includeResistance: boolean): string {
  return [
    state.cost,
    state.defenseDelta,
    state.slotUpgrades,
    skillKey(state.skills),
    ...(includeResistance
      ? [
          state.resistanceDelta.dragon,
          state.resistanceDelta.fire,
          state.resistanceDelta.ice,
          state.resistanceDelta.thunder,
          state.resistanceDelta.water,
        ]
      : []),
  ].join('|')
}

function dominatesGeneration(left: GenerationState, right: GenerationState): boolean {
  return left.cost <= right.cost
    && left.depth <= right.depth
    && left.defenseDelta >= right.defenseDelta
    && left.slots.every((level, index) => level >= right.slots[index])
    && left.skills.every(skill => getSkillLevel(left.skills, skill.skillId)
      >= getSkillLevel(right.skills, skill.skillId))
    && (
      left.cost < right.cost
      || left.depth < right.depth
      || left.defenseDelta > right.defenseDelta
      || left.slots.some((level, index) => level > right.slots[index])
      || left.skills.some(skill => getSkillLevel(left.skills, skill.skillId)
        > getSkillLevel(right.skills, skill.skillId))
    )
}

function activeSkillSetKey(skills: readonly SkillValue[]): string {
  return skills
    .filter(skill => skill.level > 0)
    .map(skill => skill.skillId)
    .sort()
    .join(',')
}

function getRequiredSkillLevel(
  requirements: readonly SkillValue[],
  skillId: SkillValue['skillId'],
): number {
  return requirements.find(requirement => requirement.skillId === skillId)?.level ?? 0
}

function isNegativeResistanceComponent(component: ArmorAugmentComponent): boolean {
  return component.skillChanges.length === 0
    && component.defenseDelta === 0
    && component.slotUpgrades === 0
    && Object.values(component.resistanceDelta ?? {}).some(value => value < 0)
}

function isPositiveResistanceComponent(component: ArmorAugmentComponent): boolean {
  return component.skillChanges.length === 0
    && component.defenseDelta === 0
    && component.slotUpgrades === 0
    && Object.values(component.resistanceDelta ?? {}).some(value => value > 0)
}

function resistanceComponentGroup(component: ArmorAugmentComponent): string {
  return [
    component.costDelta,
    Object.values(component.resistanceDelta ?? {}).reduce(
      (total, value) => total + value,
      0,
    ),
  ].join('|')
}

function preferredNegativeResistanceComponents(
  components: readonly ArmorAugmentComponent[],
  current: ArmorResistances,
): Map<string, string> {
  const preferred = new Map<string, ArmorAugmentComponent>()

  for (const component of components) {
    if (!isNegativeResistanceComponent(component)) {
      continue
    }

    const group = resistanceComponentGroup(component)
    const currentPreferred = preferred.get(group)
    if (!currentPreferred
      || resistanceReductionValue(component, current)
      > resistanceReductionValue(currentPreferred, current)) {
      preferred.set(group, component)
    }
  }

  return new Map([...preferred].map(([group, component]) => [group, component.id]))
}

function armorVariantStateKey(
  variant: ArmorVariant,
  requiredSkills: readonly SkillValue[],
): string {
  const resistanceStateKey = requiredSkills.length === 0
    ? [
        variant.resistances.dragon,
        variant.resistances.fire,
        variant.resistances.ice,
        variant.resistances.thunder,
        variant.resistances.water,
      ]
    : []
  return [
    variant.slots.join(','),
    ...resistanceStateKey,
    requiredSkills.length > 0
      ? requiredSkills.map(requirement => `${requirement.skillId}:${Math.min(
          getSkillLevel(variant.skills, requirement.skillId),
          requirement.level,
        )}`).join(',')
      : skillKey(variant.skills),
  ].join('|')
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
 * A roll is unnecessary when another roll has every final effect at least as
 * good, costs no more, and has the same skill changes/role. Keeping the better
 * roll is exact for build search and removes redundant skill+ cost tiers.
 */
function pruneDominatedComponents(
  components: readonly ArmorAugmentComponent[],
): ArmorAugmentComponent[] {
  return components.filter((component, index) => !components.some((candidate, candidateIndex) => {
    if (index === candidateIndex
      || candidate.costDelta > component.costDelta
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
    const strictlyBetter = candidate.costDelta < component.costDelta
      || candidate.defenseDelta > component.defenseDelta
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
    return score + (-delta) * target
  }, 0)
}
