<script setup lang="ts">
import type { ArmorSlot, BuildSolution, SkillValue } from '@mhrise-build-tools/core'
import type { SearchSelectOption } from './components/SearchSelect.vue'
import type { BuildSearchRequest, BuildWorkerApi, BuildWorkerProgress } from './workers/build.worker'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import FormField from '@antfu/design/components/Form/FormField.vue'
import FormNumberInput from '@antfu/design/components/Form/FormNumberInput.vue'
import { provideColorScheme } from '@antfu/design/composables/colorScheme'
import { createWikiId } from '@mhrise-build-tools/core'
import { defaultSnapshot, getLocalizedName, LOCALE_LABEL, SUPPORTED_LOCALES } from '@mhrise-build-tools/data'
import * as Comlink from 'comlink'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SearchSelect from './components/SearchSelect.vue'

type ColorScheme = 'light' | 'dark'

interface SkillSelection {
  level: number
  skillId: string
}

const armorSlots = ['head', 'chest', 'arms', 'waist', 'legs'] as const
const { locale, t } = useI18n({ useScope: 'global' })
const storedTheme = localStorage.getItem('mhrise-build-tools-theme')
const theme = ref<ColorScheme>(storedTheme === 'dark' || storedTheme === 'light'
  ? storedTheme
  : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
const selectedWeaponId = ref('')
const selectedArmorIds = ref<Record<ArmorSlot, string>>({
  arms: '',
  chest: '',
  head: '',
  legs: '',
  waist: '',
})
const selectedSkills = ref<SkillSelection[]>([])
const solutions = ref<BuildSolution[]>([])
const running = ref(false)
const errorMessage = ref('')
const progress = ref<BuildWorkerProgress>()
let worker: Worker | undefined
let workerApi: Comlink.Remote<BuildWorkerApi> | undefined

const isDark = computed(() => theme.value === 'dark')

function applyTheme() {
  document.documentElement.classList.toggle('dark', isDark.value)
  document.documentElement.classList.toggle('light', !isDark.value)
  document.documentElement.style.colorScheme = theme.value
}

function toggleTheme() {
  theme.value = isDark.value ? 'light' : 'dark'
  localStorage.setItem('mhrise-build-tools-theme', theme.value)
  applyTheme()
}

provideColorScheme(() => theme.value)
applyTheme()

const skillOptions = computed<SearchSelectOption[]>(() => defaultSnapshot.catalog.skills
  .map(record => ({
    label: getLocalizedName(record, locale.value, 'zh') ?? String(record.ref.id),
    value: String(record.ref.id),
  }))
  .sort((left, right) => left.label.localeCompare(right.label, locale.value)))

const weaponOptions = computed<SearchSelectOption[]>(() => defaultSnapshot.catalog.weapons
  .filter(record => record.weapon.slots.some(level => level > 0))
  .map(record => ({
    label: getLocalizedName(record, locale.value, 'zh') ?? String(record.ref.id),
    value: String(record.ref.id),
  }))
  .sort((left, right) => left.label.localeCompare(right.label, locale.value)))

const armorOptionsBySlot = computed<Record<ArmorSlot, SearchSelectOption[]>>(() => Object.fromEntries(
  armorSlots.map(slot => [slot, defaultSnapshot.catalog.armors
    .filter(record => record.armor.slot === slot && record.armorFamilyId)
    .map(record => ({
      label: getLocalizedName(record, locale.value, 'zh') ?? String(record.ref.id),
      value: String(record.ref.id),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, locale.value))]),
) as Record<ArmorSlot, SearchSelectOption[]>)

const hasArmorFilters = computed(() => Object.values(selectedArmorIds.value).some(Boolean))

const canSearch = computed(() => selectedWeaponId.value !== ''
  && selectedSkills.value.length > 0
  && selectedSkills.value.every(skill => skill.level >= 1))

const progressPercent = computed(() => {
  if (!progress.value || progress.value.total === 0)
    return 0
  return Math.min(100, Math.round((progress.value.current / progress.value.total) * 100))
})

function addSkill() {
  const unused = skillOptions.value.find(option => !selectedSkills.value.some(skill => skill.skillId === option.value))
  if (unused)
    selectedSkills.value.push({ level: 1, skillId: unused.value })
}

function removeSkill(index: number) {
  selectedSkills.value.splice(index, 1)
}

function skillRecord(skillId: string) {
  return defaultSnapshot.catalog.skills.find(record => String(record.ref.id) === skillId)
}

function skillName(skillId: string) {
  const record = skillRecord(skillId)
  return record ? (getLocalizedName(record, locale.value, 'zh') ?? skillId) : skillId
}

function weaponName(weaponId: string) {
  const record = defaultSnapshot.catalog.weapons.find(item => String(item.ref.id) === weaponId)
  return record ? (getLocalizedName(record, locale.value, 'zh') ?? weaponId) : weaponId
}

function armorName(armorId: string) {
  const record = defaultSnapshot.catalog.armors.find(item => String(item.ref.id) === armorId)
  return record ? (getLocalizedName(record, locale.value, 'zh') ?? armorId) : armorId
}

function clearArmorFilters() {
  for (const slot of armorSlots)
    selectedArmorIds.value[slot] = ''
}

function persistLocale() {
  localStorage.setItem('mhrise-build-tools-locale', locale.value)
}

function maxSkillLevel(skillId: string) {
  return skillRecord(skillId)?.maxLevel ?? 10
}

function startSearch() {
  if (!canSearch.value || running.value)
    return

  worker?.terminate()
  solutions.value = []
  errorMessage.value = ''
  progress.value = undefined
  running.value = true
  const currentWorker = new Worker(new URL('./workers/build.worker.ts', import.meta.url), { type: 'module' })
  const currentApi = Comlink.wrap<BuildWorkerApi>(currentWorker)
  worker = currentWorker
  workerApi = currentApi
  const request: BuildSearchRequest = {
    armorIdsBySlot: Object.fromEntries(armorSlots
      .filter(slot => selectedArmorIds.value[slot])
      .map(slot => [slot, [selectedArmorIds.value[slot]]])),
    maxSolutions: 5,
    requiredSkills: selectedSkills.value.map(({ level, skillId }): SkillValue => ({
      level,
      skillId: createWikiId(skillId),
    })),
    weaponId: selectedWeaponId.value,
  }
  void currentApi.search(request, Comlink.proxy((update: BuildWorkerProgress) => {
    if (worker === currentWorker)
      progress.value = update
  })).then((result) => {
    if (worker !== currentWorker)
      return
    solutions.value = result
    running.value = false
  }).catch((error: unknown) => {
    if (worker !== currentWorker)
      return
    errorMessage.value = error instanceof Error ? error.message : String(error)
    running.value = false
  }).finally(() => {
    currentApi[Comlink.releaseProxy]()
    currentWorker.terminate()
    if (worker === currentWorker) {
      worker = undefined
      workerApi = undefined
    }
  })
}

function cancelSearch() {
  workerApi?.[Comlink.releaseProxy]()
  worker?.terminate()
  worker = undefined
  workerApi = undefined
  running.value = false
  progress.value = undefined
}

onBeforeUnmount(() => {
  workerApi?.[Comlink.releaseProxy]()
  worker?.terminate()
})
</script>

<template>
  <main class="min-h-screen bg-base color-base">
    <div class="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
      <header class="mb-7 flex items-center justify-between border-b border-base pb-5">
        <div class="flex items-center gap-3">
          <span class="app-logo h-9 w-9 text-primary" role="img" aria-label="Monster Hunter Rise logo" />
          <h1 class="text-xl font-600 tracking-tight">
            MHRise Build Planner
          </h1>
        </div>
        <div class="flex items-center gap-2">
          <label class="sr-only" for="locale-select">{{ t('ui.language') }}</label>
          <select
            id="locale-select"
            v-model="locale"
            class="h-9 rounded-md border border-base bg-raised px-2 text-sm color-base outline-none focus:ring-2 focus:ring-primary-500/40"
            @change="persistLocale"
          >
            <option v-for="supportedLocale in SUPPORTED_LOCALES" :key="supportedLocale" :value="supportedLocale">
              {{ LOCALE_LABEL[supportedLocale] }}
            </option>
          </select>
          <ActionButton
            size="sm"
            variant="text"
            :icon="isDark ? 'i-ph:sun' : 'i-ph:moon'"
            :aria-label="isDark ? t('ui.switchToLight') : t('ui.switchToDark')"
            @click="toggleTheme"
          />
        </div>
      </header>

      <section class="rounded-lg border border-base bg-elevated p-5 sm:p-6">
        <div class="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <div>
            <h2 class="mb-4 text-base font-600">
              {{ t('ui.equipment') }}
            </h2>
            <FormField :label="t('ui.weapon')" required>
              <SearchSelect
                v-model="selectedWeaponId"
                :options="weaponOptions"
                :placeholder="t('ui.searchWeapons')"
                :empty-text="t('ui.noMatches')"
              />
            </FormField>

            <div class="mt-5 flex items-center justify-between">
              <h3 class="text-sm font-600">
                {{ t('ui.armor') }}
              </h3>
              <ActionButton size="sm" variant="text" :disabled="running || !hasArmorFilters" @click="clearArmorFilters">
                {{ t('ui.clearArmor') }}
              </ActionButton>
            </div>
            <div class="mt-3 space-y-3">
              <div v-for="slot in armorSlots" :key="slot" class="grid items-center gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
                <span class="text-sm color-secondary">{{ t(`slot.${slot}`) }}</span>
                <SearchSelect
                  v-model="selectedArmorIds[slot]"
                  :options="armorOptionsBySlot[slot]"
                  :placeholder="t('ui.searchArmor')"
                  :empty-text="t('ui.noMatches')"
                  :disabled="running"
                />
              </div>
            </div>
          </div>

          <div class="lg:border-l lg:border-base lg:pl-8">
            <div class="mb-4 flex items-center justify-between">
              <h2 class="text-base font-600">
                {{ t('ui.targetSkills') }}
              </h2>
              <ActionButton size="sm" icon="i-ph:plus" :disabled="running" @click="addSkill">
                {{ t('ui.addSkill') }}
              </ActionButton>
            </div>

            <div v-if="selectedSkills.length === 0" class="rounded-md border border-dashed border-base px-4 py-6 text-center text-sm color-tertiary">
              {{ t('ui.addSkillRequirement') }}
            </div>
            <div v-else class="space-y-3">
              <div v-for="(skill, index) in selectedSkills" :key="index" class="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_8rem_2.25rem]">
                <FormField :label="index === 0 ? t('ui.skill') : undefined">
                  <SearchSelect
                    v-model="skill.skillId"
                    :options="skillOptions"
                    :placeholder="t('ui.searchSkills')"
                    :empty-text="t('ui.noMatches')"
                    :disabled="running"
                  />
                </FormField>
                <FormField :label="index === 0 ? t('ui.level') : undefined">
                  <FormNumberInput v-model="skill.level" :min="1" :max="maxSkillLevel(skill.skillId)" :disabled="running" controls />
                </FormField>
                <ActionButton size="sm" variant="text" icon="i-ph:trash" :disabled="running" :aria-label="t('ui.removeSkill')" @click="removeSkill(index)" />
              </div>
            </div>
          </div>
        </div>

        <div class="mt-8 flex flex-wrap items-center gap-3 border-t border-base pt-5">
          <ActionButton variant="primary" :loading="running" :disabled="!canSearch" icon="i-ph:magnifying-glass" @click="startSearch">
            {{ running ? t('ui.calculating') : t('ui.findBuilds') }}
          </ActionButton>
          <ActionButton v-if="running" variant="text" icon="i-ph:stop" @click="cancelSearch">
            {{ t('ui.cancel') }}
          </ActionButton>
          <span v-if="!canSearch && !running" class="text-sm color-tertiary">{{ t('ui.chooseRequirements') }}</span>
        </div>

        <div v-if="running || progress" class="mt-5 border-t border-base pt-4">
          <div v-if="progress" class="flex items-center justify-between gap-4 text-sm">
            <span>{{ progress.stage === 'generating' ? t('ui.generatingVariants') : t('ui.searchingCombinations') }}</span>
            <span class="font-mono color-secondary">{{ progress.current }} / {{ progress.total }}</span>
          </div>
          <p v-else class="text-sm color-secondary">
            {{ t('ui.startingWorker') }}
          </p>
          <div v-if="progress" class="mt-3 h-1.5 overflow-hidden rounded-full bg-base">
            <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${progressPercent}%` }" />
          </div>
        </div>
      </section>

      <section class="mt-8">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-lg font-600">
            {{ t('ui.results') }}
          </h2>
          <span v-if="solutions.length" class="text-sm color-secondary">{{ solutions.length }} {{ t('ui.builds') }}</span>
        </div>

        <div v-if="errorMessage" class="mb-3 rounded-md border border-red/30 bg-red/10 px-4 py-3 text-sm text-red-600 dark:text-red-300" role="alert">
          {{ errorMessage }}
        </div>

        <div v-if="solutions.length" class="overflow-hidden rounded-lg border border-base bg-elevated">
          <article v-for="(solution, index) in solutions" :key="solution.id" class="border-b border-base p-4 last:border-b-0 sm:p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="text-xs color-tertiary">
                  #{{ index + 1 }} · {{ weaponName(String(solution.weapon.ref.id)) }}
                </p>
                <div class="mt-2 grid gap-x-5 gap-y-1 text-sm sm:grid-cols-2">
                  <span v-for="slot in armorSlots" :key="slot" class="truncate">
                    <span class="mr-2 color-tertiary">{{ t(`slot.${slot}`) }}</span>{{ armorName(String(solution.armor[slot].base.ref.id)) }}
                  </span>
                </div>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-xs color-tertiary">
                  {{ t('ui.defense') }}
                </p>
                <p class="font-mono text-xl font-600 text-primary">
                  {{ solution.defense }}
                </p>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs color-secondary">
              <span v-for="skill in solution.skills" :key="skill.skillId">{{ skillName(String(skill.skillId)) }} Lv.{{ skill.level }}</span>
            </div>
          </article>
        </div>
        <div v-else class="rounded-lg border border-dashed border-base px-4 py-12 text-center text-sm color-tertiary">
          {{ t('ui.noResults') }}
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.app-logo {
  display: inline-block;
  flex: none;
  background-color: currentColor;
  mask: url('/logo.svg') center / contain no-repeat;
  -webkit-mask: url('/logo.svg') center / contain no-repeat;
}
</style>
