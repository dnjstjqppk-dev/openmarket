<script setup lang="ts">
// Best sellers (PHASE 2 redesign). Ranking = server sort "popular" (products.total_sold_count DESC): units
// ordered, minus cancelled/expired/refunded-and-restocked units. The old header ("Real-Time Verified Sales
// Leaderboard", "Ranked hourly by verified net non-cancelled order volume and buyer satisfaction") described a
// ranking job that does not exist. Products without any order are not ranked.
import { ref, computed, onMounted } from 'vue'
import { OmBreadcrumb, OmSkeleton, OmEmptyState, OmErrorState, OmButton } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { API_BASE_URL } from '../config'

const TOP = 30
const products = ref<any[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products?sort=popular&limit=${TOP}`)
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || `불러오지 못했습니다 (${res.status})`)
    products.value = Array.isArray(json.data) ? json.data : []
  } catch (e: any) {
    loadError.value = e?.message || '불러오지 못했습니다'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const ranked = computed(() => products.value.filter((p) => Number(p.total_sold_count) > 0))
</script>

<template>
  <div class="mx-auto max-w-container px-4 py-6 sm:px-6">
    <OmBreadcrumb :items="[{ label: '홈', to: '/' }, { label: '베스트' }]" />
    <header class="mb-6 mt-3">
      <h1 class="text-2xl font-bold text-ink">베스트</h1>
      <p class="mt-1 text-sm text-ink-muted">주문 수량이 많은 순서입니다. 취소·만료·환불된 수량은 빠집니다. (최대 {{ TOP }}위)</p>
    </header>

    <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="10" /></div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <OmEmptyState v-else-if="!ranked.length" title="아직 집계할 주문이 없습니다" description="주문이 생기면 주문 수량 순으로 표시됩니다.">
      <OmButton to="/" variant="outline" size="sm">전체 상품 보기</OmButton>
    </OmEmptyState>
    <ol v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      <li v-for="(p, i) in ranked" :key="p.id"><ProductCard :product="p" :rank="i + 1" :eager="i < 5" /></li>
    </ol>
  </div>
</template>
