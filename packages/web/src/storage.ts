import type { ArmorSlot, SlotLevels } from '@mhrise-build/core'
import type { AppLocale } from '@mhrise-build/data'
import type { SkillSelection } from './planner-types'
import { useStorage } from '@vueuse/core'
import { computed } from 'vue'
import { detectBrowserLocale } from './locale'

export type ColorScheme = 'light' | 'dark'

export interface PlannerStorageState {
  readonly schemaVersion: 1
  equipment: {
    armorIds: Record<ArmorSlot, string[]>
    talismanId: string
    talismanFilter: TalismanFilterStorage
    weaponId: string
  }
  skills: SkillSelection[]
}

export interface TalismanFilterStorage {
  firstSkillId: string
  firstSkillLevel: number
  secondSkillId: string
  secondSkillLevel: number
  slots: SlotLevels
}

export interface PreferencesStorageState {
  readonly schemaVersion: 1
  locale: AppLocale
  theme: ColorScheme
}

const PLANNER_STORAGE_KEY = 'mhrise-build-calculator-planner'
const PREFERENCES_STORAGE_KEY = 'mhrise-build-calculator-preferences'

function createDefaultArmorIds(): Record<ArmorSlot, string[]> {
  return {
    arms: [],
    chest: [],
    head: [],
    legs: [],
    waist: [],
  }
}

function createDefaultPlannerState(): PlannerStorageState {
  return {
    schemaVersion: 1,
    equipment: {
      armorIds: createDefaultArmorIds(),
      talismanId: '',
      talismanFilter: {
        firstSkillId: '',
        firstSkillLevel: 1,
        secondSkillId: '',
        secondSkillLevel: 1,
        slots: [0, 0, 0],
      },
      weaponId: '',
    },
    skills: [],
  }
}

function createDefaultPreferencesState(): PreferencesStorageState {
  return {
    schemaVersion: 1,
    locale: detectBrowserLocale(),
    theme: detectDefaultTheme(),
  }
}

function readLegacyValue<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined')
    return fallback

  const raw = localStorage.getItem(key)
  if (!raw)
    return fallback

  try {
    return JSON.parse(raw) as T
  }
  catch {
    return fallback
  }
}

function hasStoredValue(key: string): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(key) !== null
}

function migrateLegacyState(): { planner: PlannerStorageState, preferences: PreferencesStorageState } {
  const defaultPlannerState = createDefaultPlannerState()
  const defaultPreferencesState = createDefaultPreferencesState()
  const planner = hasStoredValue(PLANNER_STORAGE_KEY)
    ? defaultPlannerState
    : {
        schemaVersion: 1 as const,
        equipment: {
          armorIds: readLegacyValue('mhrise-build-calculator-armors', defaultPlannerState.equipment.armorIds),
          talismanId: readLegacyValue('mhrise-build-calculator-talisman', ''),
          talismanFilter: defaultPlannerState.equipment.talismanFilter,
          weaponId: readLegacyValue('mhrise-build-calculator-weapon', ''),
        },
        skills: readLegacyValue<SkillSelection[]>('mhrise-build-calculator-skills', []),
      }
  const preferences = hasStoredValue(PREFERENCES_STORAGE_KEY)
    ? defaultPreferencesState
    : {
        schemaVersion: 1 as const,
        locale: readLegacyValue('mhrise-build-calculator-locale', defaultPreferencesState.locale),
        theme: readLegacyValue('mhrise-build-calculator-theme', defaultPreferencesState.theme),
      }

  removeLegacyKeys()
  return { planner, preferences }
}

function removeLegacyKeys(): void {
  if (typeof localStorage === 'undefined')
    return

  for (const key of [
    'mhrise-build-calculator-armors',
    'mhrise-build-calculator-locale',
    'mhrise-build-calculator-skills',
    'mhrise-build-calculator-talisman',
    'mhrise-build-calculator-theme',
    'mhrise-build-calculator-weapon',
  ]) {
    localStorage.removeItem(key)
  }
}

function detectDefaultTheme(): ColorScheme {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

const migratedState = migrateLegacyState()

export const plannerStorage = useStorage<PlannerStorageState>(
  PLANNER_STORAGE_KEY,
  migratedState.planner,
  undefined,
  { mergeDefaults: true },
)

export const preferencesStorage = useStorage<PreferencesStorageState>(
  PREFERENCES_STORAGE_KEY,
  migratedState.preferences,
  undefined,
  { mergeDefaults: true },
)

export const preferredLocale = computed<AppLocale>({
  get: () => preferencesStorage.value.locale,
  set: value => preferencesStorage.value.locale = value,
})

export const theme = computed<ColorScheme>({
  get: () => preferencesStorage.value.theme,
  set: value => preferencesStorage.value.theme = value,
})
