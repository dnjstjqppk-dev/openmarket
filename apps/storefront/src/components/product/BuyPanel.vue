<script setup lang="ts">
// Sticky buy panel (3-4): store, title, rating jump, price, coupon entry,
// benefit table, stepped options, selected lines, total, actions, seller card.
// State lives in the shared BuySelection; this component only renders it.
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Heart, Star, Store, Truck, BadgePercent, PiggyBank, CalendarClock } from 'lucide-vue-next'
import { OmButton, OmIconButton, OmAlert, OmSellerCard, discountRate, formatNumber } from '@olmoa/ui'
import OptionSteps from './OptionSteps.vue'
import SelectedOptionList from './SelectedOptionList.vue'
import CouponDownloadModal from './CouponDownloadModal.vue'
import { useLocaleStore } from '../../stores/locale'
import { VOLUME_TIERS } from '../../lib/pricing'
import type { BuySelection } from './useBuySelection'

const props = defineProps<{ product: any; sel: BuySelection }>()
const emit = defineEmits<{ reviews: [] }>()
const locale = useLocaleStore()

const couponOpen = ref(false)
const couponLeft = ref<number | null>(null)

const skus = computed<any[]>(() => props.product?.skus || [])
const minSale = computed(() => Math.min(...skus.value.map((s) => Number(s.sale_price)), Number(props.product?.lowest_sale_price || 0)) || 0)
const minOrig = computed(() => Math.min(...skus.value.map((s) => Number(s.original_price)), Number(props.product?.lowest_original_price || 0)) || 0)
const showPct = computed(() => !props.sel.surgeHidden && discountRate(minOrig.value, minSale.value) > 0)
const sellerName = computed(() => props.product?.business_name || props.product?.partner_name || null)
const reviewCount = computed(() => Number(props.product?.review_count || 0))
const avgRating = computed(() => (reviewCount.value > 0 && props.product?.avg_rating != null ? Number(props.product.avg_rating) : null))

const shipText = computed(() => props.product?.shipping_text || null)
const shipDays = computed(() => {
  const d = props.product?.shipping_policy?.processing_days
  return d === null || d === undefined ? null : Number(d)
})
const shipBy = computed(() => {
  if (shipDays.value === null) return null
  const t = new Date(Date.now() + shipDays.value * 86400000)
  return `${t.getMonth() + 1}/${t.getDate()}`
})
const earnPreview = computed(() => {
  const bps = Number(props.product?.earn_bps || 0)
  if (!(bps > 0) || !(minSale.value > 0)) return null
  return Math.floor((minSale.value * bps) / 10000)
})
const maxCoupon = computed(() => (props.product?.max_coupon_discount == null ? null : Number(props.product.max_coupon_discount)))
</script>

<template>
  <div class="min-w-0">
    <RouterLink v-if="product.partner_id && sellerName" :to="`/store/${product.partner_id}`" class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
      <Store class="h-4 w-4" aria-hidden="true" />{{ sellerName }}
    </RouterLink>
    <h1 class="mt-1 text-xl font-bold leading-snug text-ink sm:text-2xl">{{ product.title }}</h1>

    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <button v-if="avgRating !== null" type="button" class="inline-flex items-center gap-1 hover:underline" aria-label="리뷰로 이동" @click="emit('reviews')">
        <Star class="h-4 w-4 fill-highlight text-highlight" aria-hidden="true" />
        <span class="font-semibold text-ink">{{ avgRating.toFixed(1) }}</span>
        <span class="text-ink-muted">후기 {{ formatNumber(reviewCount) }}</span>
      </button>
      <span v-else class="text-ink-subtle">아직 후기가 없습니다</span>
    </div>

    <OmAlert v-if="!sel.onSale" tone="warning" class="mt-4">현재 판매하지 않는 상품입니다. 장바구니에 담거나 주문할 수 없습니다.</OmAlert>

    <div class="mt-5 border-t border-line-divider pt-5">
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span v-if="showPct" class="text-2xl font-bold text-accent">{{ discountRate(minOrig, minSale) }}%</span>
        <span class="text-3xl font-bold tracking-tight text-ink">{{ formatNumber(minSale) }}원</span>
        <span v-if="showPct" class="text-sm text-ink-subtle line-through">{{ formatNumber(minOrig) }}원</span>
      </div>
      <p v-if="sel.surgeHidden" class="mt-1 text-2xs text-ink-subtle">최근 정가 인상 이력이 있어 할인율을 표시하지 않습니다</p>
    </div>

    <button
      v-if="maxCoupon !== null && maxCoupon > 0"
      type="button"
      data-testid="coupon-open"
      class="mt-3 flex w-full items-center justify-between rounded-lg border border-dashed border-line-strong px-4 py-2.5 text-sm font-bold text-ink hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      @click="couponOpen = true"
    >
      <span>{{ couponLeft === 0 ? '쿠폰 받음' : `최대 ${formatNumber(maxCoupon)}원 쿠폰 받기` }}</span>
      <span aria-hidden="true">›</span>
    </button>
    <CouponDownloadModal v-model:open="couponOpen" :product-id="product.id" @remaining="couponLeft = $event" />

    <dl class="mt-4 grid gap-2.5 rounded-lg bg-surface-2 p-4 text-sm">
      <div class="flex gap-3">
        <dt class="flex w-20 shrink-0 items-center gap-1.5 text-ink-muted"><Truck class="h-4 w-4" aria-hidden="true" />배송비</dt>
        <dd class="text-ink">{{ shipText || '배송정책 미지정' }}</dd>
      </div>
      <div v-if="shipBy" class="flex gap-3">
        <dt class="flex w-20 shrink-0 items-center gap-1.5 text-ink-muted"><CalendarClock class="h-4 w-4" aria-hidden="true" />출고 예정</dt>
        <dd class="text-ink">{{ shipBy }} 출고 예정</dd>
      </div>
      <div class="flex gap-3">
        <dt class="flex w-20 shrink-0 items-center gap-1.5 text-ink-muted"><BadgePercent class="h-4 w-4" aria-hidden="true" />수량 할인</dt>
        <dd class="text-ink">{{ VOLUME_TIERS.map((t) => `${t.min}개 이상 ${t.pct}%`).join(' · ') }}</dd>
      </div>
      <div v-if="earnPreview !== null" class="flex gap-3">
        <dt class="flex w-20 shrink-0 items-center gap-1.5 text-ink-muted"><PiggyBank class="h-4 w-4" aria-hidden="true" />적립 예정</dt>
        <dd class="text-ink">구매확정 시 {{ formatNumber(earnPreview) }}원</dd>
      </div>
    </dl>

    <div v-if="sel.attributes.length" class="mt-5">
      <OptionSteps :sel="sel" :base-min="minSale" />
    </div>
    <p v-else-if="!skus.length" class="mt-5 text-sm text-ink-muted">등록된 옵션이 없어 구매할 수 없습니다.</p>

    <div v-if="sel.lines.length" class="mt-4 space-y-3">
      <SelectedOptionList :sel="sel" />
      <div class="flex items-baseline justify-between border-t border-line-divider pt-3">
        <span class="text-sm font-medium text-ink">총 상품금액</span>
        <span class="text-xl font-bold tabular-nums text-ink">{{ formatNumber(sel.total) }}원</span>
      </div>
    </div>

    <div class="mt-4 flex gap-2">
      <OmIconButton :label="sel.wished ? '찜 해제' : '찜하기'" variant="outline" size="lg" @click="sel.toggleWish">
        <Heart class="h-5 w-5" :class="sel.wished ? 'fill-accent text-accent' : ''" />
      </OmIconButton>
      <OmButton variant="outline" size="lg" class="flex-1" :disabled="!sel.buyableLines.length" data-testid="detail-cart" @click="sel.addAllToCart()">{{ locale.t('addToCart') }}</OmButton>
      <OmButton variant="primary" size="lg" class="flex-1" :disabled="!sel.buyableLines.length" data-testid="detail-buy" @click="sel.buyNow()">{{ locale.t('buyNow') }}</OmButton>
    </div>

    <div class="mt-4">
      <OmSellerCard
        :store-name="sellerName || '판매자 정보 없음'"
        :grade="product.seller?.grade ?? null"
        :rating="product.seller?.rating ?? null"
        :review-count="reviewCount || null"
        :response-rate="product.seller?.inquiry_response_rate == null ? null : Math.round(product.seller.inquiry_response_rate * 100)"
        :store-href="`/store/${product.partner_id}`"
        :inquiry-href="`/product/${product.slug || product.id}#qna`"
      />
    </div>
  </div>
</template>
