<script setup lang="ts">
import { ComboboxAnchor, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxItemIndicator, ComboboxPortal, ComboboxRoot, ComboboxViewport } from 'reka-ui'
import { computed, ref } from 'vue'

export interface SearchSelectOption {
  readonly disabled?: boolean
  readonly label: string
  readonly value: string
}

const props = withDefaults(defineProps<{
  options: SearchSelectOption[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  clearable?: boolean
  clearLabel?: string
  maxVisible?: number
}>(), {
  maxVisible: 80,
  emptyText: 'No matches',
  placeholder: 'Search…',
  clearLabel: 'Clear selection',
})

const model = defineModel<string>()
const query = ref('')

const visibleOptions = computed(() => {
  const normalizedQuery = query.value.trim().toLocaleLowerCase()
  const filtered = normalizedQuery
    ? props.options.filter(option => option.label.toLocaleLowerCase().includes(normalizedQuery))
    : props.options
  return filtered.slice(0, props.maxVisible)
})

function displayValue(value: unknown) {
  return props.options.find(option => option.value === String(value))?.label ?? ''
}
</script>

<template>
  <ComboboxRoot v-model="model" open-on-click :disabled="disabled" @update:open="(open) => !open && (query = '')">
    <ComboboxAnchor
      v-bind="$attrs"
      class="planner-control text-sm px-3 border inline-flex gap-2 w-full items-center data-[disabled]:op50 data-[disabled]:pointer-events-none focus-within:ring-2 focus-within:ring-primary-500/40"
    >
      <span class="i-ph:magnifying-glass op-fade shrink-0" aria-hidden="true" />
      <ComboboxInput
        :placeholder="placeholder"
        :display-value="displayValue"
        class="color-base outline-none bg-transparent flex-1 min-w-0 placeholder:op-mute"
        @update:model-value="query = $event"
      />
      <button v-if="clearable && model" type="button" class="h-7 w-7 flex shrink-0 items-center justify-center rounded hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary-500/40" :aria-label="clearLabel" :disabled="disabled" @pointerdown.stop @click.stop="model = ''; query = ''">
        <span class="i-ph:x" aria-hidden="true" />
      </button>
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        :side-offset="6"
        class="p-1 border border-base rounded-lg bg-glass:75 min-w-[--reka-combobox-trigger-width] max-h-80 shadow-lg z-dropdown"
        data-af-animate
      >
        <ComboboxViewport class="planner-scroll max-h-78 overflow-y-auto">
          <ComboboxItem
            v-for="option in visibleOptions"
            :key="option.value"
            :value="option.value"
            :text-value="option.label"
            :disabled="option.disabled"
            class="text-sm color-base px-2 py-2 outline-none rounded-md flex gap-2 cursor-pointer select-none transition items-center data-[highlighted]:bg-hover data-[disabled]:op50 data-[disabled]:pointer-events-none"
          >
            <span class="flex-1 truncate">{{ option.label }}</span>
            <ComboboxItemIndicator class="color-active inline-flex shrink-0 items-center">
              <span class="i-ph:check-bold" aria-hidden="true" />
            </ComboboxItemIndicator>
          </ComboboxItem>
          <ComboboxEmpty class="text-sm px-2 py-2 text-center op-fade">
            {{ emptyText }}
          </ComboboxEmpty>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
