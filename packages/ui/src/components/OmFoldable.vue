<script setup lang="ts">
// Long detail body folded with a gradient and an expand button.
import { ref } from 'vue'

withDefaults(defineProps<{ maxHeight?: number; moreLabel?: string; lessLabel?: string }>(), {
  maxHeight: 1200,
  moreLabel: '상세정보 펼쳐보기',
  lessLabel: '접기'
})
const open = ref(false)
</script>

<template>
  <div>
    <div class="relative overflow-hidden transition-[max-height] duration-slow ease-om" :style="open ? undefined : { maxHeight: `${maxHeight}px` }">
      <slot />
      <div
        v-if="!open"
        class="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-surface via-surface/85 to-transparent"
        aria-hidden="true"
      />
    </div>
    <button
      type="button"
      :aria-expanded="open"
      class="mt-2 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-surface-2 active:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      @click="open = !open"
    >
      {{ open ? lessLabel : moreLabel }}
    </button>
  </div>
</template>
