import type { SkillValue } from '@mhrise-build-tools/core'
import type { DataCatalog, LocaleCode } from './catalog'
import { skillRequirement } from './catalog'

export interface MarkdownBuildRequirements {
  readonly id: string
  readonly requiredSkills: readonly SkillValue[]
  readonly requiredSkillGroups: readonly (readonly SkillValue[])[]
  readonly title: string
}

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

    results.push({
      id: slugify(idTitle, index),
      requiredSkills,
      requiredSkillGroups,
      title,
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

  for (const name of matches) {
    const normalizedName = normalizeSkillText(name)
    if (!normalizedLine.startsWith(normalizedName)) {
      continue
    }

    const levelMatch = normalizedLine.slice(normalizedName.length).match(/^\s*(\d+)/)

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
