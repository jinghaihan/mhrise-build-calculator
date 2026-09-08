<script setup lang="ts">
import type { ArmorVariant, BuildSolution, DecorationPlacement, SkillValue } from '@mhrise-build-tools/core'
import { defaultSnapshot, getLocalizedName } from '@mhrise-build-tools/data'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { armorSkillChanges, equipmentRows, summarizeDecorations } from '../result-details'

const props = defineProps<{ solution: BuildSolution, index: number }>()
const { locale, t } = useI18n({ useScope: 'global' })
const rows = computed(() => equipmentRows(props.solution))
const jewels = computed(() => summarizeDecorations(props.solution.decorations))
const elements = ['fire', 'water', 'thunder', 'ice', 'dragon'] as const
const totalResistances = computed(() => Object.fromEntries(elements.map(element => [element,
  Object.values(props.solution.armor).reduce((total, armor) => total + armor.resistances[element], 0),
])))

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
              <div v-for="change in armorSkillChanges(row.armor)" :key="change.skillId" :class="change.level < 0 ? 'text-red-600 dark:text-red-300' : 'color-base'">
                {{ name('skills', change.skillId) }} <span class="font-600">{{ signed(change.level) }}</span>
              </div>
              <p v-if="row.armor.augmentation.slotUpgrades">
                {{ t('result.slots') }} {{ row.armor.base.slots.join('–') }} → {{ row.slots.join('–') }}
              </p>
              <p v-if="row.armor.defense !== row.armor.base.baseDefense">
                {{ t('ui.defense') }} {{ row.armor.base.baseDefense }} → {{ row.armor.defense }} ({{ signed(row.armor.defense - row.armor.base.baseDefense) }})
              </p>
              <p v-for="change in resistanceChanges(row.armor)" :key="change.element" :class="change.delta < 0 ? 'text-red-600 dark:text-red-300' : ''">
                {{ t(`stat.${change.element}`) }} {{ change.before }} → {{ change.after }} ({{ signed(change.delta) }})
              </p>
              <p class="mt-1 color-secondary">
                {{ t('result.cost', { used: row.armor.augmentation.cost, budget: row.armor.base.costBudget }) }}
                <template v-if="row.armor.augmentation.componentIds"> · {{ t('result.rolls', { count: row.armor.augmentation.componentIds.length }) }}</template>
              </p>
            </template>
            <span v-else class="color-secondary">{{ t('result.noAugmentation') }}</span>
          </template>
          <span v-else class="color-tertiary">—</span>
        </div>

        <div class="space-y-1 text-xs">
          <template v-for="socket in row.sockets" :key="socket.index">
            <p v-if="socket.level > 0" class="flex items-baseline gap-2">
              <span class="shrink-0 font-mono color-secondary" :title="t('result.socket', { index: socket.index + 1, level: socket.level })">#{{ socket.index + 1 }} [{{ socket.level }}]</span>
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
            {{ name('decorations', jewel.decoration.ref.id) }} <span class="font-600 tabular-nums">× {{ jewel.count }}</span>
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
@media (min-width: 768px) {
  .result-column-head,
  .result-gear-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.9fr);
    gap: 1.25rem;
  }
}
</style>
