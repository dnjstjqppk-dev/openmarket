<script setup lang="ts">
// Buyer home (3-1): banner carousel, category shortcuts, lightning deals,
// best ranking, exhibitions, for-you (authed) and an infinite all-products
// grid. Empty sections are hidden wholesale. First screen costs at most six
// requests (banners, lightning, categories, exhibitions, products p1 and,
// when logged in, for-you); ranking tabs lazy-load on click.
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Zap } from 'lucide-vue-next'
import { userErrorMessage, OmButton, OmSkeleton, OmEmptyState, OmErrorState, OmCarousel, OmCountdown, OmProgress, formatNumber, injectJsonLd } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { organizationGraph } from '../../../cloudflare-gateway/src/lib/site-entity.js'
import { useCatalogStore } from '../stores/catalog'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const catalog = useCatalogStore()
const auth = useAuthStore()
const locale = useLocaleStore()

const PAGE_SIZE = 40

const banners = ref<any[]>([])
const bannerIdx = ref(0)
const campaign = ref<any>(null)
const deals = ref<any[]>([])
const exhibitions = ref<any[]>([])
const forYou = ref<any[]>([])
const products = ref<any[]>([])
const totalProducts = ref(0)
const page = ref(1)
const totalPages = ref(1)
const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref<string | null>(null)

const rankTab = ref<string>('ALL')
const rankCache = ref<Record<string, any[]>>({})
const rankLoading = ref(false)

function authHeaders(): Record<string, string> {
  return auth.token ? { Authorization: `Bearer ${auth.token}` } : {}
}

async function getJson(path: string, authed = false) {
  const res = await fetch(`${API_BASE_URL}${path}`, authed ? { headers: authHeaders() } : undefined)
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) throw new Error(json?.error || '불러오지 못했습니다')
  return json
}

function parseEnds(e: string | null): number | null {
  if (!e) return null
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(e) ? e : String(e).replace(' ', 'T') + 'Z')
  return Number.isNaN(t) ? null : t
}
const campaignEndsAt = computed(() => parseEnds(campaign.value?.ends_at || null))

async function loadProducts(p: number) {
  const j = await getJson(`/api/v1/products?page=${p}&per_page=${PAGE_SIZE}`)
  const rows = Array.isArray(j.data) ? j.data : []
  totalProducts.value = Number(j.pagination?.total) || rows.length
  totalPages.value = Number(j.pagination?.total_pages) || 1
  return rows
}

async function load() {
  loading.value = true
  loadError.value = null
  page.value = 1
  catalog.load()
  getJson('/api/v1/banners').then((j) => { banners.value = Array.isArray(j.data) ? j.data : [] }).catch(() => { banners.value = [] })
  getJson('/api/v1/campaigns/lightning').then((j) => { campaign.value = j.data?.campaign || null; deals.value = (j.data?.deals || []).slice(0, 6) }).catch(() => { campaign.value = null; deals.value = [] })
  getJson('/api/v1/exhibitions').then((j) => {
    const rows = Array.isArray(j.data) ? j.data : []
    exhibitions.value = rows.filter((e: any) => Array.isArray(e.products) && e.products.length > 0)
  }).catch(() => { exhibitions.value = [] })
  if (auth.isAuthenticated) {
    getJson('/api/v1/recommendations/for-you?limit=10', true).then((j) => { forYou.value = Array.isArray(j.data) ? j.data.slice(0, 10) : [] }).catch(() => { forYou.value = [] })
  }
  try {
    products.value = await loadProducts(1)
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '상품을 불러오지 못했습니다')
  } finally {
    loading.value = false
  }
}

const sentinel = ref<Element | null>(null)
let observer: IntersectionObserver | null = null
function watchSentinel() {
  if (observer) observer.disconnect()
  if (!sentinel.value || page.value >= totalPages.value || loading.value) return
  observer = new IntersectionObserver(async (entries) => {
    if (!entries.some((e) => e.isIntersecting) || loadingMore.value) return
    loadingMore.value = true
    try {
      const rows = await loadProducts(page.value + 1)
      page.value += 1
      products.value = [...products.value, ...rows]
    } catch {
      // Keep the loaded pages; a retry affordance sits under the grid.
    } finally {
      loadingMore.value = false
      watchSentinel()
    }
  }, { rootMargin: '400px' })
  observer.observe(sentinel.value)
}
watch([() => products.value.length, () => loading.value], async () => { await nextTick(); watchSentinel() })

onMounted(() => { load(); injectJsonLd('olmoa-jsonld-org', organizationGraph(window.location.origin)) })
onUnmounted(() => { if (observer) observer.disconnect(); document.getElementById('olmoa-jsonld-org')?.remove() })
watch(() => banners.value.length, () => { if (bannerIdx.value >= banners.value.length) bannerIdx.value = 0 })

// ---- sections (all derived from server data; nothing invented) ----------------------------------
const shortcutRoots = computed(() => catalog.roots.filter((c) => Number(c.product_count) > 0).slice(0, 10))
const rankRoots = computed(() => catalog.roots.filter((c) => Number(c.product_count) > 0).slice(0, 6))
const rankTabs = computed(() => [{ slug: 'ALL', name: '전체' }, ...rankRoots.value.map((c) => ({ slug: c.slug, name: c.name }))])
const rankRows = computed(() => {
  if (rankTab.value === 'ALL') return products.value.slice(0, 10)
  return rankCache.value[rankTab.value] || []
})
async function selectRankTab(slug: string) {
  rankTab.value = slug
  if (slug === 'ALL' || rankCache.value[slug]) return
  rankLoading.value = true
  try {
    const j = await getJson(`/api/v1/products?category=${encodeURIComponent(slug)}&sort=popular&per_page=10`)
    rankCache.value[slug] = Array.isArray(j.data) ? j.data : []
  } catch {
    rankCache.value[slug] = []
  } finally {
    rankLoading.value = false
  }
}
</script>

<template>
  <div class="pb-16">
    <!-- 1. Banner carousel (hidden without banners) ------------------------------------------------- -->
    <section v-if="banners.length" class="mx-auto max-w-container px-4 pt-4 sm:px-6 sm:pt-6" aria-label="프로모션">
      <OmCarousel v-model="bannerIdx" :count="banners.length" label="프로모션 배너">
        <template #default="{ index }">
          <div class="relative aspect-video w-full overflow-hidden bg-secondary text-white sm:aspect-auto sm:h-[360px]">
            <img :src="banners[index].image_url" alt="" class="absolute inset-0 h-full w-full object-cover opacity-60" :fetchpriority="index === 0 ? 'high' : 'auto'" />
            <div class="absolute inset-0 bg-gradient-to-r from-overlay/75 via-overlay/40 to-transparent" aria-hidden="true" />
            <div class="relative flex h-full flex-col justify-end gap-3 p-6 sm:p-10" aria-live="polite">
              <span v-if="banners[index].badge_text" class="w-fit rounded-sm bg-primary-on/15 px-2 py-0.5 text-2xs font-semibold tracking-wide backdrop-blur">{{ banners[index].badge_text }}</span>
              <h1 class="max-w-xl text-2xl font-bold leading-tight sm:text-4xl">{{ banners[index].title }}</h1>
              <p v-if="banners[index].subtitle" class="max-w-xl text-sm text-white/85 sm:text-md">{{ banners[index].subtitle }}</p>
              <div><OmButton :to="banners[index].link_url" variant="primary" size="md">자세히 보기</OmButton></div>
            </div>
          </div>
        </template>
      </OmCarousel>
      <div v-if="banners.length > 1" class="relative" aria-hidden="true">
        <span class="absolute -top-10 right-4 rounded-full bg-overlay/40 px-2.5 py-1 text-2xs text-white tabular-nums">{{ bannerIdx + 1 }} / {{ banners.length }}</span>
      </div>
    </section>

    <div class="mx-auto mt-8 max-w-container space-y-10 px-4 sm:px-6">
      <!-- 2. Category shortcuts --------------------------------------------------------------------- -->
      <section v-if="shortcutRoots.length" aria-label="카테고리 바로가기">
        <ul class="grid grid-cols-5 gap-3 sm:grid-cols-10">
          <li v-for="c in shortcutRoots" :key="c.slug">
            <RouterLink :to="`/category/${c.slug}`" class="flex flex-col items-center gap-1.5">
              <span class="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-xl font-bold text-ink transition hover:bg-surface-3" aria-hidden="true">{{ c.name.slice(0, 1) }}</span>
              <span class="w-full truncate text-center text-xs text-ink">{{ c.name }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <!-- 3. Lightning deals ------------------------------------------------------------------------ -->
      <section v-if="campaign && deals.length" aria-labelledby="deals-title">
        <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div class="flex flex-wrap items-center gap-3">
            <h2 id="deals-title" class="flex items-center gap-1.5 text-xl font-bold text-ink"><Zap class="h-5 w-5 text-accent" aria-hidden="true" />번개특가</h2>
            <OmCountdown v-if="campaignEndsAt" :ends-at="campaignEndsAt" />
          </div>
          <RouterLink to="/channel/lightning-deals" class="text-sm font-medium text-ink-muted hover:text-ink">전체 보기</RouterLink>
        </div>
        <div class="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <div v-for="d in deals" :key="d.id" class="w-40 shrink-0 snap-start sm:w-44">
            <ProductCard :product="d" />
            <div v-if="Number(d.allocated_stock) > 0" class="mt-1.5 space-y-1">
              <OmProgress :sold="Number(d.sold_quantity ?? d.sold_stock ?? 0)" :allocated="Number(d.allocated_stock)" />
              <p class="text-2xs text-ink-muted tabular-nums">{{ d.sold_percent }}% 소진 · {{ formatNumber(Number(d.remaining_stock ?? 0)) }}개 남음</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. Best ranking --------------------------------------------------------------------------- -->
      <section v-if="rankTabs.length > 1" aria-labelledby="rank-title">
        <h2 id="rank-title" class="mb-3 text-xl font-bold text-ink">베스트 랭킹</h2>
        <div class="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="랭킹 분류">
          <button
            v-for="t in rankTabs"
            :key="t.slug"
            type="button"
            :aria-pressed="rankTab === t.slug"
            class="shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            :class="rankTab === t.slug ? 'border-secondary bg-secondary text-secondary-on' : 'border-line bg-surface text-ink hover:border-line-strong'"
            @click="selectRankTab(t.slug)"
          >
            {{ t.name }}
          </button>
        </div>
        <div v-if="rankLoading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="5" /></div>
        <ol v-else-if="rankRows.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          <li v-for="(p, i) in rankRows" :key="p.id"><ProductCard :product="p" :rank="i + 1" /></li>
        </ol>
      </section>

      <!-- 5. Exhibitions ---------------------------------------------------------------------------- -->
      <section v-for="ex in exhibitions" :key="ex.id" :aria-labelledby="`ex-${ex.id}`">
        <div class="mb-3 overflow-hidden rounded-xl">
          <img v-if="ex.banner_url" :src="ex.banner_url" :alt="ex.title" class="h-32 w-full object-cover sm:h-44" loading="lazy" decoding="async" />
        </div>
        <h2 :id="`ex-${ex.id}`" :class="ex.banner_url ? 'sr-only' : 'mb-3 text-xl font-bold text-ink'">{{ ex.title }}</h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ProductCard v-for="p in ex.products.slice(0, 8)" :key="p.id" :product="p" />
        </div>
      </section>

      <!-- 6. For-you (signed in only) ----------------------------------------------------------------- -->
      <section v-if="auth.isAuthenticated && forYou.length" aria-labelledby="foryou-title">
        <h2 id="foryou-title" class="mb-3 text-xl font-bold text-ink">맞춤 추천</h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          <ProductCard v-for="p in forYou" :key="p.id" :product="p" />
        </div>
      </section>

      <!-- 7. All products (infinite, 40/page; no client-side fetch-all) -------------------------------->
      <section aria-labelledby="catalog-title">
        <h2 id="catalog-title" class="mb-4 text-xl font-bold text-ink">전체 상품</h2>
        <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="10" /></div>
        <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
        <OmEmptyState v-else-if="!products.length" title="판매 중인 상품이 없습니다" description="다른 카테고리를 선택하거나 검색해 보세요." />
        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          <ProductCard v-for="(p, i) in products" :key="p.id" :product="p" :eager="i < 5" />
        </div>
        <div ref="sentinel" class="h-1" aria-hidden="true" />
        <div v-if="loadingMore" class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="5" /></div>
        <p v-if="!loading && !loadError && products.length" class="mt-4 text-xs text-ink-subtle">
          {{ formatNumber(products.length) }} / {{ formatNumber(totalProducts) }}개 상품 · 가격은 {{ locale.currency === 'KRW' ? '원화' : `${locale.currency} 환산 표시이며 결제는 원화` }} 기준
        </p>
      </section>
    </div>
  </div>
</template>
