<script setup lang="ts">
import type { SearchSelectOption } from './search-select.vue'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import FormField from '@antfu/design/components/Form/FormField.vue'
import FormNumberInput from '@antfu/design/components/Form/FormNumberInput.vue'
import { useI18n } from 'vue-i18n'
import SearchSelect from './search-select.vue'
import type { EquipmentStats, SkillSelection } from '../planner-types'
import { equipmentStatKeys } from '../planner-types'

const { maxSkillLevel } = defineProps<{
  disabled: boolean
  equipmentStats: EquipmentStats
  maxSkillLevel: (skillId: string) => number
  skillOptions: SearchSelectOption[]
}>()

const selectedSkills = defineModel<SkillSelection[]>('skills', { required: true })
const emit = defineEmits<{
  addSkill: []
}>()
const { t } = useI18n({ useScope: 'global' })

function removeSkill(index: number) {
  selectedSkills.value.splice(index, 1)
}

function selectSkill(skill: SkillSelection, skillId: string | undefined) {
  if (!skillId)
    return

  skill.skillId = skillId
  skill.level = maxSkillLevel(skillId)
}
</script>

<template>
  <div class="skills-panel min-w-0">
    <dl class="mb-5 min-h-9 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2" :aria-label="t('ui.equipmentStats')" aria-live="polite">
      <div v-for="stat in equipmentStatKeys" :key="stat" class="flex items-center gap-1.5" :title="t(`stat.${stat}`)">
        <dt class="flex items-center">
          <img :src="`/stats/${stat}.png`" :alt="t(`stat.${stat}`)" class="h-5 w-5 object-contain">
        </dt>
        <dd class="m-0 text-sm font-600 tabular-nums" :class="equipmentStats[stat] < 0 ? 'text-red-600 dark:text-red-300' : 'color-base'">
          {{ equipmentStats[stat] }}
        </dd>
      </div>
    </dl>
    <div class="mb-4 flex shrink-0 items-center justify-between">
      <h2 class="text-base font-600">
        {{ t('ui.targetSkills') }}
      </h2>
      <ActionButton size="sm" icon="i-ph:plus" :disabled="disabled" @click="emit('addSkill')">
        {{ t('ui.addSkill') }}
      </ActionButton>
    </div>

    <div v-if="selectedSkills.length === 0" class="rounded-md border border-dashed border-base px-4 py-6 text-center text-sm color-tertiary">
      {{ t('ui.addSkillRequirement') }}
    </div>
    <div v-else class="planner-scroll skill-list space-y-3" role="region" :aria-label="t('ui.targetSkills')" tabindex="0">
      <div v-for="(skill, index) in selectedSkills" :key="index" class="skill-row grid items-end gap-3">
        <FormField :label="index === 0 ? t('ui.skill') : undefined">
          <SearchSelect
            :model-value="skill.skillId"
            :options="skillOptions"
            :placeholder="t('ui.searchSkills')"
            :empty-text="t('ui.noMatches')"
            :disabled="disabled"
            @update:model-value="selectSkill(skill, $event)"
          />
        </FormField>
        <FormField :label="index === 0 ? t('ui.level') : undefined">
          <FormNumberInput v-model="skill.level" class="planner-control" :min="1" :max="maxSkillLevel(skill.skillId)" :disabled="disabled" controls />
        </FormField>
        <ActionButton size="sm" variant="text" class="h-10 w-10 justify-center p-0" icon="i-ph:trash" :disabled="disabled" :aria-label="t('ui.removeSkill')" @click="removeSkill(index)" />
      </div>
    </div>
  </div>
</template>
