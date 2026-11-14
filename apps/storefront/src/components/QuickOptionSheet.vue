<script setup lang="ts">
// Quick option sheet (3-3): pick one SKU + quantity for a multi-option product
// without leaving the grid. Desktop modal, mobile bottom sheet.
import { ref, computed, watch } from 'vue'
import { OmModal, OmBottomSheet, OmQuantityStepper, OmPrice, OmButton, useToast, useBreakpoint } from '@olmoa/ui'
import { useCartStore } from '../stores/cart'

const props = defineProps<{ product: any; skus: any[] }>()
const open = defineModel<boolean>('open', { default: false })
const cart = useCartStore()
const toast = useToast()
const { isDesktop } = useBreakpoint()

const skuId = ref<string | null>(null)
const qty = ref(1)
const chosen = computed(() => props.skus.find((s) => s.id === skuId.value) || null)
const ceiling = computed(() => (chosen.value ? Math.max(1, Number(chosen.value.stock_quantity) || 1) : 1))

watch(open, (v) => {
  if (v) {
    const first = props.skus.find((s) => Number(s.stock_quantity) > 0) || null
    skuId.value = first ? first.id : null
    qty.value = 1
  }
})
watch(skuId, () => { qty.value = 1 })

function optionLabel(s: any): string {
  try {
    const obj = typeof s.option_combination_json === 'string' ? JSON.parse(s.option_combination_json) : (s.option_combination_json || {})
    const parts = Object.entries(obj).map(([k, v]) => `${k}: ${v}`)
    return parts.length ? parts.join(' / ') : '기본'
  } catch {
    return '기본'
  }
}

function add() {
  if (!chosen.value) return
  const ok = cart.addItem(props.product, chosen.value, Math.min(qty.value, ceiling.value))
  if (ok) {
    toast.success('장바구니에 담았습니다', { title: props.product?.title })
    open.value = false
  } else {
    toast.error('장바구니에 담지 못했습니다. 품절 여부를 확인해 주세요.')
  }
}
</script>

<template>
  <component :is="isDesktop ? OmModal : OmBottomSheet" v-model:open="open" title="옵션 선택" data-testid="quick-sheet">
    <div class="space-y-3">
      <p class="truncate text-sm font-bold text-ink">{{ product?.title }}</p>
      <div role="radiogroup" aria-label="옵션 선택" class="space-y-2">
        <button
          v-for="s in skus"
          :key="s.id"
          type="button"
          role="radio"
          :aria-checked="skuId === s.id"
          :disabled="Number(s.stock_quantity) <= 0"
          data-testid="quick-sku"
          class="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
          :class="skuId === s.id ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-line-strong'"
          @click="skuId = s.id"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ optionLabel(s) }}</span>
            <span v-if="Number(s.stock_quantity) <= 0" class="text-xs text-ink-subtle">품절</span>
          </span>
          <OmPrice :sale="Number(s.sale_price)" :original="Number(s.original_price)" size="card" />
        </button>
      </div>
      <div class="flex items-center justify-between gap-3">
        <OmQuantityStepper v-model="qty" :stock="ceiling" />
        <OmPrice :sale="chosen ? Number(chosen.sale_price) * Math.min(qty, ceiling) : 0" :original="null" size="card" />
      </div>
      <OmButton variant="primary" size="lg" class="w-full" data-testid="quick-confirm" :disabled="!chosen" @click="add">
        장바구니 담기
      </OmButton>
    </div>
  </component>
</template>
