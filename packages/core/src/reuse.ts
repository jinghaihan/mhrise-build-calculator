import type { BuildRequest, BuildSolution } from './model'
import type { SolveOptions } from './solver'
import { solveBuild } from './solver'

export interface ReuseOptions extends SolveOptions {
  /** Single-build display limits do not truncate candidates for reuse planning. */
  readonly maxSolutions?: number
}

export interface ReuseScore {
  readonly armorReuseCount: number
  readonly totalDefense: number
  readonly uniqueArmorPieces: number
  readonly uniqueTalismans: number
}

export interface ReusePlan {
  readonly score: ReuseScore
  readonly solutions: readonly BuildSolution[]
  readonly sharedArmor: Readonly<Record<string, readonly string[]>>
}

export function optimizeEquipmentReuse(
  requests: readonly BuildRequest[],
  options: ReuseOptions = {},
): ReusePlan | undefined {
  if (requests.length === 0) {
    return undefined
  }

  const candidates = requests.map(request => solveBuild(request, {
    ...options,
    maxSolutions: Number.POSITIVE_INFINITY,
    preserveEquipmentIdentity: true,
  }).map(solution => ({
    solution,
    armorKeys: Object.values(solution.armor).map(variant => variant.variantId),
  })))

  if (candidates.some(solutions => solutions.length === 0)) {
    return undefined
  }

  let best: ReusePlan | undefined
  const selected: BuildSolution[] = []
  const order = candidates.map((_, index) => index).sort((a, b) => candidates[a].length - candidates[b].length)
  const seen = order.map(() => new Map<string, number>())
  const remainingDefense = Array.from<number>({ length: order.length + 1 }).fill(0)
  for (let index = order.length - 1; index >= 0; index -= 1)
    remainingDefense[index] = remainingDefense[index + 1] + candidates[order[index]][0].solution.defense

  function search(
    requestIndex: number,
    armorKeys: Set<string>,
    talismanKeys: Set<string>,
    totalDefense: number,
  ): void {
    if (requestIndex >= candidates.length) {
      const score: ReuseScore = {
        ...createBaseScore(armorKeys, talismanKeys, requests.length),
        totalDefense,
      }
      if (!best || compareScores(score, best.score) < 0) {
        best = createPlan(selected, score)
      }

      return
    }

    const key = JSON.stringify([[...armorKeys].sort(), [...talismanKeys].sort()])
    const previousDefense = seen[requestIndex].get(key)
    if (previousDefense !== undefined && previousDefense >= totalDefense)
      return
    seen[requestIndex].set(key, totalDefense)

    if (best) {
      // Remaining builds can share their new pieces, so use the largest
      // individual minimum, never the sum of those minima.
      let minimumNewPieces = 0
      for (const index of order.slice(requestIndex)) {
        const minimum = candidates[index].reduce((fewest, candidate) => Math.min(fewest, candidate.armorKeys.filter(key => !armorKeys.has(key)).length), 5)
        minimumNewPieces = Math.max(minimumNewPieces, minimum)
      }
      const minimumPieces = armorKeys.size + minimumNewPieces
      if (minimumPieces > best.score.uniqueArmorPieces
        || (minimumPieces === best.score.uniqueArmorPieces
          && totalDefense + remainingDefense[requestIndex] < best.score.totalDefense)) {
        return
      }
    }

    const originalIndex = order[requestIndex]
    const ordered = candidates[originalIndex].map(candidate => ({
      ...candidate,
      newPieces: candidate.armorKeys.filter(key => !armorKeys.has(key)).length,
    })).sort((a, b) => a.newPieces - b.newPieces || b.solution.defense - a.solution.defense)
    for (const { solution, armorKeys: keys } of ordered) {
      const nextArmorKeys = new Set(armorKeys)
      for (const key of keys)
        nextArmorKeys.add(key)
      const nextTalismanKeys = new Set(talismanKeys).add(solution.talisman.ref.id)

      if (best && nextArmorKeys.size > best.score.uniqueArmorPieces) {
        continue
      }

      selected[originalIndex] = solution
      search(requestIndex + 1, nextArmorKeys, nextTalismanKeys, totalDefense + solution.defense)
    }
  }

  search(0, new Set(), new Set(), 0)
  return best
}

function compareScores(left: ReuseScore, right: ReuseScore): number {
  return left.uniqueArmorPieces - right.uniqueArmorPieces
    || right.totalDefense - left.totalDefense
    || left.uniqueTalismans - right.uniqueTalismans
    || right.armorReuseCount - left.armorReuseCount
}

function createPlan(solutions: readonly BuildSolution[], score: ReuseScore): ReusePlan {
  const sharedArmor = new Map<string, string[]>()

  for (const solution of solutions) {
    for (const variant of Object.values(solution.armor)) {
      const builds = sharedArmor.get(variant.variantId) ?? []
      builds.push(solution.id)
      sharedArmor.set(variant.variantId, builds)
    }
  }

  return {
    score,
    sharedArmor: Object.fromEntries(sharedArmor),
    solutions: [...solutions],
  }
}

function createBaseScore(
  uniqueArmorPieces: Set<string>,
  uniqueTalismans: Set<string>,
  buildCount: number,
): Omit<ReuseScore, 'totalDefense'> {
  return {
    armorReuseCount: buildCount * 5 - uniqueArmorPieces.size,
    uniqueArmorPieces: uniqueArmorPieces.size,
    uniqueTalismans: uniqueTalismans.size,
  }
}
