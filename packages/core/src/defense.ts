import type { ArmorSlot, ArmorVariant } from './model'
import { ARMOR_SLOTS } from './model'

export function getTotalArmorDefense(
  armor: Readonly<Record<ArmorSlot, ArmorVariant>>,
): number {
  return ARMOR_SLOTS.reduce((total, slot) => total + armor[slot].defense, 0)
}
