import type {
  ArmorVariantGenerationOptions,
  BuildRequest,
  BuildSolution,
  ReusePlan,
  WikiId,
} from '@mhrise-build-tools/core'
import type { BuildDefinition, DataCatalog } from './catalog'
import type { SourceSnapshot } from './snapshot'
import {
  ARMOR_SLOTS,
  optimizeEquipmentReuse,
  pruneDominatedArmorVariants,
  solveBuild,
} from '@mhrise-build-tools/core'
import { createBuildRequest } from './catalog'
import { armorComponentsForPool, findArmorFamily, generateTalismanRecords } from './snapshot'

export interface SnapshotPlanOptions {
  readonly armorVariantOptions?: ArmorVariantGenerationOptions
  readonly generateArmorVariants?: boolean
  readonly maxSolutions?: number
  readonly maxTalismanCandidates?: number
  readonly pruneDominatedArmor?: boolean
  readonly talismanSkillIds?: readonly WikiId[]
}

export type SnapshotBuildQuery = Omit<BuildDefinition, 'id'> & {
  readonly id?: string
}

export function createSnapshotCatalog(
  snapshot: SourceSnapshot,
  skillIds: readonly WikiId[],
  maxTalismanCandidates?: number,
): DataCatalog {
  return {
    ...snapshot.catalog,
    talismans: generateTalismanRecords(snapshot, {
      maxCandidates: maxTalismanCandidates,
      skillIds,
    }),
  }
}

export function createSnapshotBuildRequest(
  snapshot: SourceSnapshot,
  definition: BuildDefinition,
  options: Omit<SnapshotPlanOptions, 'maxSolutions'> = {},
): BuildRequest {
  const skillIds = options.talismanSkillIds
    ?? definition.requiredSkills.map(requirement => requirement.skillId)
  const catalog = createSnapshotCatalog(snapshot, skillIds, options.maxTalismanCandidates)
  const request = createBuildRequest(
    catalog,
    withGeneratedArmorComponents(snapshot, definition, skillIds, options),
  )

  if (options.pruneDominatedArmor === false) {
    return request
  }

  return {
    ...request,
    armorBySlot: Object.fromEntries(ARMOR_SLOTS.map(slot => [
      slot,
      pruneDominatedArmorVariants(request.armorBySlot[slot], request.requiredSkills),
    ])) as unknown as typeof request.armorBySlot,
  }
}

export function searchSnapshotBuild(
  snapshot: SourceSnapshot,
  query: SnapshotBuildQuery,
  options: SnapshotPlanOptions = {},
): BuildSolution[] {
  return solveSnapshotBuild(snapshot, toBuildDefinition(query), options)
}

export function planSnapshotBuilds(
  snapshot: SourceSnapshot,
  definitions: readonly BuildDefinition[],
  options: SnapshotPlanOptions = {},
): ReusePlan | undefined {
  const requests = definitions.map(definition => createSnapshotBuildRequest(snapshot, definition, options))
  return optimizeEquipmentReuse(requests, { maxSolutions: options.maxSolutions })
}

export function planSnapshotQueries(
  snapshot: SourceSnapshot,
  queries: readonly SnapshotBuildQuery[],
  options: SnapshotPlanOptions = {},
): ReusePlan | undefined {
  return planSnapshotBuilds(
    snapshot,
    queries.map(toBuildDefinition),
    options,
  )
}

export function solveSnapshotBuild(
  snapshot: SourceSnapshot,
  definition: BuildDefinition,
  options: SnapshotPlanOptions = {},
): BuildSolution[] {
  return solveBuild(createSnapshotBuildRequest(snapshot, definition, options), {
    maxSolutions: options.maxSolutions,
  })
}

function toBuildDefinition(query: SnapshotBuildQuery): BuildDefinition {
  return {
    ...query,
    id: query.id ?? `weapon-${query.weaponId}`,
  }
}

function withGeneratedArmorComponents(
  snapshot: SourceSnapshot,
  definition: BuildDefinition,
  skillIds: readonly WikiId[],
  options: Omit<SnapshotPlanOptions, 'maxSolutions'>,
): BuildDefinition {
  if (!options.generateArmorVariants) {
    return definition
  }

  const armorComponentsById = { ...definition.armorComponentsById }
  const selectedIds = new Set(
    Object.values(definition.armorIdsBySlot ?? {}).flatMap(ids => ids ?? []),
  )
  const records = selectedIds.size > 0
    ? snapshot.catalog.armors.filter(record => selectedIds.has(record.ref.id))
    : snapshot.catalog.armors

  for (const record of records) {
    if (armorComponentsById[record.ref.id]) {
      continue
    }

    const family = findArmorFamily(record, snapshot)
    if (family) {
      armorComponentsById[record.ref.id] = armorComponentsForPool(
        snapshot,
        family.poolId,
        skillIds,
      )
    }
  }

  return {
    ...definition,
    armorComponentsById,
    armorVariantOptions: options.armorVariantOptions ?? definition.armorVariantOptions,
  }
}
