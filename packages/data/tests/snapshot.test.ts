import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createWikiRef } from '@mhrise-build-tools/core'
import { describe, expect, it } from 'vitest'
import { armorComponentsForPool, parseSourceSnapshot } from '../src/snapshot'

describe('source snapshots', () => {
  it('loads the synchronized 16.0.0 source snapshot', () => {
    const path = fileURLToPath(new URL('../snapshots/source-snapshot.json', import.meta.url))
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'))

    expect(snapshot.catalog.skills.length).toBeGreaterThan(100)
    expect(snapshot.catalog.decorations.length).toBeGreaterThan(200)
    expect(snapshot.catalog.armors.length).toBeGreaterThan(1000)
    expect(snapshot.catalog.weapons.length).toBeGreaterThan(3000)
    expect(snapshot.rules.armorFamilies.length).toBe(143)
    expect(snapshot.rules.talismanRules.length).toBe(136)
  })

  it('loads catalogs and expands generic skill augmentation rules', () => {
    const snapshot = parseSourceSnapshot({
      catalog: {
        armors: [],
        decorations: [],
        skills: [],
        talismans: [],
        weapons: [],
      },
      generatedAt: '2026-09-06T00:00:00.000Z',
      rules: {
        armorFamilies: [],
        augmentationEntries: [{
          cost: 3,
          gameId: 144,
          kind: 'skill',
          label: '技能+',
          levels: [1, 0, 0],
          poolId: 1,
          sourceBlock: 0,
        }],
        skillCosts: [],
        talismanRules: [],
      },
      source: { kiranico: [], workbook: 'fixture.xlsx' },
    })
    const skill = createWikiRef('skill', '366824395').id

    expect(armorComponentsForPool(snapshot, 1, [skill])).toEqual([{
      costDelta: 3,
      defenseDelta: 0,
      id: '1:144:366824395:1',
      skillChanges: [{ level: 1, skillId: '366824395' }],
      slotUpgrades: 0,
    }])
  })
})
