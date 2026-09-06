import type {
  ArmorPiece,
  Decoration,
  SkillValue,
  Talisman,
  Weapon,
  WikiEntityKind,
  WikiRef,
} from '@mhrise-build-tools/core'

export type LocaleCode = string

export interface LocalizedNames {
  readonly [locale: LocaleCode]: string
}

export interface KiranicoRecord<K extends WikiEntityKind> {
  readonly names: LocalizedNames
  readonly ref: WikiRef<K>
}

export interface SkillRecord extends KiranicoRecord<'skill'> {
  readonly maxLevel: number
}

export interface KiranicoArmorRecord extends KiranicoRecord<'armor'> {
  readonly armor: ArmorPiece
}

export interface KiranicoDecorationRecord extends KiranicoRecord<'decoration'> {
  readonly decoration: Decoration
}

export interface KiranicoTalismanRecord extends KiranicoRecord<'talisman'> {
  readonly talisman: Talisman
}

export interface KiranicoWeaponRecord extends KiranicoRecord<'weapon'> {
  readonly weapon: Weapon
}

export interface DataCatalog {
  readonly armors: readonly KiranicoArmorRecord[]
  readonly decorations: readonly KiranicoDecorationRecord[]
  readonly skills: readonly SkillRecord[]
  readonly talismans: readonly KiranicoTalismanRecord[]
  readonly weapons: readonly KiranicoWeaponRecord[]
}

export function getLocalizedName(
  record: KiranicoRecord<WikiEntityKind>,
  locale: LocaleCode,
  fallbackLocale = 'en',
): string | undefined {
  return record.names[locale] ?? record.names[fallbackLocale] ?? Object.values(record.names)[0]
}

export function skillValue(skillId: WikiRef<'skill'>, level: number): SkillValue {
  return {
    level,
    skillId: skillId.id,
  }
}
