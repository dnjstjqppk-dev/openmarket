<script setup lang="ts">
// Product detail (PHASE 2 redesign on @olmoa/ui). Removed because they were not facts:
//  - a 3-image "gallery" made by changing the saturation/contrast of the one thumbnail -> the real image only
//  - "OLMOA CHOICE", "공장직발송 최저가", "90-Day Free Returns" (the rule is 7 days), "Free Shipping over ₩30,000"
//    for every seller (each seller sets its own), "시연 샘플 영상" on a hard-coded stock video (server fixed too)
//  - pre-selecting the cheapest SKU and an invented `<id>_sku_def` SKU -> the buyer picks every option
//  - a client-side volume discount rounded differently from the server -> lib/pricing.ts mirrors the server
// Prices/discounts/shipping shown here are what the order sheet will charge (the server re-checks everything).
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { Heart, Minus, Plus, Play, ShoppingBag, Star, Store, Truck, RotateCcw, BadgePercent } from 'lucide-vue-next'
import {
  OmBreadcrumb, OmButton, OmIconButton, OmTabs, OmAlert, OmSkeleton, OmErrorState, OmEmptyState, OmModal,
  useToast, discountRate, formatNumber
} from '@olmoa/ui'
import ReviewsPanel from '../components/product/ReviewsPanel.vue'
import QnaPanel from '../components/product/QnaPanel.vue'
import { useCartStore } from '../stores/cart'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { VOLUME_TIERS, volumeDiscountPct, volumeUnitPrice, DEFAULT_SHIPPING_FEE, DEFAULT_FREE_THRESHOLD } from '../lib/pricing'
import { API_BASE_URL, authHeader } from '../config'

const route = useRoute()
const router = useRouter()
const cart = useCartStore()
const auth = useAuthStore()
const locale = useLocaleStore()
const toast = useToast()

const product = ref<any>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const notFound = ref(false)
const sold24h = ref(0)
const isWishlisted = ref(false)
const wishBusy = ref(false)
const showVideo = ref(false)
const tab = ref('detail')
const reviewSummary = ref<{ count: number; average: number | null }>({ count: 0, average: null })
const qnaCount = ref(0)

const loginTo = computed(() => `/login?redirect=${encodeURIComponent(route.fullPath)}`)

// ---- load -------------------------------------------------------------------------------------------
let seq = 0
async function load() {
  const my = ++seq
  loading.value = true
  loadError.value = null
  notFound.value = false
  selection.value = {}
  quantity.value = 1
  tab.value = 'detail'
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(String(route.params.slug))}`)
    const json = await res.json().catch(() => null)
    if (my !== seq) return
    if (res.status === 404) { notFound.value = true; product.value = null; return }
    if (!res.ok || !json?.success) throw new Error(json?.error || `상품을 불러오지 못했습니다 (${res.status})`)
    product.value = json.data
    reviewSummary.value = { count: Number(json.data.review_count || 0), average: json.data.avg_rating ?? null }
    qnaCount.value = Number(json.data.qna_count || 0)
    // A single SKU is the only case where nothing has to be chosen.
    if (skus.value.length === 1) selection.value = { ...(skus.value[0].options || {}) }
    loadSideData(json.data.id)
  } catch (e: any) {
    if (my === seq) loadError.value = e?.message || '상품을 불러오지 못했습니다'
  } finally {
    if (my === seq) loading.value = false
  }
}
function loadSideData(id: string) {
  fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(id)}/urgency-stats`).then((r) => r.json())
    .then((j) => { sold24h.value = j?.success ? Number(j.data?.recent_24h_sales || 0) : 0 }).catch(() => { sold24h.value = 0 })
  isWishlisted.value = false
  if (auth.isAuthenticated) {
    fetch(`${API_BASE_URL}/api/v1/wishlist`, { headers: { ...authHeader() } }).then((r) => r.json())
      .then((j) => { if (j?.success && Array.isArray(j.data)) isWishlisted.value = j.data.some((w: any) => w.product_id === id) }).catch(() => {})
  }
}
// ---- availability -----------------------------------------------------------------------------------
const onSale = computed(() => product.value && product.value.status === 'ACTIVE' && (product.value.review_status == null || product.value.review_status === 'APPROVED'))
const skus = computed<any[]>(() => product.value?.skus || [])
const attributes = computed<{ name: string; values: string[] }[]>(() => product.value?.attributes || [])

// ---- option selection: one choice per attribute; the SKU is the one matching all of them -------------
const selection = ref<Record<string, string>>({})
const selectedSku = computed(() => {
  if (!skus.value.length) return null
  if (attributes.value.length === 0) return skus.value.length === 1 ? skus.value[0] : null
  if (attributes.value.some((a) => !selection.value[a.name])) return null
  return skus.value.find((s) => attributes.value.every((a) => String(s.options?.[a.name]) === selection.value[a.name])) || null
})
/** A value is selectable if some in-stock SKU has it together with the other current choices. */
function valueState(attr: string, value: string): 'ok' | 'soldout' | 'none' {
  const matches = skus.value.filter((s) => String(s.options?.[attr]) === value && attributes.value.every((a) => a.name === attr || !selection.value[a.name] || String(s.options?.[a.name]) === selection.value[a.name]))
  if (!matches.length) return 'none'
  return matches.some((s) => Number(s.stock_quantity) > 0) ? 'ok' : 'soldout'
}
function choose(attr: string, value: string) {
  const next = { ...selection.value }
  if (next[attr] === value) delete next[attr]
  else next[attr] = value
  selection.value = next
  quantity.value = 1
}
const missingOptions = computed(() => attributes.value.filter((a) => !selection.value[a.name]).map((a) => a.name))

// ---- price ------------------------------------------------------------------------------------------
const quantity = ref(1)
const stock = computed(() => (selectedSku.value ? Number(selectedSku.value.stock_quantity || 0) : null))
const maxQty = computed(() => (stock.value != null ? Math.max(1, stock.value) : 999))
watch(maxQty, (m) => { if (quantity.value > m) quantity.value = m })
const priceRange = computed(() => {
  const ps = skus.value.map((s) => Number(s.sale_price)).filter((n) => Number.isFinite(n))
  return ps.length ? { min: Math.min(...ps), max: Math.max(...ps) } : { min: Number(product.value?.lowest_sale_price || 0), max: Number(product.value?.lowest_sale_price || 0) }
})
const unitSale = computed(() => (selectedSku.value ? Number(selectedSku.value.sale_price) : priceRange.value.min))
const unitOriginal = computed(() => (selectedSku.value ? Number(selectedSku.value.original_price) : Number(product.value?.lowest_original_price || 0)))
const listDiscount = computed(() => discountRate(unitOriginal.value, unitSale.value))
const tierPct = computed(() => volumeDiscountPct(quantity.value))
const lineTotal = computed(() => volumeUnitPrice(unitSale.value, quantity.value) * quantity.value)
const tierSaving = computed(() => unitSale.value * quantity.value - lineTotal.value)

const shipFee = computed(() => product.value?.base_shipping_fee ?? DEFAULT_SHIPPING_FEE)
const shipThreshold = computed(() => product.value?.free_shipping_threshold ?? DEFAULT_FREE_THRESHOLD)
const sellerName = computed(() => product.value?.business_name || null)

// ---- actions ----------------------------------------------------------------------------------------
const canBuy = computed(() => onSale.value && !!selectedSku.value && (stock.value ?? 0) > 0)
const buyHint = computed(() => {
  if (!onSale.value) return '현재 판매하지 않는 상품입니다'
  if (!skus.value.length) return '구매할 수 있는 옵션이 없습니다'
  if (missingOptions.value.length) return `${missingOptions.value.join(', ')}을(를) 선택해 주세요`
  if (!selectedSku.value) return '선택한 조합의 옵션이 없습니다'
  if ((stock.value ?? 0) <= 0) return '선택한 옵션은 품절입니다'
  return ''
})
function addToCart(goCheckout: boolean) {
  if (!canBuy.value || !product.value) { toast.error(buyHint.value || '옵션을 선택해 주세요'); return }
  // The cart stores the base unit price; quantity tiers are applied from the quantity (cart & server alike).
  const ok = cart.addItem(product.value, selectedSku.value, quantity.value)
  if (!ok) { toast.error('장바구니에 담지 못했습니다. 옵션과 재고를 확인해 주세요.'); return }
  // "바로 구매" orders only this option; other cart lines stay in the cart, unselected.
  if (goCheckout) { cart.selectOnly([selectedSku.value.id]); router.push('/checkout') }
  else toast.success(`장바구니에 담았습니다 (${quantity.value}개)`, { title: product.value.title })
}
async function toggleWishlist() {
  if (!product.value) return
  if (!auth.isAuthenticated) { router.push(loginTo.value); return }
  wishBusy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/wishlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ product_id: product.value.id })
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '찜하지 못했습니다')
    isWishlisted.value = !!json.wished
    toast.success(json.wished ? '찜 목록에 저장했습니다.' : '찜 목록에서 삭제했습니다.')
  } catch (e: any) {
    toast.error(e?.message || '찜하지 못했습니다')
  } finally {
    wishBusy.value = false
  }
}

// ---- description: strip active content (server stores seller HTML) ---------------------------------
const descriptionHtml = computed(() => {
  const raw = String(product.value?.description_html || '')
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<\/?(iframe|object|embed|form|link|meta|style|base)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"')
})

const tabs = computed(() => [
  { key: 'detail', label: '상세정보' },
  { key: 'reviews', label: '후기', count: reviewSummary.value.count },
  { key: 'qna', label: '문의', count: qnaCount.value },
  { key: 'shipping', label: '배송·교환·반품' }
])
const crumbs = computed(() => [
  { label: '홈', to: '/' },
  ...(product.value?.category_slug ? [{ label: product.value.category_name, to: `/category/${product.value.category_slug}` }] : []),
  { label: product.value?.title || '상품' }
])
function openTab(k: string) {
  tab.value = k
  document.getElementById('product-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Last, so every ref used by load() already exists when it runs immediately.
watch(() => route.params.slug, load, { immediate: true })
</script>

<template>
  <div class="mx-auto max-w-container px-4 pb-28 pt-4 sm:px-6 lg:pb-12">
    <div v-if="loading" class="grid gap-8 lg:grid-cols-2">
      <OmSkeleton variant="rect" height="aspect-square" />
      <div class="space-y-4"><OmSkeleton :lines="2" /><OmSkeleton variant="rect" height="h-24" /><OmSkeleton :lines="4" /></div>
    </div>
    <OmEmptyState v-else-if="notFound" class="mt-8" title="상품을 찾을 수 없습니다" description="삭제되었거나 주소가 잘못되었습니다.">
      <OmButton to="/" variant="outline" size="sm">홈으로</OmButton>
    </OmEmptyState>
    <OmErrorState v-else-if="loadError" class="mt-8" :message="loadError" @retry="load" />

    <template v-else-if="product">
      <OmBreadcrumb :items="crumbs" />

      <div class="mt-3 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-12">
        <!-- media ------------------------------------------------------------------------------------ -->
        <div class="lg:sticky lg:top-24 lg:self-start">
          <div class="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface-2">
            <img :src="product.thumbnail_url" :alt="product.title" class="h-full w-full object-cover" fetchpriority="high" />
          </div>
          <OmButton v-if="product.video_url" variant="outline" size="sm" block class="mt-3" @click="showVideo = true">
            <Play class="h-4 w-4" aria-hidden="true" />판매자 등록 영상 보기
          </OmButton>
        </div>

        <!-- buy box ---------------------------------------------------------------------------------- -->
        <div class="min-w-0">
          <RouterLink v-if="product.partner_id && sellerName" :to="`/store/${product.partner_id}`" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
            <Store class="h-4 w-4" aria-hidden="true" />{{ sellerName }}
          </RouterLink>
          <h1 class="mt-1 text-xl font-bold leading-snug text-ink sm:text-2xl">{{ product.title }}</h1>

          <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <button v-if="reviewSummary.count > 0 && reviewSummary.average != null" type="button" class="inline-flex items-center gap-1 hover:underline" @click="openTab('reviews')">
              <Star class="h-4 w-4 fill-highlight text-highlight" aria-hidden="true" />
              <span class="font-semibold text-ink">{{ Number(reviewSummary.average).toFixed(1) }}</span>
              <span class="text-ink-muted">후기 {{ formatNumber(reviewSummary.count) }}</span>
            </button>
            <span v-else class="text-ink-subtle">아직 후기가 없습니다</span>
            <span v-if="sold24h > 0" class="text-ink-muted">최근 24시간 {{ formatNumber(sold24h) }}개 결제</span>
          </div>

          <OmAlert v-if="!onSale" tone="warning" class="mt-4">현재 판매하지 않는 상품입니다. 장바구니에 담거나 주문할 수 없습니다.</OmAlert>

          <!-- price -->
          <div class="mt-5 border-t border-line-divider pt-5">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span v-if="listDiscount > 0" class="text-2xl font-bold text-accent">{{ listDiscount }}%</span>
              <span class="text-3xl font-bold tracking-tight text-ink">{{ locale.formatPrice(unitSale) }}</span>
              <span v-if="!selectedSku && priceRange.max > priceRange.min" class="text-md text-ink-muted">~</span>
              <span v-if="listDiscount > 0" class="text-sm text-ink-subtle line-through">{{ locale.formatPrice(unitOriginal) }}</span>
            </div>
            <p v-if="!selectedSku && priceRange.max > priceRange.min" class="mt-1 text-xs text-ink-muted">옵션에 따라 {{ locale.formatPrice(priceRange.min) }} ~ {{ locale.formatPrice(priceRange.max) }}</p>
          </div>

          <!-- facts -->
          <dl class="mt-4 grid gap-2.5 rounded-lg bg-surface-2 p-4 text-sm">
            <div class="flex gap-3"><dt class="flex w-20 shrink-0 items-center gap-1.5 text-ink-muted"><Truck class="h-4 w-4" aria-hidden="true" />배송비</dt>
              <dd class="text-ink">
                <template v-if="Number(shipFee) === 0">무료배송</template>
                <template v-else>{{ locale.formatPrice(shipFee) }}<span v-if="Number(shipThreshold) > 0" class="text-ink-muted"> · 이 판매자 상품 {{ locale.formatPrice(shipThreshold) }} 이상 구매 시 무료</span></template>
              </dd>
            </div>
            <div class="flex gap-3"><dt class="flex w-20 shrink-0 items-center gap-1.5 text-ink-muted"><BadgePercent class="h-4 w-4" aria-hidden="true" />수량 할인</dt>
              <dd class="text-ink">{{ VOLUME_TIERS.map((t) => `${t.min}개 이상 ${t.pct}%`).join(' · ') }}</dd>
            </div>
            <div class="flex gap-3"><dt class="flex w-20 shrink-0 items-center gap-1.5 text-ink-muted"><RotateCcw class="h-4 w-4" aria-hidden="true" />반품</dt>
              <dd class="text-ink">배송 완료 후 7일 이내 신청 · <RouterLink to="/legal/refund" class="text-ink-muted underline underline-offset-2">자세히</RouterLink></dd>
            </div>
          </dl>

          <!-- options -->
          <div v-if="attributes.length" class="mt-5 space-y-4">
            <fieldset v-for="a in attributes" :key="a.name">
              <legend class="mb-2 text-sm font-medium text-ink">{{ a.name }}<span v-if="selection[a.name]" class="ml-2 font-normal text-ink-muted">{{ selection[a.name] }}</span></legend>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="v in a.values"
                  :key="v"
                  type="button"
                  :aria-pressed="selection[a.name] === String(v)"
                  :disabled="valueState(a.name, String(v)) === 'none' || !onSale"
                  class="min-h-10 rounded-md border px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
                  :class="selection[a.name] === String(v) ? 'border-secondary bg-secondary text-secondary-on' : valueState(a.name, String(v)) === 'soldout' ? 'border-line border-dashed text-ink-subtle' : 'border-line text-ink hover:border-line-strong'"
                  @click="choose(a.name, String(v))"
                >{{ v }}<span v-if="valueState(a.name, String(v)) === 'soldout'" class="ml-1 text-2xs">품절</span></button>
              </div>
            </fieldset>
          </div>
          <OmAlert v-else-if="!skus.length" tone="warning" class="mt-5">등록된 옵션이 없어 구매할 수 없습니다.</OmAlert>

          <!-- quantity + total -->
          <div class="mt-5 rounded-lg border border-line p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <span class="text-sm font-medium text-ink">수량</span>
                <div class="flex items-center rounded-md border border-line">
                  <OmIconButton label="수량 줄이기" size="sm" :disabled="quantity <= 1" @click="quantity = Math.max(1, quantity - 1)"><Minus class="h-4 w-4" /></OmIconButton>
                  <input v-model.number="quantity" type="number" min="1" :max="maxQty" aria-label="수량" class="h-8 w-12 border-x border-line bg-transparent text-center text-sm tabular-nums text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" @change="quantity = Math.min(maxQty, Math.max(1, Math.floor(Number(quantity) || 1)))" />
                  <OmIconButton label="수량 늘리기" size="sm" :disabled="quantity >= maxQty" @click="quantity = Math.min(maxQty, quantity + 1)"><Plus class="h-4 w-4" /></OmIconButton>
                </div>
                <span v-if="stock != null && stock > 0 && stock <= 10" class="text-xs text-warning">{{ stock }}개 남음</span>
              </div>
              <div class="text-right">
                <p class="text-xs text-ink-muted">상품 금액<span v-if="tierPct"> (수량 할인 {{ tierPct }}% 적용)</span></p>
                <p class="text-xl font-bold tabular-nums text-ink">{{ selectedSku ? locale.formatPrice(lineTotal) : '-' }}</p>
                <p v-if="selectedSku && tierSaving > 0" class="text-xs text-accent">-{{ locale.formatPrice(tierSaving) }}</p>
              </div>
            </div>
            <p class="mt-2 text-2xs text-ink-subtle">배송비는 판매자별로 주문서에서 계산됩니다. 직접 구매확정하면 결제 금액의 1%가 적립됩니다.</p>
          </div>

          <p v-if="buyHint && onSale" class="mt-3 text-sm text-ink-muted" role="status">{{ buyHint }}</p>
          <div class="mt-3 hidden gap-2 lg:flex">
            <OmIconButton :label="isWishlisted ? '찜 해제' : '찜하기'" variant="outline" size="lg" :loading="wishBusy" @click="toggleWishlist">
              <Heart class="h-5 w-5" :class="isWishlisted ? 'fill-accent text-accent' : ''" />
            </OmIconButton>
            <OmButton variant="outline" size="lg" class="flex-1" :disabled="!canBuy" @click="addToCart(false)"><ShoppingBag class="h-5 w-5" aria-hidden="true" />{{ locale.t('addToCart') }}</OmButton>
            <OmButton variant="primary" size="lg" class="flex-1" :disabled="!canBuy" @click="addToCart(true)">{{ locale.t('buyNow') }}</OmButton>
          </div>

          <!-- seller disclosure (전자상거래법) -->
          <dl class="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line-divider pt-4 text-xs text-ink-muted">
            <dt>판매자</dt><dd class="text-ink">{{ sellerName || '판매자 정보 없음' }}</dd>
            <template v-if="product.business_reg_number"><dt>사업자등록번호</dt><dd class="text-ink">{{ product.business_reg_number }}</dd></template>
            <template v-if="product.country_origin"><dt>원산지</dt><dd class="text-ink">{{ product.country_origin }}</dd></template>
          </dl>
        </div>
      </div>

      <!-- tabs ----------------------------------------------------------------------------------------- -->
      <section id="product-tabs" class="mt-12 scroll-mt-24">
        <OmTabs v-model="tab" :tabs="tabs" full />
        <div class="py-6">
          <div v-if="tab === 'detail'">
            <!-- eslint-disable-next-line vue/no-v-html -- seller HTML, active content stripped above -->
            <div v-if="descriptionHtml.trim()" class="om-prose mx-auto max-w-3xl text-md leading-relaxed text-ink [&_img]:mx-auto [&_img]:h-auto [&_img]:max-w-full" v-html="descriptionHtml" />
            <OmEmptyState v-else compact title="판매자가 등록한 상세 설명이 없습니다" />
          </div>
          <ReviewsPanel v-else-if="tab === 'reviews'" :product-id="product.id" :login-to="loginTo" @summary="reviewSummary = $event" />
          <QnaPanel v-else-if="tab === 'qna'" :product-id="product.id" :login-to="loginTo" @count="qnaCount = $event" />
          <div v-else class="mx-auto max-w-3xl space-y-5 text-sm leading-relaxed text-ink">
            <section>
              <h3 class="font-semibold">배송</h3>
              <p class="mt-1 text-ink-muted">
                이 판매자의 기본 배송비는 {{ Number(shipFee) === 0 ? '무료' : locale.formatPrice(shipFee) }}<template v-if="Number(shipFee) !== 0 && Number(shipThreshold) > 0">이며, 이 판매자 상품을 {{ locale.formatPrice(shipThreshold) }} 이상 구매하면 무료</template>입니다.
                여러 판매자의 상품을 함께 주문하면 판매자별로 따로 배송·계산됩니다.
                배송 예정일을 넘기면 주문 상세에서 지연 보상(적립금 5,300원)을 신청할 수 있습니다. <RouterLink to="/policy/shipping" class="underline underline-offset-2">배송 정책</RouterLink>
              </p>
            </section>
            <section>
              <h3 class="font-semibold">교환·반품·환불</h3>
              <p class="mt-1 text-ink-muted">배송 완료 후 구매확정 전, 7일 이내에 주문 상세에서 신청할 수 있습니다. 단순 변심 반품은 반품 배송비가 부과될 수 있으며 금액은 판매자별로 다릅니다. <RouterLink to="/legal/refund" class="underline underline-offset-2">취소·반품·환불 안내</RouterLink></p>
            </section>
            <section>
              <h3 class="font-semibold">판매가 인하 차액 보상</h3>
              <p class="mt-1 text-ink-muted">결제 후 30일 이내 같은 옵션의 판매가가 내려가면 주문당 한 번 차액을 적립금으로 받을 수 있습니다. <RouterLink to="/policy/price-match" class="underline underline-offset-2">자세히</RouterLink></p>
            </section>
          </div>
        </div>
      </section>

      <!-- mobile purchase bar --------------------------------------------------------------------------- -->
      <div class="fixed inset-x-0 bottom-0 z-sticky flex items-center gap-2 border-t border-line bg-surface/95 px-3 pt-2 backdrop-blur lg:hidden" style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom))">
        <OmIconButton :label="isWishlisted ? '찜 해제' : '찜하기'" variant="outline" :loading="wishBusy" @click="toggleWishlist">
          <Heart class="h-5 w-5" :class="isWishlisted ? 'fill-accent text-accent' : ''" />
        </OmIconButton>
        <div class="min-w-0 flex-1">
          <p class="truncate text-2xs text-ink-muted">{{ selectedSku ? `${quantity}개` : buyHint || '옵션 선택' }}</p>
          <p class="truncate text-md font-bold tabular-nums text-ink">{{ selectedSku ? locale.formatPrice(lineTotal) : locale.formatPrice(priceRange.min) }}</p>
        </div>
        <OmButton variant="outline" :disabled="!canBuy" @click="addToCart(false)">담기</OmButton>
        <OmButton variant="primary" :disabled="!canBuy" @click="addToCart(true)">구매</OmButton>
      </div>

      <OmModal v-if="product.video_url" v-model:open="showVideo" title="판매자 등록 영상" size="lg">
        <video v-if="showVideo" :src="product.video_url" controls playsinline class="aspect-video w-full rounded bg-black" />
      </OmModal>
    </template>
  </div>
</template>
