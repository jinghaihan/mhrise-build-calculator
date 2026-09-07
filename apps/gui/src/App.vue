<script setup lang="ts">
import type { ComboboxOption } from '@antfu/design/components/Form/FormCombobox.vue'
import type { BuildSolution, SkillValue } from '@mhrise-build-tools/core'
import type { BuildWorkerMessage, BuildWorkerProgress } from './workers/build.worker'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import DisplayBadge from '@antfu/design/components/Display/DisplayBadge.vue'
import FormCombobox from '@antfu/design/components/Form/FormCombobox.vue'
import FormField from '@antfu/design/components/Form/FormField.vue'
import FormNumberInput from '@antfu/design/components/Form/FormNumberInput.vue'
import { createWikiId } from '@mhrise-build-tools/core'
import { defaultSnapshot, getLocalizedName } from '@mhrise-build-tools/data'
import { computed, onBeforeUnmount, ref } from 'vue'

interface SkillSelection {
  level: number
  skillId: string
}

const armorSlots = ['head', 'chest', 'arms', 'waist', 'legs'] as const
const locale = 'zh'
const selectedWeaponId = ref('')
const selectedSkills = ref<SkillSelection[]>([])
const solutions = ref<BuildSolution[]>([])
const running = ref(false)
const errorMessage = ref('')
const progress = ref<BuildWorkerProgress>()
let worker: Worker | undefined

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
    errorMessage.value = event.message || '计算线程异常退出'
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
    <div class="mx-auto max-w-7xl px-6 py-10 lg:px-10">
      <header class="mb-10 flex flex-col gap-4 border-b border-base pb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div class="mb-3 flex items-center gap-3">
            <span class="i-ph:hammer-fill text-2xl text-primary" aria-hidden="true" />
            <DisplayBadge color="orange" variant="subtle">
              Monster Hunter Rise
            </DisplayBadge>
          </div>
          <h1 class="text-4xl font-700 tracking-tight">
            Build Tools
          </h1>
          <p class="mt-3 max-w-2xl text-base color-secondary">
            按照武器与目标技能检索合法配装，结果优先展示防御力更高的方案。
          </p>
        </div>
        <span class="font-mono text-sm color-tertiary">{{ defaultSnapshot.catalog.armors.length }} armors · {{ defaultSnapshot.catalog.skills.length }} skills</span>
      </header>

      <section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="rounded-xl border border-base bg-elevated p-6 shadow-sm">
          <div class="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 class="text-xl font-600">
                Find a build
              </h2>
              <p class="mt-1 text-sm color-secondary">
                选择一把武器，再添加需要达到的技能等级。
              </p>
            </div>
            <span class="i-ph:sliders-horizontal text-xl color-tertiary" aria-hidden="true" />
          </div>

          <div class="grid gap-5 md:grid-cols-2">
            <FormField label="武器" required description="只显示带有武器孔位的武器">
              <FormCombobox v-model="selectedWeaponId" :options="weaponOptions" placeholder="搜索武器名称…" class="w-full" />
            </FormField>
            <div class="flex items-end">
              <div class="rounded-lg bg-base px-4 py-3 text-sm color-secondary md:w-full">
                <span class="i-ph:info mr-2 align-middle color-primary" aria-hidden="true" />
                计算会在后台 Worker 中运行，页面不会被卡住。
              </div>
            </div>
          </div>

          <div class="mt-7 border-t border-base pt-6">
            <div class="mb-4 flex items-center justify-between">
              <div>
                <h3 class="font-600">
                  目标技能
                </h3>
                <p class="mt-1 text-sm color-secondary">
                  每个技能至少填写 1 级，可添加多个技能。
                </p>
              </div>
              <ActionButton size="sm" icon="i-ph:plus" :disabled="running" @click="addSkill">
                添加技能
              </ActionButton>
            </div>

            <div v-if="selectedSkills.length === 0" class="rounded-lg border border-dashed border-base px-4 py-8 text-center text-sm color-tertiary">
              还没有目标技能，点击“添加技能”开始配置。
            </div>
            <div v-else class="space-y-3">
              <div v-for="(skill, index) in selectedSkills" :key="index" class="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_8rem_auto]">
                <FormField :label="index === 0 ? '技能' : undefined">
                  <FormCombobox v-model="skill.skillId" :options="skillOptions" placeholder="搜索技能名称…" :disabled="running" class="w-full" />
                </FormField>
                <FormField :label="index === 0 ? '等级' : undefined">
                  <FormNumberInput v-model="skill.level" :min="1" :max="maxSkillLevel(skill.skillId)" :disabled="running" controls />
                </FormField>
                <ActionButton size="sm" variant="text" icon="i-ph:trash" :disabled="running" aria-label="移除技能" @click="removeSkill(index)" />
              </div>
            </div>
          </div>

          <div class="mt-7 flex flex-wrap items-center gap-3 border-t border-base pt-6">
            <ActionButton variant="primary" :loading="running" :disabled="!canSearch" icon="i-ph:magnifying-glass" @click="startSearch">
              {{ running ? '正在计算…' : '开始检索' }}
            </ActionButton>
            <ActionButton v-if="running" variant="text" icon="i-ph:stop" @click="cancelSearch">
              取消
            </ActionButton>
            <span v-if="!canSearch && !running" class="text-sm color-tertiary">请选择武器并至少添加一个技能。</span>
          </div>
        </div>

        <aside class="space-y-4">
          <div class="rounded-xl border border-base bg-elevated p-5">
            <div class="mb-3 flex items-center gap-2">
              <span class="i-ph:timer text-lg text-primary" aria-hidden="true" />
              <h2 class="font-600">
                计算状态
              </h2>
            </div>
            <template v-if="running && progress">
              <div class="flex items-center justify-between text-sm">
                <span>{{ progress.stage === 'generating' ? '生成炼成候选' : '搜索合法组合' }}</span>
                <span class="font-mono color-secondary">{{ progress.current }} / {{ progress.total }}</span>
              </div>
              <div class="mt-3 h-2 overflow-hidden rounded-full bg-base">
                <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${progressPercent}%` }" />
              </div>
              <p class="mt-3 text-xs color-tertiary">
                {{ progressPercent }}% · 可以随时取消本次计算
              </p>
            </template>
            <p v-else-if="running" class="text-sm color-secondary">
              正在启动计算线程…
            </p>
            <p v-else-if="progress" class="text-sm color-secondary">
              上次计算已完成。
            </p>
            <p v-else class="text-sm color-tertiary">
              配置完成后，计算进度会显示在这里。
            </p>
          </div>

          <div class="rounded-xl border border-base bg-elevated p-5 text-sm color-secondary">
            <div class="mb-2 flex items-center gap-2 color-base">
              <span class="i-ph:shield-check text-lg text-primary" aria-hidden="true" />
              <h2 class="font-600">
                排序规则
              </h2>
            </div>
            <p>结果会按防御力总数优先排序，并保留合法的技能、孔位与炼成约束。</p>
          </div>
        </aside>
      </section>

      <section class="mt-8">
        <div class="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 class="text-2xl font-600">
              结果
            </h2>
            <p class="mt-1 text-sm color-secondary">
              {{ solutions.length ? `找到 ${solutions.length} 个候选方案` : '完成一次检索后，候选方案会显示在这里。' }}
            </p>
          </div>
          <DisplayBadge v-if="solutions.length" color="green" variant="subtle" icon="i-ph:check-circle">
            可用
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
                  防御力总数
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
              装饰品 ID：{{ placedDecorationName(solution) }}
            </p>
          </article>
        </div>
        <div v-else class="rounded-xl border border-dashed border-base bg-elevated px-6 py-16 text-center">
          <span class="i-ph:compass text-4xl color-tertiary" aria-hidden="true" />
          <p class="mt-3 text-sm color-secondary">
            暂无结果
          </p>
        </div>
      </section>
    </div>
  </main>
</template>
