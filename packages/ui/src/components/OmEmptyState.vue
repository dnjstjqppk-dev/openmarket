<script setup lang="ts">
// "Nothing here yet" (Meridian 2.0) — states the real situation; actions slot for the next step.
import { uiT } from '../composables/useUiLocale'

withDefaults(defineProps<{ title: string; description?: string; compact?: boolean }>(), { compact: false })
</script>

<template>
  <div :class="['flex flex-col items-center text-center', compact ? 'gap-2.5 py-8' : 'gap-3.5 py-16']" role="status">
    <div :class="['flex items-center justify-center rounded-2xl border border-line bg-surface-2 text-ink-subtle shadow-sm', compact ? 'h-12 w-12' : 'h-16 w-16']">
      <slot name="icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
      </slot>
    </div>
    <p :class="['font-bold text-ink', compact ? 'text-md' : 'text-lg']">{{ uiT(title) }}</p>
    <p v-if="description" class="max-w-sm text-sm text-ink-muted">{{ uiT(description) }}</p>
    <div v-if="$slots.default" class="mt-2 flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>
