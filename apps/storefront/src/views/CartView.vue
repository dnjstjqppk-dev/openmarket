<script setup lang="ts">
// Cart (PHASE 2 redesign on @olmoa/ui).
//  - lines are grouped by seller, like the server splits the order; shipping per seller follows the server rule
//    (lib/pricing.ts). Only selected lines are ordered.
//  - signed in: the selected lines are priced by the server quote (same code path as checkout). Prices that
//    changed since the line was added are updated in the cart, and quote errors (sold out, product stopped,
//    not enough stock) are shown here instead of only at checkout.
//  - signed out: the summary is labelled an estimate.
// Removed: "공장 직발송 파격 할인" (the list-price gap is the seller's own list price, not an OLMOA discount),
// "올모아 100% 고객 안심 보장제", "30일 최저가 차액 자동 보상" (the real rule is a one-time credit on request when
// the same option's price drops within 30 days), the "최대 85% 할인 ... 빠른 배송이 보장되는" recommendation title
// and its HOT badges. That recommendation block also never rendered (it read the campaign response as an array).
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { Minus, Plus, ShoppingCart, Store, Trash2, X } from 'lucide-vue-next'
import { OmButton, OmIconButton, OmCheckbox, OmAlert, OmBadge, OmEmptyState, OmSpinner, useToast, formatNumber } from '@olmoa/ui'
import CheckoutSteps from '../components/CheckoutSteps.vue'
import ProductCard from '../components/ProductCard.vue'
import { useCartStore, type CartItem } from '../stores/cart'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { lineTotal, volumeDiscountPct } from '../lib/pricing'
import { fetchQuote, quotePrices, type Quote } from '../lib/quote'
import { API_BASE_URL } from '../config'

const cart = useCartStore()
const auth = useAuthStore()
const locale = useLocaleStore()
const router = useRouter()
const toast = useToast()

// ---- server quote for the selected lines ------------------------------------------------------------
const quote = ref<Quote | null>(null)
const quoteError = ref<string | null>(null)
const quoting = ref(false)
const repriced = ref<string[]>([])
let ctrl: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function scheduleQuote() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runQuote, 350)
}
async function runQuote() {
  ctrl?.abort()
  quote.value = null
  quoteError.value = null
  if (!auth.isAuthenticated || !cart.selectedItems.length) { quoting.value = false; return }
  const my = (ctrl = new AbortController())
  quoting.value = true
  try {
    const q = await fetchQuote({ items: cart.selectedItems.map((i) => ({ product_id: i.product_id, sku_id: i.sku_id, quantity: i.quantity })) }, my.signal)
    if (my.signal.aborted) return
    const changed = cart.applyServerPrices(quotePrices(q))
    if (changed.length) repriced.value = [...new Set([...repriced.value, ...changed.map((c) => c.sku_id)])]
    quote.value = q
  } catch (e: any) {
    if (my.signal.aborted || e?.name === 'AbortError') return
    quoteError.value = e?.message || '주문 금액을 확인하지 못했습니다'
  } finally {
    if (!my.signal.aborted) quoting.value = false
  }
}
const selectionKey = computed(() => cart.selectedItems.map((i) => `${i.sku_id}:${i.quantity}`).join(','))
watch([selectionKey, () => auth.isAuthenticated], scheduleQuote, { immediate: true })
onBeforeUnmount(() => { ctrl?.abort(); if (timer) clearTimeout(timer) })

// ---- summary: server numbers when available, otherwise the local estimate ----------------------------
const summary = computed(() => {
  if (quote.value) {
    return {
      goods: quote.value.total_goods_amount,
      volume: quote.value.volume_discount_amount,
      shipping: quote.value.total_shipping_amount,
      total: quote.value.total_goods_amount - quote.value.volume_discount_amount + quote.value.total_shipping_amount,
      sellers: quote.value.sub_orders.length,
      confirmed: true
    }
  }
  return {
    goods: cart.listGoodsAmount,
    volume: cart.volumeSavings,
    shipping: cart.shippingFee,
    total: cart.totalPayAmount,
    sellers: cart.selectedGroups.length,
    confirmed: false
  }
})
const selectedGroupById = computed(() => Object.fromEntries(cart.selectedGroups.map((g) => [g.partner_id, g])))

// ---- line actions -----------------------------------------------------------------------------------
function setQty(it: CartItem, q: number) {
  const max = it.stock_quantity ?? Number.MAX_SAFE_INTEGER
  cart.updateQuantity(it.sku_id, Math.min(max, Math.max(1, Math.floor(Number(q) || 1))))
}
function remove(it: CartItem) {
  cart.removeItem(it.sku_id)
  toast.success('장바구니에서 삭제했습니다.', { title: it.title })
}
function removeSelected() {
  const ids = cart.selectedItems.map((i) => i.sku_id)
  if (!ids.length) return
  cart.removeMany(ids)
  toast.success(`선택한 ${ids.length}개 상품을 삭제했습니다.`)
}
function goCheckout() {
  if (!cart.selectedItems.length) return
  router.push(auth.isAuthenticated ? '/checkout' : `/login?redirect=${encodeURIComponent('/checkout')}`)
}

// ---- empty cart: a real running campaign only ---------------------------------------------------------
const deals = ref<any[]>([])
onMounted(() => {
  if (cart.items.length) return
  fetch(`${API_BASE_URL}/api/v1/campaigns/lightning`).then((r) => r.json())
    .then((j) => { deals.value = j?.data?.campaign ? (j.data.deals || []).slice(0, 5) : [] })
    .catch(() => { deals.value = [] })
})
</script>

<template>
  <div class="mx-auto max-w-container px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-ink">장바구니<span v-if="cart.items.length" class="ml-2 text-lg font-medium text-ink-muted">{{ cart.items.length }}</span></h1>
      <CheckoutSteps :current="1" />
    </div>

    <!-- empty -------------------------------------------------------------------------------------------- -->
    <template v-if="!cart.items.length">
      <OmEmptyState class="mt-6" title="장바구니가 비어 있습니다" description="상품 상세에서 옵션을 고른 뒤 장바구니에 담을 수 있습니다.">
        <template #icon><ShoppingCart class="h-8 w-8" aria-hidden="true" /></template>
        <OmButton to="/" variant="primary" size="sm">쇼핑 계속하기</OmButton>
        <OmButton v-if="auth.isAuthenticated" to="/wishlist" variant="outline" size="sm">찜한 상품 보기</OmButton>
      </OmEmptyState>
      <section v-if="deals.length" class="mt-4" aria-labelledby="cart-deals">
        <div class="mb-3 flex items-center justify-between">
          <h2 id="cart-deals" class="text-lg font-bold text-ink">진행 중인 번개특가</h2>
          <RouterLink to="/channel/lightning-deals" class="text-sm text-ink-muted hover:text-ink">전체 보기</RouterLink>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <ProductCard v-for="d in deals" :key="d.product_id || d.id" :product="d" />
        </div>
      </section>
    </template>

    <!-- lines + summary ------------------------------------------------------------------------------------ -->
    <div v-else class="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="min-w-0 space-y-4">
        <div class="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3">
          <OmCheckbox :model-value="cart.allSelected" :indeterminate="!cart.allSelected && cart.selectedItems.length > 0" :label="`전체 선택 (${cart.selectedItems.length}/${cart.items.length})`" @update:model-value="cart.selectAll(!!$event)" />
          <OmButton variant="ghost" size="sm" :disabled="!cart.selectedItems.length" @click="removeSelected"><Trash2 class="h-4 w-4" aria-hidden="true" />선택 삭제</OmButton>
        </div>

        <OmAlert v-if="repriced.length" tone="info" dismissible @dismiss="repriced = []">
          담은 뒤 판매가가 바뀐 상품 {{ repriced.length }}개를 현재 판매가로 표시합니다.
        </OmAlert>

        <section v-for="g in cart.partnerGroups" :key="g.partner_id" class="overflow-hidden rounded-lg border border-line bg-surface" :aria-label="`${g.partner_name} 상품`">
          <header class="flex flex-wrap items-center justify-between gap-2 border-b border-line-divider bg-surface-2 px-4 py-3">
            <RouterLink v-if="g.partner_id !== '__unknown_seller__'" :to="`/store/${g.partner_id}`" class="inline-flex items-center gap-1.5 text-sm font-semibold text-ink hover:underline">
              <Store class="h-4 w-4 text-ink-muted" aria-hidden="true" />{{ g.partner_name }}
            </RouterLink>
            <span v-else class="inline-flex items-center gap-1.5 text-sm font-semibold text-ink"><Store class="h-4 w-4 text-ink-muted" aria-hidden="true" />{{ g.partner_name }}</span>
            <p class="text-xs text-ink-muted">
              <template v-if="!selectedGroupById[g.partner_id]">선택한 상품 없음</template>
              <template v-else-if="selectedGroupById[g.partner_id].shipping_fee === 0"><OmBadge tone="success">배송비 무료</OmBadge></template>
              <template v-else>
                배송비 {{ locale.formatPrice(selectedGroupById[g.partner_id].shipping_fee) }}
                <template v-if="selectedGroupById[g.partner_id].free_shipping_remaining > 0"> · {{ locale.formatPrice(selectedGroupById[g.partner_id].free_shipping_remaining) }} 더 담으면 무료</template>
              </template>
            </p>
          </header>

          <ul class="divide-y divide-line-divider">
            <li v-for="it in g.items" :key="it.sku_id" class="flex gap-3 p-4">
              <OmCheckbox class="mt-1 shrink-0" :model-value="cart.isSelected(it.sku_id)" :aria-label="`${it.title} 선택`" @update:model-value="cart.setSelected(it.sku_id, !!$event)" />
              <RouterLink :to="`/product/${it.product_id}`" class="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-line bg-surface-2 sm:h-24 sm:w-24">
                <img :src="it.thumbnail_url" :alt="it.title" class="h-full w-full object-cover" loading="lazy" />
              </RouterLink>
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <RouterLink :to="`/product/${it.product_id}`" class="line-clamp-2 text-sm font-medium text-ink hover:underline">{{ it.title }}</RouterLink>
                    <p class="mt-0.5 text-xs text-ink-muted">{{ it.option_summary }}</p>
                    <p v-if="repriced.includes(it.sku_id)" class="mt-0.5 text-xs text-info">판매가 변경됨</p>
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
                    <p class="text-md font-bold tabular-nums text-ink">{{ locale.formatPrice(lineTotal(it.price, it.quantity)) }}</p>
                    <p v-if="volumeDiscountPct(it.quantity)" class="text-2xs text-ink-subtle line-through">{{ locale.formatPrice(it.price * it.quantity) }}</p>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <!-- summary -->
      <aside class="rounded-lg border border-line bg-surface p-5 lg:sticky lg:top-24" aria-labelledby="cart-sum">
        <h2 id="cart-sum" class="text-lg font-bold text-ink">주문 예정 금액</h2>
        <p class="mt-1 text-xs text-ink-muted">선택한 상품 {{ cart.selectedItems.length }}종 · {{ formatNumber(cart.selectedCount) }}개</p>

        <OmAlert v-if="quoteError" tone="danger" class="mt-4">{{ quoteError }}</OmAlert>

        <dl class="mt-4 space-y-2 text-sm" :class="{ 'opacity-60': quoting }" aria-live="polite">
          <div class="flex justify-between"><dt class="text-ink-muted">상품 금액</dt><dd class="tabular-nums text-ink">{{ locale.formatPrice(summary.goods) }}</dd></div>
          <div v-if="summary.volume" class="flex justify-between"><dt class="text-ink-muted">수량 할인</dt><dd class="tabular-nums text-accent">-{{ locale.formatPrice(summary.volume) }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-muted">배송비<span v-if="summary.sellers"> ({{ summary.sellers }}개 판매자)</span></dt><dd class="tabular-nums text-ink">{{ summary.shipping ? locale.formatPrice(summary.shipping) : '무료' }}</dd></div>
          <div class="flex items-baseline justify-between border-t border-line-divider pt-3">
            <dt class="font-semibold text-ink">결제 예정 금액</dt>
            <dd class="text-2xl font-bold tabular-nums text-ink" data-testid="cart-total">{{ locale.formatPrice(summary.total) }}</dd>
          </div>
        </dl>
        <p class="mt-2 flex items-center gap-1.5 text-2xs text-ink-subtle">
          <OmSpinner v-if="quoting" :size="12" />
          <template v-if="quoting">주문서 기준 금액을 확인하는 중</template>
          <template v-else-if="summary.confirmed">주문서와 같은 방식으로 계산한 금액입니다. 쿠폰·적립금은 주문서에서 적용합니다.</template>
          <template v-else-if="!auth.isAuthenticated">예상 금액입니다. 로그인 후 주문서에서 최종 금액이 확정됩니다.</template>
          <template v-else>예상 금액입니다. 주문서에서 최종 금액이 확정됩니다.</template>
        </p>

        <OmButton class="mt-5 hidden lg:flex" variant="primary" size="lg" block :disabled="!cart.selectedItems.length" @click="goCheckout">
          {{ cart.selectedItems.length ? `${formatNumber(cart.selectedCount)}개 주문하기` : '주문할 상품을 선택해 주세요' }}
        </OmButton>
        <ul class="mt-4 space-y-1 text-2xs text-ink-subtle">
          <li>판매자가 다른 상품은 판매자별로 따로 배송됩니다.</li>
          <li>결제 대기 주문은 30분 후 자동 취소되며 재고·쿠폰·적립금이 복원됩니다.</li>
        </ul>
      </aside>
    </div>

    <!-- mobile order bar -->
    <div v-if="cart.items.length" class="fixed inset-x-0 bottom-0 z-sticky flex items-center gap-3 border-t border-line bg-surface/95 px-4 pt-2 backdrop-blur lg:hidden" style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom))">
      <div class="min-w-0 flex-1">
        <p class="text-2xs text-ink-muted">{{ summary.confirmed ? '결제 예정' : '예상 금액' }}</p>
        <p class="truncate text-lg font-bold tabular-nums text-ink">{{ locale.formatPrice(summary.total) }}</p>
      </div>
      <OmButton variant="primary" :disabled="!cart.selectedItems.length" @click="goCheckout">{{ formatNumber(cart.selectedCount) }}개 주문하기</OmButton>
    </div>
  </div>
</template>
