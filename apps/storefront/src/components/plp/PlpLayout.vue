<script setup lang="ts">
// Shared search/category results layout (3-2): breadcrumb, title + live count,
// 240px filter sidebar (desktop) / bottom-sheet filters (mobile), sort row,
// applied chips, grid/list infinite results, honest zero state. Filters, sort
// and view live in the URL (replace); page rides along so back-navigation
// restores the exact list and scroll position.
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { userErrorMessage, OmSkeleton, OmEmptyState, OmErrorState, OmSelect, OmFilterPanel, OmFilterChips, OmViewToggle, OmBreadcrumb, OmPrice, OmRating, OmButton, formatNumber, applyRouteHead, injectJsonLd } from '@olmoa/ui'
import ProductCard from '../ProductCard.vue'
import { useCatalogStore } from '../../stores/catalog'
import { API_BASE_URL } from '../../config'
import { plpJsonLdOf } from '../../lib/productSeo'

const props = withDefaults(defineProps<{
  lockedCategory?: string | null
  lockedPartner?: string | null
  title?: string | null
}>(), { lockedCategory: null, lockedPartner: null, title: null })

const route = useRoute()
const router = useRouter()
const catalog = useCatalogStore()

const PAGE_SIZE = 40
const SORTS = [
  { value: 'recommend', label: '추천순' },
  { value: 'popular', label: '판매량순' },
  { value: 'newest', label: '최신순' },
  { value: 'price_asc', label: '낮은 가격순' },
  { value: 'price_desc', label: '높은 가격순' },
  { value: 'reviews', label: '리뷰많은순' },
  { value: 'rating', label: '평점순' }
]
const SORT_KEYS = SORTS.map((s) => s.value)
const BADGE_LABEL: Record<string, string> = { SALE: '할인', DEAL: '타임딜', NEW: '신상품' }

const q = computed(() => String(route.query.q || '').trim())
const products = ref<any[]>([])
const total = ref(0)
const totalPages = ref(1)
const page = ref(1)
const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref<string | null>(null)
const facets = ref<any>({ categories: [], brands: [], price: null, badges: {} })
// 5-4: the today-shipment toggle/chip exist only while the list response
// advertises the filter (policy-gated server-side). Starts off like the
// empty facets above — the first response fills it in.
const todayShipAvailable = ref(false)
const tomorrowShipAvailable = ref(false)
const sheetOpen = ref(false)
const popular = ref<any[]>([])
const suggestions = ref<string[]>([])
const resolvedSynonym = ref<string | null>(null)

// ---- filter state mirrors the URL -----------------------------------------------------------------
function strList(v: unknown): string[] {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean)
}
const fCats = ref<string[]>([])
const fBrands = ref<string[]>([])
const fPrice = ref<[number | null, number | null]>([null, null])
const fFlags = ref<Record<string, boolean>>({})
const fSellers = ref<string[]>([])
const sort = ref('recommend')
const view = ref<'grid' | 'list'>('grid')

function syncFromRoute() {
  fCats.value = strList(route.query.category)
  fBrands.value = strList(route.query.brand).slice(0, 10)
  const lo = route.query.min_price !== undefined && route.query.min_price !== '' ? Number(route.query.min_price) : null
  const hi = route.query.max_price !== undefined && route.query.max_price !== '' ? Number(route.query.max_price) : null
  fPrice.value = [Number.isFinite(lo) ? lo : null, Number.isFinite(hi) ? hi : null]
  fFlags.value = {
    free_shipping: route.query.free_shipping === '1',
    coupon_eligible: route.query.coupon_eligible === '1',
    has_discount: route.query.has_discount === '1',
    today_shipment: route.query.today_shipment === '1',
    tomorrow_shipment: route.query.tomorrow_shipment === '1',
    exclude_overseas: route.query.exclude_overseas === '1',
    rating4: route.query.min_rating === '4'
  }
  fSellers.value = strList(route.query.seller).map((s) => s.toUpperCase()).filter((s) => s === 'DIRECT' || s === 'MARKETPLACE')
  const s = String(route.query.sort || 'recommend')
  sort.value = SORT_KEYS.includes(s) ? s : 'recommend'
  view.value = route.query.view === 'list' ? 'list' : 'grid'
  const p = Number(route.query.page || 1)
  page.value = Number.isInteger(p) && p >= 1 ? p : 1
}

function serverSort(): string {
  if (sort.value === 'recommend') return q.value ? 'relevance' : 'popular'
  return sort.value
}

function filterParams(): URLSearchParams {
  const cats = props.lockedCategory ? [props.lockedCategory, ...fCats.value] : fCats.value
  const params = new URLSearchParams()
  if (props.lockedPartner) params.set('partner_id', props.lockedPartner)
  if (q.value) params.set('q', q.value)
  if (cats.length) params.set('category', [...new Set(cats)].join(','))
  if (fBrands.value.length) params.set('brand', fBrands.value.join(','))
  if (fPrice.value[0] !== null) params.set('min_price', String(fPrice.value[0]))
  if (fPrice.value[1] !== null) params.set('max_price', String(fPrice.value[1]))
  params.set('sort', serverSort())
  if (fFlags.value.free_shipping) params.set('free_shipping', '1')
  if (fFlags.value.coupon_eligible) params.set('coupon_eligible', '1')
  if (fFlags.value.has_discount) params.set('has_discount', '1')
  if (fFlags.value.today_shipment && todayShipAvailable.value) params.set('today_shipment', '1')
  if (fFlags.value.tomorrow_shipment && tomorrowShipAvailable.value) params.set('tomorrow_shipment', '1')
  if (fFlags.value.exclude_overseas) params.set('exclude_overseas', '1')
  if (fSellers.value.length === 1) params.set('sales_model', fSellers.value[0])
  if (fFlags.value.rating4) params.set('min_rating', '4')
  return params
}

function pushUrl(resetPage: boolean) {
  const query: Record<string, any> = {
    q: q.value || undefined,
    category: fCats.value.length ? fCats.value.join(',') : undefined,
    brand: fBrands.value.length ? fBrands.value.join(',') : undefined,
    min_price: fPrice.value[0] ?? undefined,
    max_price: fPrice.value[1] ?? undefined,
    sort: sort.value !== 'recommend' ? sort.value : undefined,
    view: view.value !== 'grid' ? view.value : undefined,
    free_shipping: fFlags.value.free_shipping ? '1' : undefined,
    coupon_eligible: fFlags.value.coupon_eligible ? '1' : undefined,
    has_discount: fFlags.value.has_discount ? '1' : undefined,
    today_shipment: fFlags.value.today_shipment ? '1' : undefined,
    tomorrow_shipment: fFlags.value.tomorrow_shipment ? '1' : undefined,
    exclude_overseas: fFlags.value.exclude_overseas ? '1' : undefined,
    seller: fSellers.value.length ? fSellers.value.join(',') : undefined,
    min_rating: fFlags.value.rating4 ? '4' : undefined,
    page: !resetPage && page.value > 1 ? page.value : undefined
  }
  router.replace({ path: route.path, query })
}

let seq = 0
async function fetchPage(p: number) {
  const params = filterParams()
  params.set('page', String(p))
  params.set('per_page', String(PAGE_SIZE))
  const res = await fetch(`${API_BASE_URL}/api/v1/products?${params}`)
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) throw new Error(json?.error || '상품을 불러오지 못했습니다')
  const avail: unknown = (json as any)?.available_filters
  if (Array.isArray(avail)) {
    todayShipAvailable.value = avail.includes('today_shipment')
    if (!todayShipAvailable.value && fFlags.value.today_shipment) {
      fFlags.value = { ...fFlags.value, today_shipment: false }
      pushUrl(true)
    }
    tomorrowShipAvailable.value = avail.includes('tomorrow_shipment')
    if (!tomorrowShipAvailable.value && fFlags.value.tomorrow_shipment) {
      fFlags.value = { ...fFlags.value, tomorrow_shipment: false }
      pushUrl(true)
    }
  }
  return json
}

async function load(reset: boolean) {
  const my = ++seq
  if (reset) { loading.value = true; page.value = 1 }
  loadError.value = null
  catalog.load()
  const params = filterParams()
  fetch(`${API_BASE_URL}/api/v1/products/facets?${params}`)
    .then((r) => r.json().catch(() => null))
    .then((j) => { if (j?.success && my === seq) facets.value = j.data })
    .catch(() => {})
  try {
    const json = await fetchPage(reset ? 1 : page.value)
    if (my !== seq) return
    const rows = Array.isArray(json.data) ? json.data : []
    total.value = Number(json.pagination?.total) || 0
    totalPages.value = Number(json.pagination?.total_pages) || 1
    products.value = reset ? rows : [...products.value, ...rows]
    if (reset) updatePlpHead()
    if (total.value === 0) void loadZeroExtras()
  } catch (e: any) {
    if (my === seq) { products.value = reset ? [] : products.value; loadError.value = reset ? userErrorMessage(e, '상품을 불러오지 못했습니다') : loadError.value }
  } finally {
    if (my === seq) { loading.value = false; loadingMore.value = false }
  }
}

async function loadMore() {
  if (loadingMore.value || loading.value || page.value >= totalPages.value) return
  loadingMore.value = true
  try {
    const json = await fetchPage(page.value + 1)
    page.value += 1
    totalPages.value = Number(json.pagination?.total_pages) || totalPages.value
    products.value = [...products.value, ...json.data]
    pushUrl(false)
  } catch {
    // Keep loaded pages; the sentinel stays armed for a retry scroll.
  } finally {
    loadingMore.value = false
  }
}

// ---- zero state: synonym suggestions + popular fill -------------------------------------------------
let zeroKey = ''
async function loadZeroExtras() {
  const key = `${q.value}|${props.lockedCategory || ''}|${props.lockedPartner || ''}`
  if (key === zeroKey) return
  zeroKey = key
  popular.value = []
  suggestions.value = []
  resolvedSynonym.value = null
  try {
    const r = await fetch(`${API_BASE_URL}/api/v1/products?sort=popular&per_page=8`)
    const j = await r.json().catch(() => null)
    if (j?.success) popular.value = j.data
  } catch { /* popular is a bonus, never a blocker */ }
  if (q.value) {
    try {
      const r = await fetch(`${API_BASE_URL}/api/v1/search/autocomplete?q=${encodeURIComponent(q.value)}`)
      const j = await r.json().catch(() => null)
      if (j?.success) {
        resolvedSynonym.value = j.resolved_synonym || null
        suggestions.value = [...new Set([...(j.suggestions || []), ...(resolvedSynonym.value ? [resolvedSynonym.value] : [])])].filter((s) => s && s !== q.value).slice(0, 6)
      }
    } catch { /* suggestions are a bonus */ }
  }
}

// ---- scroll save/restore across back-navigation -----------------------------------------------------
const SCROLL_KEY = () => `plp:scroll:${route.fullPath}`
let scrollRaf = 0
function saveScroll() {
  cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(() => {
    try { sessionStorage.setItem(SCROLL_KEY(), String(window.scrollY)) } catch { /* private mode */ }
  })
}
function markPop() { try { sessionStorage.setItem('plp:pop', '1') } catch {} }
function consumePop(): boolean {
  try {
    if (sessionStorage.getItem('plp:pop') === '1') { sessionStorage.removeItem('plp:pop'); return true }
  } catch {}
  return false
}
async function restoreScroll() {
  let y = 0
  try { y = Number(sessionStorage.getItem(SCROLL_KEY()) || 0) } catch {}
  if (y > 0) { await nextTick(); window.scrollTo(0, y) }
}

const sentinel = ref<Element | null>(null)
let observer: IntersectionObserver | null = null
function watchSentinel() {
  if (observer) observer.disconnect()
  if (!sentinel.value || loading.value) return
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) void loadMore()
  }, { rootMargin: '400px' })
  observer.observe(sentinel.value)
}

// ---- derived view data ------------------------------------------------------------------------------
const lockedNode = computed(() => (props.lockedCategory ? catalog.bySlugOrId(props.lockedCategory) : null))
const crumbs = computed(() => {
  const items = [{ label: '홈', to: '/' }]
  if (q.value) {
    items.push({ label: `‘${q.value}’ 검색`, to: '' })
  } else if (lockedNode.value) {
    const chain: { label: string; to: string }[] = []
    let cur: any = lockedNode.value
    while (cur) { chain.unshift({ label: cur.name, to: `/category/${cur.slug}` }); cur = cur.parent_id ? catalog.categories.find((c) => c.id === cur.parent_id) : null }
    items.push(...chain)
  }
  return items
})
const pageTitle = computed(() => {
  if (props.title) return props.title
  if (q.value) return `‘${q.value}’ 검색 결과`
  return lockedNode.value?.name || '전체 상품'
})

// ---- SEO: per-list head + CollectionPage/ItemList JSON-LD (live rows only) --------------------------------
function updatePlpHead() {
  const origin = window.location.origin
  applyRouteHead({ path: route.path, base: origin, title: `${pageTitle.value} | OLMOA` })
  injectJsonLd('olmoa-jsonld-plp', plpJsonLdOf(pageTitle.value, `${origin}${route.path}`, products.value, origin))
}
const facetCounts = computed(() => {
  const m = new Map<string, number>()
  for (const c of facets.value.categories || []) m.set(c.id, Number(c.count) || 0)
  return m
})
const treeNodes = computed(() => catalog.roots.map((r) => ({
  id: r.id,
  label: r.name,
  count: facetCounts.value.get(r.id) ?? null,
  children: catalog.childrenOf(r.id).map((c) => ({ id: c.id, label: c.name, count: facetCounts.value.get(c.id) ?? null }))
})))
const brandGroup = computed(() => [{
  key: 'brand',
  label: '브랜드',
  searchable: true,
  options: (facets.value.brands || []).map((b: any) => ({ value: b.brand, label: b.brand, count: b.count }))
}])
const sellerGroup = computed(() => [{
  key: 'seller',
  label: '판매자 유형',
  options: [
    { value: 'DIRECT', label: '직영' },
    { value: 'MARKETPLACE', label: '입점' }
  ]
}])
const priceBounds = computed((): [number, number] | null => {
  const p = facets.value.price
  if (!p || p.min === null || p.max === null) return null
  return [Number(p.min), Number(p.max)]
})
const toggles = computed(() => [
  { key: 'free_shipping', label: '무료배송' },
  { key: 'coupon_eligible', label: '쿠폰' },
  { key: 'has_discount', label: '할인' },
  ...(todayShipAvailable.value ? [{ key: 'today_shipment', label: '오늘출발' }] : []),
  ...(tomorrowShipAvailable.value ? [{ key: 'tomorrow_shipment', label: '내일출발' }] : []),
  { key: 'exclude_overseas', label: '해외직구 제외' },
  { key: 'rating4', label: '평점 4점 이상' }
])
const TOGGLE_LABEL: Record<string, string> = {
  free_shipping: '무료배송', coupon_eligible: '쿠폰', has_discount: '할인',
  today_shipment: '오늘출발', tomorrow_shipment: '내일출발', exclude_overseas: '해외직구 제외', rating4: '평점 4점 이상'
}
const chips = computed(() => {
  const out: { key: string; label: string }[] = []
  for (const id of fCats.value) {
    const n = catalog.bySlugOrId(id)
    out.push({ key: `cat:${id}`, label: n?.name || id })
  }
  for (const b of fBrands.value) out.push({ key: `brand:${b}`, label: b })
  if (fPrice.value[0] !== null || fPrice.value[1] !== null) {
    out.push({ key: 'price', label: `${fPrice.value[0] ?? ''}~${fPrice.value[1] ?? ''}원` })
  }
  for (const [k, on] of Object.entries(fFlags.value)) {
    if (!on || !TOGGLE_LABEL[k]) continue
    if (k === 'today_shipment' && !todayShipAvailable.value) continue
    if (k === 'tomorrow_shipment' && !tomorrowShipAvailable.value) continue
    out.push({ key: `flag:${k}`, label: TOGGLE_LABEL[k] })
  }
  for (const s of fSellers.value) out.push({ key: `seller:${s}`, label: s === 'DIRECT' ? '직영' : '입점' })
  return out
})
const filterCount = computed(() => chips.value.length)
function removeChip(key: string) {
  if (key.startsWith('cat:')) fCats.value = fCats.value.filter((x) => x !== key.slice(4))
  else if (key.startsWith('brand:')) fBrands.value = fBrands.value.filter((x) => x !== key.slice(6))
  else if (key === 'price') fPrice.value = [null, null]
  else if (key.startsWith('flag:')) fFlags.value = { ...fFlags.value, [key.slice(5)]: false }
  else if (key.startsWith('seller:')) fSellers.value = fSellers.value.filter((x) => x !== key.slice(7))
  pushUrl(true)
}
function clearAll() {
  fCats.value = []
  fBrands.value = []
  fPrice.value = [null, null]
  fFlags.value = {}
  fSellers.value = []
  pushUrl(true)
}
function shippingText(p: any): string {
  const fee = Number(p.base_shipping_fee ?? 0)
  const th = Number(p.free_shipping_threshold ?? 0)
  if (fee === 0) return '무료배송'
  return th > 0 ? `배송비 ${formatNumber(fee)}원 · ${formatNumber(th)}원 이상 무료` : `배송비 ${formatNumber(fee)}원`
}

// ---- route <-> list sync (page-only changes never reset the list) ------------------------------------
function filterKey(): string {
  const { page: _p, ...rest } = route.query as Record<string, any>
  return JSON.stringify(rest)
}
let lastKey = ''
watch(() => route.fullPath, () => {
  const k = filterKey()
  if (k === lastKey) return
  lastKey = k
  syncFromRoute()
  void load(true).then(() => { void restoreIfPop() })
})

const wasPop = ref(false)
async function restoreIfPop() {
  if (wasPop.value) { wasPop.value = false; await restoreScroll() }
}

onMounted(async () => {
  window.addEventListener('popstate', markPop)
  window.addEventListener('scroll', saveScroll, { passive: true })
  syncFromRoute()
  lastKey = filterKey()
  wasPop.value = consumePop()
  catalog.load()
  if (page.value > 1) {
    // Back-navigation into a deep page: rebuild pages 1..N before restoring scroll.
    loading.value = true
    try {
      const all: any[] = []
      for (let p = 1; p <= page.value; p++) {
        const json = await fetchPage(p)
        total.value = Number(json.pagination?.total) || 0
        totalPages.value = Number(json.pagination?.total_pages) || 1
        all.push(...(Array.isArray(json.data) ? json.data : []))
      }
      products.value = all
    } catch (e: any) {
      loadError.value = userErrorMessage(e, '상품을 불러오지 못했습니다')
    } finally {
      loading.value = false
    }
    await restoreIfPop()
  } else {
    await load(true)
    await restoreIfPop()
  }
  await nextTick()
  watchSentinel()
})
onUnmounted(() => {
  window.removeEventListener('popstate', markPop)
  window.removeEventListener('scroll', saveScroll)
  if (observer) observer.disconnect()
})
watch([() => products.value.length, () => loading.value], async () => { await nextTick(); watchSentinel() })

// Live-apply: every control writes the URL (replace), the route watcher reloads.
watch([fCats, fBrands, fFlags, fSellers, sort, view], () => pushUrl(true))
let priceTimer: ReturnType<typeof setTimeout> | null = null
watch(fPrice, () => {
  if (priceTimer) clearTimeout(priceTimer)
  priceTimer = setTimeout(() => pushUrl(true), 400)
}, { deep: true })
watch(() => props.lockedCategory, () => { fCats.value = []; pushUrl(true) })
watch(() => props.lockedPartner, () => pushUrl(true))

const pickedGroups = computed({
  get: () => ({ brand: fBrands.value, seller: fSellers.value }),
  set: (v: Record<string, string[]>) => {
    fBrands.value = (v.brand ?? []).slice(0, 10)
    fSellers.value = (v.seller ?? []).map((s) => s.toUpperCase()).filter((s) => s === 'DIRECT' || s === 'MARKETPLACE')
  }
})
const allGroups = computed(() => [...brandGroup.value, ...sellerGroup.value])
const lockedCrumbParent = computed(() => {
  const n: any = lockedNode.value
  if (!n?.parent_id) return null
  return catalog.categories.find((c) => c.id === n.parent_id) || null
})
</script>

<template>
  <div class="mx-auto max-w-container px-4 py-6 sm:px-6">
    <OmBreadcrumb :items="crumbs" />
    <header class="mb-4 mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 class="text-2xl font-bold text-ink">{{ pageTitle }}</h1>
      <p v-if="!loading && !loadError" class="text-sm text-ink-muted">{{ formatNumber(total) }}개 상품</p>
    </header>

    <!-- Mobile sticky control row -->
    <div class="sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-2 border-b border-line-divider bg-surface px-4 py-2 lg:hidden">
      <OmButton size="sm" variant="outline" :aria-label="`필터 열기, ${filterCount}개 적용 중`" @click="sheetOpen = true">
        필터<template v-if="filterCount"> {{ filterCount }}</template>
      </OmButton>
      <div class="min-w-0 flex-1"><OmSelect v-model="sort" :options="SORTS" size="sm" aria-label="정렬" /></div>
      <OmViewToggle v-model="view" />
    </div>

    <div class="lg:flex lg:items-start lg:gap-6">
      <div class="hidden lg:block">
        <OmFilterPanel
          v-model:cats="fCats"
          v-model:picked="pickedGroups"
          v-model:price="fPrice"
          v-model:flags="fFlags"
          :categories="treeNodes"
          :groups="allGroups"
          :price-bounds="priceBounds"
          :toggles="toggles"
        />
      </div>
      <OmFilterPanel
        mode="sheet"
        v-model:open="sheetOpen"
        v-model:cats="fCats"
        v-model:picked="pickedGroups"
        v-model:price="fPrice"
        v-model:flags="fFlags"
        :categories="treeNodes"
        :groups="allGroups"
        :price-bounds="priceBounds"
        :toggles="toggles"
        :result-count="total"
        @apply="sheetOpen = false"
        @reset="clearAll"
      />

      <div class="min-w-0 flex-1">
        <!-- Desktop sort row -->
        <div class="mb-3 hidden items-center justify-between gap-3 lg:flex">
          <OmFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
          <div class="ml-auto flex items-center gap-2">
            <div class="w-40"><OmSelect v-model="sort" :options="SORTS" size="sm" aria-label="정렬" /></div>
            <OmViewToggle v-model="view" />
          </div>
        </div>
        <div class="mb-3 lg:hidden">
          <OmFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
        </div>

        <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"><OmSkeleton variant="card" :count="8" /></div>
        <OmErrorState v-else-if="loadError" :message="loadError" @retry="load(true)" />
        <template v-else-if="total === 0">
          <slot name="zero" :q="q" :suggestions="suggestions" :popular="popular" :parent="lockedCrumbParent">
            <OmEmptyState title="검색 결과가 없습니다" description="검색어나 필터를 바꿔 보세요." />
          </slot>
        </template>
        <template v-else>
          <div v-if="view === 'grid'" class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <ProductCard v-for="(p, i) in products" :key="p.id" :product="p" :eager="i < 4" />
          </div>
          <ol v-else class="divide-y divide-line-divider border-y border-line-divider">
            <li v-for="p in products" :key="p.id">
              <RouterLink :to="`/product/${p.slug || p.id}`" class="flex gap-4 py-4">
                <img :src="p.thumbnail_url" :alt="p.title" loading="lazy" decoding="async" class="h-40 w-40 shrink-0 rounded-lg object-cover" />
                <span class="flex min-w-0 flex-1 flex-col gap-1">
                  <span class="truncate text-md font-bold text-ink">{{ p.title }}</span>
                  <OmPrice :sale="p.lowest_sale_price" :original="p.lowest_original_price" size="card" />
                  <span v-if="p.badges?.length" class="flex flex-wrap gap-1">
                    <span v-for="b in p.badges" :key="b" class="rounded-sm bg-surface-3 px-1.5 py-0.5 text-2xs font-semibold text-ink-muted">{{ BADGE_LABEL[b] || b }}</span>
                  </span>
                  <span class="text-xs text-ink-muted">{{ p.partner_name }}</span>
                  <span class="text-xs text-ink-muted">{{ shippingText(p) }}</span>
                </span>
              </RouterLink>
            </li>
          </ol>
          <div ref="sentinel" class="h-1" aria-hidden="true" />
          <div v-if="loadingMore" class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"><OmSkeleton variant="card" :count="4" /></div>
          <p v-if="!loadingMore && page >= totalPages && products.length" class="mt-4 text-center text-xs text-ink-subtle">마지막 상품입니다</p>
        </template>
      </div>
    </div>
  </div>
</template>

