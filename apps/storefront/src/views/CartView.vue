<script setup lang="ts">
// Cart (3-5): per-seller boxes with free-shipping gauges, server quote plus
// best-coupon estimates in the summary, repriced lines stated old -> new.
// Signed out: the summary is labelled an estimate.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { ShoppingCart, Trash2 } from 'lucide-vue-next'
import { userErrorMessage, OmButton, OmCheckbox, OmAlert, OmEmptyState, OmSpinner, useToast, formatNumber } from '@olmoa/ui'
import CheckoutSteps from '../components/CheckoutSteps.vue'
import ProductCard from '../components/ProductCard.vue'
import SellerCartGroup from '../components/cart/SellerCartGroup.vue'
import { useCartStore } from '../stores/cart'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { fetchQuote, quotePrices, type Quote } from '../lib/quote'
import { API_BASE_URL, authHeader } from '../config'

const cart = useCartStore()
const auth = useAuthStore()
const locale = useLocaleStore()
const router = useRouter()
const toast = useToast()

// ---- server quote + best-coupon estimates for the selected lines ------------------------------------------------
const quote = ref<Quote | null>(null)
const best = ref<{ platform: any | null; store: any[]; total_discount: number } | null>(null)
const quoteError = ref<string | null>(null)
const quoting = ref(false)
const repriced = ref<Record<string, { from: number; to: number }>>({})
let ctrl: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function scheduleQuote() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runQuote, 350)
}
async function runQuote() {
  ctrl?.abort()
  quote.value = null
  best.value = null
  quoteError.value = null
  if (!auth.isAuthenticated || !cart.selectedItems.length) { quoting.value = false; return }
  const my = (ctrl = new AbortController())
  quoting.value = true
  const lines = cart.selectedItems.map((i) => ({ product_id: i.product_id, sku_id: i.sku_id, quantity: i.quantity }))
  try {
    const [q, b] = await Promise.all([
      fetchQuote({ items: lines }, my.signal),
      fetch(`${API_BASE_URL}/api/v1/coupons/best`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ items: lines.map((l) => ({ sku_id: l.sku_id, quantity: l.quantity })) }),
        signal: my.signal
      }).then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!r.ok || !j?.success) throw new Error(j?.error || '쿠폰 예상 할인을 계산하지 못했습니다')
        return j.data
      })
    ])
    if (my.signal.aborted) return
    for (const c of cart.applyServerPrices(quotePrices(q))) repriced.value[c.sku_id] = { from: c.from, to: c.to }
    quote.value = q
    best.value = b
  } catch (e: any) {
    if (my.signal.aborted || e?.name === 'AbortError') return
    quoteError.value = userErrorMessage(e, '주문 금액을 확인하지 못했습니다')
  } finally {
    if (!my.signal.aborted) quoting.value = false
  }
}
const selectionKey = computed(() => cart.selectedItems.map((i) => `${i.sku_id}:${i.quantity}`).join(','))
watch([selectionKey, () => auth.isAuthenticated], scheduleQuote, { immediate: true })
onBeforeUnmount(() => { ctrl?.abort(); if (timer) clearTimeout(timer) })

// ---- summary: server numbers when available, otherwise the local estimate ----------------------------------------
const storeEst = computed(() => (best.value?.store || []).reduce((a: number, s: any) => a + Number(s.discount_amount || 0), 0))
const platformEst = computed(() => Number(best.value?.platform?.discount_amount || 0))
const summary = computed(() => {
  if (quote.value) {
    const total = quote.value.total_goods_amount - quote.value.volume_discount_amount - storeEst.value - platformEst.value + quote.value.total_shipping_amount
    return {
      goods: quote.value.total_goods_amount,
      volume: quote.value.volume_discount_amount,
      store: storeEst.value,
      platform: platformEst.value,
      shipping: quote.value.total_shipping_amount,
      total: Math.max(0, total),
      earn: quote.value.projected_credit_amount ?? null,
      sellers: quote.value.sub_orders.length,
      confirmed: true
    }
  }
  return {
    goods: cart.listGoodsAmount,
    volume: cart.volumeSavings,
    store: 0,
    platform: 0,
    shipping: cart.shippingFee,
    total: cart.totalPayAmount,
    earn: null,
    sellers: cart.selectedGroups.length,
    confirmed: false
  }
})

// ---- line actions ------------------------------------------------------------------------------------------------
function removeSelected() {
  const ids = cart.selectedItems.map((i) => i.sku_id)
  if (!ids.length) return
  cart.removeMany(ids)
  toast.success(`선택한 ${ids.length}개 상품을 삭제했습니다.`)
}
const soldoutIds = computed(() => cart.items.filter((i) => i.stock_quantity === 0).map((i) => i.sku_id))
function removeSoldout() {
  if (!soldoutIds.value.length) return
  cart.removeMany(soldoutIds.value)
  toast.success(`품절 상품 ${soldoutIds.value.length}개를 삭제했습니다.`)
}
function goCheckout() {
  if (!cart.selectedItems.length) return
  router.push(auth.isAuthenticated ? '/checkout' : `/login?redirect=${encodeURIComponent('/checkout')}`)
}

// ---- empty cart: a real running campaign only ----------------------------------------------------------------------
const deals = ref<any[]>([])
onMounted(() => {
  if (cart.items.length) return
  fetch(`${API_BASE_URL}/api/v1/campaigns/lightning`).then((r) => r.json())
    .then((j) => { deals.value = j?.data?.campaign ? (j.data.deals || []).slice(0, 5) : [] })
    .catch(() => { deals.value = [] })
})

// ---- H-3: cart bundle (co-purchased with the cart lines, server ranked) ----------------------------------------------
const bundle = ref<any[]>([])
async function loadBundle() {
  bundle.value = []
  const ids = [...new Set(cart.items.map((i) => i.product_id).filter(Boolean))]
  if (!ids.length) return
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/recommendations/cart-bundle?ids=${encodeURIComponent(ids.join(','))}&limit=5`)
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.success || !Array.isArray(j.data)) return
    bundle.value = j.data
  } catch { /* section stays hidden */ }
}
onMounted(loadBundle)
watch(() => cart.items.length, loadBundle)
</script>

<template>
  <div class="mx-auto max-w-container px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-ink">장바구니<span v-if="cart.items.length" class="ml-2 text-lg font-medium text-ink-muted">{{ cart.items.length }}</span></h1>
      <CheckoutSteps :current="1" />
    </div>

    <!-- empty -->
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

    <!-- lines + summary -->
    <div v-else class="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="min-w-0 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-4 py-3">
          <OmCheckbox :model-value="cart.allSelected" :indeterminate="!cart.allSelected && cart.selectedItems.length > 0" :label="`전체 선택 (${cart.selectedItems.length}/${cart.items.length})`" @update:model-value="cart.selectAll(!!$event)" />
          <div class="flex gap-1">
            <OmButton variant="ghost" size="sm" :disabled="!cart.selectedItems.length" @click="removeSelected"><Trash2 class="h-4 w-4" aria-hidden="true" />선택 삭제</OmButton>
            <OmButton variant="ghost" size="sm" :disabled="!soldoutIds.length" @click="removeSoldout">품절 삭제</OmButton>
          </div>
        </div>

        <SellerCartGroup v-for="g in cart.partnerGroups" :key="g.partner_id" :group="g" :repriced="repriced" />

        <section v-if="bundle.length" aria-labelledby="cart-bundle">
          <h2 id="cart-bundle" class="mb-3 text-lg font-bold text-ink">함께 구매하면 좋은 상품</h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <ProductCard v-for="p in bundle" :key="p.id" :product="p" />
          </div>
        </section>
      </div>

      <!-- summary -->
      <aside class="rounded-lg border border-line bg-surface p-5 lg:sticky lg:top-24" aria-labelledby="cart-sum">
        <h2 id="cart-sum" class="text-lg font-bold text-ink">주문 예정 금액</h2>
        <p class="mt-1 text-xs text-ink-muted">선택한 상품 {{ cart.selectedItems.length }}종 · {{ formatNumber(cart.selectedCount) }}개</p>

        <OmAlert v-if="quoteError" tone="danger" class="mt-4">{{ quoteError }}</OmAlert>

        <dl class="mt-4 space-y-2 text-sm" :class="{ 'opacity-60': quoting }" aria-live="polite">
          <div class="flex justify-between"><dt class="text-ink-muted">총 상품금액</dt><dd class="tabular-nums text-ink">{{ locale.formatPrice(summary.goods) }}</dd></div>
          <div v-if="summary.volume" class="flex justify-between"><dt class="text-ink-muted">즉시할인</dt><dd class="tabular-nums text-accent">-{{ locale.formatPrice(summary.volume) }}</dd></div>
          <div v-if="summary.store" class="flex justify-between"><dt class="text-ink-muted">스토어 쿠폰(예상)</dt><dd class="tabular-nums text-accent">-{{ locale.formatPrice(summary.store) }}</dd></div>
          <div v-if="summary.platform" class="flex justify-between"><dt class="text-ink-muted">플랫폼 쿠폰(예상)</dt><dd class="tabular-nums text-accent">-{{ locale.formatPrice(summary.platform) }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-muted">배송비<span v-if="summary.sellers"> ({{ summary.sellers }}개 판매자)</span></dt><dd class="tabular-nums text-ink">{{ summary.shipping ? locale.formatPrice(summary.shipping) : '무료' }}</dd></div>
          <div class="flex items-baseline justify-between border-t border-line-divider pt-3">
            <dt class="font-semibold text-ink">결제 예정 금액</dt>
            <dd class="text-xl font-bold tabular-nums text-ink" data-testid="cart-total">{{ locale.formatPrice(summary.total) }}</dd>
          </div>
          <div v-if="summary.earn !== null" class="flex justify-between"><dt class="text-ink-muted">적립 예정</dt><dd class="tabular-nums text-ink">{{ locale.formatPrice(summary.earn) }}</dd></div>
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
