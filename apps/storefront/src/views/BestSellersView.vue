<script setup lang="ts">
// Best sellers (3-11): category tabs plus day/week/month windows. Ranking =
// paid non-refunded units inside the window (server period_sales); products
// without window sales are not ranked.
import { ref, computed, onMounted, watch } from 'vue'
import { userErrorMessage, OmBreadcrumb, OmSkeleton, OmEmptyState, OmErrorState, OmButton, OmStatusTabs } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { useCatalogStore } from '../stores/catalog'
import { API_BASE_URL } from '../config'

const TOP = 30
const PERIODS = [
  { value: 'day', label: '일간' },
  { value: 'week', label: '주간' },
  { value: 'month', label: '월간' }
] as const
const PERIOD_COPY: Record<string, string> = {
  day: '최근 24시간 주문 수량 순입니다. 취소·환불된 수량은 빠집니다.',
  week: '최근 7일 주문 수량 순입니다. 취소·환불된 수량은 빠집니다.',
  month: '최근 30일 주문 수량 순입니다. 취소·환불된 수량은 빠집니다.'
}

const catalog = useCatalogStore()
const products = ref<any[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const category = ref('')
const period = ref<'day' | 'week' | 'month'>('day')

const categoryTabs = computed(() => [
  { value: '', label: '전체' },
  ...catalog.roots.map((c: any) => ({ value: c.slug || c.id, label: c.name }))
])

async function load() {
  loading.value = true
  loadError.value = null
  try {
    await catalog.load()
    const params = new URLSearchParams({ sort: 'popular', period: period.value, limit: String(TOP) })
    if (category.value) params.set('category', category.value)
    const res = await fetch(`${API_BASE_URL}/api/v1/products?${params}`)
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || `베스트셀러를 불러오지 못했습니다`)
    products.value = Array.isArray(json.data) ? json.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '불러오지 못했습니다')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch([category, period], load)

const ranked = computed(() => products.value.filter((p) => Number(p.period_sales) > 0))
</script>

<template>
  <div class="mx-auto max-w-container px-4 py-6 sm:px-6">
    <OmBreadcrumb :items="[{ label: '홈', to: '/' }, { label: '베스트' }]" />
    <header class="mb-4 mt-3">
      <h1 class="text-2xl font-bold text-ink">베스트</h1>
      <p class="mt-1 text-sm text-ink-muted">{{ PERIOD_COPY[period] }} (최대 {{ TOP }}위)</p>
    </header>

    <div class="mb-4 space-y-2">
      <OmStatusTabs v-model="category" :tabs="categoryTabs" />
      <OmStatusTabs v-model="period" :tabs="PERIODS.map((p) => ({ value: p.value, label: p.label }))" />
    </div>

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
