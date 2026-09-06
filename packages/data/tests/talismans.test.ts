import { describe, expect, it } from 'vitest'
import { parseSlots, parseTalismanTable } from '../src/talismans'

describe('talisman table importer', () => {
  it('parses slot notation used by the source sheets', () => {
    expect(parseSlots('Slot2.2.2')).toEqual([2, 2, 2])
    expect(parseSlots('4-1-0')).toEqual([4, 1, 0])
  })

  it('imports skills and keeps generated talismans local', () => {
    const [record] = parseTalismanTable([
      'id\tname\tslots\tskill1Id\tskill1Level\tskill2Id\tskill2Level',
      'attack-charm\t测试护石\t2.2.2\t366824395\t4\t500079394\t2',
    ].join('\n'))

    expect(record.ref).toEqual({
      id: 'local:attack-charm',
      kind: 'talisman',
      source: 'local',
    })
    expect(record.talisman.skills).toEqual([
      { level: 4, skillId: '366824395' },
      { level: 2, skillId: '500079394' },
    ])
    expect(record.talisman.slots).toEqual([2, 2, 2])
  })
})
