<script setup lang="ts">
// Metric card: figure, delta, link to the list, per-card error state.
import { RouterLink } from 'vue-router'

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
    :class="['block rounded-lg border border-line bg-surface p-4 transition-colors', to && !error ? 'hover:border-line-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus' : '']"
  >
    <p class="text-xs font-semibold text-ink-muted">{{ label }}</p>
    <div v-if="loading" class="mt-1 h-7 w-24 animate-pulse rounded bg-surface-3" aria-label="불러오는 중" />
    <p v-else-if="error" class="mt-1 text-sm font-semibold text-danger">
      불러오지 못함
      <button type="button" class="ml-2 text-xs font-bold underline hover:no-underline" @click.stop.prevent="emit('retry')">다시 시도</button>
    </p>
    <p v-else class="om-num mt-1 text-xl font-bold text-ink">{{ value }}</p>
    <p v-if="!loading && !error && delta !== null && delta !== 0" class="om-num mt-1 text-xs font-semibold" :class="delta > 0 ? 'text-success' : 'text-danger'">
      {{ delta > 0 ? '▲' : '▼' }}{{ Math.abs(delta) }}{{ deltaSuffix }}
    </p>
  </component>
</template>
