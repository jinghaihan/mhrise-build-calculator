import type { SkillValue } from '@mhrise-build-tools/core'
import type { DataCatalog, LocaleCode } from './catalog'
import { skillRequirement } from './catalog'

export interface MarkdownBuildRequirements {
  readonly id: string
  readonly requiredSkills: readonly SkillValue[]
  readonly requiredSkillGroups: readonly (readonly SkillValue[])[]
  readonly title: string
  readonly weaponOptions: readonly MarkdownWeaponOption[]
}

export interface MarkdownWeaponOption {
  readonly element?: MarkdownWeaponElement
  readonly name: string
  readonly type: string
}

export type MarkdownWeaponElement = 'dragon' | 'fire' | 'ice' | 'thunder' | 'water'

export interface MarkdownParserOptions {
  readonly locale: LocaleCode
  readonly includeQuestionable: boolean
}

export function parseMarkdownBuildRequirements(
  markdown: string,
  catalog: DataCatalog,
  options: Partial<MarkdownParserOptions> = {},
): MarkdownBuildRequirements[] {
  const parserOptions: MarkdownParserOptions = {
    includeQuestionable: options.includeQuestionable ?? true,
    locale: options.locale ?? 'zh',
  }
  const headings: { index: number, length: number, level: number, title: string }[] = []
  let offset = 0

  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^#{2,6}/u)
    const title = marker ? line.slice(marker[0].length).trim() : ''
    if (marker && /^[ \t]/u.test(line[marker[0].length] ?? '') && title) {
      headings.push({
        index: offset,
        length: line.length,
        level: marker[0].length,
        title,
      })
    }

    offset += line.length + 1
  }
  const sections = headings.filter((heading) => {
    if (heading.level === 4) {
      return true
    }

    if (heading.level !== 3 || heading.title !== '属性配装') {
      return false
    }

    const end = nextHeadingIndex(headings, heading)
    return !headings.some(candidate => candidate.index > heading.index
      && candidate.index < end
      && candidate.level > heading.level)
  })
  const results: MarkdownBuildRequirements[] = []

  for (const [index, section] of sections.entries()) {
    const title = section.title
    const start = section.index + section.length + 1
    const end = nextHeadingIndex(headings, section)
    const body = markdown.slice(start, end)
    const requiredSkillGroups = parseSkillLines(body, catalog, parserOptions)
    const requiredSkills = requiredSkillGroups
      .filter(group => group.length === 1)
      .map(([skill]) => skill)

    if (requiredSkillGroups.length === 0) {
      continue
    }

    const parent = [...headings]
      .reverse()
      .find(heading => heading.index < section.index && heading.level < section.level)
    const idTitle = section.level === 3 && parent ? `${parent.title}-${title}` : title

    const inlineWeaponOptions = parseInlineWeaponOptions(body)
    results.push({
      id: slugify(idTitle, index),
      requiredSkills,
      requiredSkillGroups,
      title,
      weaponOptions: inlineWeaponOptions.length > 0
        ? inlineWeaponOptions
        : parent ? parseWeaponOptions(markdown, headings, parent) : [],
    })
  }

  return results
}

function nextHeadingIndex(
  headings: readonly { index: number, level: number }[],
  section: { index: number, level: number },
): number {
  return headings.find(heading => heading.index > section.index && heading.level <= section.level)?.index
    ?? Number.POSITIVE_INFINITY
}

function parseWeaponOptions(
  markdown: string,
  headings: readonly { index: number, level: number, title: string }[],
  parent: { index: number, level: number },
): MarkdownWeaponOption[] {
  const parentEnd = nextHeadingIndex(headings, parent)
  const weaponHeading = headings.find(heading => heading.index > parent.index
    && heading.index < parentEnd
    && heading.level === parent.level + 1
    && heading.title === '武器')

  if (!weaponHeading) {
    return []
  }

  const start = weaponHeading.index + markdown.slice(weaponHeading.index).indexOf('\n') + 1
  const body = markdown.slice(start, nextHeadingIndex(headings, weaponHeading))
  const lines = body.split(/\r?\n/).filter(line => line.trim().startsWith('|'))
  const header = lines.find(line => parseTableCells(line).length > 1)

  if (!header) {
    return []
  }

  const headers = parseTableCells(header)
  const options: MarkdownWeaponOption[] = []

  for (const line of lines.slice(lines.indexOf(header) + 1)) {
    const cells = parseTableCells(line)
    if (cells.length !== headers.length || cells.every(isTableSeparator)) {
      continue
    }

    const type = cells[0]
    if (!type || isTableSeparator(type)) {
      continue
    }

    for (let index = 1; index < cells.length; index += 1) {
      const element = markdownWeaponElement(headers[index])
      for (const name of splitWeaponNames(cells[index])) {
        options.push({ element, name, type })
      }
    }
  }

  return options
}

function parseInlineWeaponOptions(body: string): MarkdownWeaponOption[] {
  const options: MarkdownWeaponOption[] = []

  for (const line of body.split(/\r?\n/)) {
    const content = line.trim()
    const marker = content.startsWith('+ 武器：')
      ? '武器：'
      : content.startsWith('+ 武器:')
        ? '武器:'
        : undefined
    if (!marker) {
      continue
    }

    for (const name of splitWeaponNames(content.slice(('+ ').length + marker.length))) {
      options.push({ name, type: 'explicit' })
    }
  }

  return options
}

function parseTableCells(line: string): string[] {
  const value = line.trim()
  const content = value.startsWith('|') ? value.slice(1) : value
  const withoutTrailingPipe = content.endsWith('|') ? content.slice(0, -1) : content
  return withoutTrailingPipe.split('|').map(cell => cell.trim())
}

function isTableSeparator(value: string): boolean {
  return /^:?-{3,}:?$/u.test(value)
}

function markdownWeaponElement(value: string): MarkdownWeaponElement | undefined {
  return {
    火: 'fire',
    水: 'water',
    冰: 'ice',
    雷: 'thunder',
    龙: 'dragon',
  }[value] as MarkdownWeaponElement | undefined
}

function splitWeaponNames(value: string): string[] {
  return value
    .split(/\s*(?:\/|／|\bor\b)\s*/iu)
    .map(name => name.trim())
    .filter(name => name && name !== '-')
}

function parseSkillLines(
  body: string,
  catalog: DataCatalog,
  options: MarkdownParserOptions,
): SkillValue[][] {
  const values: SkillValue[][] = []

  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^[ \t]*-[ \t]*\[([x?I])\]/i)

    if (!match || (match[1].toLowerCase() !== 'x' && !options.includeQuestionable)) {
      continue
    }

    const parsed = parseSkillLine(line.slice(match[0].length).trim(), catalog, options.locale)

    values.push(...parsed)
  }

  return values
}

function parseSkillLine(
  line: string,
  catalog: DataCatalog,
  locale: LocaleCode,
): SkillValue[][] {
  const matches = catalog.skills
    .map(record => record.names[locale])
    .filter((name): name is string => Boolean(name))
    .sort((left, right) => right.length - left.length)
  const normalizedLine = normalizeSkillText(line)
  const hasAlternativeSyntax = /[/:：、]/u.test(line)

  const shorthand = parseShorthand(line, catalog, locale)
  if (shorthand) {
    return shorthand
  }

  for (const name of matches) {
    const normalizedName = normalizeSkillText(name)
    const suffix = normalizedLine.slice(normalizedName.length)
    if (!normalizedLine.startsWith(normalizedName)) {
      continue
    }

    const levelAlternativeMatch = suffix.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/u)
    if (levelAlternativeMatch) {
      return [[
        skillRequirement(catalog, name, Number(levelAlternativeMatch[1]), locale),
        skillRequirement(catalog, name, Number(levelAlternativeMatch[2]), locale),
      ]]
    }

    const levelMatch = suffix.match(/^\s*(\d+)\s*$/u)

    if (!levelMatch) {
      if (hasAlternativeSyntax) {
        continue
      }
      throw new Error(`Missing skill level in Markdown line: ${line}`)
    }

    return [[skillRequirement(catalog, name, Number(levelMatch[1]), locale)]]
  }

  const levelMatch = line.match(/\b(\d+)/)
  const level = levelMatch ? Number(levelMatch[1]) : undefined
  const inlineAlternatives = level === undefined || !hasAlternativeSyntax
    ? []
    : matches
        .filter(name => normalizedLine.includes(normalizeSkillText(name)))
        .map(name => skillRequirement(catalog, name, level, locale))

  if (inlineAlternatives.length > 0) {
    return [inlineAlternatives]
  }

  const alias = matches.filter(name => normalizeSkillText(name).includes(
    normalizeSkillText(line.replace(/\d.*$/u, '').trim()),
  ))

  if (level !== undefined && alias.length > 0) {
    return [alias.map(name => skillRequirement(catalog, name, level, locale))]
  }

  throw new Error(`Skill was not found in ${locale} catalog: ${line}`)
}

function parseShorthand(
  line: string,
  catalog: DataCatalog,
  locale: LocaleCode,
): SkillValue[][] | undefined {
  if (locale !== 'zh') {
    return undefined
  }

  const match = line.match(/^(属性攻击强化|弹种强化)\s*(\d+)$/u)
  if (!match) {
    return undefined
  }

  const prefixes = match[1] === '属性攻击强化'
    ? ['火属性攻击强化', '水属性攻击强化', '雷属性攻击强化', '冰属性攻击强化', '龙属性攻击强化']
    : ['通常弹・', '散弹・', '贯穿弹・']
  const level = Number(match[2])
  const values = prefixes.flatMap(prefix => catalog.skills
    .filter(record => record.names[locale]
      && normalizeSkillText(record.names[locale]).startsWith(normalizeSkillText(prefix)))
    .map(record => skillRequirement(catalog, record.names[locale]!, level, locale)))

  if (values.length !== prefixes.length) {
    throw new Error(`Shorthand ${match[1]} could not be resolved in ${locale} catalog`)
  }

  return [values]
}

function normalizeSkillText(value: string): string {
  return value.replace(/[·・･]/gu, '・').replace(/[【】]/gu, '')
}

function slugify(value: string, index: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '')
  return slug || `build-${index + 1}`
}
