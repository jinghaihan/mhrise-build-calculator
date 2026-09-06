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
  const sections: { index: number, title: string }[] = []
  let offset = 0

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('#### ')) {
      sections.push({ index: offset, title: line.slice(5).trim() })
    }

    offset += line.length + 1
  }
  const results: MarkdownBuildRequirements[] = []

  for (const [index, section] of sections.entries()) {
    const title = section.title
    const start = section.index + title.length + 5
    const end = sections[index + 1]?.index ?? markdown.length
    const body = markdown.slice(start, end)
    const requiredSkillGroups = parseSkillLines(body, catalog, parserOptions)
    const requiredSkills = requiredSkillGroups
      .filter(group => group.length === 1)
      .map(([skill]) => skill)

    if (requiredSkillGroups.length === 0) {
      continue
    }

    results.push({
      id: slugify(title, index),
      requiredSkills,
      requiredSkillGroups,
      title,
    })
  }

  return results
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

  for (const name of matches) {
    if (!line.startsWith(name)) {
      continue
    }

    const levelMatch = line.slice(name.length).match(/^\s*(\d+)/)

    if (!levelMatch) {
      throw new Error(`Missing skill level in Markdown line: ${line}`)
    }

    return [[skillRequirement(catalog, name, Number(levelMatch[1]), locale)]]
  }

  const levelMatch = line.match(/\b(\d+)/)
  const level = levelMatch ? Number(levelMatch[1]) : undefined
  const inlineAlternatives = level === undefined
    ? []
    : matches
        .filter(name => line.includes(name))
        .map(name => skillRequirement(catalog, name, level, locale))

  if (inlineAlternatives.length > 0) {
    return [inlineAlternatives]
  }

  const alias = matches.filter(name => name.includes(line.replace(/\d.*$/u, '').trim()))

  if (level !== undefined && alias.length > 0) {
    return [alias.map(name => skillRequirement(catalog, name, level, locale))]
  }

  throw new Error(`Skill was not found in ${locale} catalog: ${line}`)
}

function slugify(value: string, index: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '')
  return slug || `build-${index + 1}`
}
