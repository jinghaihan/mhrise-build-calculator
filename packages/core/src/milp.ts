import type { ArmorSlot, ArmorVariant, BuildRequest, BuildSolution, Decoration, SkillValue, Talisman } from './model'
import loadHighs from 'highs'
import { collectAvailableSlots, findBestDecorationPlacement } from './decorations'
import { getTotalArmorDefense } from './defense'
import { ARMOR_SLOTS } from './model'
import { addSkillValues, getSkillLevel, meetsSkillRequirements } from './skills'
import { isTalismanLegal } from './talismans'

export interface AsyncSolveOptions {
  readonly maxSolutions?: number
  readonly onProgress?: (progress: { readonly current: number, readonly stage: 'solving', readonly total: number }) => void
  readonly timeLimitSeconds?: number
}

const SEED_CANDIDATE_LIMIT = 4_096
const SEED_SKILL_CANDIDATE_LIMIT = 512

export interface UnreachableSkillRequirement {
  readonly maximum: number
  readonly requirement: SkillValue
}

/**
 * Solve a build through a MILP model. The model is intentionally built from a
 * bounded seed candidate set; every returned build is then checked against the
 * complete decoration-placement rules before it is exposed to callers.
 */
export async function solveBuildAsync(
  request: BuildRequest,
  options: AsyncSolveOptions = {},
): Promise<BuildSolution[]> {
  const requirements = request.requiredSkills
  const legalTalismans = request.talismans.filter(isTalismanLegal)
  const unreachable = findUnreachableRequirements({ ...request, talismans: legalTalismans })
  if (unreachable.length > 0) {
    options.onProgress?.({ current: 1, stage: 'solving', total: 1 })
    return []
  }
  const armorBySlot = Object.fromEntries(ARMOR_SLOTS.map(slot => [
    slot,
    selectSeedCandidates(request.armorBySlot[slot], requirements),
  ])) as unknown as Record<ArmorSlot, readonly ArmorVariant[]>
  const talismans = dedupeTalismans(legalTalismans, requirements)
  const decorations = dedupeDecorations(request.decorations, requirements)
  options.onProgress?.({ current: 0, stage: 'solving', total: 1 })

  const highs = await loadHighs()
  const startedAt = Date.now()
  const timeLimitSeconds = options.timeLimitSeconds ?? 120
  const feasibleModel = createModel(request, armorBySlot, talismans, decorations, false)
  const feasibleResult = highs.solve(feasibleModel.lp, {
    mip_heuristic_effort: 1,
    output_flag: false,
    time_limit: Math.min(timeLimitSeconds, 30),
  })
  const feasibleSolution = feasibleResult.Status === 'Optimal' || feasibleResult.Status === 'Time limit reached'
    ? materializeSolution(request, feasibleModel, feasibleResult.Columns)
    : undefined
  const elapsedSeconds = (Date.now() - startedAt) / 1_000
  const remainingSeconds = Math.max(1, timeLimitSeconds - elapsedSeconds)
  const model = createModel(request, armorBySlot, talismans, decorations, true)
  const result = highs.solve(model.lp, {
    mip_heuristic_effort: 1,
    output_flag: false,
    time_limit: remainingSeconds,
  })
  if (result.Status !== 'Optimal' && result.Status !== 'Time limit reached')
    return feasibleSolution ? [feasibleSolution] : []

  const solution = materializeSolution(request, model, result.Columns)
  options.onProgress?.({ current: 1, stage: 'solving', total: 1 })
  return solution ? [solution] : feasibleSolution ? [feasibleSolution] : []
}

/**
 * Return only requirements that cannot be reached even before socket
 * competition is considered. Decorations are treated as an unbounded source
 * when any matching decoration exists, so this check can reject only proofs
 * of impossibility and never a potentially feasible build.
 */
export function findUnreachableRequirements(
  request: BuildRequest,
): UnreachableSkillRequirement[] {
  return request.requiredSkills.flatMap((requirement) => {
    const armorMaximum = ARMOR_SLOTS.reduce((total, slot) => total + Math.max(
      0,
      ...request.armorBySlot[slot].map(variant => getSkillLevel(variant.skills, requirement.skillId)),
    ), 0)
    const talismanMaximum = Math.max(
      0,
      ...request.talismans.map(talisman => getSkillLevel(talisman.skills, requirement.skillId)),
    )
    const decorationCanProvide = request.decorations.some(decoration =>
      getSkillLevel(decoration.skills, requirement.skillId) > 0)
    const maximum = getSkillLevel(request.weapon.skills, requirement.skillId)
      + armorMaximum
      + talismanMaximum
      + (decorationCanProvide ? requirement.level : 0)

    return maximum < requirement.level ? [{ maximum, requirement }] : []
  })
}

interface Model {
  readonly armor: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>
  readonly decorations: readonly Decoration[]
  readonly lp: string
  readonly talismans: readonly Talisman[]
}

function createModel(
  request: BuildRequest,
  armor: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>,
  talismans: readonly Talisman[],
  decorations: readonly Decoration[],
  optimizeDefense: boolean,
): Model {
  const rows: string[] = []
  const objective: string[] = []
  const binaries: string[] = []
  const generals: string[] = []

  for (const slot of ARMOR_SLOTS) {
    const variables = armor[slot].map((_, index) => armorVariable(slot, index))
    rows.push(`${slot}_choice: ${variables.join(' + ')} = 1`)
    binaries.push(...variables)
    for (const [index, variant] of armor[slot].entries()) {
      if (optimizeDefense)
        objective.push(`${variant.defense * 1_000} ${variables[index]}`)
    }
  }

  const talismanVariables = talismans.map((_, index) => talismanVariable(index))
  rows.push(`talisman_choice: ${talismanVariables.join(' + ')} = 1`)
  binaries.push(...talismanVariables)

  for (const [skillIndex, requirement] of request.requiredSkills.entries()) {
    const terms = [
      ...ARMOR_SLOTS.flatMap(slot => armor[slot].map((variant, index) => `${getSkillLevel(variant.skills, requirement.skillId)} ${armorVariable(slot, index)}`)),
      ...talismans.map((talisman, index) => `${getSkillLevel(talisman.skills, requirement.skillId)} ${talismanVariable(index)}`),
      ...decorations.map((decoration, index) => `${getSkillLevel(decoration.skills, requirement.skillId)} ${decorationVariable(index)}`),
    ]
    const weaponLevel = getSkillLevel(request.weapon.skills, requirement.skillId)
    rows.push(`skill_${skillIndex}: ${terms.join(' + ')} >= ${requirement.level - weaponLevel}`)
  }

  const equipment = [
    ...ARMOR_SLOTS.flatMap(slot => armor[slot].map((variant, index) => ({ variable: armorVariable(slot, index), slots: variant.slots }))),
    ...talismans.map((talisman, index) => ({ variable: talismanVariable(index), slots: talisman.slots })),
    { variable: 'weapon_fixed', slots: request.weapon.slots },
  ]
  for (let level = 1; level <= 4; level += 1) {
    const decorationTerms = decorations
      .map((decoration, index) => decoration.slotLevel >= level
        ? `${decorationVariable(index)}`
        : undefined)
      .filter((variable): variable is string => variable !== undefined)
      .map(variable => `1 ${variable}`)
    const equipmentTerms = equipment
      .filter(entry => entry.variable !== 'weapon_fixed')
      .map(entry => `- ${entry.slots.filter(slot => slot >= level).length} ${entry.variable}`)
    const weaponCapacity = request.weapon.slots.filter(slot => slot >= level).length
    rows.push(`slots_${level}: ${[...decorationTerms, ...equipmentTerms].join(' + ')} <= ${weaponCapacity}`)
  }

  for (const [index, decoration] of decorations.entries()) {
    const variable = decorationVariable(index)
    generals.push(variable)
    if (optimizeDefense)
      objective.push(`-${decoration.slotLevel} ${variable}`)
  }

  const lp = [
    'Maximize',
    ` obj: ${objective.length > 0 ? objective.join(' + ') : '0'}`,
    'Subject To',
    ...rows.map(row => ` ${row}`),
    'Bounds',
    ...decorations.map((_, index) => ` 0 <= ${decorationVariable(index)} <= 20`),
    'Binaries',
    ...binaries.map(variable => ` ${variable}`),
    'Generals',
    ...generals.map(variable => ` ${variable}`),
    'End',
  ].join('\n')

  return { armor, decorations, lp, talismans }
}

function materializeSolution(
  request: BuildRequest,
  model: Model,
  columns: Readonly<Record<string, { readonly Primal: number }>>,
): BuildSolution | undefined {
  const armor = {} as Record<ArmorSlot, ArmorVariant>
  for (const slot of ARMOR_SLOTS) {
    const index = model.armor[slot].findIndex((_, candidateIndex) => columnValue(columns, armorVariable(slot, candidateIndex)) > 0.5)
    if (index < 0)
      return undefined
    armor[slot] = model.armor[slot][index]
  }

  const talismanIndex = model.talismans.findIndex((_, index) => columnValue(columns, talismanVariable(index)) > 0.5)
  if (talismanIndex < 0)
    return undefined
  const talisman = model.talismans[talismanIndex]
  const selectedDecorations = model.decorations.flatMap((decoration, index) => Array
    .from<Decoration>({ length: Math.max(0, Math.round(columnValue(columns, decorationVariable(index)))) })
    .fill(decoration))
  const totalSkills = addSkillValues(
    request.weapon.skills,
    talisman.skills,
    ...Object.values(armor).map(variant => variant.skills),
  )
  const placement = findBestDecorationPlacement(
    collectAvailableSlots(request.weapon, armor, talisman),
    selectedDecorations,
    totalSkills,
    request.requiredSkills,
  )
  if (!placement)
    return undefined
  const skills = placement.reduce(
    (current, currentPlacement) => addSkillValues(current, currentPlacement.decoration.skills),
    totalSkills,
  )
  if (!meetsSkillRequirements(skills, request.requiredSkills))
    return undefined

  return {
    armor,
    decorations: placement,
    defense: getTotalArmorDefense(armor),
    id: request.id,
    skills,
    talisman,
    weapon: request.weapon,
  }
}

function selectSeedCandidates(
  variants: readonly ArmorVariant[],
  requirements: readonly SkillValue[],
): ArmorVariant[] {
  const selected = new Set<ArmorVariant>()
  const ranked = [...variants].sort((left, right) => candidateScore(right, requirements) - candidateScore(left, requirements))
  ranked.slice(0, SEED_CANDIDATE_LIMIT).forEach(variant => selected.add(variant))
  for (const requirement of requirements) {
    ;[...variants]
      .sort((left, right) => getSkillLevel(right.skills, requirement.skillId) - getSkillLevel(left.skills, requirement.skillId)
        || candidateScore(right, requirements) - candidateScore(left, requirements))
      .slice(0, SEED_SKILL_CANDIDATE_LIMIT)
      .forEach(variant => selected.add(variant))
  }
  return variants.filter(variant => selected.has(variant))
}

function candidateScore(variant: ArmorVariant, requirements: readonly SkillValue[]): number {
  return requirements.reduce((total, requirement) => total
    + Math.min(getSkillLevel(variant.skills, requirement.skillId), requirement.level), 0)
  + slotCapacityScore(variant.slots) * 0.25
  + variant.defense * 0.01
}

function dedupeTalismans(talismans: readonly Talisman[], requirements: readonly SkillValue[]): Talisman[] {
  const best = new Map<string, Talisman>()
  for (const talisman of talismans) {
    const key = [
      requirements.map(requirement => `${requirement.skillId}:${Math.min(
        getSkillLevel(talisman.skills, requirement.skillId),
        requirement.level,
      )}`).join(','),
      slotCapacityKey(talisman.slots),
    ].join('|')
    if (!best.has(key))
      best.set(key, talisman)
  }
  return [...best.values()]
}

function dedupeDecorations(decorations: readonly Decoration[], requirements: readonly SkillValue[]): Decoration[] {
  const best = new Map<string, Decoration>()
  for (const decoration of decorations) {
    const key = `${decoration.slotLevel}|${requirements.map(requirement => getSkillLevel(decoration.skills, requirement.skillId)).join(',')}`
    if (!best.has(key))
      best.set(key, decoration)
  }
  return [...best.values()]
}

function slotCapacityScore(slots: readonly number[]): number {
  return [1, 2, 3, 4].reduce((score, level) => score + slots.filter(slot => slot >= level).length * level, 0)
}

function slotCapacityKey(slots: readonly number[]): string {
  return [1, 2, 3, 4].map(level => slots.filter(slot => slot >= level).length).join(',')
}

function armorVariable(slot: ArmorSlot, index: number): string {
  return `a_${slot}_${index}`
}

function talismanVariable(index: number): string {
  return `t_${index}`
}

function decorationVariable(index: number): string {
  return `d_${index}`
}

function columnValue(
  columns: Readonly<Record<string, { readonly Primal: number }>>,
  variable: string,
): number {
  return columns[variable]?.Primal ?? 0
}
