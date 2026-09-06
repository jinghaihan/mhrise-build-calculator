import { describe, expect, it } from 'vitest'
import { createWikiId, createWikiRef } from '../src/ids'

describe('wiki identifiers', () => {
  it('keeps source identifiers separate from localized names', () => {
    const skill = createWikiRef('skill', '500079394')

    expect(skill).toEqual({
      id: createWikiId('500079394'),
      kind: 'skill',
      source: 'kiranico',
    })
  })

  it('rejects identifiers that are not numeric wiki ids', () => {
    expect(() => createWikiId('weakness-exploit')).toThrow('Invalid wiki id')
  })
})
