<script setup lang="ts">
import type { BuildSolution, SkillValue } from '@mhrise-build-tools/core'
import type { SearchSelectOption } from './components/SearchSelect.vue'
import type { BuildWorkerMessage, BuildWorkerProgress } from './workers/build.worker'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import FormField from '@antfu/design/components/Form/FormField.vue'
import FormNumberInput from '@antfu/design/components/Form/FormNumberInput.vue'
import { provideColorScheme } from '@antfu/design/composables/colorScheme'
import { createWikiId } from '@mhrise-build-tools/core'
import { defaultSnapshot, getLocalizedName } from '@mhrise-build-tools/data'
import { computed, onBeforeUnmount, ref } from 'vue'
import SearchSelect from './components/SearchSelect.vue'

type ColorScheme = 'light' | 'dark'

interface SkillSelection {
  level: number
  skillId: string
}

const armorSlots = ['head', 'chest', 'arms', 'waist', 'legs'] as const
const locale = 'en'
const storedTheme = localStorage.getItem('mhrise-build-tools-theme')
const theme = ref<ColorScheme>(storedTheme === 'dark' || storedTheme === 'light'
  ? storedTheme
  : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
const selectedWeaponId = ref('')
const selectedSkills = ref<SkillSelection[]>([])
const solutions = ref<BuildSolution[]>([])
const running = ref(false)
const errorMessage = ref('')
const progress = ref<BuildWorkerProgress>()
let worker: Worker | undefined

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
    label: getLocalizedName(record, locale) ?? String(record.ref.id),
    value: String(record.ref.id),
  }))
  .sort((left, right) => left.label.localeCompare(right.label, locale)))

const weaponOptions = computed<SearchSelectOption[]>(() => defaultSnapshot.catalog.weapons
  .filter(record => record.weapon.slots.some(level => level > 0))
  .map(record => ({
    label: getLocalizedName(record, locale) ?? String(record.ref.id),
    value: String(record.ref.id),
  }))
  .sort((left, right) => left.label.localeCompare(right.label, locale)))

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
  return record ? (getLocalizedName(record, locale) ?? skillId) : skillId
}

function weaponName(weaponId: string) {
  const record = defaultSnapshot.catalog.weapons.find(item => String(item.ref.id) === weaponId)
  return record ? (getLocalizedName(record, locale) ?? weaponId) : weaponId
}

function armorName(armorId: string) {
  const record = defaultSnapshot.catalog.armors.find(item => String(item.ref.id) === armorId)
  return record ? (getLocalizedName(record, locale) ?? armorId) : armorId
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
  worker = new Worker(new URL('./workers/build.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<BuildWorkerMessage>) => {
    const message = event.data
    if (message.type === 'progress') {
      progress.value = message.progress
    }
    else if (message.type === 'result') {
      solutions.value = message.solutions
      running.value = false
      worker?.terminate()
      worker = undefined
    }
    else {
      errorMessage.value = message.message
      running.value = false
      worker?.terminate()
      worker = undefined
    }
  }
  worker.onerror = (event) => {
    errorMessage.value = event.message || 'The calculation worker stopped unexpectedly.'
    running.value = false
    worker?.terminate()
    worker = undefined
  }
  worker.postMessage({
    maxSolutions: 5,
    requiredSkills: selectedSkills.value.map(({ level, skillId }): SkillValue => ({
      level,
      skillId: createWikiId(skillId),
    })),
    type: 'search',
    weaponId: selectedWeaponId.value,
  })
}

function cancelSearch() {
  worker?.terminate()
  worker = undefined
  running.value = false
  progress.value = undefined
}

onBeforeUnmount(() => worker?.terminate())
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
        <ActionButton
          size="sm"
          variant="text"
          :icon="isDark ? 'i-ph:sun' : 'i-ph:moon'"
          :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
          @click="toggleTheme"
        />
      </header>

      <section class="rounded-lg border border-base bg-elevated p-5 sm:p-6">
        <div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_8rem] md:items-end">
          <FormField label="Weapon" required>
            <SearchSelect v-model="selectedWeaponId" :options="weaponOptions" placeholder="Search weapons…" />
          </FormField>
          <div class="text-sm color-tertiary md:pb-2">
            {{ weaponOptions.length }} available
          </div>
        </div>

        <div class="mt-6 border-t border-base pt-5">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-base font-600">
              Target skills
            </h2>
            <ActionButton size="sm" icon="i-ph:plus" :disabled="running" @click="addSkill">
              Add skill
            </ActionButton>
          </div>

          <div v-if="selectedSkills.length === 0" class="rounded-md border border-dashed border-base px-4 py-6 text-center text-sm color-tertiary">
            Add a skill requirement.
          </div>
          <div v-else class="space-y-3">
            <div v-for="(skill, index) in selectedSkills" :key="index" class="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_8rem_2.25rem]">
              <FormField :label="index === 0 ? 'Skill' : undefined">
                <SearchSelect v-model="skill.skillId" :options="skillOptions" placeholder="Search skills…" :disabled="running" />
              </FormField>
              <FormField :label="index === 0 ? 'Level' : undefined">
                <FormNumberInput v-model="skill.level" :min="1" :max="maxSkillLevel(skill.skillId)" :disabled="running" controls />
              </FormField>
              <ActionButton size="sm" variant="text" icon="i-ph:trash" :disabled="running" aria-label="Remove skill" @click="removeSkill(index)" />
            </div>
          </div>
        </div>

        <div class="mt-6 flex flex-wrap items-center gap-3 border-t border-base pt-5">
          <ActionButton variant="primary" :loading="running" :disabled="!canSearch" icon="i-ph:magnifying-glass" @click="startSearch">
            {{ running ? 'Calculating…' : 'Find builds' }}
          </ActionButton>
          <ActionButton v-if="running" variant="text" icon="i-ph:stop" @click="cancelSearch">
            Cancel
          </ActionButton>
          <span v-if="!canSearch && !running" class="text-sm color-tertiary">Choose a weapon and at least one skill.</span>
        </div>

        <div v-if="running || progress" class="mt-5 border-t border-base pt-4">
          <div v-if="progress" class="flex items-center justify-between gap-4 text-sm">
            <span>{{ progress.stage === 'generating' ? 'Generating augmentation variants' : 'Searching legal combinations' }}</span>
            <span class="font-mono color-secondary">{{ progress.current }} / {{ progress.total }}</span>
          </div>
          <p v-else class="text-sm color-secondary">
            Starting the calculation worker…
          </p>
          <div v-if="progress" class="mt-3 h-1.5 overflow-hidden rounded-full bg-base">
            <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${progressPercent}%` }" />
          </div>
        </div>
      </section>

      <section class="mt-8">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-lg font-600">
            Results
          </h2>
          <span v-if="solutions.length" class="text-sm color-secondary">{{ solutions.length }} builds</span>
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
                    <span class="mr-2 color-tertiary">{{ slot }}</span>{{ armorName(String(solution.armor[slot].base.ref.id)) }}
                  </span>
                </div>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-xs color-tertiary">
                  Defense
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
          No results yet.
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
