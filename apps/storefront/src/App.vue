<script setup lang="ts">
// Buyer app shell (Meridian 2.0): utility bar, glass search-first header,
// pill category bar, mobile tab bar, floating recent dock, editorial footer.
// 100% localized across ko-KR / en-US / ja-JP / zh-TW.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { Bell, ChevronUp, Globe, Heart, History, House, LayoutGrid, LogOut, Monitor, Moon, Package, Search, ShoppingBag, Sun, Ticket, User, Zap } from 'lucide-vue-next'
import { OmHeader, OmSearchBar, OmIconButton, OmNavigation, OmPopover, OmFooter, OmBadge, OmToast, OmConfirmDialog, formatDateTime, parseTrendingKeywords, useTheme, nextThemeMode, useBreakpoint, isCurrency, barePathOf, type Lang, type AcFetcher, type AcItem, type NavItem, type FooterColumn } from '@olmoa/ui'
import { useCartStore } from './stores/cart'
import { useAuthStore } from './stores/auth'
import { useLocaleStore, type SupportedLocale } from './stores/locale'
import { useBusinessStore } from './stores/business'
import { API_BASE_URL, PARTNER_CONSOLE_URL, authHeader } from './config'
import MegaMenu from './components/MegaMenu.vue'
import LocaleNudge from './components/LocaleNudge.vue'
import { SITE_NAME, SITE_TAGLINE } from '../../cloudflare-gateway/src/lib/site-entity.js'
import { useLocaleSwitch } from './composables/useLocaleSwitch'

const { isPhone } = useBreakpoint()

const cart = useCartStore()
const auth = useAuthStore()
const locale = useLocaleStore()
const router = useRouter()
const route = useRoute()

const localeSwitch = useLocaleSwitch()
const LANG_OF: Record<SupportedLocale, Lang> = { 'ko-KR': 'ko', 'en-US': 'en', 'ja-JP': 'ja', 'zh-TW': 'zh-tw' }
async function switchLocale(v: SupportedLocale) {
  locale.dismissNudge()
  if (auth.isAuthenticated) void auth.saveLocale(v)
  await localeSwitch.switchLang(LANG_OF[v] || 'ko')
}
async function switchCurrency(v: string) {
  const c = String(v || '').toLowerCase()
  if (isCurrency(c)) await localeSwitch.switchCurrency(c)
}

// ---- notifications ----------------------------------------------------------------------------------
const notifications = ref<any[]>([])
const unread = ref(0)
const notiError = ref(false)
async function fetchNotifications() {
  if (!(await auth.ensureSession())) return
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/notifications`, { headers: { ...authHeader() } })
    const json = await res.json()
    if (json.success && Array.isArray(json.data)) {
      notifications.value = json.data
      unread.value = json.unread_count || 0
      notiError.value = false
    } else notiError.value = true
  } catch { notiError.value = true }
}
async function openNotification(n: any, close: () => void) {
  if (Number(n.is_read) === 0) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/notifications/${n.id}/read`, { method: 'PUT', headers: { ...authHeader() } })
      if (res.ok) { n.is_read = 1; unread.value = Math.max(0, unread.value - 1) }
    } catch { /* stays unread; shown as unread */ }
  }
  close()
  if (n.action_url) router.push(n.action_url)
}

// ---- search (real catalogue data from /search/autocomplete) ------------------------------------------
const recommendedCats = ref<any[]>([])
const searchFetcher: AcFetcher = async (q, signal) => {
  const res = await fetch(`${API_BASE_URL}/api/v1/search/autocomplete?q=${encodeURIComponent(q)}`, { signal })
  if (!res.ok) throw new Error(locale.t('searchError'))
  const j = await res.json()
  const d = j.data || {}
  const groups: { key: string; label: string; items: AcItem[] }[] = [
    { key: 'product', label: '상품', items: (d.products || []).map((p: any) => ({ id: p.id, type: 'product', label: p.title, sub: locale.formatPrice(p.lowest_sale_price), image: p.thumbnail_url, to: `/product/${p.slug || p.id}` })) },
    { key: 'category', label: '카테고리', items: (d.categories || []).map((c: any) => ({ id: c.id, type: 'category', label: c.name, to: `/category/${c.slug}` })) },
    { key: 'keyword', label: '검색어', items: (d.keywords || []).map((k: any) => ({ id: k.keyword, type: 'keyword', label: k.keyword, sub: k.category_name || undefined, to: `/search?q=${encodeURIComponent(k.keyword)}` })) }
  ].filter((g) => g.items.length)
  if (q.trim() && recommendedCats.value.length) {
    groups.unshift({
      key: 'recommended', label: '추천 카테고리',
      items: recommendedCats.value.map((c: any) => ({ id: c.slug || c.id, type: 'category', label: c.name, to: `/category/${c.slug}` }))
    })
  }
  return groups
}
function logSearch(keyword: string) {
  fetch(`${API_BASE_URL}/api/v1/search/log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword }) }).catch(() => {})
}
function onSearchSelect(it: AcItem) {
  if (it.type === 'keyword') { rememberSearch(it.label); logSearch(it.label) }
  if (it.to) router.push(it.to)
}
function onSearchSubmit(q: string) {
  const kw = q.trim()
  if (!kw) return
  rememberSearch(kw)
  logSearch(kw)
  router.push({ path: '/search', query: { q: kw } })
}
// ---- recent searches (local device only, max 8) ---------------------------------------------------
const RECENT_KEY = 'olmoa_recent_searches'
const recentSearches = ref<string[]>([])
try {
  const raw: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  if (Array.isArray(raw)) recentSearches.value = raw.filter((s): s is string => typeof s === 'string').slice(0, 8)
} catch { /* corrupted storage: start empty */ }
function persistRecent() {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches.value)) } catch { /* storage unavailable */ }
}
function rememberSearch(kw: string) {
  const k = kw.trim()
  if (!k) return
  recentSearches.value = [k, ...recentSearches.value.filter((s) => s !== k)].slice(0, 8)
  persistRecent()
}
function removeRecent(kw: string) {
  recentSearches.value = recentSearches.value.filter((s) => s !== kw)
  persistRecent()
}
function clearRecent() {
  recentSearches.value = []
  persistRecent()
}
function runRecent(term: string, close: () => void) {
  close()
  router.push({ path: '/search', query: { q: term } })
}
// ---- trending searches -----------------------------------------------------------------------------
interface TrendingRow { term: string; delta: number | 'NEW' | null }
const trendingSearches = ref<TrendingRow[]>([])
async function fetchTrending() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/search/autocomplete?q=`)
    if (!res.ok) return
    const json = await res.json()
    trendingSearches.value = parseTrendingKeywords(json).map((term) => ({ term, delta: null }))
    const rec = (json?.data?.recommended_categories ?? json?.recommended_categories ?? []) as any[]
    if (Array.isArray(rec)) recommendedCats.value = rec.filter((c) => c && (c.slug || c.id) && c.name).slice(0, 8)
  } catch { /* idle panel simply shows recents only */ }
}
function runTrendingRow(row: TrendingRow, close: () => void) { runTrending(row.term, close) }
function runTrending(term: string, close: () => void) {
  rememberSearch(term)
  logSearch(term)
  close()
  router.push({ path: '/search', query: { q: term } })
}

// ---- business disclosure (전자상거래법 제10조) ----------------------------------------------------------
const business = useBusinessStore()
const biz = computed(() => business.info)
const bizLoaded = computed(() => business.loaded)

function logout() { auth.logout(); router.push('/') }
function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }

// ---- theme (light / dark / system, persisted per browser) -------------------------------------------
const { mode: themeMode, set: setTheme } = useTheme()
const themeLabel = computed(() => themeMode.value === 'light' ? locale.t('themeLight') : themeMode.value === 'dark' ? locale.t('themeDark') : locale.t('themeSystem'))
function cycleTheme() { setTheme(nextThemeMode(themeMode.value)) }

// OmNavigation & OmFooter dynamically translate these labels via uiT() across ko/en/ja/zh-TW.
const categoryNav = computed<NavItem[]>(() => [
  { to: '/channel/lightning-deals', label: '번개특가', icon: Zap },
  { to: '/channel/best-sellers', label: '베스트' },
  { to: '/categories', label: '전체 카테고리' },
  { to: '/coupons', label: '쿠폰·적립금' },
  { to: '/support', label: '고객센터' }
])
const bottomNav = computed<NavItem[]>(() => [
  { to: '/', label: '홈', icon: House, exact: true },
  { to: '/categories', label: '카테고리', icon: LayoutGrid },
  { to: '/search', label: '검색', icon: Search },
  { to: auth.isAuthenticated ? '/my' : '/login', label: auth.isAuthenticated ? '마이' : '로그인', icon: User },
  { to: '/my/recent', label: '최근 본', icon: History }
])
const footerColumns: FooterColumn[] = [
  { title: '쇼핑', links: [{ label: '번개특가', to: '/channel/lightning-deals' }, { label: '베스트', to: '/channel/best-sellers' }, { label: '전체 카테고리', to: '/categories' }, { label: '쿠폰·적립금', to: '/coupons' }] },
  { title: '구매 안내', links: [{ label: '배송 정책', to: '/policy/shipping' }, { label: '취소·반품·환불', to: '/legal/refund' }, { label: '주문·배송 조회', to: '/orders' }] },
  { title: '고객 지원', links: [{ label: '고객센터·1:1 문의', to: '/support' }, { label: '이용약관', to: '/legal/terms' }, { label: '개인정보처리방침', to: '/legal/privacy' }, { label: '판매자 입점·판매자센터', href: PARTNER_CONSOLE_URL }] }
]

const hideBottomNav = computed(() => {
  const bare = barePathOf(route.path)
  return bare.startsWith('/p/') || bare.startsWith('/product/') || bare === '/checkout' || bare === '/cart'
})

// ---- recently viewed rail ---------------------------------------------------------------------------
interface RecentProduct { id: string; title: string; thumb?: string; at: number }
const RECENT_PRODUCTS_KEY = 'olmoa_recent_products'
const recentProducts = ref<RecentProduct[]>([])
function loadRecents() {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_PRODUCTS_KEY) || '[]')
    recentProducts.value = Array.isArray(raw)
      ? raw.filter((p): p is RecentProduct => !!p && typeof (p as any).id === 'string').slice(0, 50)
      : []
  } catch { recentProducts.value = [] }
}

// ---- category bar hides on scroll down, returns on scroll up ----------------------------------------
const categoryBarHidden = ref(false)
const SCROLL_DELTA_PX = 12
const HIDE_BELOW_Y = 200
const SETTLE_MS = 250
let pivotY = 0
let scrollQueued = false
let settleUntil = 0
function onScrollFrame() {
  scrollQueued = false
  const y = window.scrollY
  if (performance.now() < settleUntil) {
    pivotY = y
    return
  }
  if (!categoryBarHidden.value) {
    if (y > HIDE_BELOW_Y && y - pivotY > SCROLL_DELTA_PX) {
      categoryBarHidden.value = true
      pivotY = y
      settleUntil = performance.now() + SETTLE_MS
    } else if (y < pivotY) {
      pivotY = y
    }
  } else {
    if (pivotY - y > SCROLL_DELTA_PX || y <= HIDE_BELOW_Y) {
      categoryBarHidden.value = false
      pivotY = y
      settleUntil = performance.now() + SETTLE_MS
    } else if (y > pivotY) {
      pivotY = y
    }
  }
}
function onScroll() {
  if (!scrollQueued) {
    scrollQueued = true
    requestAnimationFrame(onScrollFrame)
  }
}
function resetCategoryBar() {
  categoryBarHidden.value = false
  pivotY = 0
}

onMounted(async () => {
  fetchNotifications()
  fetchTrending()
  business.load()
  loadRecents()
  window.addEventListener('scroll', onScroll, { passive: true })
})
watch(() => route.fullPath, () => { loadRecents(); resetCategoryBar() })
onBeforeUnmount(() => { window.removeEventListener('scroll', onScroll) })
</script>

<template>
  <div class="flex min-h-screen flex-col bg-bg text-ink">
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-toast focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg">{{ locale.t('skipToMain') }}</a>

    <OmHeader>
      <template #top>
        <div class="hidden border-b border-line-divider bg-surface-2/80 md:block">
          <div class="om-container flex h-9 items-center justify-between text-xs text-ink-muted">
            <div class="flex items-center gap-4">
              <a :href="PARTNER_CONSOLE_URL" target="_blank" rel="noopener" class="font-medium transition-colors hover:text-primary">{{ locale.t('sellerCenter') }}</a>
              <span class="h-3 w-px bg-line-strong" aria-hidden="true" />
              <RouterLink to="/support" class="font-medium transition-colors hover:text-primary">{{ locale.t('support') }}</RouterLink>
            </div>
            <div class="flex items-center gap-2.5">
              <label class="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 shadow-sm">
                <Globe class="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span class="sr-only">{{ locale.t('langLabel') }}</span>
                <select :value="locale.locale" class="cursor-pointer bg-transparent text-xs font-semibold text-ink focus:outline-none" @change="switchLocale(($event.target as HTMLSelectElement).value as SupportedLocale)">
                  <option value="ko-KR">한국어</option><option value="en-US">English</option><option value="ja-JP">日本語</option><option value="zh-TW">繁體中文</option>
                </select>
              </label>
              <label class="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 shadow-sm" :title="locale.currency !== 'KRW' ? locale.fxNote : undefined">
                <span class="sr-only">{{ locale.t('currencyLabel') }}</span>
                <select :value="locale.currency" class="cursor-pointer bg-transparent text-xs font-semibold text-ink focus:outline-none" @change="switchCurrency(($event.target as HTMLSelectElement).value)">
                  <option v-for="c in locale.availableCurrencies" :key="c" :value="c">{{ { KRW: 'KRW ₩', USD: 'USD $', JPY: 'JPY ¥', TWD: 'TWD NT$' }[c] }}</option>
                </select>
              </label>
              <span v-if="locale.currency !== 'KRW'" class="text-2xs font-medium text-ink-subtle">{{ locale.t('fxReferenceNote') }}</span>
            </div>
          </div>
        </div>
      </template>

      <template #start>
        <RouterLink to="/" class="group flex items-center gap-2.5" aria-label="OLMOA">
          <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true" class="shrink-0 transition-transform duration-fast group-hover:scale-105">
            <rect width="36" height="36" rx="11" class="fill-primary" />
            <circle cx="18" cy="18" r="8.5" fill="none" stroke="currentColor" stroke-width="2.8" class="text-primary-on" />
            <path d="M10.5 18h15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" class="text-primary-on opacity-65" />
            <circle cx="25.5" cy="10.5" r="3" class="fill-highlight" />
          </svg>
          <span class="hidden text-xl font-extrabold tracking-tight text-ink sm:inline">{{ SITE_NAME }}</span>
        </RouterLink>
        <MegaMenu />
      </template>

      <div class="mx-auto w-full max-w-2xl">
        <OmSearchBar
          :fetcher="searchFetcher"
          :placeholder="isPhone ? locale.t('searchPlaceholderShort') : locale.t('searchPlaceholder')"
          :label="locale.t('navSearch')"
          :empty-text="locale.t('searchEmpty')"
          @select="onSearchSelect"
          @submit="onSearchSubmit"
        >
          <template #idle="{ close }">
            <div class="grid gap-4 px-3 py-2 sm:grid-cols-2">
              <div v-if="recentSearches.length">
                <div class="flex items-center justify-between pb-1.5 pt-2">
                  <p class="text-2xs font-bold uppercase tracking-wider text-ink-subtle">{{ locale.t('recentSearches') }}</p>
                  <button type="button" class="text-2xs font-medium text-ink-muted underline hover:text-ink" @click="clearRecent">{{ locale.t('clearAll') }}</button>
                </div>
                <ul class="flex flex-wrap gap-1.5 pb-2">
                  <li v-for="term in recentSearches" :key="term" class="flex items-center gap-0.5 rounded-full border border-line bg-surface-2 py-1 pl-3 pr-1.5 text-xs">
                    <button type="button" class="hover:text-primary hover:underline" @click="runRecent(term, close)">{{ term }}</button>
                    <button type="button" class="flex h-5 w-5 items-center justify-center rounded-full text-ink-muted hover:bg-surface-3" :aria-label="`${term} ${locale.t('clearAll')}`" @click="removeRecent(term)">×</button>
                  </li>
                </ul>
              </div>
              <div v-if="trendingSearches.length">
                <p class="pb-1.5 pt-2 text-2xs font-bold uppercase tracking-wider text-ink-subtle">{{ locale.t('trendingSearches') }}</p>
                <ol>
                  <li v-for="(row, i) in trendingSearches" :key="row.term">
                    <button type="button" class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2" @click="runTrendingRow(row, close)">
                      <span class="w-4 shrink-0 text-center text-xs font-bold om-num" :class="i < 3 ? 'text-primary' : 'text-ink-subtle'">{{ i + 1 }}</span>
                      <span class="min-w-0 flex-1 truncate">{{ row.term }}</span>
                      <span v-if="row.delta === 'NEW'" class="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-2xs font-bold text-accent whitespace-nowrap">NEW</span>
                      <span v-else-if="typeof row.delta === 'number' && row.delta !== 0" class="om-num shrink-0 text-2xs font-bold" :class="row.delta > 0 ? 'text-danger' : 'text-info'">
                        {{ row.delta > 0 ? `▲${row.delta}` : `▼${Math.abs(row.delta)}` }}
                      </span>
                      <span v-else-if="row.delta === 0" class="shrink-0 text-2xs text-ink-subtle">-</span>
                    </button>
                  </li>
                </ol>
              </div>
            </div>
          </template>
        </OmSearchBar>
      </div>

      <template #end>
        <OmIconButton :label="`${themeLabel}`" :title="locale.t('themeToggleTitle')" @click="cycleTheme">
          <Sun v-if="themeMode === 'light'" :size="19" />
          <Moon v-else-if="themeMode === 'dark'" :size="19" />
          <Monitor v-else :size="19" />
        </OmIconButton>
        <div class="hidden items-center gap-1 sm:flex">
          <template v-if="auth.isAuthenticated">
            <OmPopover placement="bottom-end" width="w-80" role="dialog">
              <template #trigger="{ toggle, attrs }">
                <OmIconButton v-bind="attrs" :label="locale.t('notifications')" :badge="unread || null" @click="toggle"><Bell :size="19" /></OmIconButton>
              </template>
              <template #default="{ close }">
                <div class="flex items-center justify-between border-b border-line px-4 py-3">
                  <p class="text-sm font-bold">{{ locale.t('notifications') }}</p>
                  <OmBadge v-if="unread" tone="primary" size="sm">{{ locale.t('unreadPrefix') }} {{ unread }}</OmBadge>
                </div>
                <p v-if="notiError" class="p-6 text-center text-sm text-danger">{{ locale.t('notificationsError') }}</p>
                <ul v-else-if="notifications.length" class="max-h-80 divide-y divide-line overflow-y-auto">
                  <li v-for="n in notifications" :key="n.id">
                    <button type="button" class="block w-full px-4 py-3 text-left transition-colors hover:bg-surface-2" @click="openNotification(n, close)">
                      <span class="flex items-center gap-2 text-sm" :class="Number(n.is_read) === 0 ? 'font-semibold text-ink' : 'text-ink-muted'">
                        <span v-if="Number(n.is_read) === 0" class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />{{ n.title }}
                      </span>
                      <span class="mt-0.5 block text-xs text-ink-muted">{{ n.message }}</span>
                      <span class="mt-1 block text-2xs text-ink-subtle">{{ formatDateTime(n.created_at) }}</span>
                    </button>
                  </li>
                </ul>
                <p v-else class="p-6 text-center text-sm text-ink-muted">{{ locale.t('notificationsEmpty') }}</p>
              </template>
            </OmPopover>
            <OmIconButton :label="locale.t('wishlistTitle')" @click="router.push('/wishlist')"><Heart :size="19" /></OmIconButton>
            <OmPopover placement="bottom-end" width="w-56" role="menu">
              <template #trigger="{ toggle, attrs }">
                <button type="button" v-bind="attrs" class="flex h-10 items-center gap-2 rounded-full border border-line bg-surface-2/70 pl-1.5 pr-3 transition-colors hover:border-line-strong hover:bg-surface-2" @click="toggle">
                  <span class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-on">{{ (auth.user?.name || 'U').charAt(0) }}</span>
                  <span class="hidden max-w-[7rem] truncate text-sm font-semibold xl:inline">{{ auth.user?.name }}</span>
                </button>
              </template>
              <template #default="{ close }">
                <ul class="py-1.5 text-sm">
                  <li><RouterLink to="/my" class="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-surface-2" @click="close()"><User :size="16" />{{ locale.t('myPage') }}</RouterLink></li>
                  <li><RouterLink to="/orders" class="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-surface-2" @click="close()"><Package :size="16" />{{ locale.t('orders') }}</RouterLink></li>
                  <li><RouterLink to="/coupons" class="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-surface-2" @click="close()"><Ticket :size="16" />{{ locale.t('coupons') }}</RouterLink></li>
                  <li class="my-1.5 h-px bg-line-divider" role="separator" />
                  <li><button type="button" class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink" @click="close(); logout()"><LogOut :size="16" />{{ locale.t('signOut') }}</button></li>
                </ul>
              </template>
            </OmPopover>
          </template>
          <RouterLink v-else to="/login" class="flex h-10 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2"><User :size="18" />{{ locale.t('signIn') }}</RouterLink>
          <RouterLink to="/cart" class="ml-1 flex h-10 items-center gap-2 rounded-full bg-primary px-4.5 text-sm font-semibold text-primary-on shadow-sm transition-all hover:bg-primary-hover hover:shadow-md active:scale-[0.98]">
            <ShoppingBag :size="17" aria-hidden="true" />{{ locale.t('cart') }}
            <span v-if="cart.totalCount" class="rounded-full bg-primary-on/20 px-1.5 text-xs om-num">{{ cart.totalCount }}</span>
          </RouterLink>
        </div>
        <OmIconButton class="sm:hidden" :label="locale.t('cart')" :badge="cart.totalCount || null" @click="router.push('/cart')"><ShoppingBag :size="20" /></OmIconButton>
      </template>

      <template #bottom>
        <div
          class="overflow-hidden border-t border-line-divider bg-surface/95 transition-[max-height,opacity,visibility] duration-fast"
          :class="categoryBarHidden ? 'max-h-0 border-transparent opacity-0 invisible' : 'max-h-14 opacity-100 visible'"
        >
          <div class="om-container"><OmNavigation :items="categoryNav" label="쇼핑 메뉴" /></div>
        </div>
      </template>
    </OmHeader>

    <main id="main" :class="['flex-1', hideBottomNav ? '' : 'pb-20 md:pb-0']">
      <RouterView />
    </main>

    <aside
      v-if="!hideBottomNav"
      class="fixed right-4 top-1/3 z-30 hidden w-[72px] min-[1600px]:flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface/95 p-2 shadow-lg backdrop-blur-md"
      :aria-label="locale.t('recentProducts')"
    >
      <RouterLink
        v-for="p in recentProducts.slice(0, 3)"
        :key="p.id"
        :to="`/product/${p.id}`"
        :aria-label="p.title"
        class="block overflow-hidden rounded-xl border border-line transition-transform hover:scale-105 hover:border-primary"
      >
        <img v-if="p.thumb" :src="p.thumb" :alt="p.title" loading="lazy" decoding="async" class="h-12 w-12 object-cover" />
        <span v-else class="flex h-12 w-12 items-center justify-center bg-surface-2 text-ink-subtle">
          <Package :size="20" aria-hidden="true" />
        </span>
      </RouterLink>
      <RouterLink to="/cart" class="flex w-full flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-2xs font-bold text-ink-muted transition-colors hover:bg-primary-soft hover:text-primary" :aria-label="locale.t('cart')">
        <ShoppingBag :size="18" aria-hidden="true" />
        <span class="om-num">{{ cart.totalCount }}</span>
      </RouterLink>
      <button
        type="button"
        :aria-label="locale.t('scrollTop')"
        class="flex w-full flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-2xs font-bold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
        @click="scrollToTop"
      >
        <ChevronUp :size="18" aria-hidden="true" />{{ locale.t('scrollTop') }}
      </button>
    </aside>

    <OmNavigation v-if="!hideBottomNav" variant="bottom" :items="bottomNav" label="하단 메뉴" />

    <OmFooter :columns="footerColumns">
      <template #brand>
        <p class="flex items-center gap-2.5 text-lg font-extrabold tracking-tight">
          <svg width="28" height="28" viewBox="0 0 36 36" aria-hidden="true">
            <rect width="36" height="36" rx="11" class="fill-primary" />
            <circle cx="18" cy="18" r="8.5" fill="none" stroke="currentColor" stroke-width="2.8" class="text-primary-on" />
            <circle cx="25.5" cy="10.5" r="3" class="fill-highlight" />
          </svg>
          {{ SITE_NAME }}
        </p>
        <p class="max-w-xs text-sm text-ink-muted">{{ locale.locale === 'ko-KR' ? SITE_TAGLINE : locale.t('tagline') }}</p>
        <!-- Mobile-accessible locale & currency switcher -->
        <div class="flex flex-wrap items-center gap-2 pt-2 md:hidden">
          <select :value="locale.locale" :aria-label="locale.t('langLabel')" class="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink" @change="switchLocale(($event.target as HTMLSelectElement).value as SupportedLocale)">
            <option value="ko-KR">한국어</option><option value="en-US">English</option><option value="ja-JP">日本語</option><option value="zh-TW">繁體中文</option>
          </select>
          <select :value="locale.currency" :aria-label="locale.t('currencyLabel')" class="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink" @change="switchCurrency(($event.target as HTMLSelectElement).value)">
            <option v-for="c in locale.availableCurrencies" :key="c" :value="c">{{ { KRW: 'KRW ₩', USD: 'USD $', JPY: 'JPY ¥', TWD: 'TWD NT$' }[c] }}</option>
          </select>
        </div>
      </template>
      <template #legal>
        <div v-if="biz" data-testid="business-info" class="space-y-1">
          <p>
            상호 {{ biz.legal_name }} · 대표자 {{ biz.representative_name }} · 사업자등록번호 {{ biz.business_reg_number }}
            <a :href="`https://www.ftc.go.kr/bizCommPop.do?wrkr_no=${String(biz.business_reg_number).replace(/-/g, '')}`" target="_blank" rel="noopener" class="underline hover:text-ink">{{ locale.t('bizInfoVerify') }}</a>
            · 통신판매업신고 {{ biz.mail_order_reg_number }}<template v-if="biz.hosting_provider"> · 호스팅서비스 {{ biz.hosting_provider }}</template>
          </p>
          <p>주소 {{ biz.address }} · 고객센터 {{ biz.cs_phone }} · {{ biz.cs_email }}<template v-if="biz.privacy_officer_name"> · 개인정보보호책임자 {{ biz.privacy_officer_name }}</template></p>
          <p v-if="biz.escrow_service_ref">구매안전서비스 {{ biz.escrow_service_ref }}</p>
          <p class="pt-1 text-ink-subtle">
            '올모아 직영' 표시 상품은 {{ biz.legal_name }}가 직접 판매합니다. 입점 판매자 상품의 경우 {{ biz.legal_name }}는 통신판매중개자로서 거래 당사자가 아니며,
            상품 정보와 거래에 대한 책임은 각 판매자에게 있습니다. 판매자 정보는 상품 상세에서 확인할 수 있습니다.
          </p>
          <p class="pt-2">© {{ new Date().getFullYear() }} {{ biz.legal_name }}</p>
        </div>
        <p v-else-if="bizLoaded" data-testid="business-info-missing" class="font-semibold text-warning">{{ locale.t('bizInfoMissing') }}</p>
      </template>
    </OmFooter>
    <OmToast />
    <OmConfirmDialog />
    <LocaleNudge />
  </div>
</template>
