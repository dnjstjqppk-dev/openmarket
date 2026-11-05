<script setup lang="ts">
export interface Crumb { label: string; to?: string }
defineProps<{ items: Crumb[] }>()
</script>

<template>
  <nav aria-label="현재 위치" class="min-w-0">
    <ol class="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-ink-muted">
      <li v-for="(c, i) in items" :key="i" class="flex min-w-0 items-center gap-1.5">
        <RouterLink v-if="c.to && i < items.length - 1" :to="c.to" class="truncate hover:text-ink hover:underline">{{ c.label }}</RouterLink>
        <span v-else :aria-current="i === items.length - 1 ? 'page' : undefined" :class="['truncate', i === items.length - 1 ? 'font-semibold text-ink' : '']">{{ c.label }}</span>
        <span v-if="i < items.length - 1" aria-hidden="true" class="text-ink-subtle">/</span>
      </li>
    </ol>
  </nav>
</template>
