<script setup lang="ts">
// One star + one-decimal average + review count. Renders nothing with zero reviews.
import { Star } from 'lucide-vue-next'
import { ratingVisible } from '../commerce'

const props = withDefaults(defineProps<{ avg?: number | null; count?: number | null }>(), { avg: null, count: 0 })
</script>

<template>
  <span v-if="ratingVisible(count)" class="inline-flex items-center gap-1 text-xs">
    <Star class="h-3.5 w-3.5 fill-rating text-rating" aria-hidden="true" />
    <span class="font-semibold text-ink om-num">{{ Number(avg).toFixed(1) }}</span>
    <span class="text-ink-muted om-num">({{ count }})</span>
  </span>
</template>
