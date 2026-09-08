import type { ArmorSlot, BuildSolution, SkillValue } from '@mhrise-build/core'
import { defaultSnapshot, searchSnapshotBuild } from '@mhrise-build/data'
import * as Comlink from 'comlink'

export interface BuildSearchRequest {
  readonly armorIdsBySlot?: Partial<Readonly<Record<ArmorSlot, readonly string[]>>>
  readonly maxSolutions?: number
  readonly requiredSkills: readonly SkillValue[]
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
  search: (request: BuildSearchRequest, onProgress?: BuildProgressCallback) => BuildSolution[]
}

const api: BuildWorkerApi = {
  search(request, onProgress) {
    return searchSnapshotBuild(defaultSnapshot, {
      armorIdsBySlot: request.armorIdsBySlot,
      requiredSkills: request.requiredSkills,
      talismanIds: request.talismanIds,
      weaponId: request.weaponId,
    }, {
      generateArmorVariants: true,
      maxSolutions: request.maxSolutions ?? 5,
      onProgress: progress => onProgress?.({
        current: progress.current,
        stage: progress.stage,
        total: progress.total,
      }),
    })
  },
}

Comlink.expose(api)
