import type { ArmorSlot, ArmorVariant, BuildRequest, BuildSolution } from './model'
import type { SolveOptions } from './solver'
import { solveBuild } from './solver'

export type ReuseOptions = SolveOptions

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

  const candidates = requests.map(request => solveBuild(request, options))

  if (candidates.some(solutions => solutions.length === 0)) {
    return undefined
  }

  let best: ReusePlan | undefined
  const selected: BuildSolution[] = []

  function search(
    requestIndex: number,
    armorKeys: Set<string>,
    talismanKeys: Set<string>,
  ): void {
    if (requestIndex >= candidates.length) {
      const score = {
        ...createScore(armorKeys, talismanKeys, requests.length),
        totalDefense: selected.reduce((total, solution) => total + solution.defense, 0),
      }
      const plan = createPlan(selected, score)

      if (!best || compareScores(score, best.score) < 0) {
        best = plan
      }

      return
    }

    for (const solution of candidates[requestIndex]) {
      const nextArmorKeys = new Set(armorKeys)
      addArmorKeys(nextArmorKeys, solution.armor)
      const nextTalismanKeys = new Set(talismanKeys).add(String(solution.talisman.ref.id))

      if (best && nextArmorKeys.size > best.score.uniqueArmorPieces) {
        continue
      }

      selected.push(solution)
      search(requestIndex + 1, nextArmorKeys, nextTalismanKeys)
      selected.pop()
    }
  }

  search(0, new Set(), new Set())
  return best
}

function addArmorKeys(
  target: Set<string>,
  armor: Readonly<Record<ArmorSlot, ArmorVariant>>,
): void {
  for (const variant of Object.values(armor)) {
    target.add(variant.variantId)
  }
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

function createScore(
  uniqueArmorPieces: Set<string>,
  uniqueTalismans: Set<string>,
  buildCount: number,
): ReuseScore {
  return {
    armorReuseCount: buildCount * 5 - uniqueArmorPieces.size,
    totalDefense: 0,
    uniqueArmorPieces: uniqueArmorPieces.size,
    uniqueTalismans: uniqueTalismans.size,
  }
}
