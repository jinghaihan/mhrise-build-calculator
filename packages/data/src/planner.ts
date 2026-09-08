import type {
  ArmorVariantGenerationOptions,
  BuildRequest,
  BuildSolution,
  ReusePlan,
  SolveProgress,
  WikiId,
} from '@mhrise-build/core'
import type { BuildDefinition, BuildRequestProgress, DataCatalog } from './catalog'
import type { SourceSnapshot } from './snapshot'
import {
  ARMOR_SLOTS,
  optimizeEquipmentReuse,
  solveBuild,
} from '@mhrise-build/core'
import { createBuildRequest } from './catalog'
import { armorComponentsForPool, findArmorFamily, generateTalismanRecords } from './snapshot'

export interface SnapshotPlanOptions {
  readonly armorVariantOptions?: ArmorVariantGenerationOptions
  readonly generateArmorVariants?: boolean
  readonly maxSolutions?: number
  readonly maxTalismanCandidates?: number
  readonly onProgress?: (progress: BuildRequestProgress | SolveProgress) => void
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
    { onProgress: options.onProgress },
  )

  return request
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
    onProgress: options.onProgress,
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
  const records = snapshot.catalog.armors.filter((record) => {
    const selectedIds = definition.armorIdsBySlot?.[record.armor.slot]
    return record.armorFamilyId && (!selectedIds || selectedIds.includes(record.ref.id))
  })

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
        record.armor.baseSkills.map(skill => skill.skillId),
      )
    }
  }

  return {
    ...definition,
    armorComponentsById,
    armorIdsBySlot: Object.fromEntries(ARMOR_SLOTS.map((slot) => {
      const requested = definition.armorIdsBySlot?.[slot]
      const eligible = new Set<string>(records
        .filter(record => record.armor.slot === slot)
        .map(record => record.ref.id))
      return [slot, requested
        ? requested.filter(id => eligible.has(id))
        : [...eligible]]
    })),
    armorVariantOptions: {
      ...(options.armorVariantOptions ?? definition.armorVariantOptions),
      requiredSkills: definition.requiredSkills,
    },
  }
}
