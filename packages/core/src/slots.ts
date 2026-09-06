export const MAX_SLOT_LEVEL = 4

export type SlotLevels = readonly [number, number, number]

function assertSlotLevels(slots: SlotLevels): void {
  if (slots.some(level => !Number.isInteger(level) || level < 0 || level > MAX_SLOT_LEVEL)) {
    throw new Error(`Invalid slot levels: ${slots.join('-')}`)
  }
}

export function applySlotUpgrades(base: SlotLevels, upgrades: number): SlotLevels {
  assertSlotLevels(base)

  if (!Number.isInteger(upgrades) || upgrades < 0) {
    throw new Error(`Invalid slot upgrade count: ${upgrades}`)
  }

  const result = [...base]

  for (let index = 0; index < upgrades; index += 1) {
    const emptySlotIndex = result.findIndex(level => level === 0)

    if (emptySlotIndex >= 0) {
      result[emptySlotIndex] = 1
      continue
    }

    const upgradeSlotIndex = result.findIndex(level => level < MAX_SLOT_LEVEL)

    if (upgradeSlotIndex < 0) {
      break
    }

    result[upgradeSlotIndex] += 1
  }

  return [result[0], result[1], result[2]]
}
