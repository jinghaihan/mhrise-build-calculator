import type { WikiId, WikiRef } from './ids'
import type { SlotLevels } from './slots'

export type ArmorSlot = 'arms' | 'chest' | 'head' | 'legs' | 'waist'

export const ARMOR_SLOTS: readonly ArmorSlot[] = [
  'head',
  'chest',
  'arms',
  'waist',
  'legs',
]

export interface SkillValue {
  readonly level: number
  readonly skillId: WikiId
}

export interface ArmorPiece {
  readonly baseSkills: readonly SkillValue[]
  readonly baseDefense: number
  readonly costBudget: number
  readonly ref: WikiRef<'armor'>
  readonly slot: ArmorSlot
  readonly slots: SlotLevels
}

export interface ArmorAugmentation {
  readonly componentIds?: readonly string[]
  readonly cost: number
  readonly defenseDelta: number
  readonly skillChanges: readonly SkillValue[]
  readonly slotUpgrades: number
}

export interface ArmorAugmentComponent {
  readonly costDelta: number
  readonly defenseDelta: number
  readonly id: string
  readonly skillChanges: readonly SkillValue[]
  readonly slotUpgrades: number
}

export interface ArmorVariant {
  readonly augmentation: ArmorAugmentation | undefined
  readonly base: ArmorPiece
  readonly defense: number
  readonly skills: readonly SkillValue[]
  readonly slots: SlotLevels
  readonly variantId: string
}

export interface Weapon {
  readonly ref: WikiRef<'weapon'>
  readonly skills: readonly SkillValue[]
  readonly slots: SlotLevels
}

export interface Decoration {
  readonly ref: WikiRef<'decoration'>
  readonly skills: readonly SkillValue[]
  readonly slotLevel: number
}

export interface Talisman {
  readonly allowedSlots: readonly SlotLevels[] | undefined
  readonly maxSkills: readonly SkillValue[] | undefined
  readonly ref: WikiRef<'talisman'>
  readonly skills: readonly SkillValue[]
  readonly slots: SlotLevels
}

export interface BuildRequest {
  readonly armorBySlot: Readonly<Record<ArmorSlot, readonly ArmorVariant[]>>
  readonly decorations: readonly Decoration[]
  readonly id: string
  readonly requiredSkills: readonly SkillValue[]
  readonly talismans: readonly Talisman[]
  readonly weapon: Weapon
}

export interface DecorationPlacement {
  readonly decoration: Decoration
  readonly host: 'arms' | 'chest' | 'head' | 'legs' | 'talisman' | 'waist' | 'weapon'
  readonly slotIndex: number
}

export interface BuildSolution {
  readonly armor: Readonly<Record<ArmorSlot, ArmorVariant>>
  readonly decorations: readonly DecorationPlacement[]
  readonly defense: number
  readonly id: string
  readonly skills: readonly SkillValue[]
  readonly talisman: Talisman
  readonly weapon: Weapon
}
