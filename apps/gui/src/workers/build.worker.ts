import type { BuildSolution, SkillValue } from '@mhrise-build-tools/core'
import { defaultSnapshot, searchSnapshotBuild } from '@mhrise-build-tools/data'
import * as Comlink from 'comlink'

export interface BuildSearchRequest {
  readonly maxSolutions?: number
  readonly requiredSkills: readonly SkillValue[]
  readonly weaponId: string
}

export interface BuildWorkerProgress {
  readonly current: number
  readonly stage: 'generating' | 'searching'
  readonly total: number
}

export type BuildProgressCallback = (progress: BuildWorkerProgress) => void

export interface BuildWorkerApi {
  search: (request: BuildSearchRequest, onProgress?: BuildProgressCallback) => BuildSolution[]
}

const api: BuildWorkerApi = {
  search(request, onProgress) {
    return searchSnapshotBuild(defaultSnapshot, {
      requiredSkills: request.requiredSkills,
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
