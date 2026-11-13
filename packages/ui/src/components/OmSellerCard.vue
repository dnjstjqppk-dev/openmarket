<script setup lang="ts">
// Seller mini profile: grade, rating, reviews, response rate, store home, inquiry.
import { Star } from 'lucide-vue-next'
import { formatNumber } from '../format'

withDefaults(defineProps<{
  storeName: string
  grade?: string | null
  rating?: number | null
  reviewCount?: number | null
  responseRate?: number | null
  storeHref: string
  inquiryHref: string
}>(), { grade: null, rating: null, reviewCount: null, responseRate: null })
</script>

<template>
  <div class="rounded-lg border border-line bg-surface p-4">
    <div class="flex items-center justify-between gap-2">
      <p class="truncate text-sm font-bold text-ink">{{ storeName }}</p>
      <span v-if="grade" class="shrink-0 rounded bg-primary-soft px-2 py-0.5 text-2xs font-bold text-primary-soft-ink">{{ grade }}</span>
    </div>
    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
      <span v-if="rating !== null && reviewCount" class="inline-flex items-center gap-1">
        <Star class="h-3.5 w-3.5 fill-rating text-rating" aria-hidden="true" />
        <span class="font-semibold text-ink om-num">{{ Number(rating).toFixed(1) }}</span>
        <span class="om-num">({{ formatNumber(reviewCount) }})</span>
      </span>
      <span v-if="responseRate !== null && responseRate !== undefined" class="om-num">응답률 {{ responseRate }}%</span>
    </div>
    <div class="mt-3 flex gap-2">
      <a :href="storeHref" class="flex h-9 flex-1 items-center justify-center rounded-lg border border-line text-xs font-bold transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">스토어 홈</a>
      <a :href="inquiryHref" class="flex h-9 flex-1 items-center justify-center rounded-lg bg-secondary text-xs font-bold text-secondary-on transition-colors hover:bg-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">문의</a>
    </div>
  </div>
</template>
