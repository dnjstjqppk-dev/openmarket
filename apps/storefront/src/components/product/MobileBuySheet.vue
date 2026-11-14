<script setup lang="ts">
// Mobile buy sheet (3-4): options, selected lines, total and actions in one
// bottom sheet. Shares the view's BuySelection with the desktop panel.
import { OmBottomSheet, OmButton, formatNumber } from '@olmoa/ui'
import OptionSteps from './OptionSteps.vue'
import SelectedOptionList from './SelectedOptionList.vue'
import type { BuySelection } from './useBuySelection'

defineProps<{ product: any; sel: BuySelection }>()
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <OmBottomSheet v-model="open" title="구매하기" data-testid="buy-sheet">
    <div class="space-y-4">
      <p class="truncate text-sm font-bold text-ink">{{ product?.title }}</p>
      <OptionSteps v-if="sel.attributes.length" :sel="sel" :base-min="0" />
      <SelectedOptionList v-if="sel.lines.length" :sel="sel" />
      <div class="flex items-baseline justify-between border-t border-line-divider pt-3">
        <span class="text-sm font-medium text-ink">총 상품금액</span>
        <span class="text-xl font-bold tabular-nums text-ink">{{ formatNumber(sel.total) }}원</span>
      </div>
    </div>
    <template #footer>
      <div class="flex gap-2">
        <OmButton variant="outline" size="lg" class="flex-1" :disabled="!sel.buyableLines.length" @click="sel.addAllToCart(); open = false">장바구니 담기</OmButton>
        <OmButton variant="primary" size="lg" class="flex-1" :disabled="!sel.buyableLines.length" @click="sel.buyNow()">바로구매</OmButton>
      </div>
    </template>
  </OmBottomSheet>
</template>
