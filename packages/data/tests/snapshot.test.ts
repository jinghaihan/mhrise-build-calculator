import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { collectAvailableSlots, createArmorVariant, createWikiRef } from '@mhrise-build-tools/core'
import { describe, expect, it } from 'vitest'
import {
  createSnapshotBuildRequest,
  createSnapshotCatalog,
  searchSnapshotBuild,
} from '../src/planner'
import {
  armorComponentsForPool,
  generateTalismanRecords,
  parseSourceSnapshot,
} from '../src/snapshot'

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
    expect(snapshot.catalog.skills.find(skill => skill.names.zh === '坚如磐石')?.maxLevel).toBe(5)

    const weaponWithSlots = snapshot.catalog.weapons.find(record =>
      record.weapon.slots.some(level => level > 0))
    const armorRecords = snapshot.catalog.armors.filter(record => record.armor.slot)
    const armorBySlot = Object.fromEntries(
      ['head', 'chest', 'arms', 'waist', 'legs'].map(slot => [
        slot,
        createArmorVariant(armorRecords.find(record => record.armor.slot === slot)!.armor),
      ]),
    ) as Record<'head' | 'chest' | 'arms' | 'waist' | 'legs', ReturnType<typeof createArmorVariant>>

    expect(weaponWithSlots).toBeDefined()
    expect(collectAvailableSlots(
      weaponWithSlots!.weapon,
      armorBySlot,
      {
        allowedSlots: undefined,
        maxSkillCount: undefined,
        maxSkills: undefined,
        ref: createWikiRef('talisman', '999999999'),
        skills: [],
        slots: [0, 0, 0],
      },
    ).some(slot => slot.host === 'weapon')).toBe(true)
    expect(snapshot.catalog.armors.some(record => record.armor.baseResistances)).toBe(true)
  })

  it('builds a planner catalog with on-demand talismans', () => {
    const path = fileURLToPath(new URL('../snapshots/source-snapshot.json', import.meta.url))
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'))
    const attackId = snapshot.catalog.skills.find(skill => skill.names.zh === '攻击')?.ref.id

    expect(attackId).toBeDefined()
    const catalog = createSnapshotCatalog(snapshot, [attackId!], 100)

    expect(catalog.talismans.length).toBeGreaterThan(0)
    expect(catalog.talismans.length).toBeLessThanOrEqual(100)
    expect(catalog.talismans.every(record => record.talisman.skills
      .every(skill => skill.skillId === attackId))).toBe(true)
  })

  it('searches from a selected weapon and required skills', () => {
    const path = fileURLToPath(new URL('../snapshots/source-snapshot.json', import.meta.url))
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'))
    const attackId = snapshot.catalog.skills.find(skill => skill.names.zh === '攻击')!.ref.id
    const weapon = snapshot.catalog.weapons.find(record => record.weapon.slots.some(Boolean))!
    const armorIdsBySlot = Object.fromEntries(
      ['head', 'chest', 'arms', 'waist', 'legs'].map(slot => [
        slot,
        [snapshot.catalog.armors.find(record => record.armor.slot === slot)!.ref.id],
      ]),
    )
    const attackDecoration = snapshot.catalog.decorations.find(record =>
      record.decoration.skills.some(skill => skill.skillId === attackId))!

    const solutions = searchSnapshotBuild(snapshot, {
      armorIdsBySlot,
      decorationIds: [attackDecoration.ref.id],
      requiredSkills: [{ level: 1, skillId: attackId }],
      weaponId: weapon.ref.id,
    }, {
      maxSolutions: 1,
      maxTalismanCandidates: 100,
    })

    expect(solutions).toHaveLength(1)
    expect(solutions[0].weapon.ref.id).toBe(weapon.ref.id)
    expect(solutions[0].skills).toContainEqual({ level: 1, skillId: attackId })
  })

  it('can generate Qurious Crafting variants for selected armor records', () => {
    const path = fileURLToPath(new URL('../snapshots/source-snapshot.json', import.meta.url))
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'))
    const attackId = snapshot.catalog.skills.find(skill => skill.names.zh === '攻击')!.ref.id
    const weapon = snapshot.catalog.weapons.find(record => record.weapon.slots.some(Boolean))!
    const armorIdsBySlot = Object.fromEntries(
      ['head', 'chest', 'arms', 'waist', 'legs'].map(slot => [
        slot,
        [snapshot.catalog.armors.find(record => record.armor.slot === slot
          && record.armorFamilyId)!.ref.id],
      ]),
    )
    const request = createSnapshotBuildRequest(snapshot, {
      armorIdsBySlot,
      id: 'augmented-build',
      requiredSkills: [{ level: 1, skillId: attackId }],
      weaponId: weapon.ref.id,
    }, {
      armorVariantOptions: { maxComponents: 1, maxVariants: 20 },
      generateArmorVariants: true,
      maxTalismanCandidates: 100,
      pruneDominatedArmor: false,
    })

    expect(Object.values(request.armorBySlot).some(variants => variants.length > 1)).toBe(true)
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

  it('imports resistance reduction rules from the synchronized workbook', () => {
    const path = fileURLToPath(new URL('../snapshots/source-snapshot.json', import.meta.url))
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'))
    const components = armorComponentsForPool(snapshot, 1)
    const fireReduction = components.find(component => component.resistanceDelta?.fire === -1)

    expect(fireReduction).toMatchObject({
      costDelta: -2,
      resistanceDelta: { fire: -1 },
    })
  })

  it('generates legal talismans only for requested skills', () => {
    const attackId = createWikiRef('skill', '366824395').id
    const snapshot = parseSourceSnapshot({
      catalog: {
        armors: [],
        decorations: [],
        skills: [],
        talismans: [],
        weapons: [],
      },
      generatedAt: '',
      rules: {
        armorFamilies: [],
        augmentationEntries: [],
        skillCosts: [],
        talismanRules: [{
          firstSkillMax: 2,
          firstSkillMaxRing: 1,
          gameId: 1,
          maxLevel: 7,
          name: '攻击',
          rank: 'A',
          secondSkillMax: 2,
          secondSkillMaxRing: 1,
          skillId: attackId,
          slotOptions: [[4, 1, 1]],
        }],
      },
      source: { kiranico: [], workbook: '' },
    })

    const [record] = generateTalismanRecords(snapshot, {
      skillIds: [attackId],
    })

    expect(record.names.zh).toBe('攻击1 (霸气)')
    expect(record.talisman.slots).toEqual([4, 1, 1])
    expect(record.talisman.skills).toEqual([{ level: 1, skillId: '366824395' }])
  })
})
