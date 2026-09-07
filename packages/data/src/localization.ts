import type { WikiEntityKind } from '@mhrise-build-tools/core'
import type {
  DataCatalog,
  KiranicoArmorRecord,
  KiranicoDecorationRecord,
  KiranicoRecord,
  KiranicoTalismanRecord,
  KiranicoWeaponRecord,
  LocalizedNames,
  SkillRecord,
} from './catalog'

export const SUPPORTED_LOCALES = ['zh', 'zh-Hant', 'en', 'ja', 'ko'] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_LABEL: Record<AppLocale, string> = {
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어',
  'zh': '简体中文',
  'zh-Hant': '繁體中文',
}

export function normalizeLocale(locale?: string): AppLocale {
  return locale && SUPPORTED_LOCALES.includes(locale as AppLocale)
    ? locale as AppLocale
    : 'zh'
}

export interface LocalizedNameData {
  readonly generatedAt?: string
  readonly locales: Readonly<Record<string, Readonly<Partial<Record<WikiEntityKind, Readonly<Record<string, string>>>>>>>
}

type CatalogRecordWithOptionalNames<K extends WikiEntityKind> = Omit<KiranicoRecord<K>, 'names'> & {
  readonly names?: LocalizedNames
}

export function applyLocalizedNames(
  input: {
    readonly armors: readonly (Omit<KiranicoArmorRecord, 'names'> & { readonly names?: LocalizedNames })[]
    readonly decorations: readonly (Omit<KiranicoDecorationRecord, 'names'> & { readonly names?: LocalizedNames })[]
    readonly skills: readonly (Omit<SkillRecord, 'names'> & { readonly names?: LocalizedNames })[]
    readonly talismans: readonly (Omit<KiranicoTalismanRecord, 'names'> & { readonly names?: LocalizedNames })[]
    readonly weapons: readonly (Omit<KiranicoWeaponRecord, 'names'> & { readonly names?: LocalizedNames })[]
  },
  data?: LocalizedNameData,
): DataCatalog {
  return {
    armors: input.armors.map(record => localizeRecord(record, 'armor', data)),
    decorations: input.decorations.map(record => localizeRecord(record, 'decoration', data)),
    skills: input.skills.map(record => localizeRecord(record, 'skill', data)),
    talismans: input.talismans.map(record => localizeRecord(record, 'talisman', data)),
    weapons: input.weapons.map(record => localizeRecord(record, 'weapon', data)),
  }
}

function localizeRecord<K extends WikiEntityKind, T extends CatalogRecordWithOptionalNames<K>>(
  record: T,
  kind: K,
  data: LocalizedNameData | undefined,
): T & { readonly names: LocalizedNames } {
  const names = { ...(record.names ?? {}) }

  for (const [locale, localeNames] of Object.entries(data?.locales ?? {})) {
    const name = localeNames[kind]?.[record.ref.id]
    if (name) {
      names[locale] = name
    }
  }

  return { ...record, names } as T & { readonly names: LocalizedNames }
}
