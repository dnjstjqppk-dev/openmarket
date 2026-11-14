<script setup lang="ts">
// One seller's cart box (3-5): group select, store link, direct badge, coupon
// entry, lines with option change, and the goods+shipping=order footer.
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Minus, Plus, Store, Trash2, X } from 'lucide-vue-next'
import { OmCheckbox, OmIconButton, OmCommerceBadge, useToast, userErrorMessage, formatNumber } from '@olmoa/ui'
import FreeShipGauge from './FreeShipGauge.vue'
import QuickOptionSheet from '../QuickOptionSheet.vue'
import { useCartStore, type PartnerCartGroup, type CartItem } from '../../stores/cart'
import { lineTotal, volumeDiscountPct } from '../../lib/pricing'
import { API_BASE_URL } from '../../config'
import { ref } from 'vue'

const props = defineProps<{
  group: PartnerCartGroup
  repriced: Record<string, { from: number; to: number }>
}>()

const cart = useCartStore()
const toast = useToast()

const selectedCount = computed(() => props.group.items.filter((i) => cart.isSelected(i.sku_id)).length)
const allOn = computed(() => props.group.items.length > 0 && selectedCount.value === props.group.items.length)
function toggleGroup(on: boolean) {
  for (const it of props.group.items) cart.setSelected(it.sku_id, on)
}

function setQty(it: CartItem, q: number) {
  const max = it.stock_quantity ?? Number.MAX_SAFE_INTEGER
  cart.updateQuantity(it.sku_id, Math.min(max, Math.max(1, Math.floor(Number(q) || 1))))
}
function remove(it: CartItem) {
  cart.removeItem(it.sku_id)
  toast.success('장바구니에서 삭제했습니다.', { title: it.title })
}

// ---- option change: the quick sheet in replace mode -----------------------------------------------
const sheetOpen = ref(false)
const sheetProduct = ref<any>(null)
const sheetSkus = ref<any[]>([])
const replaceSkuId = ref<string | null>(null)
async function changeOption(it: CartItem) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(it.product_id)}`)
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '옵션을 불러오지 못했습니다')
    const skus = Array.isArray(json.data?.skus) ? json.data.skus : []
    if (skus.length <= 1) {
      toast.success('변경할 수 있는 다른 옵션이 없습니다.')
      return
    }
    sheetProduct.value = json.data
    sheetSkus.value = skus
    replaceSkuId.value = it.sku_id
    sheetOpen.value = true
  } catch (e: any) {
    toast.error(userErrorMessage(e, '옵션을 불러오지 못했습니다'))
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-line bg-surface" :aria-label="`${group.partner_name} 상품`">
    <header class="flex flex-wrap items-center justify-between gap-2 border-b border-line-divider bg-surface-2 px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <OmCheckbox :model-value="allOn" :indeterminate="!allOn && selectedCount > 0" :aria-label="`${group.partner_name} 상품 전체 선택`" @update:model-value="toggleGroup(!!$event)" />
        <RouterLink v-if="group.partner_id !== '__unknown_seller__'" :to="`/store/${group.partner_id}`" class="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink hover:underline">
          <Store class="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <span class="truncate">{{ group.partner_name }}</span>
        </RouterLink>
        <span v-else class="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Store class="h-4 w-4 text-ink-muted" aria-hidden="true" />{{ group.partner_name }}
        </span>
        <OmCommerceBadge v-if="group.sales_model === 'DIRECT'" kind="direct" />
      </div>
      <RouterLink to="/coupons" class="shrink-0 text-xs font-bold text-primary hover:underline">스토어 쿠폰 받기</RouterLink>
    </header>

    <ul class="divide-y divide-line-divider">
      <li v-for="it in group.items" :key="it.sku_id" class="flex gap-3 p-4">
        <OmCheckbox class="mt-1 shrink-0" :model-value="cart.isSelected(it.sku_id)" :aria-label="`${it.title} 선택`" @update:model-value="cart.setSelected(it.sku_id, !!$event)" />
        <RouterLink :to="`/product/${it.product_id}`" class="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-line bg-surface-2 sm:h-24 sm:w-24">
          <img :src="it.thumbnail_url" :alt="it.title" class="h-full w-full object-cover" loading="lazy" decoding="async" />
        </RouterLink>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <RouterLink :to="`/product/${it.product_id}`" class="line-clamp-2 text-sm font-medium text-ink hover:underline">{{ it.title }}</RouterLink>
              <p class="mt-0.5 text-xs text-ink-muted">
                {{ it.option_summary }}
                <button type="button" class="ml-1 font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" @click="changeOption(it)">옵션 변경</button>
              </p>
              <p v-if="repriced[it.sku_id]" class="mt-0.5 text-xs text-info">
                가격이 변경되었습니다 (이전 {{ formatNumber(repriced[it.sku_id].from) }}원 → {{ formatNumber(repriced[it.sku_id].to) }}원)
              </p>
            </div>
            <OmIconButton :label="`${it.title} 삭제`" size="sm" @click="remove(it)"><X class="h-4 w-4" /></OmIconButton>
          </div>
          <div class="mt-3 flex flex-wrap items-end justify-between gap-2">
            <div class="flex items-center gap-2">
              <div class="flex items-center rounded-md border border-line">
                <OmIconButton label="수량 줄이기" size="sm" :disabled="it.quantity <= 1" @click="setQty(it, it.quantity - 1)"><Minus class="h-4 w-4" /></OmIconButton>
                <input :value="it.quantity" type="number" min="1" :max="it.stock_quantity" :aria-label="`${it.title} 수량`" class="h-8 w-12 border-x border-line bg-transparent text-center text-sm tabular-nums text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" @change="setQty(it, Number(($event.target as HTMLInputElement).value))" />
                <OmIconButton label="수량 늘리기" size="sm" :disabled="it.stock_quantity != null && it.quantity >= it.stock_quantity" @click="setQty(it, it.quantity + 1)"><Plus class="h-4 w-4" /></OmIconButton>
              </div>
              <span v-if="volumeDiscountPct(it.quantity)" class="text-xs text-accent">수량 할인 {{ volumeDiscountPct(it.quantity) }}%</span>
            </div>
            <div class="text-right">
              <p class="text-md font-bold tabular-nums text-ink">{{ formatNumber(lineTotal(it.price, it.quantity)) }}원</p>
              <p v-if="volumeDiscountPct(it.quantity)" class="text-2xs text-ink-subtle line-through">{{ formatNumber(it.price * it.quantity) }}원</p>
            </div>
          </div>
        </div>
      </li>
    </ul>

    <footer class="space-y-3 border-t border-line-divider bg-surface-2 px-4 py-3">
      <p class="text-right text-sm tabular-nums text-ink">
        {{ formatNumber(group.goods_amount) }}원 + 배송비 {{ group.shipping_fee ? `${formatNumber(group.shipping_fee)}원` : '무료' }} = {{ formatNumber(group.goods_amount + group.shipping_fee) }}원
      </p>
      <FreeShipGauge :goods="group.goods_amount" :threshold="group.free_shipping_threshold" :partner-id="group.partner_id" />
    </footer>

    <QuickOptionSheet v-model:open="sheetOpen" :product="sheetProduct" :skus="sheetSkus" :replace-sku-id="replaceSkuId" />
  </section>
</template>
