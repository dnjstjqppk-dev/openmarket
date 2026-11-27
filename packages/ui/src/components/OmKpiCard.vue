<script setup lang="ts">
// Metric card (Meridian 2.0): figure, delta pill, link to the list, per-card error state, 4-language labels.
import { RouterLink } from 'vue-router'
import { uiT } from '../composables/useUiLocale'

withDefaults(defineProps<{
  label: string
  value: string
  delta?: number | null
  deltaSuffix?: string
  to?: string | null
  error?: string | null
  loading?: boolean
}>(), { delta: null, deltaSuffix: '', to: null, error: null, loading: false })
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <component
    :is="to && !error ? RouterLink : 'div'"
    :to="to ?? undefined"
    :class="[
      'group block rounded-2xl border border-line bg-surface p-4 sm:p-5 shadow-sm transition-all duration-fast ease-om',
      to && !error ? 'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus' : ''
    ]"
  >
    <p class="text-xs font-semibold text-ink-muted group-hover:text-ink transition-colors">{{ uiT(label) }}</p>
    <div v-if="loading" class="mt-2 h-8 w-24 animate-pulse rounded-md bg-surface-3" :aria-label="uiT('불러오는 중')" />
    <p v-else-if="error" class="mt-2 text-sm font-semibold text-danger">
      {{ uiT('불러오지 못함') }}
      <button type="button" class="ml-2 text-xs font-bold underline hover:no-underline" @click.stop.prevent="emit('retry')">{{ uiT('다시 시도') }}</button>
    </p>
    <p v-else class="om-num mt-1.5 text-2xl font-extrabold tracking-tight text-ink">{{ value }}</p>
    <p
      v-if="!loading && !error && delta !== null && delta !== 0"
      class="om-num mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-bold"
      :class="delta > 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'"
    >
      {{ delta > 0 ? '▲' : '▼' }} {{ Math.abs(delta) }}{{ deltaSuffix }}
    </p>
  </component>
</template>
