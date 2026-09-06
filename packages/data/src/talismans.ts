import type { SkillValue, SlotLevels, Talisman } from '@mhrise-build-tools/core'
import type { KiranicoTalismanRecord, LocalizedNames } from './catalog'
import { createLocalRef, createWikiId } from '@mhrise-build-tools/core'

export interface TalismanTableRow {
  readonly allowedSlots?: readonly SlotLevels[]
  readonly id: string
  readonly maxSkillCount?: number
  readonly maxSkills?: readonly SkillValue[]
  readonly names?: LocalizedNames
  readonly skills: readonly SkillValue[]
  readonly slots: SlotLevels
}

export interface TalismanTableParseOptions {
  readonly delimiter?: string
  readonly locale?: string
}

export function createTalismanRecord(row: TalismanTableRow): KiranicoTalismanRecord {
  const ref = createLocalRef('talisman', row.id)
  const talisman: Talisman = {
    allowedSlots: row.allowedSlots,
    maxSkillCount: row.maxSkillCount ?? 2,
    maxSkills: row.maxSkills,
    ref,
    skills: row.skills,
    slots: row.slots,
  }

  return {
    names: row.names ?? {},
    ref,
    talisman,
  }
}

export function parseTalismanTable(
  text: string,
  options: TalismanTableParseOptions = {},
): KiranicoTalismanRecord[] {
  const delimiter = options.delimiter ?? '\t'
  const locale = options.locale ?? 'zh'
  const rows = parseDelimited(text, delimiter).filter(row => row.some(Boolean))
  const headers = rows.shift()

  if (!headers) {
    return []
  }

  const columns = headers.map(normalizeHeader)
  return rows.map((row, index) => {
    const id = valueAt(row, columns, ['id', 'talismanid']) || `row-${index + 1}`
    const name = valueAt(row, columns, ['name', 'talismanname'])
    const slots = parseSlots(requiredValue(row, columns, ['slots', 'slot']))
    const skills = parseSkills(row, columns)
    const maxSkillCountValue = valueAt(row, columns, ['maxskillcount', 'skillcount'])
    const maxSkillCount = maxSkillCountValue ? Number(maxSkillCountValue) : 2
    const allowedSlotsValue = valueAt(row, columns, ['allowedslots', 'validslots'])
    const allowedSlots = allowedSlotsValue
      ? allowedSlotsValue.split(';').map(parseSlots)
      : undefined

    return createTalismanRecord({
      allowedSlots,
      id,
      maxSkillCount,
      names: name ? { [locale]: name } : undefined,
      skills,
      slots,
    })
  })
}

export function parseSlots(value: string): SlotLevels {
  const levels = value.match(/[0-4]/g)?.map(Number) ?? []

  if (levels.length !== 3) {
    throw new Error(`Invalid talisman slots: ${value}`)
  }

  return [levels[0], levels[1], levels[2]]
}

function parseSkills(row: readonly string[], columns: readonly string[]): SkillValue[] {
  const skills: SkillValue[] = []

  for (const position of [1, 2]) {
    const id = valueAt(row, columns, [`skill${position}id`, `skill${position}`])
    const levelValue = valueAt(row, columns, [`skill${position}level`, `level${position}`])

    if (!id && !levelValue) {
      continue
    }

    if (!id || !levelValue) {
      throw new Error(`Incomplete skill${position} talisman column`)
    }

    skills.push({
      level: Number(levelValue),
      skillId: createWikiId(id),
    })
  }

  return skills
}

function parseDelimited(text: string, delimiter: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .map(line => parseDelimitedLine(line, delimiter))
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (character === '"') {
      quoted = !quoted
      continue
    }

    if (character === delimiter && !quoted) {
      cells.push(cell.trim())
      cell = ''
      continue
    }

    cell += character
  }

  cells.push(cell.trim())
  return cells
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, '')
}

function valueAt(
  row: readonly string[],
  columns: readonly string[],
  names: readonly string[],
): string | undefined {
  const index = names.map(normalizeHeader).map(name => columns.indexOf(name)).find(index => index >= 0)
  const value = index === undefined ? undefined : row[index]
  return value || undefined
}

function requiredValue(
  row: readonly string[],
  columns: readonly string[],
  names: readonly string[],
): string {
  const value = valueAt(row, columns, names)

  if (!value) {
    throw new Error(`Missing required talisman column: ${names[0]}`)
  }

  return value
}
