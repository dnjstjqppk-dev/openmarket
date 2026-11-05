<script setup lang="ts">
// Loading placeholder. variant: text (n lines) | rect | circle | card (product card) | row (table rows).
withDefaults(defineProps<{ variant?: 'text' | 'rect' | 'circle' | 'card' | 'row'; lines?: number; height?: string; count?: number }>(), { variant: 'text', lines: 3, height: 'h-32', count: 1 })
</script>

<template>
  <div role="status" aria-live="polite" aria-label="불러오는 중" class="contents">
    <template v-for="n in count" :key="n">
      <div v-if="variant === 'text'" class="flex w-full flex-col gap-2">
        <span v-for="l in lines" :key="l" :class="['om-skeleton-bg block h-3.5 animate-shimmer rounded-sm', l === lines ? 'w-2/3' : 'w-full']" />
      </div>
      <span v-else-if="variant === 'rect'" :class="['om-skeleton-bg block w-full animate-shimmer rounded', height]" />
      <span v-else-if="variant === 'circle'" class="om-skeleton-bg block h-10 w-10 animate-shimmer rounded-full" />
      <div v-else-if="variant === 'card'" class="flex flex-col gap-3">
        <span class="om-skeleton-bg block aspect-square w-full animate-shimmer rounded-lg" />
        <span class="om-skeleton-bg block h-3.5 w-full animate-shimmer rounded-sm" />
        <span class="om-skeleton-bg block h-3.5 w-2/3 animate-shimmer rounded-sm" />
        <span class="om-skeleton-bg block h-5 w-1/3 animate-shimmer rounded-sm" />
      </div>
      <div v-else class="flex items-center gap-4 border-b border-line-divider py-3">
        <span class="om-skeleton-bg block h-4 w-1/6 animate-shimmer rounded-sm" />
        <span class="om-skeleton-bg block h-4 flex-1 animate-shimmer rounded-sm" />
        <span class="om-skeleton-bg block h-4 w-1/6 animate-shimmer rounded-sm" />
      </div>
    </template>
    <span class="sr-only">불러오는 중</span>
  </div>
</template>
