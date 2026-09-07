import type { SkillValue } from '@mhrise-build-tools/core'
import { defaultSnapshot, searchSnapshotBuild } from '@mhrise-build-tools/data'

export interface BuildSearchMessage {
  readonly maxSolutions?: number
  readonly requiredSkills: readonly SkillValue[]
  readonly type: 'search'
  readonly weaponId: string
}

export interface BuildWorkerProgress {
  readonly current: number
  readonly stage: 'generating' | 'searching'
  readonly total: number
}

export interface BuildWorkerProgressMessage {
  readonly progress: BuildWorkerProgress
  readonly type: 'progress'
}

export interface BuildWorkerResultMessage {
  readonly solutions: ReturnType<typeof searchSnapshotBuild>
  readonly type: 'result'
}

export interface BuildWorkerErrorMessage {
  readonly message: string
  readonly type: 'error'
}

export type BuildWorkerMessage = BuildWorkerErrorMessage | BuildWorkerProgressMessage | BuildWorkerResultMessage

const workerScope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<BuildSearchMessage>) => void) | null
  postMessage: (message: BuildWorkerMessage) => void
}

workerScope.onmessage = (event) => {
  if (event.data.type !== 'search')
    return

  try {
    const solutions = searchSnapshotBuild(defaultSnapshot, {
      requiredSkills: event.data.requiredSkills,
      weaponId: event.data.weaponId,
    }, {
      generateArmorVariants: true,
      maxSolutions: event.data.maxSolutions ?? 5,
      onProgress: progress => workerScope.postMessage({
        progress: {
          current: progress.current,
          stage: progress.stage === 'generating' ? 'generating' : 'searching',
          total: progress.total,
        },
        type: 'progress',
      }),
    })
    workerScope.postMessage({ solutions, type: 'result' })
  }
  catch (error) {
    workerScope.postMessage({
      message: error instanceof Error ? error.message : String(error),
      type: 'error',
    })
  }
}
