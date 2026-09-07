import localizedNames from '../locales/names.json'
import snapshot from '../snapshots/source-snapshot.json'
import { parseSourceSnapshot } from './snapshot'

export const defaultSnapshot = parseSourceSnapshot(snapshot, localizedNames)
