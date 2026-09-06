import { describe, expect, it } from 'vitest'
import { applySlotUpgrades, MAX_SLOT_LEVEL } from '../src/slots'

describe('qurious armor slot upgrades', () => {
  it.each([
    [0, [2, 1, 0]],
    [1, [2, 1, 1]],
    [2, [3, 1, 1]],
    [3, [4, 1, 1]],
    [4, [4, 2, 1]],
    [5, [4, 3, 1]],
    [6, [4, 4, 1]],
    [7, [4, 4, 2]],
  ])('converts 2-1-0 with +%i to %s', (upgrades, expected) => {
    expect(applySlotUpgrades([2, 1, 0], upgrades)).toEqual(expected)
  })

  it('fills empty slots before upgrading existing slots', () => {
    expect(applySlotUpgrades([3, 0, 0], 2)).toEqual([3, 1, 1])
  })

  it('upgrades slots from left to right after all three slots exist', () => {
    expect(applySlotUpgrades([2, 1, 1], 3)).toEqual([4, 2, 1])
  })

  it('does not exceed the maximum slot level', () => {
    expect(applySlotUpgrades([MAX_SLOT_LEVEL, MAX_SLOT_LEVEL, MAX_SLOT_LEVEL], 3)).toEqual([
      MAX_SLOT_LEVEL,
      MAX_SLOT_LEVEL,
      MAX_SLOT_LEVEL,
    ])
  })
})
