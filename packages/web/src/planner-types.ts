import type { ArmorSlot } from '@mhrise-build/core'

export interface SkillSelection {
  level: number
  skillId: string
}

export const armorSlots = ['head', 'chest', 'arms', 'waist', 'legs'] as const satisfies readonly ArmorSlot[]

export const equipmentStatKeys = ['defense', 'fire', 'water', 'thunder', 'ice', 'dragon'] as const

export type EquipmentStats = Record<(typeof equipmentStatKeys)[number], number>
