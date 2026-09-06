import type { ArmorAugmentComponent, WikiId } from '@mhrise-build-tools/core'
import type { DataCatalog, KiranicoArmorRecord } from './catalog'
import { createDataCatalog } from './catalog'

export type AugmentationKind = 'defense' | 'resistance' | 'skill' | 'slot'

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
  readonly slotOptions: readonly (readonly number[])[]
  readonly weight?: number
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
  readonly source: {
    readonly kiranico: readonly string[]
    readonly workbook: string
  }
}

export function parseSourceSnapshot(input: string | unknown): SourceSnapshot {
  const value = typeof input === 'string' ? JSON.parse(input) as unknown : input

  if (!isRecord(value) || !isRecord(value.catalog) || !isRecord(value.rules)) {
    throw new TypeError('Invalid source snapshot: catalog and rules are required')
  }

  const catalog = createDataCatalog(value.catalog as unknown as DataCatalog)
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
): ArmorAugmentComponent[] {
  const components: ArmorAugmentComponent[] = []

  for (const entry of snapshot.rules.augmentationEntries.filter(entry => entry.poolId === poolId)) {
    const values = entry.levels
      .map((value, level) => ({ level: level + 1, value }))
      .filter(({ value }) => value !== 0)

    if (entry.kind === 'skill') {
      for (const skillId of skillIds) {
        for (const { level, value } of values) {
          components.push({
            costDelta: entry.cost,
            defenseDelta: 0,
            id: `${poolId}:${entry.gameId}:${skillId}:${level}`,
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
        id: `${poolId}:${entry.gameId}:${level}`,
        skillChanges: [],
        slotUpgrades: entry.kind === 'slot' ? value : 0,
      })
    }
  }

  return components
}

export function findArmorFamily(
  record: KiranicoArmorRecord,
  snapshot: SourceSnapshot,
): ArmorFamilyRule | undefined {
  return snapshot.rules.armorFamilies.find(family => family.id === record.armorFamilyId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
