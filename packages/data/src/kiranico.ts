import type {
  ArmorElement,
  ArmorPiece,
  ArmorResistances,
  ArmorSlot,
  Decoration,
  SkillValue,
  Weapon,
  WikiEntityKind,
} from '@mhrise-build-tools/core'
import type {
  KiranicoArmorRecord,
  KiranicoDecorationRecord,
  KiranicoWeaponRecord,
  SkillRecord,
} from './catalog'
import { createWikiId, createWikiRef } from '@mhrise-build-tools/core'

export const KIRANICO_BASE_URL = 'https://mhrise.kiranico.com'

export interface KiranicoArmorParseOptions {
  readonly costBudget: number
  readonly locale?: string
  readonly slot: ArmorSlot
}

export interface KiranicoParseOptions {
  readonly locale?: string
}

export function parseKiranicoSkills(
  html: string,
  options: KiranicoParseOptions = {},
): SkillRecord[] {
  const locale = options.locale ?? 'zh'
  const records: SkillRecord[] = []

  for (const row of tableRows(html)) {
    const link = firstLink(row, '/data/skills/')

    if (!link) {
      continue
    }

    const levels = [...row.matchAll(/\bLv\s*(\d+)/gi)].map(match => Number(match[1]))
    const maxLevel = Math.max(...levels, 1)

    records.push({
      maxLevel,
      names: { [locale]: stripMarkup(link.text) },
      ref: createWikiRef('skill', link.id),
    })
  }

  return deduplicate(records)
}

export function parseKiranicoDecorations(
  html: string,
  options: KiranicoParseOptions = {},
): KiranicoDecorationRecord[] {
  const locale = options.locale ?? 'zh'
  const records: KiranicoDecorationRecord[] = []

  for (const row of tableRows(html)) {
    const decorationLink = firstLink(row, '/data/decorations/')

    if (!decorationLink) {
      continue
    }

    const skillValues = skillValuesFromRow(row)
    const slotLevel = decorationSlotLevel(stripMarkup(decorationLink.text))

    if (slotLevel === undefined || skillValues.length === 0) {
      continue
    }

    const decoration: Decoration = {
      ref: createWikiRef('decoration', decorationLink.id),
      skills: skillValues,
      slotLevel,
    }

    records.push({
      decoration,
      names: { [locale]: stripMarkup(decorationLink.text) },
      ref: decoration.ref,
    })
  }

  return deduplicate(records)
}

export function parseKiranicoArmors(
  html: string,
  options: KiranicoArmorParseOptions,
): KiranicoArmorRecord[] {
  const locale = options.locale ?? 'zh'
  const records: KiranicoArmorRecord[] = []

  for (const row of tableRows(html)) {
    const armorLink = firstLink(row, '/data/armors/')

    if (!armorLink) {
      continue
    }

    const cells = tableCells(row)
    const slots = slotLevelsFromCell(cells[3] ?? '')
    const baseDefense = firstDivNumber(cells[4] ?? '')
    const baseResistances = armorResistancesFromCells(cells)
    const baseSkills = skillValuesFromRow(row)

    if (baseDefense === undefined) {
      continue
    }

    const armor: ArmorPiece = {
      baseDefense,
      baseSkills,
      baseResistances,
      costBudget: options.costBudget,
      ref: createWikiRef('armor', armorLink.id),
      slot: options.slot,
      slots,
    }

    records.push({
      armor,
      names: { [locale]: stripMarkup(armorLink.text) },
      ref: armor.ref,
    })
  }

  return deduplicate(records)
}

export function parseKiranicoWeapons(
  html: string,
  options: KiranicoParseOptions = {},
): KiranicoWeaponRecord[] {
  const locale = options.locale ?? 'zh'
  const records: KiranicoWeaponRecord[] = []

  for (const row of tableRows(html)) {
    const weaponLink = firstLink(row, '/data/weapons/')

    if (!weaponLink) {
      continue
    }

    const cells = tableCells(row)
    const weapon: Weapon = {
      ref: createWikiRef('weapon', weaponLink.id),
      skills: skillValuesFromRow(row),
      slots: slotLevelsFromCell(cells[2] ?? ''),
    }

    records.push({
      names: { [locale]: stripMarkup(weaponLink.text) },
      ref: weapon.ref,
      weapon,
    })
  }

  return deduplicate(records)
}

export function kiranicoUrl(
  kind: WikiEntityKind,
  id?: string,
  locale = 'zh',
): string {
  const path = kind === 'armor' ? 'armors' : `${kind}s`
  return id
    ? `${KIRANICO_BASE_URL}/${locale}/data/${path}/${id}`
    : `${KIRANICO_BASE_URL}/${locale}/data/${path}`
}

function tableRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => match[1])
}

function tableCells(row: string): string[] {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match => match[1])
}

function firstLink(row: string, path: string): { id: string, text: string } | undefined {
  const match = row.match(new RegExp(
    `href=["'][^"']*${path.replace('/', '\\/')}(\\d+)["'][^>]*>([\\s\\S]*?)<\\/a>`,
    'i',
  ))

  return match
    ? { id: String(createWikiId(match[1])), text: match[2] }
    : undefined
}

function skillValuesFromRow(row: string): SkillValue[] {
  const values: SkillValue[] = []
  const pattern = /href=["'][^"']*\/data\/skills\/(\d+)["'][^>]*>([\s\S]*?)<\/a>\s*Lv\s*(\d+)/gi

  for (const match of row.matchAll(pattern)) {
    values.push({
      level: Number(match[3]),
      skillId: createWikiId(match[1]),
    })
  }

  return values
}

function decorationSlotLevel(name: string): number | undefined {
  const bracketLevel = name.match(/[【[]([1-4])[】\]]/)

  if (bracketLevel) {
    return Number(bracketLevel[1])
  }

  const englishLevel = name.match(/(?:jewel|珠)\D{0,5}([1-4])\b|\b([1-4])\s*(?:jewel|珠)/i)
  const level = englishLevel?.[1] ?? englishLevel?.[2]
  return level ? Number(level) : undefined
}

function slotLevelsFromCell(cell: string): [number, number, number] {
  const levels = [...cell.matchAll(/deco([1-4])\.png/gi)].map(match => Number(match[1]))
  return [levels[0] ?? 0, levels[1] ?? 0, levels[2] ?? 0]
}

function firstDivNumber(cell: string): number | undefined {
  const match = cell.match(/<div\b[^>]*>\s*(-?\d+)\s*<\/div>/i)
  return match ? Number(match[1]) : undefined
}

function armorResistancesFromCells(cells: readonly string[]): ArmorResistances {
  const resistances: Record<ArmorElement, number> = {
    dragon: 0,
    fire: 0,
    ice: 0,
    thunder: 0,
    water: 0,
  }
  const elementNames = ['fire', 'water', 'ice', 'thunder', 'dragon'] as const
  const source = cells.slice(4, 6).join(' ')
  const pattern = /data-key=["']element["']\s+data-value=["'](\d+)["'][\s\S]*?data-key=["']elementAttack["']\s+data-value=["'](-?\d+)["']/gi

  for (const match of source.matchAll(pattern)) {
    const element = elementNames[Number(match[1]) - 1]
    if (element) {
      resistances[element] = Number(match[2])
    }
  }

  return resistances
}

function stripMarkup(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function deduplicate<T extends { ref: { id: string } }>(records: readonly T[]): T[] {
  return [...new Map(records.map(record => [record.ref.id, record])).values()]
}
