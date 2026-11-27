<script setup lang="ts">
// Commerce badges (Meridian 2.0): sleek pill tags with 4-language reactive labels.
import { uiT } from '../composables/useUiLocale'

type Kind = 'free-ship' | 'today' | 'tomorrow' | 'coupon' | 'point' | 'direct' | 'deal' | 'soldout' | 'new'
withDefaults(defineProps<{ kind: Kind; label?: string }>(), { label: '' })
const meta: Record<Kind, { text: string; cls: string }> = {
  'free-ship': { text: '무료배송', cls: 'bg-success-soft text-ship-free' },
  today: { text: '오늘출발', cls: 'bg-info-soft text-ship-fast' },
  tomorrow: { text: '내일출발', cls: 'bg-info-soft text-ship-fast' },
  coupon: { text: '쿠폰', cls: 'bg-primary-soft text-benefit' },
  point: { text: '적립', cls: 'bg-primary-soft text-benefit' },
  direct: { text: '직영', cls: 'bg-direct text-ink-inverse' },
  deal: { text: '특가', cls: 'bg-urgent-soft text-urgent' },
  soldout: { text: '품절', cls: 'bg-surface-3 text-soldout' },
  new: { text: '신상품', cls: 'bg-primary-soft text-primary-soft-ink' }
}
</script>

<template>
  <span :class="['inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-2xs font-bold tracking-tight', meta[kind].cls]">
    {{ label ? uiT(label) : uiT(meta[kind].text) }}
  </span>
</template>
