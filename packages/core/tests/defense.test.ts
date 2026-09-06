import type { ArmorSlot } from '../src/model'
import { describe, expect, it } from 'vitest'
import { createArmorVariant } from '../src/armor'
import { getTotalArmorDefense } from '../src/defense'
import { createWikiRef } from '../src/ids'

describe('total armor defense', () => {
  it('sums the final defense of all five armor pieces', () => {
    const entries: readonly [ArmorSlot, number][] = [
      ['head', 126],
      ['chest', 130],
      ['arms', 122],
      ['waist', 124],
      ['legs', 128],
    ]
    const armor = Object.fromEntries(entries.map(([slot, defense], index) => [slot, createArmorVariant({
      baseDefense: defense,
      baseSkills: [],
      costBudget: 16,
      ref: createWikiRef('armor', String(1000 + index)),
      slot,
      slots: [1, 0, 0],
    })])) as Parameters<typeof getTotalArmorDefense>[0]

    expect(getTotalArmorDefense(armor)).toBe(630)
  })
})
