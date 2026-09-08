<script setup lang="ts">
import type { BuildSolution } from '@mhrise-build/core'
import { useI18n } from 'vue-i18n'
import BuildResult from './build-result.vue'

defineProps<{
  errorMessage: string
  solutions: BuildSolution[]
}>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <section class="mt-8">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-lg font-600">
        {{ t('ui.results') }}
      </h2>
      <span v-if="solutions.length" class="text-sm color-secondary">{{ solutions.length }} {{ t('ui.builds') }}</span>
    </div>

    <div v-if="errorMessage" class="mb-3 rounded-md border border-red/30 bg-red/10 px-4 py-3 text-sm text-red-600 dark:text-red-300" role="alert">
      {{ errorMessage }}
    </div>

    <div v-if="solutions.length" class="space-y-3">
      <BuildResult v-for="(solution, index) in solutions" :key="index" :solution="solution" :index="index" />
    </div>
    <div v-else class="rounded-lg border border-dashed border-base px-4 py-12 text-center text-sm color-tertiary">
      {{ t('ui.noResults') }}
    </div>
  </section>
</template>
