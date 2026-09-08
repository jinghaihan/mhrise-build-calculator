import { readFileSync } from 'node:fs'
import { createWikiId } from '@mhrise-build/core'
import { describe, expect, it } from 'vitest'
import localizedNames from '../locales/names.json'
import { solveSnapshotBuildAsync } from '../src/planner'
import { parseSourceSnapshot } from '../src/snapshot'

describe('user target build', () => {
  it('rejects the supplied fixed armor target when it requires non-augmentable Blood Awakening', async () => {
    const snapshot = parseSourceSnapshot(
      readFileSync(new URL('../snapshots/source-snapshot.json', import.meta.url), 'utf8'),
      localizedNames,
    )
    const requiredSkills = [
      [5, '437062215'],
      [4, '366824395'],
      [3, '485829389'],
      [3, '500079394'],
      [3, '408054401'],
      [3, '200239249'],
      [3, '599465498'],
      [3, '1622706159'],
      [3, '337057370'],
      [3, '278586937'],
      [3, '321844636'],
      [3, '440849622'],
      [3, '22983784'],
      [3, '903072550'],
      [3, '825821882'],
      [3, '840071771'],
      [2, '790650270'],
      [2, '1636956044'],
      [2, '156236611'],
      [1, '899287127'],
      [1, '1594014760'],
      [1, '307594751'],
      [1, '37217289'],
      [1, '261970829'],
      [1, '888838913'],
    ].map(([level, skillId]) => ({ level: Number(level), skillId: createWikiId(String(skillId)) }))
    const results = await solveSnapshotBuildAsync(snapshot, {
      armorIdsBySlot: {
        arms: ['1559693084'],
        chest: ['1560741660'],
        head: ['1648748550'],
        legs: ['1356269340'],
        waist: ['1582057104'],
      },
      id: 'user-target',
      requiredSkills,
      weaponId: '1817803981',
    }, {
      generateArmorVariants: true,
      maxSolutions: 1,
    })

    expect(results).toHaveLength(0)
  }, 600_000)
})
