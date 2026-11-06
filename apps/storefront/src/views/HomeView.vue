<script setup lang="ts">
// Buyer home (PHASE 2 redesign on @olmoa/ui).
// Data: /banners (operator-managed), /campaigns/lightning (a real running campaign only), /products, and the
// shared category store. Nothing is filled in when an API returns nothing:
//  - no banner -> a plain brand hero whose three benefits are server rules (auth.js WELCOME_CREDIT,
//    temu-ops.js LATE_COMPENSATION_KRW, orders.js RETURN_WINDOW_DAYS)
//  - no running campaign -> no deal section (previously the top-discount products were shown as "deals")
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ChevronLeft, ChevronRight, Clock, Zap } from 'lucide-vue-next'
import { OmButton, OmIconButton, OmSelect, OmSkeleton, OmEmptyState, OmErrorState, discountRate } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { useCatalogStore } from '../stores/catalog'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const catalog = useCatalogStore()
const locale = useLocaleStore()

const products = ref<any[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const campaign = ref<any>(null)
const deals = ref<any[]>([])
const banners = ref<any[]>([])
const bannerIdx = ref(0)

const activeRoot = ref<string>('ALL')
const sortBy = ref<'popular' | 'discount' | 'price_asc' | 'price_desc'>('popular')
const sortOptions = [
  { value: 'popular', label: '구매 많은 순' },
  { value: 'discount', label: '할인율 높은 순' },
  { value: 'price_asc', label: '낮은 가격 순' },
  { value: 'price_desc', label: '높은 가격 순' }
]

// ---- countdown: only for the running campaign's real ends_at ----------------------------------------
const now = ref(Date.now())
const endsAt = computed(() => {
  const e = campaign.value?.ends_at
  if (!e) return null
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(e) ? e : String(e).replace(' ', 'T') + 'Z')
  return Number.isNaN(t) ? null : t
})
const countdown = computed(() => {
  if (!endsAt.value) return ''
  const s = Math.floor((endsAt.value - now.value) / 1000)
  if (s <= 0) return ''
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':')
})

let tick: ReturnType<typeof setInterval> | null = null
let rotate: ReturnType<typeof setInterval> | null = null
const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
function startRotation() {
  if (rotate) clearInterval(rotate)
  rotate = banners.value.length > 1 && !reducedMotion ? setInterval(() => step(1), 6000) : null
}
function step(d: number) {
  const n = banners.value.length
  if (n) bannerIdx.value = (bannerIdx.value + d + n) % n
}
function goBanner(i: number) { bannerIdx.value = i; startRotation() }

async function getJson(path: string) {
  const res = await fetch(`${API_BASE_URL}${path}`)
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) throw new Error(json?.error || `${path} (${res.status})`)
  return json
}

async function load() {
  loading.value = true
  loadError.value = null
  catalog.load()
  // Optional sections fail quietly (they are simply not shown); the product list is the page's content.
  getJson('/api/v1/banners').then((j) => { banners.value = Array.isArray(j.data) ? j.data : []; startRotation() }).catch(() => { banners.value = [] })
  getJson('/api/v1/campaigns/lightning').then((j) => { campaign.value = j.data?.campaign || null; deals.value = (j.data?.deals || []).slice(0, 6) }).catch(() => { campaign.value = null; deals.value = [] })
  try {
    const j = await getJson('/api/v1/products')
    products.value = Array.isArray(j.data) ? j.data : []
  } catch (e: any) {
    loadError.value = e?.message || '상품을 불러오지 못했습니다'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  tick = setInterval(() => { now.value = Date.now() }, 1000)
  load()
})
onUnmounted(() => { if (tick) clearInterval(tick); if (rotate) clearInterval(rotate) })
watch(() => banners.value.length, () => { if (bannerIdx.value >= banners.value.length) bannerIdx.value = 0 })

// ---- product list: client-side filter by root category (the list is the full active catalogue) --------
const roots = computed(() => catalog.roots.filter((c) => Number(c.product_count) > 0))
const rootTabs = computed(() => [{ slug: 'ALL', name: '전체', count: products.value.length }, ...roots.value.map((c) => ({ slug: c.slug, name: c.name, count: Number(c.product_count) }))])
const visible = computed(() => {
  let list = products.value
  if (activeRoot.value !== 'ALL') list = list.filter((p) => p.category_slug === activeRoot.value || p.parent_category_slug === activeRoot.value)
  const rate = (p: any) => discountRate(p.lowest_original_price, p.lowest_sale_price)
  const sorted = [...list]
  if (sortBy.value === 'price_asc') sorted.sort((a, b) => a.lowest_sale_price - b.lowest_sale_price)
  else if (sortBy.value === 'price_desc') sorted.sort((a, b) => b.lowest_sale_price - a.lowest_sale_price)
  else if (sortBy.value === 'discount') sorted.sort((a, b) => rate(b) - rate(a))
  else sorted.sort((a, b) => (b.total_sold_count || 0) - (a.total_sold_count || 0))
  return sorted
})
const activeRootName = computed(() => rootTabs.value.find((t) => t.slug === activeRoot.value)?.name || '전체')

const banner = computed(() => banners.value[bannerIdx.value] || null)
const benefits = [
  { value: '10,000원', label: '신규 가입 적립금', to: '/register' },
  { value: '5,300원', label: '배송 예정일 초과 시 적립', to: '/policy/shipping' },
  { value: '7일', label: '배송 완료 후 반품 신청', to: '/legal/refund' }
]
</script>

<template>
  <div class="pb-16">
    <!-- Hero ---------------------------------------------------------------------------------------- -->
    <section class="mx-auto max-w-container px-4 pt-4 sm:px-6 sm:pt-6" aria-label="프로모션">
      <div v-if="banner" class="relative overflow-hidden rounded-xl bg-secondary text-white">
        <img :src="banner.image_url" alt="" class="absolute inset-0 h-full w-full object-cover opacity-60" fetchpriority="high" />
        <div class="absolute inset-0 bg-gradient-to-r from-black/75 via-black/40 to-transparent" aria-hidden="true" />
        <div class="relative flex min-h-[220px] flex-col justify-end gap-3 p-6 sm:min-h-[300px] sm:p-10" aria-live="polite">
          <span v-if="banner.badge_text" class="w-fit rounded-sm bg-white/15 px-2 py-0.5 text-2xs font-semibold tracking-wide backdrop-blur">{{ banner.badge_text }}</span>
          <h1 class="max-w-xl text-2xl font-bold leading-tight sm:text-4xl">{{ banner.title }}</h1>
          <p v-if="banner.subtitle" class="max-w-xl text-sm text-white/85 sm:text-md">{{ banner.subtitle }}</p>
          <div><OmButton :to="banner.link_url" variant="primary" size="md">자세히 보기</OmButton></div>
        </div>
        <div v-if="banners.length > 1" class="absolute bottom-4 right-4 flex items-center gap-2">
          <span class="rounded-full bg-black/40 px-2.5 py-1 text-2xs tabular-nums">{{ bannerIdx + 1 }} / {{ banners.length }}</span>
          <OmIconButton label="이전 배너" size="sm" class="!bg-black/40 !text-white hover:!bg-black/60" @click="step(-1); startRotation()"><ChevronLeft class="h-4 w-4" /></OmIconButton>
          <OmIconButton label="다음 배너" size="sm" class="!bg-black/40 !text-white hover:!bg-black/60" @click="step(1); startRotation()"><ChevronRight class="h-4 w-4" /></OmIconButton>
        </div>
        <div v-if="banners.length > 1" class="sr-only">
          <button v-for="(b, i) in banners" :key="b.id" type="button" @click="goBanner(i)">{{ i + 1 }}번 배너: {{ b.title }}</button>
        </div>
      </div>

      <div v-else class="grid gap-6 rounded-xl border border-line bg-surface p-6 sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <p class="text-xs font-semibold text-primary">OLMOA</p>
          <h1 class="mt-2 text-2xl font-bold leading-tight text-ink sm:text-3xl">직영 상품과 입점 판매자 상품을<br class="hidden sm:inline" /> 한 장바구니에서 결제하세요</h1>
          <p class="mt-3 text-sm text-ink-muted">판매자마다 배송비와 무료배송 기준이 다르며, 장바구니에서 판매자별로 나누어 계산됩니다.</p>
          <div class="mt-5 flex flex-wrap gap-2">
            <OmButton to="/categories" variant="primary">카테고리 둘러보기</OmButton>
            <OmButton to="/channel/best-sellers" variant="outline">베스트 상품</OmButton>
          </div>
        </div>
        <ul class="grid grid-cols-3 gap-2 sm:gap-3">
          <li v-for="b in benefits" :key="b.label">
            <RouterLink :to="b.to" class="flex h-full flex-col justify-between rounded-lg bg-surface-2 p-3 transition hover:bg-surface-3 sm:p-4">
              <span class="text-lg font-bold text-ink sm:text-xl">{{ b.value }}</span>
              <span class="mt-1 text-2xs text-ink-muted sm:text-xs">{{ b.label }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>

    <div class="mx-auto mt-8 max-w-container space-y-10 px-4 sm:px-6">
      <!-- Lightning deals: only a real running campaign ---------------------------------------------- -->
      <section v-if="campaign && deals.length" aria-labelledby="deals-title">
        <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div class="flex flex-wrap items-center gap-3">
            <h2 id="deals-title" class="flex items-center gap-1.5 text-xl font-bold text-ink"><Zap class="h-5 w-5 text-accent" aria-hidden="true" />번개특가</h2>
            <span v-if="countdown" class="inline-flex items-center gap-1 rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent tabular-nums">
              <Clock class="h-3.5 w-3.5" aria-hidden="true" />{{ countdown }} 남음
            </span>
          </div>
          <RouterLink to="/channel/lightning-deals" class="text-sm font-medium text-ink-muted hover:text-ink">전체 보기</RouterLink>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <!-- No sold/remaining bars: flash_sale_items.sold_stock is never updated by orders (see LightningDealsView). -->
          <ProductCard v-for="d in deals" :key="d.id" :product="d" />
        </div>
      </section>

      <!-- Catalogue -------------------------------------------------------------------------------- -->
      <section aria-labelledby="catalog-title">
        <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 id="catalog-title" class="text-xl font-bold text-ink">{{ activeRoot === 'ALL' ? '지금 판매 중인 상품' : activeRootName }}</h2>
          <div class="w-44"><OmSelect v-model="sortBy" :options="sortOptions" size="sm" aria-label="정렬" /></div>
        </div>

        <div v-if="rootTabs.length > 1" class="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="카테고리 필터">
          <button
            v-for="t in rootTabs"
            :key="t.slug"
            type="button"
            :aria-pressed="activeRoot === t.slug"
            class="shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            :class="activeRoot === t.slug ? 'border-secondary bg-secondary text-secondary-on' : 'border-line bg-surface text-ink hover:border-line-strong'"
            @click="activeRoot = t.slug"
          >
            {{ t.name }} <span class="tabular-nums" :class="activeRoot === t.slug ? 'text-secondary-on/70' : 'text-ink-subtle'">{{ t.count }}</span>
          </button>
          <RouterLink to="/categories" class="shrink-0 rounded-full border border-dashed border-line-strong px-3.5 py-1.5 text-sm text-ink-muted hover:text-ink">전체 카테고리</RouterLink>
        </div>

        <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="10" /></div>
        <OmErrorState v-else-if="loadError" :message="loadError" :retrying="loading" @retry="load" />
        <OmEmptyState
          v-else-if="!visible.length"
          :title="activeRoot === 'ALL' ? '판매 중인 상품이 없습니다' : `${activeRootName}에 판매 중인 상품이 없습니다`"
          description="다른 카테고리를 선택하거나 검색해 보세요."
        >
          <OmButton v-if="activeRoot !== 'ALL'" variant="outline" size="sm" @click="activeRoot = 'ALL'">전체 상품 보기</OmButton>
        </OmEmptyState>
        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          <ProductCard v-for="(p, i) in visible" :key="p.id" :product="p" :eager="i < 5" />
        </div>
        <p v-if="!loading && !loadError && visible.length" class="mt-4 text-xs text-ink-subtle">
          {{ visible.length.toLocaleString() }}개 상품 · 가격은 {{ locale.currency === 'KRW' ? '원화' : `${locale.currency} 환산 표시이며 결제는 원화` }} 기준
        </p>
      </section>
    </div>
  </div>
</template>
