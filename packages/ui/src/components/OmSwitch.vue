<script setup lang="ts">
// Toggle. `loading` shows the pending state while the server confirms (the value only flips after success).
const model = defineModel<boolean>({ default: false })
withDefaults(defineProps<{ label?: string; description?: string; disabled?: boolean; loading?: boolean }>(), { disabled: false, loading: false })
</script>

<template>
  <label :class="['inline-flex items-center gap-3 select-none', disabled || loading ? 'cursor-not-allowed' : 'cursor-pointer']">
    <button
      type="button"
      role="switch"
      :aria-checked="model"
      :aria-busy="loading || undefined"
      :disabled="disabled || loading"
      :class="[
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration ease-om',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50',
        model ? 'bg-primary' : 'bg-surface-3 ring-1 ring-inset ring-line-strong'
      ]"
      @click="model = !model"
    >
      <span :class="['absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration ease-om', model ? 'translate-x-[22px]' : 'translate-x-0.5', loading ? 'animate-pulse' : '']" />
    </button>
    <span v-if="label" class="flex flex-col">
      <span class="text-md text-ink">{{ label }}</span>
      <span v-if="description" class="text-xs text-ink-muted">{{ description }}</span>
    </span>
  </label>
</template>
