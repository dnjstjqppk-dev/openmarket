<script setup lang="ts">
// Applied-filter chips with a clear-all action. Renders nothing without chips.
import { X } from 'lucide-vue-next'

export interface FilterChip { key: string; label: string }
defineProps<{ chips: FilterChip[] }>()
const emit = defineEmits<{ remove: [key: string]; clear: [] }>()
</script>

<template>
  <div v-if="chips.length" class="flex flex-wrap items-center gap-2">
    <span
      v-for="c in chips"
      :key="c.key"
      class="inline-flex h-8 items-center gap-1 rounded-full bg-surface-3 pl-3 pr-1.5 text-xs font-semibold text-ink"
    >
      {{ c.label }}
      <button type="button" :aria-label="`${c.label} 해제`" class="rounded-full p-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" @click="emit('remove', c.key)">
        <X class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
    <button type="button" class="h-8 rounded-full border border-line px-3 text-xs font-bold text-ink-muted hover:bg-surface-2" @click="emit('clear')">
      전체 초기화
    </button>
  </div>
</template>
