import type { ArmorSlot, BuildSolution, SkillValue, TalismanFilter } from '@mhrise-build/core'
import { defaultSnapshot, searchSnapshotBuild } from '@mhrise-build/data'
import * as Comlink from 'comlink'

export interface BuildSearchRequest {
  readonly armorIdsBySlot?: Partial<Readonly<Record<ArmorSlot, readonly string[]>>>
  readonly maxSolutions?: number
  readonly requiredSkills: readonly SkillValue[]
  readonly talismanFilter?: TalismanFilter
  readonly talismanIds?: readonly string[]
  readonly weaponId: string
}

export interface BuildWorkerProgress {
  readonly current: number
  readonly stage: 'generating' | 'combining' | 'searching'
  readonly total: number
}

export type BuildProgressCallback = (progress: BuildWorkerProgress) => void

export interface BuildWorkerApi {
  search: (request: BuildSearchRequest, onProgress?: BuildProgressCallback, onSolutions?: (solutions: readonly BuildSolution[]) => void) => BuildSolution[]
}

const api: BuildWorkerApi = {
  search(request, onProgress, onSolutions) {
    return searchSnapshotBuild(defaultSnapshot, {
      armorIdsBySlot: request.armorIdsBySlot,
      requiredSkills: request.requiredSkills,
      talismanIds: request.talismanIds,
      weaponId: request.weaponId,
    }, {
      generateArmorVariants: true,
      maxSolutions: request.maxSolutions ?? 5,
      talismanFilter: request.talismanFilter,
      onProgress: progress => onProgress?.({
        current: progress.current,
        stage: progress.stage,
        total: progress.total,
      }),
      onSolutions,
    })
  },
}

Comlink.expose(api)
