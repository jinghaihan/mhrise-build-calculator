<script setup lang="ts">
import type { ComboboxOption } from '@antfu/design/components/Form/FormCombobox.vue'
import type { BuildSolution, SkillValue } from '@mhrise-build-tools/core'
import type { BuildWorkerMessage, BuildWorkerProgress } from './workers/build.worker'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import DisplayBadge from '@antfu/design/components/Display/DisplayBadge.vue'
import FormCombobox from '@antfu/design/components/Form/FormCombobox.vue'
import FormField from '@antfu/design/components/Form/FormField.vue'
import FormNumberInput from '@antfu/design/components/Form/FormNumberInput.vue'
import { provideColorScheme } from '@antfu/design/composables/colorScheme'
import { createWikiId } from '@mhrise-build-tools/core'
import { defaultSnapshot, getLocalizedName } from '@mhrise-build-tools/data'
import { computed, onBeforeUnmount, ref } from 'vue'

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

const skillOptions = computed<ComboboxOption[]>(() => defaultSnapshot.catalog.skills
  .map(record => ({
    label: getLocalizedName(record, locale) ?? String(record.ref.id),
    value: String(record.ref.id),
  }))
  .sort((left, right) => left.label.localeCompare(right.label, locale)))

const weaponOptions = computed<ComboboxOption[]>(() => defaultSnapshot.catalog.weapons
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
  if (unused) {
    selectedSkills.value.push({ level: 1, skillId: unused.value })
  }
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

function armorName(armorId: string) {
  const record = defaultSnapshot.catalog.armors.find(item => String(item.ref.id) === armorId)
  return record ? (getLocalizedName(record, locale) ?? armorId) : armorId
}

function placedDecorationName(solution: BuildSolution) {
  return solution.decorations.map(placement => String(placement.decoration.ref.id)).join(', ')
}

onBeforeUnmount(() => worker?.terminate())
</script>

<template>
  <main class="min-h-screen bg-base color-base">
    <div class="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
      <header class="mb-9 flex flex-col gap-5 border-b border-base pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div class="flex items-start gap-4">
          <span class="app-logo mt-1 h-10 w-10 shrink-0 text-primary" role="img" aria-label="Monster Hunter Rise logo" />
          <div>
            <div class="mb-3 flex items-center gap-3">
              <DisplayBadge color="orange" variant="subtle">
                Monster Hunter Rise
              </DisplayBadge>
              <span class="text-xs uppercase tracking-widest color-tertiary">Sunbreak</span>
            </div>
            <h1 class="text-4xl font-700 tracking-tight">
              Build Planner
            </h1>
            <p class="mt-3 max-w-2xl text-base color-secondary">
              Find legal builds from your weapon and target skills, ranked by total defense.
            </p>
          </div>
        </div>
        <div class="flex items-center justify-between gap-4 sm:justify-end">
          <span class="font-mono text-xs color-tertiary">{{ defaultSnapshot.catalog.armors.length }} armors · {{ defaultSnapshot.catalog.skills.length }} skills</span>
          <ActionButton
            size="sm"
            variant="text"
            :icon="isDark ? 'i-ph:sun' : 'i-ph:moon'"
            :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
            @click="toggleTheme"
          />
        </div>
      </header>

      <section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="rounded-xl border border-base bg-elevated p-6 shadow-sm">
          <div class="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 class="text-xl font-600">
                Search a build
              </h2>
              <p class="mt-1 text-sm color-secondary">
                Choose a weapon and add the skill levels you need.
              </p>
            </div>
            <span class="i-ph:sliders-horizontal text-xl color-tertiary" aria-hidden="true" />
          </div>

          <div class="grid gap-5 md:grid-cols-2">
            <FormField label="Weapon" required description="Only weapons with at least one slot are listed.">
              <FormCombobox v-model="selectedWeaponId" :options="weaponOptions" placeholder="Search weapons…" class="w-full" />
            </FormField>
            <div class="flex items-end">
              <div class="rounded-lg bg-base px-4 py-3 text-sm color-secondary md:w-full">
                <span class="i-ph:info mr-2 align-middle color-primary" aria-hidden="true" />
                Search runs in a background Worker, so the page stays responsive.
              </div>
            </div>
          </div>

          <div class="mt-7 border-t border-base pt-6">
            <div class="mb-4 flex items-center justify-between">
              <div>
                <h3 class="font-600">
                  Target skills
                </h3>
                <p class="mt-1 text-sm color-secondary">
                  Set a minimum level for each skill. Add as many as you need.
                </p>
              </div>
              <ActionButton size="sm" icon="i-ph:plus" :disabled="running" @click="addSkill">
                Add skill
              </ActionButton>
            </div>

            <div v-if="selectedSkills.length === 0" class="rounded-lg border border-dashed border-base px-4 py-8 text-center text-sm color-tertiary">
              No target skills yet. Add one to start configuring your build.
            </div>
            <div v-else class="space-y-3">
              <div v-for="(skill, index) in selectedSkills" :key="index" class="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_8rem_auto]">
                <FormField :label="index === 0 ? 'Skill' : undefined">
                  <FormCombobox v-model="skill.skillId" :options="skillOptions" placeholder="Search skills…" :disabled="running" class="w-full" />
                </FormField>
                <FormField :label="index === 0 ? 'Level' : undefined">
                  <FormNumberInput v-model="skill.level" :min="1" :max="maxSkillLevel(skill.skillId)" :disabled="running" controls />
                </FormField>
                <ActionButton size="sm" variant="text" icon="i-ph:trash" :disabled="running" aria-label="Remove skill" @click="removeSkill(index)" />
              </div>
            </div>
          </div>

          <div class="mt-7 flex flex-wrap items-center gap-3 border-t border-base pt-6">
            <ActionButton variant="primary" :loading="running" :disabled="!canSearch" icon="i-ph:magnifying-glass" @click="startSearch">
              {{ running ? 'Calculating…' : 'Find builds' }}
            </ActionButton>
            <ActionButton v-if="running" variant="text" icon="i-ph:stop" @click="cancelSearch">
              Cancel
            </ActionButton>
            <span v-if="!canSearch && !running" class="text-sm color-tertiary">Choose a weapon and at least one skill.</span>
          </div>
        </div>

        <aside class="space-y-4">
          <div class="rounded-xl border border-base bg-elevated p-5">
            <div class="mb-3 flex items-center gap-2">
              <span class="i-ph:timer text-lg text-primary" aria-hidden="true" />
              <h2 class="font-600">
                Search status
              </h2>
            </div>
            <template v-if="running && progress">
              <div class="flex items-center justify-between text-sm">
                <span>{{ progress.stage === 'generating' ? 'Generating augmentation variants' : 'Searching legal combinations' }}</span>
                <span class="font-mono color-secondary">{{ progress.current }} / {{ progress.total }}</span>
              </div>
              <div class="mt-3 h-2 overflow-hidden rounded-full bg-base">
                <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${progressPercent}%` }" />
              </div>
              <p class="mt-3 text-xs color-tertiary">
                {{ progressPercent }}% · You can cancel at any time.
              </p>
            </template>
            <p v-else-if="running" class="text-sm color-secondary">
              Starting the calculation worker…
            </p>
            <p v-else-if="progress" class="text-sm color-secondary">
              The last search is complete.
            </p>
            <p v-else class="text-sm color-tertiary">
              Progress will appear here once a search starts.
            </p>
          </div>

          <div class="rounded-xl border border-base bg-elevated p-5 text-sm color-secondary">
            <div class="mb-2 flex items-center gap-2 color-base">
              <span class="i-ph:shield-check text-lg text-primary" aria-hidden="true" />
              <h2 class="font-600">
                Ranking
              </h2>
            </div>
            <p>Results prioritize total defense while preserving skill, slot, and augmentation constraints.</p>
          </div>
        </aside>
      </section>

      <section class="mt-8">
        <div class="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 class="text-2xl font-600">
              Results
            </h2>
            <p class="mt-1 text-sm color-secondary">
              {{ solutions.length ? `${solutions.length} candidate builds found` : 'Run a search to see candidate builds here.' }}
            </p>
          </div>
          <DisplayBadge v-if="solutions.length" color="green" variant="subtle" icon="i-ph:check-circle">
            Ready
          </DisplayBadge>
        </div>

        <div v-if="errorMessage" class="mb-4 rounded-lg border border-red/30 bg-red/10 px-4 py-3 text-sm text-red-600 dark:text-red-300" role="alert">
          <span class="i-ph:warning mr-2 align-middle" aria-hidden="true" />{{ errorMessage }}
        </div>

        <div v-if="solutions.length" class="grid gap-4 xl:grid-cols-2">
          <article v-for="solution in solutions" :key="solution.id" class="rounded-xl border border-base bg-elevated p-5 shadow-sm">
            <div class="flex items-start justify-between gap-4 border-b border-base pb-4">
              <div>
                <p class="text-xs uppercase tracking-widest color-tertiary">
                  {{ solution.id }}
                </p>
                <h3 class="mt-1 text-lg font-600">
                  {{ weaponName(String(solution.weapon.ref.id)) }}
                </h3>
              </div>
              <div class="text-right">
                <p class="text-xs color-tertiary">
                  Total defense
                </p>
                <p class="font-mono text-2xl font-700 text-primary">
                  {{ solution.defense }}
                </p>
              </div>
            </div>
            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <div v-for="slot in armorSlots" :key="slot" class="rounded-lg bg-base px-3 py-2">
                <p class="text-xs color-tertiary">
                  {{ slot }}
                </p>
                <p class="mt-1 truncate text-sm" :title="armorName(String(solution.armor[slot].base.ref.id))">
                  {{ armorName(String(solution.armor[slot].base.ref.id)) }}
                </p>
              </div>
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              <DisplayBadge v-for="skill in solution.skills" :key="skill.skillId" color="blue" variant="subtle">
                {{ skillName(String(skill.skillId)) }} Lv.{{ skill.level }}
              </DisplayBadge>
            </div>
            <p v-if="placedDecorationName(solution)" class="mt-4 text-xs color-tertiary">
              Decoration IDs: {{ placedDecorationName(solution) }}
            </p>
          </article>
        </div>
        <div v-else class="rounded-xl border border-dashed border-base bg-elevated px-6 py-16 text-center">
          <span class="i-ph:compass text-4xl color-tertiary" aria-hidden="true" />
          <p class="mt-3 text-sm color-secondary">
            No results yet
          </p>
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
