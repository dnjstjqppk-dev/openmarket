<script setup lang="ts">
// Search results (PHASE 2 redesign). Server: /products?q=&sort=&min_price=&max_price=&limit= (title, description,
// category name and the synonym table). The server returns at most LIMIT rows, so when that many come back the
// page says "상위 N개" instead of presenting it as the total.
import { ref, watch, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SearchX } from 'lucide-vue-next'
import { OmButton, OmInput, OmTabs, OmSkeleton, OmEmptyState, OmErrorState, formatNumber } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { API_BASE_URL } from '../config'

const LIMIT = 200
const route = useRoute()
const router = useRouter()

const sortTabs = [
  { key: 'popular', label: '구매 많은 순' },
  { key: 'newest', label: '최신 순' },
  { key: 'rating', label: '평점 순' },
  { key: 'price_asc', label: '낮은 가격' },
  { key: 'price_desc', label: '높은 가격' }
]
const sortKeys = sortTabs.map((t) => t.key)

const q = computed(() => String(route.query.q || '').trim())
const sort = ref('popular')
const minPrice = ref<string | number>('')
const maxPrice = ref<string | number>('')
const priceError = ref<string | null>(null)
const products = ref<any[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

function syncFromRoute() {
  const s = String(route.query.sort || 'popular')
  sort.value = sortKeys.includes(s) ? s : 'popular'
  minPrice.value = String(route.query.min_price || '')
  maxPrice.value = String(route.query.max_price || '')
}

let seq = 0
async function load() {
  const my = ++seq
  loading.value = true
  loadError.value = null
  const params = new URLSearchParams({ sort: sort.value, limit: String(LIMIT) })
  if (q.value) params.set('q', q.value)
  if (route.query.min_price) params.set('min_price', String(route.query.min_price))
  if (route.query.max_price) params.set('max_price', String(route.query.max_price))
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products?${params}`)
    const json = await res.json().catch(() => null)
    if (my !== seq) return
    if (!res.ok || !json?.success) throw new Error(json?.error || `검색하지 못했습니다 (${res.status})`)
    products.value = Array.isArray(json.data) ? json.data : []
  } catch (e: any) {
    if (my === seq) loadError.value = e?.message || '검색하지 못했습니다'
  } finally {
    if (my === seq) loading.value = false
  }
}

function push(extra: Record<string, string | undefined> = {}) {
  router.push({
    path: '/search',
    query: {
      q: q.value || undefined,
      sort: sort.value !== 'popular' ? sort.value : undefined,
      min_price: minPrice.value !== '' ? String(minPrice.value) : undefined,
      max_price: maxPrice.value !== '' ? String(maxPrice.value) : undefined,
      ...extra
    }
  })
}
function onSort(key: string) { sort.value = key; push() }
function applyPrice() {
  const min = minPrice.value === '' ? null : Number(minPrice.value)
  const max = maxPrice.value === '' ? null : Number(maxPrice.value)
  if ((min !== null && (!Number.isInteger(min) || min < 0)) || (max !== null && (!Number.isInteger(max) || max < 0))) {
    priceError.value = '가격은 0 이상의 정수(원)로 입력해 주세요.'
    return
  }
  if (min !== null && max !== null && min > max) { priceError.value = '최소 가격이 최대 가격보다 큽니다.'; return }
  priceError.value = null
  push()
}
function clearPrice() { minPrice.value = ''; maxPrice.value = ''; priceError.value = null; push() }

onMounted(() => { syncFromRoute(); load() })
watch(() => route.fullPath, () => { if (route.path === '/search') { syncFromRoute(); load() } })

const capped = computed(() => products.value.length >= LIMIT)
const hasPriceFilter = computed(() => !!(route.query.min_price || route.query.max_price))
</script>

<template>
  <div class="mx-auto max-w-container px-4 py-6 sm:px-6">
    <header class="mb-5">
      <h1 class="text-2xl font-bold text-ink">
        <template v-if="q">‘{{ q }}’ 검색 결과</template>
        <template v-else>전체 상품</template>
      </h1>
      <p v-if="!loading && !loadError" class="mt-1 text-sm text-ink-muted">
        {{ capped ? `상위 ${formatNumber(LIMIT)}개 표시` : `${formatNumber(products.length)}개 상품` }}
        <span v-if="capped"> · 검색어나 가격 범위를 좁혀 보세요</span>
      </p>
    </header>

    <div class="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <OmTabs :model-value="sort" :tabs="sortTabs" variant="pill" @update:model-value="onSort" />
      <form class="flex flex-wrap items-start gap-2" @submit.prevent="applyPrice">
        <div class="w-28"><OmInput v-model="minPrice" type="number" size="sm" placeholder="최소 원" aria-label="최소 가격(원)" min="0" inputmode="numeric" /></div>
        <span class="pt-1.5 text-ink-subtle">~</span>
        <div class="w-28"><OmInput v-model="maxPrice" type="number" size="sm" placeholder="최대 원" aria-label="최대 가격(원)" min="0" inputmode="numeric" /></div>
        <OmButton type="submit" size="sm" variant="outline">적용</OmButton>
        <OmButton v-if="hasPriceFilter" size="sm" variant="ghost" @click="clearPrice">초기화</OmButton>
        <p v-if="priceError" class="basis-full text-xs text-danger" role="alert">{{ priceError }}</p>
      </form>
    </div>

    <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="10" /></div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <OmEmptyState
      v-else-if="!products.length"
      :title="q ? `‘${q}’에 대한 상품이 없습니다` : '조건에 맞는 상품이 없습니다'"
      :description="hasPriceFilter ? '가격 범위를 넓히거나 다른 검색어를 입력해 보세요.' : '철자를 확인하거나 더 일반적인 단어로 검색해 보세요.'"
    >
      <template #icon><SearchX class="h-8 w-8 text-ink-subtle" aria-hidden="true" /></template>
      <OmButton v-if="hasPriceFilter" size="sm" variant="outline" @click="clearPrice">가격 조건 지우기</OmButton>
      <OmButton to="/categories" size="sm" variant="ghost">카테고리 둘러보기</OmButton>
    </OmEmptyState>
    <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      <ProductCard v-for="(p, i) in products" :key="p.id" :product="p" :eager="i < 5" />
    </div>
  </div>
</template>
