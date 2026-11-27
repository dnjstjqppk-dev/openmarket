<script setup lang="ts">
// Status tabs with per-status counts.
export interface StatusTab { value: string; label: string; count?: number | null }
defineProps<{ tabs: StatusTab[] }>()
const active = defineModel<string>({ default: '' })
</script>

<template>
  <div class="flex gap-1 overflow-x-auto om-scrollbar-none" role="tablist" aria-label="상태별 보기">
    <button
      v-for="tb in tabs"
      :key="tb.value"
      type="button"
      role="tab"
      :aria-selected="active === tb.value"
      :class="['flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', active === tb.value ? 'bg-secondary text-secondary-on' : 'bg-surface-3 text-ink-muted hover:text-ink']"
      @click="active = tb.value"
    >
      {{ tb.label }}
      <span v-if="tb.count !== null && tb.count !== undefined" class="om-num rounded-full bg-overlay/10 px-1.5 py-0.5 text-2xs whitespace-nowrap">{{ tb.count }}</span>
    </button>
  </div>
</template>
