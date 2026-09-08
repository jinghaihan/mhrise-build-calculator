import type {
  ArmorAugmentComponent,
  ArmorAugmentRole,
  ArmorElement,
  SlotLevels,
  Talisman,
  WikiId,
} from '@mhrise-build-tools/core'
import type { DataCatalog, KiranicoArmorRecord, KiranicoTalismanRecord } from './catalog'
import type { LocalizedNameData } from './localization'
import { createLocalRef } from '@mhrise-build-tools/core'
import { createDataCatalog } from './catalog'
import { applyLocalizedNames } from './localization'

export type AugmentationKind = 'defense' | 'resistance' | 'skill' | 'slot'

export type AugmentationRole = ArmorAugmentRole

export interface ArmorFamilyRule {
  readonly costBudget: number
  readonly id: string
  readonly name: string
  readonly poolId: number
}

export interface AugmentationEntry {
  readonly cost: number
  readonly gameId: number
  readonly kind: AugmentationKind
  readonly label: string
  readonly levels: readonly number[]
  readonly poolId: number
  readonly element?: ArmorElement
  readonly role?: AugmentationRole
  readonly skillId?: WikiId
  readonly sourceBlock: number
}

export interface SkillCostRule {
  readonly cost: number
  readonly gameId: number
  readonly name: string
  readonly skillId?: WikiId
}

export interface TalismanRule {
  readonly firstSkillMax: number
  readonly firstSkillMaxRing: number
  readonly gameId: number
  readonly maxLevel: number
  readonly name: string
  readonly rank: string
  readonly rate?: number
  readonly secondSkillMax: number
  readonly secondSkillMaxRing: number
  readonly skillId?: WikiId
  readonly slotOptions: readonly SlotLevels[]
  readonly weight?: number
}

export interface TalismanGenerationOptions {
  /** Explicit enumeration limit for previews; omitted means enumerate all legal records. */
  readonly maxCandidates?: number
  readonly skillIds: readonly WikiId[]
  readonly variants?: readonly ('霸气' | '圆环')[]
}

export interface SourceRules {
  readonly armorFamilies: readonly ArmorFamilyRule[]
  readonly augmentationEntries: readonly AugmentationEntry[]
  readonly skillCosts: readonly SkillCostRule[]
  readonly talismanRules: readonly TalismanRule[]
}

export interface SourceSnapshot {
  readonly catalog: DataCatalog
  readonly generatedAt: string
  readonly rules: SourceRules
  readonly source?: {
    readonly kiranico: readonly string[]
    readonly workbook: string
  }
}

export function parseSourceSnapshot(
  input: string | unknown,
  localizedNames?: LocalizedNameData,
): SourceSnapshot {
  const value = typeof input === 'string' ? JSON.parse(input) as unknown : input

  if (!isRecord(value) || !isRecord(value.catalog) || !isRecord(value.rules)) {
    throw new TypeError('Invalid source snapshot: catalog and rules are required')
  }

  const catalog = createDataCatalog(applyLocalizedNames(
    value.catalog as unknown as Parameters<typeof applyLocalizedNames>[0],
    localizedNames,
  ))
  const rules = value.rules as unknown as SourceRules

  if (!Array.isArray(rules.armorFamilies)
    || !Array.isArray(rules.augmentationEntries)
    || !Array.isArray(rules.skillCosts)
    || !Array.isArray(rules.talismanRules)) {
    throw new TypeError('Invalid source snapshot: all rule tables are required')
  }

  return {
    catalog,
    generatedAt: String(value.generatedAt ?? ''),
    rules,
    source: value.source as SourceSnapshot['source'],
  }
}

export function armorComponentsForPool(
  snapshot: SourceSnapshot,
  poolId: number,
  skillIds: readonly WikiId[] = [],
  removableSkillIds: readonly WikiId[] = [],
): ArmorAugmentComponent[] {
  const components: ArmorAugmentComponent[] = []

  for (const entry of snapshot.rules.augmentationEntries.filter(entry => entry.poolId === poolId)) {
    const role = entry.role ?? inferredAugmentationRole(entry.gameId)
    const values = entry.levels
      .map((value, level) => ({ level: level + 1, value }))
      .filter(({ value }) => value !== 0)

    if (entry.kind === 'skill') {
      for (const { level, value } of values) {
        const eligibleSkillIds = value < 0 ? new Set([...skillIds, ...removableSkillIds]) : new Set(skillIds)
        for (const skillId of eligibleSkillIds) {
          components.push({
            costDelta: entry.cost,
            defenseDelta: 0,
            id: `${poolId}:${entry.gameId}:${skillId}:${level}`,
            ...(role && role !== 'normal' ? { role } : {}),
            skillChanges: [{ level: value, skillId }],
            slotUpgrades: 0,
          })
        }
      }
      continue
    }

    for (const { level, value } of values) {
      components.push({
        costDelta: entry.cost,
        defenseDelta: entry.kind === 'defense' ? value : 0,
        resistanceDelta: entry.kind === 'resistance' && entry.element
          ? { [entry.element]: value }
          : undefined,
        id: `${poolId}:${entry.gameId}:${level}`,
        ...(role && role !== 'normal' ? { role } : {}),
        skillChanges: [],
        slotUpgrades: entry.kind === 'slot' ? value : 0,
      })
    }
  }

  return components.sort((left, right) => componentPriority(left) - componentPriority(right))
}

function inferredAugmentationRole(gameId: number): AugmentationRole | undefined {
  // These IDs are the extra rows in the offline workbook's augmentation table.
  if (gameId >= 70 && gameId <= 72) {
    return 'cost-fill'
  }

  if ([91, 101, 111, 121, 131].includes(gameId)) {
    return 'ignored-special'
  }

  if (gameId === 61) {
    return 'ignored-special'
  }

  return undefined
}

function componentPriority(component: ArmorAugmentComponent): number {
  if (component.skillChanges.length > 0) {
    return 0
  }

  if (component.slotUpgrades > 0) {
    return 1
  }

  if (component.resistanceDelta && Object.values(component.resistanceDelta).some(value => value !== 0)) {
    return 2
  }

  return 3
}

export function findArmorFamily(
  record: KiranicoArmorRecord,
  snapshot: SourceSnapshot,
): ArmorFamilyRule | undefined {
  return snapshot.rules.armorFamilies.find(family => family.id === record.armorFamilyId)
}

export function generateTalismanRecords(
  snapshot: SourceSnapshot,
  options: TalismanGenerationOptions,
): KiranicoTalismanRecord[] {
  const maxCandidates = options.maxCandidates ?? Number.POSITIVE_INFINITY
  const requestedSkillIds = new Set(options.skillIds)
  const variants = options.variants ?? ['霸气', '圆环']
  const rules = snapshot.rules.talismanRules.filter(rule => rule.skillId
    && requestedSkillIds.has(rule.skillId))
  const records: KiranicoTalismanRecord[] = []

  for (const variant of variants) {
    const firstMax = variant === '霸气' ? 'firstSkillMax' : 'firstSkillMaxRing'
    const secondMax = variant === '霸气' ? 'secondSkillMax' : 'secondSkillMaxRing'

    for (const first of rules) {
      if (!first.skillId) {
        continue
      }

      for (let firstLevel = 1; firstLevel <= first[firstMax]; firstLevel += 1) {
        addTalisman(first, firstLevel, undefined, 0, first[secondMax], variant)

        for (const second of rules) {
          if (!second.skillId || second.skillId === first.skillId) {
            continue
          }

          for (let secondLevel = 1; secondLevel <= second[secondMax]; secondLevel += 1) {
            addTalisman(first, firstLevel, second, secondLevel, second[secondMax], variant)
          }
        }
      }
    }
  }

  return records

  function addTalisman(
    first: TalismanRule,
    firstLevel: number,
    second: TalismanRule | undefined,
    secondLevel: number,
    secondSkillMaximum: number,
    variant: '霸气' | '圆环',
  ): void {
    if (records.length >= maxCandidates || !first.skillId) {
      return
    }

    const skills = [{ level: firstLevel, skillId: first.skillId }]

    if (second?.skillId && secondLevel > 0 && secondLevel <= secondSkillMaximum) {
      skills.push({ level: secondLevel, skillId: second.skillId })
    }

    const slotOptions: readonly SlotLevels[] = first.slotOptions.length > 0
      ? first.slotOptions
      : [[0, 0, 0]]

    for (const slots of slotOptions) {
      if (records.length >= maxCandidates) {
        return
      }

      const id = [
        variant,
        first.gameId,
        firstLevel,
        second?.gameId ?? 'none',
        secondLevel,
        slots.join(''),
      ].join(':')
      const ref = createLocalRef('talisman', id)
      const talisman: Talisman = {
        allowedSlots: [slots],
        maxSkillCount: skills.length,
        maxSkills: skills,
        ref,
        skills,
        slots,
      }

      records.push({
        names: {
          zh: second
            ? `${first.name}${firstLevel} + ${second.name}${secondLevel} (${variant})`
            : `${first.name}${firstLevel} (${variant})`,
        },
        ref,
        talisman,
      })
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
