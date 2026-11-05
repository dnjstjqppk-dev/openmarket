<script setup lang="ts">
// Image avatar with initials fallback (no stock photos).
import { ref, computed } from 'vue'
const props = withDefaults(defineProps<{ src?: string | null; name?: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; square?: boolean }>(), { size: 'md', square: false })
const failed = ref(false)
const initials = computed(() => (props.name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())
</script>

<template>
  <span
    :class="[
      'inline-flex shrink-0 items-center justify-center overflow-hidden bg-primary-soft font-bold text-primary-soft-ink',
      square ? 'rounded' : 'rounded-full',
      { xs: 'h-6 w-6 text-2xs', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg', xl: 'h-20 w-20 text-2xl' }[size]
    ]"
    :aria-label="name"
    role="img"
  >
    <img v-if="src && !failed" :src="src" :alt="name || ''" class="h-full w-full object-cover" loading="lazy" @error="failed = true" />
    <span v-else aria-hidden="true">{{ initials }}</span>
  </span>
</template>
