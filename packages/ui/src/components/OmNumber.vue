<script setup lang="ts">
// Tabular number with optional up/down delta (▲ green / ▼ red).
const props = withDefaults(defineProps<{ value: string | number; delta?: number | null }>(), { delta: null })
</script>

<template>
  <span class="om-num inline-flex items-baseline gap-1">
    <slot>{{ value }}</slot>
    <span v-if="delta !== null && delta !== 0" :class="['text-xs font-semibold', delta > 0 ? 'text-success' : 'text-danger']">
      {{ delta > 0 ? '▲' : '▼' }}{{ Math.abs(delta) }}
    </span>
  </span>
</template>
