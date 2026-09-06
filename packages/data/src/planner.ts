import type {
  BuildRequest,
  BuildSolution,
  ReusePlan,
  WikiId,
} from '@mhrise-build-tools/core'
import type { BuildDefinition, DataCatalog } from './catalog'
import type { SourceSnapshot } from './snapshot'
import { optimizeEquipmentReuse, solveBuild } from '@mhrise-build-tools/core'
import { createBuildRequest } from './catalog'
import { generateTalismanRecords } from './snapshot'

export interface SnapshotPlanOptions {
  readonly maxSolutions?: number
  readonly maxTalismanCandidates?: number
  readonly talismanSkillIds?: readonly WikiId[]
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
  return createBuildRequest(catalog, definition)
}

export function planSnapshotBuilds(
  snapshot: SourceSnapshot,
  definitions: readonly BuildDefinition[],
  options: SnapshotPlanOptions = {},
): ReusePlan | undefined {
  const requests = definitions.map(definition => createSnapshotBuildRequest(snapshot, definition, options))
  return optimizeEquipmentReuse(requests, { maxSolutions: options.maxSolutions })
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
