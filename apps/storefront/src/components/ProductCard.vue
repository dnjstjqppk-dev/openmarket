<script setup lang="ts">
// Product tile used by every buyer product grid (home, search, category, best sellers, seller store, wishlist).
// Only facts from the API are shown:
//  - discount: only when the list price is really higher than the sale price (discountRate)
//  - rating: only when there are reviews
//  - order count: products.total_sold_count, only when > 0. It is incremented when an order is created and
//    decremented on cancel/expiry/refund restock (services/orders.js), so it is "ordered", not "paid" —
//    labelled "주문 N개". Seeded counts were removed in d1_30.
//  - "무료배송": only when ONE unit already ships free under the server rule (services/orders.js:
//    fee = threshold > 0 && goods >= threshold ? 0 : base fee; defaults 3,000 / 30,000)
// There is no quick-add: the cheapest SKU is not necessarily the option the buyer wants, so options are
// always chosen on the product page.
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Star } from 'lucide-vue-next'
import { OmBadge, discountRate, formatNumber } from '@olmoa/ui'
import { useLocaleStore } from '../stores/locale'

const props = withDefaults(defineProps<{ product: any; rank?: number | null; eager?: boolean }>(), { rank: null, eager: false })
const locale = useLocaleStore()

const sale = computed(() => Number(props.product.deal_price ?? props.product.lowest_sale_price ?? 0))
const original = computed(() => Number(props.product.lowest_original_price ?? props.product.original_price ?? 0))
const discount = computed(() => discountRate(original.value, sale.value))
const reviews = computed(() => Number(props.product.review_count || 0))
const rating = computed(() => (reviews.value > 0 && props.product.avg_rating != null ? Number(props.product.avg_rating) : null))
const sold = computed(() => Number(props.product.total_sold_count || 0))
const seller = computed(() => props.product.business_name || props.product.brand || props.product.partner_name || '')
// Endpoints that do not return the seller's policy (wishlist, deals) get no badge: guessing with the defaults
// could claim free shipping for a seller whose real threshold is higher.
const freeShipping = computed(() => {
  const fee = props.product.base_shipping_fee
  const threshold = props.product.free_shipping_threshold
  if (fee == null) return false
  return Number(fee) === 0 || (threshold != null && Number(threshold) > 0 && sale.value >= Number(threshold))
})
const to = computed(() => `/product/${props.product.slug || props.product.product_id || props.product.id}`)
</script>

<template>
  <RouterLink
    :to="to"
    class="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition duration-fast ease-om hover:border-line-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
  >
    <div class="relative aspect-square overflow-hidden bg-surface-2">
      <img
        :src="product.thumbnail_url"
        :alt="product.title"
        :loading="eager ? 'eager' : 'lazy'"
        decoding="async"
        class="h-full w-full object-cover transition duration-slow ease-om group-hover:scale-[1.03]"
      />
      <span
        v-if="rank"
        class="absolute left-2 top-2 inline-flex h-7 min-w-7 items-center justify-center rounded-sm bg-secondary px-1.5 text-xs font-bold text-secondary-on"
      >{{ rank }}</span>
    </div>

    <div class="flex flex-1 flex-col gap-1.5 p-3">
      <p v-if="seller" class="truncate text-2xs text-ink-muted">{{ seller }}</p>
      <h3 class="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-tight text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-2">
        {{ product.title }}
      </h3>

      <div class="mt-auto flex flex-wrap items-baseline gap-x-1.5">
        <span v-if="discount > 0" class="text-md font-bold text-accent">{{ discount }}%</span>
        <span class="text-md font-bold text-ink">{{ locale.formatPrice(sale) }}</span>
        <span v-if="discount > 0" class="text-2xs text-ink-subtle line-through">{{ locale.formatPrice(original) }}</span>
      </div>

      <div class="flex min-h-[1.25rem] flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-muted">
        <span v-if="rating !== null" class="inline-flex items-center gap-0.5">
          <Star class="h-3 w-3 fill-highlight text-highlight" aria-hidden="true" />
          <span class="font-semibold text-ink">{{ rating.toFixed(1) }}</span>
          <span>({{ formatNumber(reviews) }})</span>
        </span>
        <span v-if="sold > 0">주문 {{ formatNumber(sold) }}개</span>
        <OmBadge v-if="freeShipping" tone="primary">무료배송</OmBadge>
      </div>
    </div>
  </RouterLink>
</template>
