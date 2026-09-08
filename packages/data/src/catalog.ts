import type {
  ArmorAugmentation,
  ArmorAugmentComponent,
  ArmorPiece,
  ArmorSlot,
  ArmorVariantGenerationOptions,
  BuildRequest,
  Decoration,
  ReusePlan,
  SkillValue,
  Talisman,
  Weapon,
  WikiEntityKind,
  WikiRef,
} from '@mhrise-build/core'
import {
  ARMOR_SLOTS,
  createArmorVariant,
  generateArmorVariants,
  getSkillLevel,
  optimizeEquipmentReuse,
} from '@mhrise-build/core'

export type LocaleCode = string

export interface BuildRequestProgress {
  readonly current: number
  readonly stage: 'generating'
  readonly total: number
}

export interface LocalizedNames {
  readonly [locale: LocaleCode]: string
}

export interface KiranicoRecord<K extends WikiEntityKind> {
  readonly names: LocalizedNames
  readonly ref: WikiRef<K>
}

export interface SkillRecord extends KiranicoRecord<'skill'> {
  readonly maxLevel: number
}

export interface KiranicoArmorRecord extends KiranicoRecord<'armor'> {
  readonly armorFamilyId?: string
  readonly armor: ArmorPiece
}

export interface KiranicoDecorationRecord extends KiranicoRecord<'decoration'> {
  readonly decoration: Decoration
}

export interface KiranicoTalismanRecord extends KiranicoRecord<'talisman'> {
  readonly talisman: Talisman
}

export interface KiranicoWeaponRecord extends KiranicoRecord<'weapon'> {
  readonly weapon: Weapon
}

export interface DataCatalog {
  readonly armors: readonly KiranicoArmorRecord[]
  readonly decorations: readonly KiranicoDecorationRecord[]
  readonly skills: readonly SkillRecord[]
  readonly talismans: readonly KiranicoTalismanRecord[]
  readonly weapons: readonly KiranicoWeaponRecord[]
}

export interface BuildDefinition {
  readonly armorAugmentationsById?: Readonly<Record<string, readonly ArmorAugmentation[]>>
  readonly armorComponentsById?: Readonly<Record<string, readonly ArmorAugmentComponent[]>>
  readonly armorIdsBySlot?: Partial<Readonly<Record<ArmorSlot, readonly string[]>>>
  readonly armorVariantOptions?: ArmorVariantGenerationOptions
  readonly decorationIds?: readonly string[]
  readonly id: string
  readonly requiredSkills: readonly SkillValue[]
  readonly talismanIds?: readonly string[]
  readonly weaponId: string
}

export function createDataCatalog(input: DataCatalog): DataCatalog {
  assertUniqueIds(input.armors, 'armor')
  assertUniqueIds(input.decorations, 'decoration')
  assertUniqueIds(input.skills, 'skill')
  assertUniqueIds(input.talismans, 'talisman')
  assertUniqueIds(input.weapons, 'weapon')
  return input
}

export function findRecordByName<K extends WikiEntityKind>(
  records: readonly KiranicoRecord<K>[],
  name: string,
  locale: LocaleCode,
): KiranicoRecord<K> {
  const matches = records.filter(record => record.names[locale] === name)

  if (matches.length === 0) {
    throw new Error(`No ${locale} ${name} record was found`)
  }

  if (matches.length > 1) {
    throw new Error(`Multiple ${locale} records match: ${name}`)
  }

  return matches[0]
}

export function findSkillByName(
  catalog: DataCatalog,
  name: string,
  locale: LocaleCode,
): SkillRecord {
  return findRecordByName(catalog.skills, name, locale) as SkillRecord
}

export function skillRequirement(
  catalog: DataCatalog,
  name: string,
  level: number,
  locale: LocaleCode,
): SkillValue {
  const record = findSkillByName(catalog, name, locale)

  if (!Number.isInteger(level) || level < 1 || level > record.maxLevel) {
    throw new Error(`Invalid ${name} level: ${level}; maximum is ${record.maxLevel}`)
  }

  return skillValue(record.ref, level)
}

export function createBuildRequest(
  catalog: DataCatalog,
  definition: BuildDefinition,
  options: {
    readonly onProgress?: (progress: BuildRequestProgress) => void
  } = {},
): BuildRequest {
  const armorBySlot = {} as Record<ArmorSlot, readonly ReturnType<typeof createArmorVariant>[]>
  const generatedAugmentations = new Map<string, readonly (ArmorAugmentation | undefined)[]>()
  const recordsBySlot = ARMOR_SLOTS.map(slot => catalog.armors.filter((record) => {
    const selectedIds = definition.armorIdsBySlot?.[slot]
    return record.armor.slot === slot && (!selectedIds || selectedIds.includes(record.ref.id))
  }))
  const totalRecords = recordsBySlot.reduce((total, records) => total + records.length, 0)
  let completedRecords = 0

  for (const [slotIndex, slot] of ARMOR_SLOTS.entries()) {
    const records = recordsBySlot[slotIndex]

    if (records.length === 0) {
      throw new Error(`No armor data found for ${slot} in build ${definition.id}`)
    }

    armorBySlot[slot] = records.flatMap((record) => {
      const variants = armorVariantsFor(
        record.armor,
        definition,
        generatedAugmentations,
      )
      completedRecords += 1
      options.onProgress?.({
        current: completedRecords,
        stage: 'generating',
        total: totalRecords,
      })
      return variants
    })
  }

  const weapon = findById(catalog.weapons, definition.weaponId, 'weapon').weapon
  const talismanRecords = filterByIds(catalog.talismans, definition.talismanIds, 'talisman')
  const decorationRecords = filterByIds(catalog.decorations, definition.decorationIds, 'decoration')

  return {
    armorBySlot,
    decorations: decorationRecords.map(record => record.decoration),
    id: definition.id,
    requiredSkills: definition.requiredSkills,
    talismans: talismanRecords.map(record => record.talisman),
    weapon,
  }
}

export function planBuilds(
  catalog: DataCatalog,
  definitions: readonly BuildDefinition[],
  options: Parameters<typeof optimizeEquipmentReuse>[1] = {},
): ReusePlan | undefined {
  return optimizeEquipmentReuse(
    definitions.map(definition => createBuildRequest(catalog, definition)),
    options,
  )
}

export function getLocalizedName(
  record: KiranicoRecord<WikiEntityKind>,
  locale: LocaleCode,
  fallbackLocale = 'en',
): string | undefined {
  return record.names[locale] ?? record.names[fallbackLocale] ?? Object.values(record.names)[0]
}

export function skillValue(skillId: WikiRef<'skill'>, level: number): SkillValue {
  return {
    level,
    skillId: skillId.id,
  }
}

function armorVariantsFor(
  base: ArmorPiece,
  definition: BuildDefinition,
  generatedAugmentations: Map<string, readonly (ArmorAugmentation | undefined)[]>,
) {
  const explicitAugmentations = definition.armorAugmentationsById?.[base.ref.id] ?? []
  const components = definition.armorComponentsById?.[base.ref.id] ?? []
  const generatedKey = components.length > 0
    ? JSON.stringify({
        baseSkills: base.baseSkills,
        baseResistances: base.baseResistances,
        components,
        costBudget: base.costBudget,
        options: definition.armorVariantOptions,
        slots: base.slots,
      })
    : undefined
  let augmentations = generatedKey ? generatedAugmentations.get(generatedKey) : undefined

  if (!augmentations) {
    if (components.length > 0) {
      const generatedVariants = generateArmorVariants(base, components, definition.armorVariantOptions)
      const reducedVariants = reduceGeneratedVariants(generatedVariants, definition.requiredSkills)
      augmentations = reducedVariants.map(variant => variant.augmentation)
    }
    else {
      augmentations = [undefined]
    }
    if (generatedKey) {
      generatedAugmentations.set(generatedKey, augmentations)
    }
  }

  const generated = augmentations.map(augmentation => createArmorVariant(base, augmentation))
  const explicit = explicitAugmentations.map(augmentation => createArmorVariant(base, augmentation))

  // The generator can produce tens of thousands of legal variants for one
  // piece. For ordinary searches, variants with the same requested skill
  // levels and socket capacities are interchangeable; keep the highest
  // defense representative before assembling the full request. This is a
  // lossless reduction for the current objective and avoids retaining all
  // generated objects at once. Explicit augmentations remain untouched.
  return [...generated, ...explicit]
}

function reduceGeneratedVariants(
  variants: readonly ReturnType<typeof createArmorVariant>[],
  requirements: readonly SkillValue[],
): ReturnType<typeof createArmorVariant>[] {
  if (requirements.length === 0)
    return [...variants]

  const bestByState = new Map<string, ReturnType<typeof createArmorVariant>>()
  for (const variant of variants) {
    const key = [
      requirements.map(requirement => `${requirement.skillId}:${Math.min(
        getSkillLevel(variant.skills, requirement.skillId),
        requirement.level,
      )}`).join(','),
      socketCapacities(variant.slots).join(','),
    ].join('|')
    const previous = bestByState.get(key)
    if (!previous || variant.defense > previous.defense)
      bestByState.set(key, variant)
  }

  return [...bestByState.values()]
}

function socketCapacities(slots: readonly [number, number, number]): [number, number, number, number] {
  return [1, 2, 3, 4].map(level => slots.filter(slot => slot >= level).length) as [number, number, number, number]
}

function filterByIds<T extends { ref: { id: string } }>(
  records: readonly T[],
  ids: readonly string[] | undefined,
  kind: string,
): T[] {
  const filtered = ids ? records.filter(record => ids.includes(record.ref.id)) : [...records]

  if (filtered.length === 0) {
    throw new Error(`No ${kind} data matched the requested ids`)
  }

  if (ids && filtered.length !== new Set(ids).size) {
    throw new Error(`Some ${kind} ids were not found`)
  }

  return filtered
}

function findById<T extends { ref: { id: string } }>(
  records: readonly T[],
  id: string,
  kind: string,
): T {
  const record = records.find(candidate => candidate.ref.id === id)

  if (!record) {
    throw new Error(`${kind} id was not found: ${id}`)
  }

  return record
}

function assertUniqueIds<T extends { ref: { id: string } }>(
  records: readonly T[],
  kind: string,
): void {
  const ids = records.map(record => record.ref.id)

  if (new Set(ids).size !== ids.length) {
    throw new Error(`Duplicate ${kind} ids in data catalog`)
  }
}
