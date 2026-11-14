<script setup lang="ts">
// Selected option lines (3-4): per-line name, quantity stepper, amount and
// removal. Sold-out lines offer a restock alert instead of a quantity.
import { X } from 'lucide-vue-next'
import { OmQuantityStepper, formatNumber } from '@olmoa/ui'
import type { BuySelection } from './useBuySelection'

defineProps<{ sel: BuySelection }>()
</script>

<template>
  <ul v-if="sel.lines.length" class="divide-y divide-line-divider rounded-lg border border-line" aria-label="선택한 옵션">
    <li v-for="l in sel.lines" :key="l.sku.id" class="space-y-2 p-3">
      <div class="flex items-start justify-between gap-3">
        <p class="min-w-0 flex-1 text-sm text-ink">
          {{ Object.values(l.sku.options || {}).join(' / ') || '기본' }}
        </p>
        <button
          type="button"
          aria-label="선택 옵션 삭제"
          class="rounded p-1 text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          @click="sel.removeLine(l.sku.id)"
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div v-if="Number(l.sku.stock_quantity) > 0" class="flex items-center justify-between gap-3">
        <OmQuantityStepper :model-value="l.qty" :stock="Number(l.sku.stock_quantity)" @update:model-value="sel.setQty(l.sku.id, $event)" />
        <p class="text-md font-bold tabular-nums text-ink">
          {{ formatNumber(sel.lineTotalOf(l)) }}원
          <span v-if="sel.tierPctOf(l) > 0" class="ml-1 align-middle text-2xs font-semibold text-accent">수량 {{ sel.tierPctOf(l) }}% 적용</span>
        </p>
      </div>
      <div v-else class="flex items-center justify-between gap-3">
        <p class="text-sm text-ink-subtle">품절된 옵션입니다</p>
        <button
          v-if="!sel.restocked.has(l.sku.id)"
          type="button"
          class="h-9 rounded-lg border border-line px-3 text-sm font-bold text-ink hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          @click="sel.subscribeRestock(l.sku.id)"
        >
          재입고 알림 받기
        </button>
        <p v-else class="text-sm text-ink-muted">알림 신청됨</p>
      </div>
    </li>
  </ul>
</template>
