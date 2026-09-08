<script setup lang="ts">
import type { ArmorSlot } from '@mhrise-build/core'
import type { SearchSelectOption } from './search-select.vue'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import { useI18n } from 'vue-i18n'
import SearchSelect from './search-select.vue'
import TalismanFilter from './talisman-filter.vue'
import { armorSlots } from '../planner-types'
import type { TalismanFilterStorage } from '../storage'

defineProps<{
  armorOptionsBySlot: Readonly<Record<ArmorSlot, SearchSelectOption[]>>
  disabled: boolean
  hasArmorFilters: boolean
  skillOptions: SearchSelectOption[]
  weaponOptions: SearchSelectOption[]
}>()

const selectedWeaponId = defineModel<string>('weaponId', { required: true })
const selectedTalismanFilter = defineModel<TalismanFilterStorage>('talismanFilter', { required: true })
const selectedArmorIds = defineModel<Record<ArmorSlot, string[]>>('armorIds', { required: true })
const emit = defineEmits<{
  clearArmor: []
}>()
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-base font-600">
        {{ t('ui.equipment') }}
      </h2>
      <ActionButton size="sm" variant="text" :disabled="disabled || !hasArmorFilters" @click="emit('clearArmor')">
        {{ t('ui.clearArmor') }}
      </ActionButton>
    </div>
    <div class="space-y-2">
      <div class="gear-row">
        <img src="/armor/weapon.png" :alt="t('ui.weapon')" class="h-7 w-7 object-contain">
        <SearchSelect
          v-model="selectedWeaponId"
          :disabled="disabled"
          clearable
          :clear-label="`${t('ui.clearSelection')}: ${t('ui.weapon')}`"
          :options="weaponOptions"
          :placeholder="t('ui.searchWeapons')"
          :empty-text="t('ui.noMatches')"
          :aria-label="t('ui.weapon')"
          required
        />
      </div>
      <div v-for="slot in armorSlots" :key="slot" class="gear-row">
        <img
          :src="`/armor/${slot}.png`"
          :alt="t(`slot.${slot}`)"
          class="h-7 w-7 object-contain"
        >
        <SearchSelect
          :model-value="selectedArmorIds[slot][0] ?? ''"
          clearable
          :options="armorOptionsBySlot[slot]"
          :placeholder="t('ui.searchArmor')"
          :empty-text="t('ui.noMatches')"
          :disabled="disabled"
          :aria-label="t(`slot.${slot}`)"
          :clear-label="`${t('ui.clearSelection')}: ${t(`slot.${slot}`)}`"
          @update:model-value="selectedArmorIds[slot] = $event ? [$event] : []"
        />
      </div>
      <div class="gear-row">
        <img src="/armor/talisman.png" :alt="t('ui.talisman')" class="h-7 w-7 object-contain">
        <TalismanFilter v-model:filter="selectedTalismanFilter" :disabled="disabled" :skill-options="skillOptions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.gear-row {
  display: grid;
  grid-template-columns: 1.75rem minmax(0, 1fr);
  align-items: start;
  gap: 0.5rem;
}

.gear-row > img {
  margin-top: 0.375rem;
}
</style>
