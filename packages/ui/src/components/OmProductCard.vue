<script setup lang="ts">
// Product tile for every buyer grid (3-3): 1:1 thumbnail with hover zoom,
// sold-out scrim, rank/deal/direct corner, wishlist + quick-add actions,
// store/name/price/badge/rating stack. Only API facts are shown:
//  - discount: only when the list price is really higher (discountRate)
//  - rating: only when there are reviews
//  - "무료배송": only when ONE unit already ships free under the server rule
//  - "오늘출발": policy with a cutoff exists and the buyer-local clock is before it
//  - "내일출발": tomorrow enabled and the buyer-local clock is past the cutoff
//  - "쿠폰"/"적립": server has_coupon / earn_bps flags
// Actions emit to the app wrapper (wishlist store, cart store, quick sheet);
// this component never calls APIs itself.
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Heart, ShoppingCart, Star } from 'lucide-vue-next'
import OmCommerceBadge from './OmCommerceBadge.vue'
import OmPrice from './OmPrice.vue'
import { discountRate, formatNumber } from '../format'

const props = withDefaults(defineProps<{
  product: any
  rank?: number | null
  eager?: boolean
  wished?: boolean
  formatPrice?: (n: number) => string
}>(), { rank: null, eager: false, wished: false })
const emit = defineEmits<{ wish: []; add: [] }>()

const sale = computed(() => Number(props.product.deal_price ?? props.product.lowest_sale_price ?? 0))
const original = computed(() => Number(props.product.lowest_original_price ?? props.product.original_price ?? 0))
const discount = computed(() => discountRate(original.value, sale.value))
const reviews = computed(() => Number(props.product.review_count || 0))
const rating = computed(() => (reviews.value > 0 && props.product.avg_rating != null ? Number(props.product.avg_rating) : null))
const seller = computed(() => props.product.business_name || props.product.brand || props.product.partner_name || '')
const soldOut = computed(() => Number(props.product.in_stock ?? 1) === 0)
const isDeal = computed(() => Array.isArray(props.product.badges) && props.product.badges.includes('DEAL'))
const isDirect = computed(() => props.product.sales_model === 'DIRECT')
const freeShipping = computed(() => {
  const fee = props.product.base_shipping_fee
  const threshold = props.product.free_shipping_threshold
  if (fee == null) return false
  return Number(fee) === 0 || (threshold != null && Number(threshold) > 0 && sale.value >= Number(threshold))
})
const todayDispatch = computed(() => {
  if (!props.product.has_today) return false
  const cut = String(props.product.today_cutoff || '')
  const m = /^(\d{1,2}):(\d{2})/.exec(cut)
  if (!m) return true
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes() < Number(m[1]) * 60 + Number(m[2])
})
const tomorrowDispatch = computed(() => {
  if (!props.product.has_tomorrow) return false
  const cut = String(props.product.today_cutoff || '')
  const m = /^(\d{1,2}):(\d{2})/.exec(cut)
  if (!m) return false
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes() >= Number(m[1]) * 60 + Number(m[2])
})
const hasCoupon = computed(() => Number(props.product.has_coupon ?? 0) === 1)
const hasEarn = computed(() => {
  const bps = props.product.earn_bps
  return bps !== null && bps !== undefined && Number(bps) > 0
})
const monthSales = computed(() => {
  const n = Number(props.product.sales_30d ?? 0)
  if (!Number.isFinite(n) || n < 10) return null
  return n >= 1000 ? '1천+' : formatNumber(n)
})
const to = computed(() => `/product/${props.product.slug || props.product.product_id || props.product.id}`)

const popping = ref(false)
let popTimer: ReturnType<typeof setTimeout> | null = null
function onWish() {
  emit('wish')
  popping.value = true
  if (popTimer) clearTimeout(popTimer)
  popTimer = setTimeout(() => { popping.value = false }, 200)
}
</script>

<template>
  <div class="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition duration-fast ease-om hover:border-line-strong hover:shadow-md" data-testid="product-card">
    <div class="relative aspect-square overflow-hidden bg-surface-2">
      <RouterLink :to="to" tabindex="-1" aria-hidden="true" class="block h-full w-full focus-visible:outline-none">
        <img
          :src="product.thumbnail_url"
          :alt="product.title"
          :loading="eager ? 'eager' : 'lazy'"
          decoding="async"
          class="h-full w-full object-cover transition duration-slow ease-om group-hover:scale-105"
        />
      </RouterLink>
      <span
        v-if="rank"
        class="absolute left-2 top-2 inline-flex h-7 min-w-7 items-center justify-center rounded-sm bg-secondary px-1.5 text-xs font-bold text-secondary-on"
      >{{ rank }}</span>
      <span v-else-if="isDeal" class="absolute left-2 top-2"><OmCommerceBadge kind="deal" /></span>
      <span v-else-if="isDirect" class="absolute left-2 top-2"><OmCommerceBadge kind="direct" /></span>
      <div v-if="soldOut" class="absolute inset-0 flex items-center justify-center bg-surface/70" aria-hidden="true">
        <span class="rounded-full bg-surface px-4 py-1.5 text-sm font-bold text-ink">품절</span>
      </div>
      <div class="absolute bottom-2 right-2 flex gap-1.5">
        <button
          type="button"
          data-testid="wish-toggle"
          :aria-label="wished ? '찜 해제' : '찜하기'"
          :aria-pressed="wished"
          class="rounded-full bg-surface p-2 shadow-md transition duration hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          :class="popping ? 'scale-125' : 'scale-100'"
          @click.stop="onWish"
        >
          <Heart class="h-4 w-4" :class="wished ? 'fill-accent text-accent' : 'text-ink'" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="quick-add"
          aria-label="장바구니 담기"
          :disabled="soldOut"
          class="rounded-full bg-surface p-2 shadow-md transition duration hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
          @click.stop="emit('add')"
        >
          <ShoppingCart class="h-4 w-4 text-ink" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="flex flex-1 flex-col gap-1.5 p-3">
      <p v-if="seller" class="truncate text-xs text-ink-muted">{{ seller }}</p>
      <RouterLink :to="to" class="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-tight text-ink hover:underline hover:decoration-line-strong hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        {{ product.title }}
      </RouterLink>

      <OmPrice :sale="sale" :original="discount > 0 ? original : null" size="card" />

      <div class="flex min-h-[1.25rem] flex-wrap items-center gap-1">
        <OmCommerceBadge v-if="freeShipping" kind="free-ship" />
        <OmCommerceBadge v-if="todayDispatch" kind="today" />
        <OmCommerceBadge v-else-if="tomorrowDispatch" kind="tomorrow" />
        <OmCommerceBadge v-if="hasCoupon" kind="coupon" />
        <OmCommerceBadge v-if="hasEarn" kind="point" />
      </div>

      <div class="flex min-h-[1.25rem] flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-muted">
        <span v-if="rating !== null" class="inline-flex items-center gap-0.5">
          <Star class="h-3 w-3 fill-rating text-rating" aria-hidden="true" />
          <span class="font-semibold text-ink">{{ rating.toFixed(1) }}</span>
        </span>
        <span v-if="monthSales !== null">최근 30일 {{ monthSales }}개 구매</span>
      </div>
    </div>
  </div>
</template>
