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
  disabled?: boolean
  maxVisible?: number
}>(), {
  maxVisible: 80,
  placeholder: 'Search…',
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
</script>

<template>
  <ComboboxRoot v-model="model" :disabled="disabled" @update:open="(open) => !open && (query = '')">
    <ComboboxAnchor
      v-bind="$attrs"
      class="text-sm px-3 border border-base rounded-md bg-raised inline-flex gap-2 h-10 w-full transition items-center data-[disabled]:op50 data-[disabled]:pointer-events-none focus-within:ring-2 focus-within:ring-primary-500/40"
    >
      <span class="i-ph:magnifying-glass op-fade shrink-0" aria-hidden="true" />
      <ComboboxInput
        :placeholder="placeholder"
        class="color-base outline-none bg-transparent flex-1 min-w-0 placeholder:op-mute"
        @update:model-value="query = $event"
      />
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        :side-offset="6"
        class="p-1 border border-base rounded-lg bg-glass:75 min-w-[--reka-combobox-trigger-width] max-h-80 shadow-lg z-dropdown"
        data-af-animate
      >
        <ComboboxViewport class="max-h-78 overflow-y-auto">
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
            No matches
          </ComboboxEmpty>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
