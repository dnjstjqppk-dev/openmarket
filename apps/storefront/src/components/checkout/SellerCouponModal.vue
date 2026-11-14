<script setup lang="ts">
// Per-seller coupon picker (3-6): the buyer's unused store holdings for one
// seller, defaulting to the best-combination pick. Server re-validates.
import { OmModal, OmButton, formatNumber } from '@olmoa/ui'

defineProps<{ sellerName: string; holdings: any[] }>()
const picked = defineModel<string | null>({ default: null })
const open = defineModel<boolean>('open', { default: false })

function label(c: any): string {
  const amount = c.discount_type === 'PERCENT'
    ? `${c.discount_value}%${c.max_discount_amount ? ` (최대 ${formatNumber(c.max_discount_amount)}원)` : ''}`
    : `${formatNumber(c.discount_value)}원`
  const min = Number(c.min_order_amount) > 0 ? ` · ${formatNumber(c.min_order_amount)}원 이상` : ''
  return `${c.title || c.code} · ${amount}${min}`
}
</script>

<template>
  <OmModal v-model:open="open" :title="`${sellerName} 쿠폰`" data-testid="seller-coupon-modal">
    <div v-if="!holdings.length" class="py-4 text-center text-sm text-ink-muted">사용할 수 있는 스토어 쿠폰이 없습니다</div>
    <div v-else role="radiogroup" aria-label="스토어 쿠폰 선택" class="space-y-2">
      <button
        type="button"
        role="radio"
        :aria-checked="picked === null"
        class="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        :class="picked === null ? 'border-primary bg-primary-soft font-bold' : 'border-line hover:border-line-strong'"
        @click="picked = null; open = false"
      >
        사용 안 함
      </button>
      <button
        v-for="c in holdings"
        :key="c.user_coupon_id"
        type="button"
        role="radio"
        :aria-checked="picked === c.user_coupon_id"
        class="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        :class="picked === c.user_coupon_id ? 'border-primary bg-primary-soft font-bold' : 'border-line hover:border-line-strong'"
        @click="picked = c.user_coupon_id; open = false"
      >
        <span class="min-w-0 flex-1">{{ label(c) }}</span>
        <span v-if="c.code" class="shrink-0 text-2xs text-ink-subtle">{{ c.code }}</span>
      </button>
    </div>
    <template #footer>
      <OmButton variant="outline" class="w-full" @click="open = false">닫기</OmButton>
    </template>
  </OmModal>
</template>
