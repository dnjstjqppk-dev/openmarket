<script setup lang="ts">
// Bulk action bar (4-2): appears when console rows are selected. Count plus
// caller-provided action buttons; the caller clears the selection.
defineProps<{ count: number }>()
const emit = defineEmits<{ clear: [] }>()
</script>

<template>
  <div
    v-if="count > 0"
    class="sticky bottom-4 z-sticky flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-lg"
    role="toolbar"
    aria-label="선택 항목 일괄 처리"
  >
    <span class="om-num text-xs font-bold text-ink">{{ count }}개 선택</span>
    <span class="h-5 w-px bg-line-divider" aria-hidden="true" />
    <slot />
    <button
      type="button"
      class="ml-auto rounded-lg px-2 py-1 text-xs font-bold text-ink-muted hover:bg-surface-2 hover:text-ink"
      @click="emit('clear')"
    >
      선택 해제
    </button>
  </div>
</template>
