<script setup lang="ts">
import type { SearchSelectOption } from './search-select.vue'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import FormField from '@antfu/design/components/Form/FormField.vue'
import FormNumberInput from '@antfu/design/components/Form/FormNumberInput.vue'
import { useI18n } from 'vue-i18n'
import SearchSelect from './search-select.vue'
import type { TalismanFilterStorage } from '../storage'

defineProps<{
  disabled: boolean
  skillOptions: SearchSelectOption[]
}>()

const filter = defineModel<TalismanFilterStorage>('filter', { required: true })
const { t } = useI18n({ useScope: 'global' })

function clearFilter() {
  filter.value.firstSkillId = ''
  filter.value.firstSkillLevel = 1
  filter.value.secondSkillId = ''
  filter.value.secondSkillLevel = 1
  filter.value.slots = [0, 0, 0]
}
</script>

<template>
  <div class="mt-4 border-t border-base pt-4">
    <div class="mb-3 flex items-center justify-between gap-3">
      <h3 class="text-sm font-600">
        {{ t('ui.talisman') }}
      </h3>
      <ActionButton size="sm" variant="text" :disabled="disabled" @click="clearFilter">
        {{ t('ui.clearTalisman') }}
      </ActionButton>
    </div>
    <div class="space-y-3">
      <div class="talisman-skill-row grid grid-cols-[minmax(0,1fr)_5rem] items-end gap-2">
        <FormField :label="t('ui.talismanSkill1')">
          <SearchSelect
            v-model="filter.firstSkillId"
            :options="skillOptions"
            :placeholder="t('ui.searchTalismanSkill')"
            :empty-text="t('ui.noMatches')"
            :disabled="disabled"
            clearable
            :clear-label="`${t('ui.clearSelection')}: ${t('ui.talismanSkill1')}`"
          />
        </FormField>
        <FormField :label="t('ui.level')">
          <FormNumberInput v-model="filter.firstSkillLevel" class="planner-control" :min="1" :max="10" :disabled="disabled" controls />
        </FormField>
      </div>
      <div class="talisman-skill-row grid grid-cols-[minmax(0,1fr)_5rem] items-end gap-2">
        <FormField :label="t('ui.talismanSkill2')">
          <SearchSelect
            v-model="filter.secondSkillId"
            :options="skillOptions"
            :placeholder="t('ui.searchTalismanSkill')"
            :empty-text="t('ui.noMatches')"
            :disabled="disabled"
            clearable
            :clear-label="`${t('ui.clearSelection')}: ${t('ui.talismanSkill2')}`"
          />
        </FormField>
        <FormField :label="t('ui.level')">
          <FormNumberInput v-model="filter.secondSkillLevel" class="planner-control" :min="1" :max="10" :disabled="disabled" controls />
        </FormField>
      </div>
      <div>
        <span class="mb-1 block text-xs color-secondary">{{ t('ui.talismanSlots') }}</span>
        <div class="grid grid-cols-3 gap-2">
          <FormNumberInput v-for="(_, index) in filter.slots" :key="index" v-model="filter.slots[index]" class="planner-control" :aria-label="`${t('ui.talismanSlots')} ${index + 1}`" :min="0" :max="4" :disabled="disabled" controls />
        </div>
      </div>
    </div>
  </div>
</template>
