<script setup lang="ts">
import type { AppLocale } from '@mhrise-build/data'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import { LOCALE_LABEL, SUPPORTED_LOCALES } from '@mhrise-build/data'
import { useI18n } from 'vue-i18n'

defineProps<{
  isDark: boolean
}>()

const locale = defineModel<AppLocale>('locale', { required: true })
const emit = defineEmits<{
  toggleTheme: []
}>()
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <header class="mb-7 flex items-center justify-between border-b border-base pb-5">
    <div class="flex items-center gap-3">
      <span class="app-logo h-9 w-9 text-primary" role="img" aria-label="Monster Hunter Rise logo" />
      <h1 class="text-xl font-600 tracking-tight">
        MHRise Build Calculator
      </h1>
    </div>
    <div class="flex items-center gap-3">
      <label class="sr-only" for="locale-select">{{ t('ui.language') }}</label>
      <div class="relative">
        <select
          id="locale-select"
          v-model="locale"
          class="planner-control min-w-32 appearance-none border pl-3 pr-9 text-sm color-base outline-none focus:ring-2 focus:ring-primary-500/40"
        >
          <option v-for="supportedLocale in SUPPORTED_LOCALES" :key="supportedLocale" :value="supportedLocale">
            {{ LOCALE_LABEL[supportedLocale] }}
          </option>
        </select>
        <span class="pointer-events-none absolute right-2.5 top-1/2 i-ph:caret-down translate-y-[-50%] color-secondary" aria-hidden="true" />
      </div>
      <ActionButton
        size="sm"
        variant="text"
        class="h-9 w-9 justify-center p-0"
        :icon="isDark ? 'i-ph:sun' : 'i-ph:moon'"
        :aria-label="isDark ? t('ui.switchToLight') : t('ui.switchToDark')"
        @click="emit('toggleTheme')"
      />
    </div>
  </header>
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
