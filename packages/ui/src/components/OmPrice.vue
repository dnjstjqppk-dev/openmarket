<script setup lang="ts">
// Price block: struck list price above, then discount rate (accent) + final
// price (near-black). The rate shows only when the list price is really higher.
import { computed } from 'vue'
import { formatKrw } from '../format'
import { priceDisplayLines } from '../commerce'

const props = withDefaults(defineProps<{
  original?: number | null
  sale: number
  size?: 'card' | 'detail' | 'total'
  formatPrice?: (n: number) => string
}>(), { size: 'card' })
const fmt = computed(() => props.formatPrice ?? formatKrw)
const lines = computed(() => priceDisplayLines(props.original ?? null, props.sale))
const finalCls = computed(() => ({ card: 'om-price-card', detail: 'om-price-final', total: 'om-price-total' })[props.size])
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <span v-if="lines.list !== null" class="om-price-list text-ink-subtle">{{ fmt(lines.list) }}</span>
    <span class="flex flex-wrap items-baseline gap-x-1.5">
      <span v-if="lines.rate !== null" class="text-md font-bold text-discount om-num">{{ lines.rate }}%</span>
      <span :class="['text-price', finalCls]">{{ fmt(lines.final) }}</span>
    </span>
  </div>
</template>
