<script setup lang="ts">
// Collapsible multi-condition search area for consoles.
import { ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ title?: string; startOpen?: boolean }>(), { title: '검색 조건', startOpen: true })
const open = ref(props.startOpen)
</script>

<template>
  <section class="rounded-lg border border-line bg-surface">
    <button
      type="button"
      :aria-expanded="open"
      class="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      @click="open = !open"
    >
      {{ title }}
      <span class="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted">
        {{ open ? '접기' : '펼치기' }}
        <ChevronDown class="h-4 w-4 transition-transform" :class="open ? 'rotate-180' : ''" aria-hidden="true" />
      </span>
    </button>
    <div v-show="open" class="border-t border-line-divider px-4 py-3">
      <slot />
      <div class="mt-3 flex justify-end gap-2">
        <slot name="actions" />
      </div>
    </div>
  </section>
</template>
