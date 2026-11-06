<script setup lang="ts">
// The OLMOA mark (same drawing as the shell header). Decorative: the surrounding link/heading carries the name.
withDefaults(defineProps<{ size?: number }>(), { size: 30 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
    <rect width="32" height="32" rx="9" class="fill-primary" />
    <circle cx="16" cy="16" r="7.5" fill="none" stroke="white" stroke-width="3" />
    <circle cx="22.5" cy="9.5" r="2.5" class="fill-highlight" />
  </svg>
</template>
