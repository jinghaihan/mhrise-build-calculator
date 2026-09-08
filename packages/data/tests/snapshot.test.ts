import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  collectAvailableSlots,
  createArmorVariant,
  createWikiId,
  createWikiRef,
  generateArmorVariants,
  getSkillLevel,
} from '@mhrise-build/core'
import { describe, expect, it } from 'vitest'
import localizedNames from '../locales/names.json'
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
  it('finds a legal attack-7 build from real scoped armor data with seven-roll augmentation enabled', () => {
    const snapshot = parseSourceSnapshot(readFileSync(new URL('../snapshots/source-snapshot.json', import.meta.url), 'utf8'), localizedNames)
    const slots = ['head', 'chest', 'arms', 'waist', 'legs'] as const
    const armorIdsBySlot = Object.fromEntries(slots.map(slot => [slot, snapshot.catalog.armors
      .filter(record => record.armor.slot === slot && record.armorFamilyId)
      .slice(0, 2)
      .map(record => record.ref.id)]))
    const skillId = snapshot.catalog.skills.find(record => record.names.zh === '攻击')!.ref.id
    const weaponId = snapshot.catalog.weapons.find(record => record.weapon.slots[0] >= 2)!.ref.id
    const results = searchSnapshotBuild(snapshot, {
      weaponId,
      armorIdsBySlot,
      requiredSkills: [{ skillId, level: 7 }],
    }, { generateArmorVariants: true, maxTalismanCandidates: 10, maxSolutions: 5 })
    expect(results).toHaveLength(5)
    for (const result of results) {
      expect(getSkillLevel(result.skills, skillId)).toBeGreaterThanOrEqual(7)
      expect(result.defense).toBe(Object.values(result.armor).reduce((sum, variant) => sum + variant.defense, 0))
      for (const slot of slots) {
        const variant = result.armor[slot]
        expect(armorIdsBySlot[slot]).toContain(variant.base.ref.id)
        expect(variant.augmentation?.componentIds?.length ?? 0).toBeLessThanOrEqual(7)
        expect(variant.augmentation?.cost ?? 0).toBeLessThanOrEqual(variant.base.costBudget)
        expect(variant.skills.filter(skill => skill.level > 0).length).toBeLessThanOrEqual(5)
      }
      const available = collectAvailableSlots(result.weapon, result.armor, result.talisman)
      expect(new Set(result.decorations.map(jewel => `${jewel.host}:${jewel.slotIndex}`)).size).toBe(result.decorations.length)
      for (const jewel of result.decorations)
        expect(available.find(slot => slot.host === jewel.host && slot.index === jewel.slotIndex)!.level).toBeGreaterThanOrEqual(jewel.decoration.slotLevel)
    }
  }, 15000)

  it('can fund a requested skill by removing an unrelated original skill', () => {
    const skillId = createWikiId('1')
    const originalSkillIds = ['2', '3', '4', '5', '6'].map(createWikiId)
    const base = {
      ref: createWikiRef('armor', '100'),
      slot: 'head' as const,
      slots: [0, 0, 0] as const,
      baseSkills: originalSkillIds.map(skillId => ({ skillId, level: 1 })),
      baseDefense: 100,
      costBudget: 5,
    }
    const snapshot = parseSourceSnapshot({
      catalog: { armors: [], decorations: [], skills: [], talismans: [], weapons: [] },
      rules: {
        armorFamilies: [],
        skillCosts: [],
        talismanRules: [],
        augmentationEntries: [
          { cost: 15, gameId: 1, kind: 'skill', levels: [1], poolId: 1 },
          { cost: -10, gameId: 2, kind: 'skill', levels: [-1], poolId: 1 },
        ],
      },
    })
    const components = armorComponentsForPool(snapshot, 1, [skillId], originalSkillIds)
    expect(components.filter(component => component.skillChanges.some(change => change.level > 0))
      .every(component => component.skillChanges.every(change => change.skillId === skillId))).toBe(true)
    const variants = generateArmorVariants(base, components, { maxOperations: 2, requiredSkills: [{ skillId, level: 1 }] })
    expect(variants.some(variant => getSkillLevel(variant.skills, skillId) === 1
      && variant.skills.filter(skill => skill.level > 0).length === 5
      && variant.augmentation?.cost === 5)).toBe(true)
  })

  it.each([1, 2])('limits %i head candidates while leaving other slots unrestricted', (count) => {
    const snapshot = parseSourceSnapshot(readFileSync(new URL('../snapshots/source-snapshot.json', import.meta.url), 'utf8'), localizedNames)
    const heads = snapshot.catalog.armors.filter(record => record.armorFamilyId && record.armor.slot === 'head').slice(0, count)
    const skillId = snapshot.catalog.skills.find(skill => skill.names.zh === '攻击')!.ref.id
    const request = createSnapshotBuildRequest(snapshot, {
      id: 'partial-filter',
      weaponId: snapshot.catalog.weapons[0].ref.id,
      requiredSkills: [{ skillId, level: 1 }],
      armorIdsBySlot: { head: heads.map(record => record.ref.id) },
    }, { generateArmorVariants: true, armorVariantOptions: { maxOperations: 0 }, maxTalismanCandidates: 1 })

    expect(request.armorBySlot.head.map(variant => variant.base.ref.id)).toEqual(heads.map(record => record.ref.id))
    for (const slot of ['chest', 'arms', 'waist', 'legs'] as const) {
      expect(request.armorBySlot[slot].map(variant => variant.base.ref.id)).toEqual(snapshot.catalog.armors
        .filter(record => record.armorFamilyId && record.armor.slot === slot).map(record => record.ref.id))
    }
  })

  it('does not interpret an empty head allowlist as unrestricted', () => {
    const snapshot = parseSourceSnapshot(readFileSync(new URL('../snapshots/source-snapshot.json', import.meta.url), 'utf8'), localizedNames)
    expect(() => createSnapshotBuildRequest(snapshot, {
      id: 'empty-filter',
      weaponId: snapshot.catalog.weapons[0].ref.id,
      requiredSkills: [],
      armorIdsBySlot: { head: [] },
    }, { generateArmorVariants: true, armorVariantOptions: { maxOperations: 0 } }))
      .toThrow('No armor data found for head')
  })

  it('loads the synchronized 16.0.0 source snapshot', () => {
    const path = fileURLToPath(new URL('../snapshots/source-snapshot.json', import.meta.url))
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'), localizedNames)

    expect(snapshot.catalog.skills.length).toBeGreaterThan(100)
    expect(snapshot.catalog.decorations.length).toBeGreaterThan(200)
    expect(snapshot.catalog.armors.length).toBeGreaterThan(1000)
    expect(snapshot.catalog.weapons.length).toBeGreaterThan(3000)
    expect(snapshot.rules.armorFamilies.length).toBe(143)
    expect(snapshot.rules.armorFamilies.every(family => Object.keys(family).sort().join(',') === 'costBudget,id,poolId'))
      .toBe(true)
    expect(snapshot.rules.talismanRules.length).toBe(136)
    expect(snapshot.catalog.skills.find(skill => skill.names.zh === '坚如磐石')?.maxLevel).toBe(5)

    expect(snapshot.catalog.armors.find(record => record.names.zh === '皮制头饰')?.armorFamilyId)
      .toBeUndefined()
    expect(snapshot.catalog.armors.find(record => record.names.zh === '皮制X头饰')).toMatchObject({
      armor: { baseDefense: 80, costBudget: 20 },
      armorFamilyId: '301',
    })
    expect(snapshot.catalog.armors.find(record => record.names.zh === '炎火装束【头巾】继')).toMatchObject({
      armor: { baseDefense: 80, costBudget: 20 },
      armorFamilyId: '300',
    })

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
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'), localizedNames)
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
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'), localizedNames)
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
    expect(getSkillLevel(solutions[0].skills, attackId)).toBeGreaterThanOrEqual(1)
  })

  it('can generate Qurious Crafting variants for selected armor records', () => {
    const path = fileURLToPath(new URL('../snapshots/source-snapshot.json', import.meta.url))
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'), localizedNames)
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
      armorVariantOptions: { maxOperations: 1, maxVariants: 20 },
      generateArmorVariants: true,
      maxTalismanCandidates: 100,
    })

    expect(Object.values(request.armorBySlot).some(variants => variants.length > 1)).toBe(true)
  })

  it('excludes non-master armor from generated Qurious Crafting searches', () => {
    const path = fileURLToPath(new URL('../snapshots/source-snapshot.json', import.meta.url))
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'), localizedNames)
    const nonMaster = snapshot.catalog.armors.find(record => !record.armorFamilyId)!
    expect(() => createSnapshotBuildRequest(snapshot, {
      armorIdsBySlot: { [nonMaster.armor.slot]: [nonMaster.ref.id] },
      id: 'master-rank-only',
      requiredSkills: [],
      weaponId: snapshot.catalog.weapons[0].ref.id,
    }, { generateArmorVariants: true })).toThrow(
      `No armor data found for ${nonMaster.armor.slot} in build master-rank-only`,
    )
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
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'), localizedNames)
    const components = armorComponentsForPool(snapshot, 1)
    const fireReduction = components.find(component => component.resistanceDelta?.fire === -1)

    expect(fireReduction).toMatchObject({
      costDelta: -2,
      resistanceDelta: { fire: -1 },
    })
  })

  it('keeps special augmentation rows distinct from normal rows', () => {
    const path = fileURLToPath(new URL('../snapshots/source-snapshot.json', import.meta.url))
    const snapshot = parseSourceSnapshot(readFileSync(path, 'utf8'), localizedNames)
    const components = armorComponentsForPool(snapshot, 1)

    expect(components.find(component => component.id === '1:70:1')?.role).toBe('cost-fill')
    expect(components.find(component => component.id === '1:91:1')?.role).toBe('ignored-special')
    expect(components.find(component => component.id === '1:61:1')?.role).toBe('ignored-special')
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
