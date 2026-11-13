<script setup lang="ts">
// Progress bar for measured ratios only (deal sell-through etc). Hidden without a value.
import { soldoutPct } from '../commerce'

const props = withDefaults(defineProps<{ sold?: number | null; allocated?: number | null; tone?: 'urgent' | 'primary' | 'success' }>(), { tone: 'urgent' })
</script>

<template>
  <div
    v-if="soldoutPct(sold, allocated) !== null"
    class="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
    role="progressbar"
    :aria-valuenow="soldoutPct(sold, allocated)!"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div
      class="h-full rounded-full transition-[width]"
      :class="{ urgent: 'bg-urgent', primary: 'bg-primary', success: 'bg-success' }[tone]"
      :style="{ width: `${soldoutPct(sold, allocated)}%` }"
    />
  </div>
</template>
