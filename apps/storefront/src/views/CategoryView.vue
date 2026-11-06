<script setup lang="ts">
// Category page (PHASE 2 redesign). Products: /products?category=<slug> (server includes direct children);
// category tree from the shared store. "verified products available with instant shipping" and the blanket
// "무료배송" badge were not facts and are gone; ProductCard shows free shipping only where it applies.
import { ref, watch, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { RouterLink } from 'vue-router'
import { OmBreadcrumb, OmSelect, OmSkeleton, OmEmptyState, OmErrorState, OmButton, discountRate, formatNumber } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { useCatalogStore } from '../stores/catalog'
import { API_BASE_URL } from '../config'

const route = useRoute()
const catalog = useCatalogStore()
const products = ref<any[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const sortBy = ref<'popular' | 'discount' | 'price_asc' | 'price_desc' | 'newest'>('popular')
const sortOptions = [
  { value: 'popular', label: '구매 많은 순' },
  { value: 'newest', label: '최신 등록 순' },
  { value: 'discount', label: '할인율 높은 순' },
  { value: 'price_asc', label: '낮은 가격 순' },
  { value: 'price_desc', label: '높은 가격 순' }
]

const slug = computed(() => String(route.params.slug || ''))
const current = computed(() => catalog.bySlugOrId(slug.value))
const parent = computed(() => (current.value?.parent_id ? catalog.categories.find((c) => c.id === current.value!.parent_id) || null : null))
// On a sub-category show its siblings, on a root show its children.
const chips = computed(() => {
  if (!current.value) return []
  const base = parent.value ? catalog.childrenOf(parent.value.id) : catalog.childrenOf(current.value.id)
  return base.filter((c) => Number(c.product_count) > 0 || c.id === current.value!.id)
})
const crumbs = computed(() => [
  { label: '홈', to: '/' },
  { label: '전체 카테고리', to: '/categories' },
  ...(parent.value ? [{ label: parent.value.name, to: `/category/${parent.value.slug}` }] : []),
  { label: current.value?.name || slug.value }
])

let seq = 0
async function load() {
  const my = ++seq
  loading.value = true
  loadError.value = null
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products?category=${encodeURIComponent(slug.value)}&limit=200`)
    const json = await res.json().catch(() => null)
    if (my !== seq) return // a newer category was opened meanwhile
    if (!res.ok || !json?.success) throw new Error(json?.error || `상품을 불러오지 못했습니다 (${res.status})`)
    products.value = Array.isArray(json.data) ? json.data : []
  } catch (e: any) {
    if (my === seq) loadError.value = e?.message || '상품을 불러오지 못했습니다'
  } finally {
    if (my === seq) loading.value = false
  }
}
onMounted(() => { catalog.load(); load() })
watch(slug, () => { sortBy.value = 'popular'; load() })

const sorted = computed(() => {
  const list = [...products.value]
  const rate = (p: any) => discountRate(p.lowest_original_price, p.lowest_sale_price)
  if (sortBy.value === 'price_asc') return list.sort((a, b) => a.lowest_sale_price - b.lowest_sale_price)
  if (sortBy.value === 'price_desc') return list.sort((a, b) => b.lowest_sale_price - a.lowest_sale_price)
  if (sortBy.value === 'discount') return list.sort((a, b) => rate(b) - rate(a))
  if (sortBy.value === 'newest') return list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  return list.sort((a, b) => (b.total_sold_count || 0) - (a.total_sold_count || 0))
})
const unknownCategory = computed(() => catalog.loaded && !current.value)
</script>

<template>
  <div class="mx-auto max-w-container px-4 py-6 sm:px-6">
    <OmBreadcrumb :items="crumbs" />

    <header class="mb-5 mt-3">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-ink">{{ current?.name || (unknownCategory ? '카테고리를 찾을 수 없습니다' : '') }}</h1>
          <p v-if="!loading && !loadError" class="mt-1 text-sm text-ink-muted">판매 중인 상품 {{ formatNumber(products.length) }}개</p>
        </div>
        <div class="w-44"><OmSelect v-model="sortBy" :options="sortOptions" size="sm" aria-label="정렬" /></div>
      </div>
      <nav v-if="chips.length" class="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" aria-label="하위 카테고리">
        <RouterLink
          v-if="parent"
          :to="`/category/${parent.slug}`"
          class="shrink-0 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-ink hover:border-line-strong"
        >{{ parent.name }} 전체</RouterLink>
        <RouterLink
          v-for="c in chips"
          :key="c.id"
          :to="`/category/${c.slug}`"
          :aria-current="c.id === current?.id ? 'page' : undefined"
          class="shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition"
          :class="c.id === current?.id ? 'border-secondary bg-secondary text-secondary-on' : 'border-line bg-surface text-ink hover:border-line-strong'"
        >
          {{ c.name }} <span class="tabular-nums" :class="c.id === current?.id ? 'text-secondary-on/70' : 'text-ink-subtle'">{{ c.product_count }}</span>
        </RouterLink>
      </nav>
    </header>

    <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="10" /></div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <OmEmptyState v-else-if="!sorted.length" :title="unknownCategory ? '존재하지 않는 카테고리입니다' : '이 카테고리에 판매 중인 상품이 없습니다'" description="다른 카테고리를 둘러보거나 검색해 보세요.">
      <OmButton to="/categories" variant="outline" size="sm">전체 카테고리</OmButton>
    </OmEmptyState>
    <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      <ProductCard v-for="(p, i) in sorted" :key="p.id" :product="p" :eager="i < 5" />
    </div>
  </div>
</template>
