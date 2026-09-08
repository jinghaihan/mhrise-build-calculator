<script setup lang="ts">
import type { ArmorVariant, BuildSolution, DecorationPlacement, SkillValue } from '@mhrise-build/core'
import { defaultSnapshot, getLocalizedName } from '@mhrise-build/data'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { armorSkillChanges, equipmentRows, summarizeDecorations } from '../result-details'

const props = defineProps<{ solution: BuildSolution, index: number }>()
const { locale, t } = useI18n({ useScope: 'global' })
const rows = computed(() => equipmentRows(props.solution))
const jewels = computed(() => summarizeDecorations(props.solution.decorations))
const elements = ['fire', 'water', 'thunder', 'ice', 'dragon'] as const
const totalResistances = computed(() => Object.fromEntries(elements.map(element => [element, resistanceTotal(element)])))

function resistanceTotal(element: typeof elements[number]): number {
  return Object.values(props.solution.armor).reduce((total, armor) => total + armor.resistances[element], 0)
}

function name(kind: 'armors' | 'weapons' | 'skills' | 'decorations', id: string): string {
  const record = defaultSnapshot.catalog[kind].find(record => record.ref.id === id)
  return record ? getLocalizedName(record, locale.value, 'en') ?? t('result.unknown') : t('result.unknown')
}

function hostName(host: DecorationPlacement['host']): string {
  return t(host === 'weapon' || host === 'talisman' ? `ui.${host}` : `slot.${host}`)
}

function equipmentName(row: typeof rows.value[number]): string {
  if (row.armor)
    return name('armors', row.armor.base.ref.id)
  return row.host === 'weapon' ? name('weapons', props.solution.weapon.ref.id) : t('ui.talisman')
}

function skillText(skills: readonly SkillValue[]): string {
  return skills.filter(skill => skill.level > 0).map(skill => `${name('skills', skill.skillId)} Lv.${skill.level}`).join(' · ')
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function changeClass(value: number): string {
  if (value < 0)
    return 'text-red-600 dark:text-red-300'
  if (value > 0)
    return 'text-green-700 dark:text-green-300'
  return 'color-secondary'
}

function resistanceChanges(armor: ArmorVariant) {
  return elements.map(element => ({
    element,
    before: armor.base.baseResistances?.[element] ?? 0,
    after: armor.resistances[element],
    delta: armor.resistances[element] - (armor.base.baseResistances?.[element] ?? 0),
  })).filter(change => change.delta !== 0)
}
</script>

<template>
  <details class="build-result rounded-lg border border-base" :open="index === 0">
    <summary class="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-4 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary-500/40 sm:px-5">
      <span class="result-chevron i-ph:caret-right shrink-0 color-secondary" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-600">#{{ index + 1 }} · {{ name('weapons', solution.weapon.ref.id) }}</h3>
        <p class="mt-1 text-xs color-secondary">{{ t('result.decorationCount', { count: solution.decorations.length }) }}</p>
      </div>
      <div class="text-right">
        <p class="text-xs color-secondary">{{ t('ui.defense') }}</p>
        <p class="text-xl font-600 tabular-nums">{{ solution.defense }}</p>
      </div>
    </summary>

    <div class="border-t border-base px-4 pb-5 sm:px-5">
      <dl class="flex flex-wrap gap-x-5 gap-y-2 py-3" :aria-label="t('result.finalResistances')">
        <div v-for="element in elements" :key="element" class="flex items-center gap-1.5">
          <dt><img :src="`/stats/${element}.png`" :alt="t(`stat.${element}`)" width="18" height="18"></dt>
          <dd class="text-sm tabular-nums" :class="totalResistances[element] < 0 ? 'text-red-600 dark:text-red-300' : ''">{{ totalResistances[element] }}</dd>
        </div>
      </dl>

      <div class="result-column-head border-b border-base pb-2 text-xs color-secondary" aria-hidden="true">
        <span>{{ t('ui.equipment') }}</span><span>{{ t('result.augmentation') }}</span><span>{{ t('result.socketPlacement') }}</span>
      </div>
      <div v-for="row in rows" :key="row.host" class="result-gear-row border-b border-base py-3">
        <div class="min-w-0 flex items-start gap-2.5">
          <img :src="`/armor/${row.host}.png`" :alt="hostName(row.host)" width="24" height="24" class="shrink-0 object-contain">
          <div class="min-w-0">
            <h4 class="text-sm font-600">{{ equipmentName(row) }}</h4>
            <p class="mt-1 text-xs color-secondary">{{ skillText(row.skills) || t('result.noSkills') }}</p>
            <p class="mt-1 text-xs color-secondary">{{ t('result.slots') }} <span class="font-mono">{{ row.slots.join('–') }}</span></p>
          </div>
        </div>

        <div class="min-w-0 text-xs leading-relaxed">
          <template v-if="row.armor">
            <template v-if="row.armor.augmentation && (row.armor.augmentation.componentIds?.length ?? 1) > 0">
              <div class="augmentation-heading">
                <img src="/qurious/qurious.png" :alt="t('result.augmentation')" class="qurious-icon" width="28" height="28">
                <span class="font-600">{{ t('result.augmentation') }}</span>
                <span class="ml-auto color-secondary">{{ t('result.rolls', { count: row.armor.augmentation.componentIds?.length ?? 0 }) }}</span>
              </div>
              <div class="change-list">
                <span v-for="change in armorSkillChanges(row.armor)" :key="change.skillId" class="change-chip" :class="changeClass(change.level)">
                  <span>{{ name('skills', change.skillId) }}</span>
                  <strong>{{ signed(change.level) }}</strong>
                </span>
                <span v-if="row.armor.augmentation.slotUpgrades" class="change-chip color-base">
                  <span>{{ t('result.slots') }}</span>
                  <strong>{{ row.armor.base.slots.join('–') }} → {{ row.slots.join('–') }}</strong>
                </span>
                <span v-if="row.armor.defense !== row.armor.base.baseDefense" class="change-chip" :class="changeClass(row.armor.defense - row.armor.base.baseDefense)">
                  <span>{{ t('ui.defense') }}</span>
                  <strong>{{ signed(row.armor.defense - row.armor.base.baseDefense) }}</strong>
                </span>
                <span v-for="change in resistanceChanges(row.armor)" :key="change.element" class="change-chip" :class="changeClass(change.delta)">
                  <span>{{ t(`stat.${change.element}`) }}</span>
                  <strong>{{ signed(change.delta) }}</strong>
                </span>
              </div>
              <p class="mt-2 color-secondary">
                {{ t('result.cost', { used: row.armor.augmentation.cost, budget: row.armor.base.costBudget }) }}
              </p>
            </template>
            <span v-else class="color-secondary">{{ t('result.noAugmentation') }}</span>
          </template>
          <span v-else class="color-tertiary">—</span>
        </div>

        <div class="space-y-1 text-xs">
          <template v-for="socket in row.sockets" :key="socket.index">
            <p v-if="socket.level > 0" class="flex items-baseline gap-2">
              <span class="socket-marker" :data-level="socket.level" :title="t('result.socket', { index: socket.index + 1, level: socket.level })">
                <span class="socket-gem" aria-hidden="true" />
                <span class="font-mono">{{ socket.level }}</span>
              </span>
              <span :class="socket.decoration ? '' : 'color-secondary'">{{ socket.decoration ? name('decorations', socket.decoration.ref.id) : t('result.emptySocket') }}</span>
            </p>
          </template>
          <p v-if="row.slots.every(level => level === 0)" class="color-secondary">{{ t('result.noSockets') }}</p>
        </div>
      </div>

      <section class="mt-4" :aria-label="t('result.requiredDecorations')">
        <h4 class="text-sm font-600">{{ t('result.requiredDecorations') }}</h4>
        <ul v-if="jewels.length" class="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <li v-for="jewel in jewels" :key="jewel.decoration.ref.id">
            <span class="decoration-summary">
              <span class="socket-marker" :data-level="jewel.decoration.slotLevel" :title="t('result.decorationSlot', { level: jewel.decoration.slotLevel })">
                <span class="socket-gem" aria-hidden="true" />
                <span class="font-mono">{{ jewel.decoration.slotLevel }}</span>
              </span>
              <span>{{ name('decorations', jewel.decoration.ref.id) }}</span>
              <strong class="tabular-nums">× {{ jewel.count }}</strong>
            </span>
          </li>
        </ul>
        <p v-else class="mt-2 text-sm color-secondary">{{ t('result.noDecorations') }}</p>
      </section>
      <section class="mt-4" :aria-label="t('result.finalSkills')">
        <h4 class="text-sm font-600">{{ t('result.finalSkills') }}</h4>
        <p class="mt-2 text-sm color-secondary">{{ skillText(solution.skills) }}</p>
      </section>
    </div>
  </details>
</template>

<style scoped>
summary::-webkit-details-marker { display: none; }
details[open] > summary .result-chevron { transform: rotate(90deg); }
.result-column-head { display: none; }
.result-gear-row { display: grid; gap: 0.75rem; }
.augmentation-heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
}
.qurious-icon {
  width: 1.75rem;
  height: 1.75rem;
  object-fit: contain;
  filter: drop-shadow(0 0 0.3rem rgb(255 211 104 / 18%));
}
.change-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.5rem;
}
.change-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--planner-control-border);
  border-radius: 999px;
  padding: 0.2rem 0.5rem;
  background: var(--planner-control-bg);
}
.socket-marker {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 2rem;
  color: var(--planner-primary, #6969a8);
  font-size: 0.75rem;
  font-weight: 600;
}
.socket-gem {
  display: inline-block;
  width: 0.7rem;
  height: 0.7rem;
  border: 1px solid currentColor;
  border-radius: 35% 65% 55% 45%;
  background: currentColor;
  box-shadow: inset 0.12rem 0.08rem rgb(255 255 255 / 42%);
  transform: rotate(45deg);
}
.socket-marker[data-level="1"] { color: #8a8f9d; }
.socket-marker[data-level="2"] { color: #4c9ab1; }
.socket-marker[data-level="3"] { color: #9f75c7; }
.socket-marker[data-level="4"] { color: #d28d3f; }
.decoration-summary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
@media (min-width: 768px) {
  .result-column-head,
  .result-gear-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.9fr);
    gap: 1.25rem;
  }
}
</style>
