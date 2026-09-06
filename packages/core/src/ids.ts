export type WikiEntityKind
  = | 'armor'
    | 'decoration'
    | 'skill'
    | 'talisman'
    | 'weapon'

export type WikiId = string & {
  readonly __wikiId: unique symbol
}

export interface WikiRef<K extends WikiEntityKind = WikiEntityKind> {
  readonly id: WikiId
  readonly kind: K
  readonly source: 'kiranico'
}

export function createWikiId(value: string): WikiId {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid wiki id: ${value}`)
  }

  return value as WikiId
}

export function createWikiRef<K extends WikiEntityKind>(
  kind: K,
  id: string,
): WikiRef<K> {
  return {
    id: createWikiId(id),
    kind,
    source: 'kiranico',
  }
}
