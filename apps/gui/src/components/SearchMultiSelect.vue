<script setup lang="ts">
import type { SearchSelectOption } from './SearchSelect.vue'
import { ComboboxAnchor, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxItemIndicator, ComboboxPortal, ComboboxRoot, ComboboxViewport } from 'reka-ui'
import { computed, ref } from 'vue'

const props = defineProps<{
  options: SearchSelectOption[]
  label: string
  placeholder: string
  emptyText: string
  removeLabel: string
  clearLabel: string
  disabled?: boolean
}>()
const model = defineModel<string[]>({ required: true })
const query = ref('')
const labels = computed(() => new Map(props.options.map(option => [option.value, option.label])))
const visibleOptions = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return props.options.filter(option => !search || option.label.toLocaleLowerCase().includes(search)).slice(0, 80)
})

function remove(value: string) {
  model.value = model.value.filter(id => id !== value)
}
</script>

<template>
  <div class="min-w-0">
    <ComboboxRoot v-model="model" multiple open-on-click :disabled="disabled" @update:open="(open) => !open && (query = '')" @update:model-value="query = ''">
      <ComboboxAnchor class="h-10 flex items-center gap-2 rounded-md border border-base bg-raised px-3 text-sm focus-within:ring-2 focus-within:ring-primary-500/40 data-[disabled]:pointer-events-none data-[disabled]:op50">
        <span class="i-ph:magnifying-glass shrink-0 op-fade" aria-hidden="true" />
        <ComboboxInput :aria-label="label" :placeholder="placeholder" class="min-w-0 flex-1 bg-transparent color-base outline-none placeholder:op-mute" @update:model-value="query = $event" />
        <button v-if="model.length" type="button" class="h-7 w-7 flex shrink-0 items-center justify-center rounded hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary-500/40" :disabled="disabled" :aria-label="`${clearLabel}: ${label}`" @pointerdown.stop @click.stop="model = []; query = ''">
          <span class="i-ph:x" aria-hidden="true" />
        </button>
      </ComboboxAnchor>
      <ComboboxPortal>
        <ComboboxContent position="popper" :side-offset="6" class="z-dropdown max-h-80 min-w-[--reka-combobox-trigger-width] rounded-lg border border-base bg-glass:75 p-1 shadow-lg">
          <ComboboxViewport class="max-h-78 overflow-y-auto">
            <ComboboxItem v-for="option in visibleOptions" :key="option.value" :value="option.value" :text-value="option.label" class="flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-hover">
              <span class="flex-1 truncate">{{ option.label }}</span>
              <ComboboxItemIndicator class="i-ph:check-bold shrink-0 color-active" />
            </ComboboxItem>
            <ComboboxEmpty class="px-2 py-2 text-center text-sm op-fade">
              {{ emptyText }}
            </ComboboxEmpty>
          </ComboboxViewport>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
    <div v-if="model.length" class="mt-1.5 flex flex-wrap gap-1">
      <span v-for="id in model" :key="id" class="inline-flex max-w-full items-center gap-1 rounded bg-raised pl-2 text-xs">
        <span class="truncate">{{ labels.get(id) ?? id }}</span>
        <button type="button" class="h-7 w-7 flex shrink-0 items-center justify-center rounded hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary-500/40" :disabled="disabled" :aria-label="`${removeLabel}: ${labels.get(id) ?? id}`" @click="remove(id)">
          <span class="i-ph:x" aria-hidden="true" />
        </button>
      </span>
    </div>
  </div>
</template>
