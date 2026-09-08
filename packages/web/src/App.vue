<script setup lang="ts">
import type { ArmorSlot, BuildSolution, SkillValue } from '@mhrise-build/core'
import type { SearchSelectOption } from './components/search-select.vue'
import type { BuildSearchRequest, BuildWorkerApi, BuildWorkerProgress } from './workers/build.worker'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import { provideColorScheme } from '@antfu/design/composables/colorScheme'
import { createWikiId } from '@mhrise-build/core'
import { defaultSnapshot, generateTalismanRecords, getLocalizedName } from '@mhrise-build/data'
import * as Comlink from 'comlink'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from './components/app-header.vue'
import EquipmentPanel from './components/equipment-panel.vue'
import ResultsSection from './components/results-section.vue'
import TargetSkillsPanel from './components/target-skills-panel.vue'
import { preferredLocale } from './i18n'
import type { EquipmentStats, SkillSelection } from './planner-types'
import { armorSlots, equipmentStatKeys } from './planner-types'
import { plannerStorage, theme } from './storage'

const { locale, t } = useI18n({ useScope: 'global' })
const selectedWeaponId = computed({
  get: () => plannerStorage.value.equipment.weaponId,
  set: value => plannerStorage.value.equipment.weaponId = value,
})
const selectedTalismanId = computed({
  get: () => plannerStorage.value.equipment.talismanId,
  set: value => plannerStorage.value.equipment.talismanId = value,
})
const selectedArmorIds = computed<Record<ArmorSlot, string[]>>({
  get: () => plannerStorage.value.equipment.armorIds,
  set: value => plannerStorage.value.equipment.armorIds = value,
})
// Retain the first selection from the previous multi-select UI cache.
for (const slot of armorSlots)
  selectedArmorIds.value[slot] = selectedArmorIds.value[slot].slice(0, 1)
const selectedSkills = computed<SkillSelection[]>({
  get: () => plannerStorage.value.skills,
  set: value => plannerStorage.value.skills = value,
})
const solutions = ref<BuildSolution[]>([])
const running = ref(false)
const errorMessage = ref('')
const progress = ref<BuildWorkerProgress>()
const elapsedMilliseconds = ref(0)
let worker: Worker | undefined
let workerApi: Comlink.Remote<BuildWorkerApi> | undefined
let elapsedTimer: ReturnType<typeof setInterval> | undefined
let searchStartedAt = 0

watch([selectedWeaponId, selectedTalismanId, selectedArmorIds, selectedSkills], () => {
  if (!running.value) {
    solutions.value = []
    progress.value = undefined
    errorMessage.value = ''
  }
}, { deep: true })

const isDark = computed(() => theme.value === 'dark')

function applyTheme() {
  document.documentElement.classList.toggle('dark', isDark.value)
  document.documentElement.classList.toggle('light', !isDark.value)
  document.documentElement.style.colorScheme = theme.value
}

function toggleTheme() {
  theme.value = isDark.value ? 'light' : 'dark'
}

provideColorScheme(() => theme.value)
watch(theme, applyTheme, { immediate: true })

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

const talismanOptions = computed<SearchSelectOption[]>(() => generateTalismanRecords(defaultSnapshot, {
  maxCandidates: 2000,
  skillIds: selectedSkills.value.map(skill => createWikiId(skill.skillId)),
}).map(record => ({
  label: getLocalizedName(record, locale.value, 'zh') ?? String(record.ref.id),
  value: String(record.ref.id),
})))

const hasArmorFilters = computed(() => Object.values(selectedArmorIds.value).some(ids => ids.length > 0))

const equipmentStats = computed<EquipmentStats>(() => {
  const totals = { defense: 0, fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 }
  for (const slot of armorSlots) {
    const armor = defaultSnapshot.catalog.armors.find(record => record.ref.id === selectedArmorIds.value[slot][0])?.armor
    if (!armor)
      continue
    totals.defense += armor.baseDefense
    for (const element of equipmentStatKeys) {
      if (element !== 'defense')
        totals[element] += armor.baseResistances?.[element] ?? 0
    }
  }
  return totals
})

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
    selectedSkills.value.push({ level: maxSkillLevel(unused.value), skillId: unused.value })
}

function skillRecord(skillId: string) {
  return defaultSnapshot.catalog.skills.find(record => String(record.ref.id) === skillId)
}

function clearArmorFilters() {
  for (const slot of armorSlots)
    selectedArmorIds.value[slot] = []
}

function maxSkillLevel(skillId: string) {
  return skillRecord(skillId)?.maxLevel ?? 10
}

function updateElapsedTime() {
  if (searchStartedAt > 0)
    elapsedMilliseconds.value = performance.now() - searchStartedAt
}

function startElapsedTimer() {
  searchStartedAt = performance.now()
  elapsedMilliseconds.value = 0
  elapsedTimer = setInterval(updateElapsedTime, 250)
}

function stopElapsedTimer() {
  updateElapsedTime()
  if (elapsedTimer)
    clearInterval(elapsedTimer)
  elapsedTimer = undefined
  searchStartedAt = 0
}

function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function startSearch() {
  if (!canSearch.value || running.value)
    return

  worker?.terminate()
  solutions.value = []
  errorMessage.value = ''
  progress.value = undefined
  running.value = true
  startElapsedTimer()
  const currentWorker = new Worker(new URL('./workers/build.worker.ts', import.meta.url), { type: 'module' })
  const currentApi = Comlink.wrap<BuildWorkerApi>(currentWorker)
  worker = currentWorker
  workerApi = currentApi
  const request: BuildSearchRequest = {
    armorIdsBySlot: Object.fromEntries(armorSlots
      .filter(slot => selectedArmorIds.value[slot].length > 0)
      .map(slot => [slot, [...selectedArmorIds.value[slot]]])),
    maxSolutions: 5,
    requiredSkills: selectedSkills.value.map(({ level, skillId }): SkillValue => ({
      level,
      skillId: createWikiId(skillId),
    })),
    ...(talismanOptions.value.some(option => option.value === selectedTalismanId.value)
      ? { talismanIds: [selectedTalismanId.value] }
      : {}),
    weaponId: selectedWeaponId.value,
  }
  void currentApi.search(request, Comlink.proxy((update: BuildWorkerProgress) => {
    if (worker === currentWorker)
      progress.value = update
  }), Comlink.proxy((partialResults: readonly BuildSolution[]) => {
    if (worker === currentWorker)
      solutions.value = [...partialResults]
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
    stopElapsedTimer()
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
  stopElapsedTimer()
  progress.value = undefined
}

onBeforeUnmount(() => {
  stopElapsedTimer()
  workerApi?.[Comlink.releaseProxy]()
  worker?.terminate()
})
</script>

<template>
  <main class="min-h-screen bg-base color-base">
    <div class="mx-auto max-w-5xl px-5 py-6 sm:px-8 sm:py-8">
      <AppHeader v-model:locale="preferredLocale" :is-dark="isDark" @toggle-theme="toggleTheme" />

      <section>
        <div class="editor-grid grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <EquipmentPanel
            v-model:armor-ids="selectedArmorIds"
            v-model:talisman-id="selectedTalismanId"
            v-model:weapon-id="selectedWeaponId"
            :armor-options-by-slot="armorOptionsBySlot"
            :disabled="running"
            :has-armor-filters="hasArmorFilters"
            :talisman-options="talismanOptions"
            :weapon-options="weaponOptions"
            @clear-armor="clearArmorFilters"
          />
          <TargetSkillsPanel
            v-model:skills="selectedSkills"
            :disabled="running"
            :equipment-stats="equipmentStats"
            :max-skill-level="maxSkillLevel"
            :skill-options="skillOptions"
            @add-skill="addSkill"
          />
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

        <div v-if="running || elapsedMilliseconds > 0" class="mt-5 border-t border-base pt-4">
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <span>{{ running ? t('ui.calculatingBuilds') : t('ui.calculationComplete') }}</span>
            <span class="font-mono color-secondary">{{ t('ui.elapsed', { time: formatElapsedTime(elapsedMilliseconds) }) }}</span>
          </div>
          <div v-if="running && progress" class="mt-2 flex items-center justify-between gap-4 text-xs color-secondary">
            <span>{{ progress.stage === 'searching' ? t('ui.searchingBuilds') : t('ui.preparingBuilds') }}</span>
            <span class="font-mono">{{ progress.current }} / {{ progress.total }}</span>
          </div>
          <div v-if="progress" class="mt-3 h-1.5 overflow-hidden rounded-full bg-base">
            <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${progressPercent}%` }" />
          </div>
        </div>
      </section>

      <ResultsSection :error-message="errorMessage" :solutions="solutions" />
    </div>
  </main>
</template>
