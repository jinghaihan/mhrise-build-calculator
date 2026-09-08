import type {
  ArmorVariantGenerationOptions,
  BuildRequest,
  BuildSolution,
  ReusePlan,
  SolveProgress,
  Talisman,
  TalismanFilter,
  WikiId,
} from '@mhrise-build/core'
import type { BuildDefinition, BuildRequestProgress, DataCatalog } from './catalog'
import type { SourceSnapshot } from './snapshot'
import {
  ARMOR_SLOTS,
  getSkillLevel,
  optimizeEquipmentReuse,
  solveBuild,
  solveBuildAsync,
} from '@mhrise-build/core'
import { createBuildRequest } from './catalog'
import { armorComponentsForPool, findArmorFamily, generateTalismanRecords } from './snapshot'

export interface SnapshotPlanOptions {
  readonly armorVariantOptions?: ArmorVariantGenerationOptions
  readonly generateArmorVariants?: boolean
  readonly maxSolutions?: number
  readonly maxTalismanCandidates?: number
  readonly onProgress?: (progress: BuildRequestProgress | SolveProgress) => void
  readonly onSolutions?: (solutions: readonly BuildSolution[]) => void
  readonly talismanSkillIds?: readonly WikiId[]
  readonly talismanFilter?: TalismanFilter
  readonly timeLimitSeconds?: number
}

export type SnapshotBuildQuery = Omit<BuildDefinition, 'id'> & {
  readonly id?: string
}

export function createSnapshotCatalog(
  snapshot: SourceSnapshot,
  skillIds: readonly WikiId[],
  maxTalismanCandidates?: number,
  talismanFilter?: TalismanFilter,
): DataCatalog {
  const generatedSkillIds = talismanFilter
    ? [...new Set([
        ...skillIds,
        ...(talismanFilter.firstSkillId ? [talismanFilter.firstSkillId] : []),
        ...(talismanFilter.secondSkillId ? [talismanFilter.secondSkillId] : []),
      ])]
    : skillIds
  const talismans = generateTalismanRecords(snapshot, {
    maxCandidates: maxTalismanCandidates,
    skillIds: generatedSkillIds,
  })

  return {
    ...snapshot.catalog,
    talismans: talismanFilter
      ? talismans.filter(record => matchesTalismanFilter(record.talisman, talismanFilter))
      : talismans,
  }
}

export function createSnapshotBuildRequest(
  snapshot: SourceSnapshot,
  definition: BuildDefinition,
  options: SnapshotPlanOptions = {},
): BuildRequest {
  const skillIds = options.talismanSkillIds
    ?? definition.requiredSkills.map(requirement => requirement.skillId)
  const catalog = createSnapshotCatalog(snapshot, skillIds, options.maxTalismanCandidates, options.talismanFilter)
  const request = createBuildRequest(
    catalog,
    withGeneratedArmorComponents(snapshot, definition, skillIds, options),
    { maxArmorAlternatives: options.maxSolutions, onProgress: options.onProgress },
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
    onSolutions: options.onSolutions,
  })
}

export async function solveSnapshotBuildAsync(
  snapshot: SourceSnapshot,
  definition: BuildDefinition,
  options: SnapshotPlanOptions = {},
): Promise<BuildSolution[]> {
  return solveBuildAsync(createSnapshotBuildRequest(snapshot, definition, {
    ...options,
    maxSolutions: undefined,
  }), {
    maxSolutions: options.maxSolutions,
    onProgress: progress => options.onProgress?.({
      current: progress.current,
      stage: 'searching',
      total: progress.total,
    }),
    timeLimitSeconds: options.timeLimitSeconds,
  })
}

function toBuildDefinition(query: SnapshotBuildQuery): BuildDefinition {
  return {
    ...query,
    id: query.id ?? `weapon-${query.weaponId}`,
  }
}

function matchesTalismanFilter(
  talisman: Talisman,
  filter: TalismanFilter,
): boolean {
  const requiredSkills = [
    [filter.firstSkillId, filter.firstSkillLevel],
    [filter.secondSkillId, filter.secondSkillLevel],
  ] as const
  if (requiredSkills.some(([skillId, level]) => skillId
    && getSkillLevel(talisman.skills, skillId) < (level ?? 1))) {
    return false
  }

  return !filter.slots || filter.slots.every((level, index) => talisman.slots[index] >= level)
}

function withGeneratedArmorComponents(
  snapshot: SourceSnapshot,
  definition: BuildDefinition,
  skillIds: readonly WikiId[],
  options: SnapshotPlanOptions,
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
