<script setup lang="ts">
// Buyer home (Meridian 2.0): editorial banner carousel, circular category hub,
// elevated lightning deals strip, segmented best ranking, exhibitions, for-you
// (signed-in), and infinite all-products grid. 100% localized across 4 locales.
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRight, Flame, Sparkles, TrendingUp, Zap } from 'lucide-vue-next'
import { userErrorMessage, OmButton, OmSkeleton, OmEmptyState, OmErrorState, OmCarousel, OmCountdown, OmProgress, formatNumber, injectJsonLd, useBreakpoint } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { organizationGraph } from '../../../cloudflare-gateway/src/lib/site-entity.js'
import { useCatalogStore } from '../stores/catalog'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const { isPhone } = useBreakpoint()

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

async function getJson(path: string, _authed = false) {
  const res = await fetch(`${API_BASE_URL}${path}`)
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
  if (await auth.ensureSession()) {
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
const rankTabs = computed(() => [{ slug: 'ALL', name: locale.t('homeTabAll') }, ...rankRoots.value.map((c) => ({ slug: c.slug, name: c.name }))])
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
const remainingLabel = (d: any) =>
  locale.locale === 'ko-KR'
    ? `${d.sold_percent}% 소진 · ${formatNumber(Number(d.remaining_stock ?? 0))}개 남음`
    : `${d.sold_percent}% ${locale.t('homeSoldOutPct')} · ${formatNumber(Number(d.remaining_stock ?? 0))}${locale.t('homeRemainingUnit')}`
</script>

<template>
  <div class="pb-16">
    <!-- 1. Editorial Banner Carousel (hidden without banners) --------------------------------------- -->
    <section v-if="banners.length" class="om-container pt-4 sm:pt-6" :aria-label="locale.t('homePromoLabel')">
      <div class="overflow-hidden rounded-2xl shadow-lg">
        <OmCarousel v-model="bannerIdx" :count="banners.length" :label="locale.t('homePromoBanner')">
          <template #default="{ index }">
            <div class="relative aspect-video w-full overflow-hidden bg-secondary text-white sm:aspect-auto sm:h-[360px]">
              <img :src="banners[index].image_url" alt="" class="absolute inset-0 h-full w-full object-cover opacity-70 transition-transform duration-slow" :fetchpriority="index === 0 ? 'high' : 'auto'" />
              <div class="absolute inset-0 bg-gradient-to-tr from-overlay/85 via-overlay/45 to-transparent" aria-hidden="true" />
              <div class="relative flex h-full flex-col justify-end gap-2.5 p-5 sm:gap-3.5 sm:p-12" aria-live="polite">
                <span v-if="banners[index].badge_text" class="w-fit rounded-full bg-primary/90 px-3 py-1 text-2xs font-bold tracking-wider text-primary-on shadow-sm backdrop-blur whitespace-nowrap">{{ banners[index].badge_text }}</span>
                <h1 class="line-clamp-2 max-w-2xl text-xl font-extrabold leading-tight tracking-tight sm:text-4xl">{{ banners[index].title }}</h1>
                <p v-if="banners[index].subtitle" class="hidden max-w-xl text-sm text-white/90 sm:block sm:text-md">{{ banners[index].subtitle }}</p>
                <div class="pt-1">
                  <OmButton :to="banners[index].link_url" variant="primary" :size="isPhone ? 'sm' : 'md'">
                    {{ locale.t('homeHeroCta') }}
                    <ArrowRight class="h-4 w-4" aria-hidden="true" />
                  </OmButton>
                </div>
              </div>
            </div>
          </template>
        </OmCarousel>
      </div>
      <div v-if="banners.length > 1" class="relative" aria-hidden="true">
        <span class="absolute -top-11 right-5 rounded-full bg-overlay/55 px-3 py-1 text-2xs font-bold text-white backdrop-blur-sm tabular-nums whitespace-nowrap">{{ bannerIdx + 1 }} / {{ banners.length }}</span>
      </div>
    </section>

    <div class="om-container mt-8 space-y-12">
      <!-- 2. Category Shortcuts Hub ----------------------------------------------------------------- -->
      <section v-if="shortcutRoots.length" :aria-label="locale.t('homeCategoryShortcuts')" class="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6">
        <ul class="grid grid-cols-5 gap-3 sm:grid-cols-10 sm:gap-4">
          <li v-for="c in shortcutRoots" :key="c.slug">
            <RouterLink :to="`/category/${c.slug}`" class="group flex flex-col items-center gap-2">
              <span class="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface-2 text-lg font-extrabold text-ink shadow-sm transition-all duration-fast group-hover:-translate-y-0.5 group-hover:border-primary group-hover:bg-primary-soft group-hover:text-primary group-hover:shadow-md" aria-hidden="true" data-no-i18n>{{ c.name.slice(0, 1) }}</span>
              <span class="w-full truncate text-center text-xs font-semibold text-ink-muted transition-colors group-hover:text-primary">{{ c.name }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <!-- 3. Lightning Deals Showcase --------------------------------------------------------------- -->
      <section v-if="campaign && deals.length" aria-labelledby="deals-title" class="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6">
        <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <h2 id="deals-title" class="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink">
              <span class="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent"><Zap class="h-4 w-4" aria-hidden="true" /></span>
              {{ locale.t('lightningDeals') }}
            </h2>
            <OmCountdown v-if="campaignEndsAt" :ends-at="campaignEndsAt" />
          </div>
          <RouterLink to="/channel/lightning-deals" class="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3.5 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-primary-soft hover:text-primary">
            {{ locale.t('homeViewAll') }}
            <ArrowRight class="h-3.5 w-3.5" aria-hidden="true" />
          </RouterLink>
        </div>
        <div class="no-scrollbar -mx-4 flex snap-x gap-3.5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div v-for="d in deals" :key="d.id" class="w-44 shrink-0 snap-start sm:w-48">
            <ProductCard :product="d" />
            <div v-if="Number(d.allocated_stock) > 0" class="mt-2 space-y-1 px-0.5">
              <OmProgress :sold="Number(d.sold_quantity ?? d.sold_stock ?? 0)" :allocated="Number(d.allocated_stock)" />
              <p class="text-2xs font-medium text-ink-muted tabular-nums">{{ remainingLabel(d) }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. Best Sellers Ranking ------------------------------------------------------------------- -->
      <section v-if="rankTabs.length > 1" aria-labelledby="rank-title">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="rank-title" class="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink">
            <span class="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-soft text-primary"><TrendingUp class="h-4 w-4" aria-hidden="true" /></span>
            {{ locale.t('homeBestRanking') }}
          </h2>
          <RouterLink to="/channel/best-sellers" class="inline-flex items-center gap-1 text-xs font-bold text-ink-muted transition-colors hover:text-primary">
            {{ locale.t('homeViewAll') }}
            <ArrowRight class="h-3.5 w-3.5" aria-hidden="true" />
          </RouterLink>
        </div>
        <div class="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" :aria-label="locale.t('homeRankingGroup')">
          <button
            v-for="t in rankTabs"
            :key="t.slug"
            type="button"
            :aria-pressed="rankTab === t.slug"
            class="shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            :class="rankTab === t.slug ? 'border-primary bg-primary text-primary-on shadow-sm' : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink'"
            @click="selectRankTab(t.slug)"
          >
            {{ t.name }}
          </button>
        </div>
        <div v-if="rankLoading" class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="5" /></div>
        <ol v-else-if="rankRows.length" class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          <li v-for="(p, i) in rankRows" :key="p.id"><ProductCard :product="p" :rank="i + 1" /></li>
        </ol>
      </section>

      <!-- 5. Curated Exhibitions -------------------------------------------------------------------- -->
      <section v-for="ex in exhibitions" :key="ex.id" :aria-labelledby="`ex-${ex.id}`" class="space-y-4">
        <div v-if="ex.banner_url" class="overflow-hidden rounded-2xl border border-line shadow-sm">
          <img :src="ex.banner_url" :alt="ex.title" class="h-36 w-full object-cover sm:h-48" loading="lazy" decoding="async" />
        </div>
        <h2 :id="`ex-${ex.id}`" :class="ex.banner_url ? 'sr-only' : 'flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink'">
          <Flame v-if="!ex.banner_url" class="h-5 w-5 text-primary" aria-hidden="true" />
          {{ ex.title }}
        </h2>
        <div class="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <ProductCard v-for="p in ex.products.slice(0, 8)" :key="p.id" :product="p" />
        </div>
      </section>

      <!-- 6. Personalized For-You (signed in only) -------------------------------------------------- -->
      <section v-if="auth.isAuthenticated && forYou.length" aria-labelledby="foryou-title">
        <h2 id="foryou-title" class="mb-4 flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink">
          <span class="flex h-8 w-8 items-center justify-center rounded-xl bg-highlight-soft text-highlight-ink"><Sparkles class="h-4 w-4" aria-hidden="true" /></span>
          {{ locale.t('homeForYou') }}
        </h2>
        <div class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          <ProductCard v-for="p in forYou" :key="p.id" :product="p" />
        </div>
      </section>

      <!-- 7. All Products Discovery Grid (infinite, 40/page) ---------------------------------------- -->
      <section aria-labelledby="catalog-title">
        <div class="mb-5 flex items-baseline justify-between gap-3">
          <h2 id="catalog-title" class="text-xl font-extrabold tracking-tight text-ink">{{ locale.t('homeAllProducts') }}</h2>
          <p v-if="!loading && !loadError && products.length" class="text-xs font-medium text-ink-subtle tabular-nums">
            {{ formatNumber(products.length) }} / {{ formatNumber(totalProducts) }}{{ locale.t('homeProductsUnit') }}
          </p>
        </div>
        <div v-if="loading" class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="10" /></div>
        <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
        <OmEmptyState v-else-if="!products.length" :title="locale.t('homeEmptyTitle')" :description="locale.t('homeEmptyDesc')" />
        <div v-else class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          <ProductCard v-for="(p, i) in products" :key="p.id" :product="p" :eager="i < 5" />
        </div>
        <div ref="sentinel" class="h-1" aria-hidden="true" />
        <div v-if="loadingMore" class="mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="5" /></div>
        <p v-if="!loading && !loadError && products.length" class="mt-5 text-xs text-ink-subtle">
          {{ formatNumber(products.length) }} / {{ formatNumber(totalProducts) }}{{ locale.t('homeProductsUnit') }} · {{ locale.currency === 'KRW' ? locale.t('homePriceCaptionKrw') : `${locale.currency} ${locale.t('homePriceCaptionFx')}` }}
        </p>
      </section>
    </div>
  </div>
</template>
