<script setup lang="ts">
// Buyer app shell (PHASE 2 redesign): utility bar, search-first header, category bar, mobile tab bar, footer.
// Everything shown here comes from an API or the user's own state; no badges, counts or claims are invented.
import { ref, computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { Bell, ChevronDown, Heart, House, LayoutGrid, LogOut, Package, ShoppingBag, Ticket, User, Zap } from 'lucide-vue-next'
import { OmHeader, OmSearchBar, OmIconButton, OmNavigation, OmPopover, OmFooter, OmBadge, OmToast, formatDateTime } from '@olmoa/ui'
import type { AcFetcher, AcItem, NavItem, FooterColumn } from '@olmoa/ui'
import { useCartStore } from './stores/cart'
import { useAuthStore } from './stores/auth'
import { useLocaleStore } from './stores/locale'
import { useCatalogStore } from './stores/catalog'
import { API_BASE_URL, PARTNER_CONSOLE_URL, authHeader } from './config'

const cart = useCartStore()
const auth = useAuthStore()
const locale = useLocaleStore()
const router = useRouter()
const route = useRoute()

// ---- categories (mega menu) — shared store, one /categories request per page session -------------------
const catalog = useCatalogStore()
const activeRoot = ref<any>(null)
const rootCategories = computed(() => catalog.roots)
const subCategories = computed(() => (activeRoot.value ? catalog.childrenOf(activeRoot.value.id) : []))

// ---- notifications ----------------------------------------------------------------------------------
const notifications = ref<any[]>([])
const unread = ref(0)
const notiError = ref(false)
async function fetchNotifications() {
  if (!auth.isAuthenticated) return
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
const searchFetcher: AcFetcher = async (q, signal) => {
  const res = await fetch(`${API_BASE_URL}/api/v1/search/autocomplete?q=${encodeURIComponent(q)}`, { signal })
  if (!res.ok) throw new Error(`검색 서버 오류 (${res.status})`)
  const j = await res.json()
  const d = j.data || {}
  return [
    { key: 'product', label: '상품', items: (d.products || []).map((p: any) => ({ id: p.id, type: 'product', label: p.title, sub: locale.formatPrice(p.lowest_sale_price), image: p.thumbnail_url, to: `/product/${p.slug || p.id}` })) },
    { key: 'category', label: '카테고리', items: (d.categories || []).map((c: any) => ({ id: c.id, type: 'category', label: c.name, to: `/category/${c.slug}` })) },
    { key: 'keyword', label: '검색어', items: (d.keywords || []).map((k: any) => ({ id: k.keyword, type: 'keyword', label: k.keyword, sub: k.category_name || undefined, to: `/search?q=${encodeURIComponent(k.keyword)}` })) }
  ].filter((g) => g.items.length)
}
function logSearch(keyword: string) {
  fetch(`${API_BASE_URL}/api/v1/search/log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword }) }).catch(() => {})
}
function onSearchSelect(it: AcItem) {
  if (it.type === 'keyword') logSearch(it.label)
  if (it.to) router.push(it.to)
}
function onSearchSubmit(q: string) {
  const kw = q.trim()
  if (!kw) return
  logSearch(kw)
  router.push({ path: '/search', query: { q: kw } })
}

// ---- business disclosure (전자상거래법 제10조) ----------------------------------------------------------
const biz = ref<any>(null)
const bizLoaded = ref(false)

function logout() { auth.logout(); router.push('/') }

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
  { to: '/wishlist', label: '찜', icon: Heart },
  { to: '/cart', label: '장바구니', icon: ShoppingBag, badge: cart.totalCount || null },
  { to: auth.isAuthenticated ? '/profile' : '/login', label: auth.isAuthenticated ? '마이' : '로그인', icon: User }
])
const footerColumns: FooterColumn[] = [
  { title: '쇼핑', links: [{ label: '번개특가', to: '/channel/lightning-deals' }, { label: '베스트', to: '/channel/best-sellers' }, { label: '전체 카테고리', to: '/categories' }, { label: '쿠폰·적립금', to: '/coupons' }] },
  { title: '구매 안내', links: [{ label: '배송 정책', to: '/policy/shipping' }, { label: '취소·반품·환불', to: '/legal/refund' }, { label: '판매가 인하 차액 보상', to: '/policy/price-match' }, { label: '주문·배송 조회', to: '/orders' }] },
  { title: '고객 지원', links: [{ label: '고객센터·1:1 문의', to: '/support' }, { label: '이용약관', to: '/legal/terms' }, { label: '개인정보처리방침', to: '/legal/privacy' }, { label: '판매자 입점·판매자센터', href: PARTNER_CONSOLE_URL }] }
]
const hideBottomNav = computed(() => route.path.startsWith('/product/') || route.path === '/checkout')

onMounted(async () => {
  fetchNotifications()
  fetch(`${API_BASE_URL}/api/v1/business-info`).then((r) => r.json()).then((j) => { biz.value = j && j.configured ? j.data : null }).catch(() => { biz.value = null }).finally(() => { bizLoaded.value = true })
  // On failure the category bar still works; the menu just stays empty.
  await catalog.load()
  activeRoot.value = rootCategories.value[0] || null
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-bg text-ink">
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-toast focus:rounded focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg">본문 바로가기</a>

    <OmHeader>
      <template #top>
        <div class="hidden border-b border-line bg-surface-2 md:block">
          <div class="om-container flex h-9 items-center justify-between text-xs text-ink-muted">
            <div class="flex items-center gap-4">
              <a :href="PARTNER_CONSOLE_URL" target="_blank" rel="noopener" class="hover:text-ink">판매자 입점·판매자센터</a>
              <RouterLink to="/support" class="hover:text-ink">고객센터</RouterLink>
            </div>
            <div class="flex items-center gap-3">
              <label class="flex items-center gap-1">
                <span class="sr-only">언어</span>
                <select :value="locale.locale" class="cursor-pointer bg-transparent font-medium text-ink-muted hover:text-ink focus:outline-none" @change="locale.setLocale(($event.target as HTMLSelectElement).value as any)">
                  <option value="ko-KR">한국어</option><option value="en-US">English</option><option value="ja-JP">日本語</option>
                </select>
              </label>
              <span class="h-3 w-px bg-line-strong" aria-hidden="true" />
              <label class="flex items-center gap-1" :title="locale.currency !== 'KRW' ? locale.fxNote : undefined">
                <span class="sr-only">표시 통화</span>
                <select :value="locale.currency" class="cursor-pointer bg-transparent font-medium text-ink-muted hover:text-ink focus:outline-none" @change="locale.setCurrency(($event.target as HTMLSelectElement).value as any)">
                  <option v-for="c in locale.availableCurrencies" :key="c" :value="c">{{ { KRW: 'KRW ₩', USD: 'USD $', JPY: 'JPY ¥', EUR: 'EUR €' }[c] }}</option>
                </select>
              </label>
              <span v-if="locale.currency !== 'KRW'" class="text-2xs text-ink-subtle">참고 환산가 · 결제는 원화</span>
            </div>
          </div>
        </div>
      </template>

      <template #start>
        <RouterLink to="/" class="flex items-center gap-2" aria-label="OLMOA 홈">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
            <rect width="32" height="32" rx="9" class="fill-primary" />
            <circle cx="16" cy="16" r="7.5" fill="none" stroke="white" stroke-width="3" />
            <circle cx="22.5" cy="9.5" r="2.5" class="fill-highlight" />
          </svg>
          <span class="hidden text-xl font-bold tracking-tight sm:inline">olmoa</span>
        </RouterLink>
        <OmPopover placement="bottom-start" width="w-[min(92vw,720px)]" role="dialog">
          <template #trigger="{ toggle, attrs, open }">
            <button type="button" v-bind="attrs" class="ml-2 hidden h-10 items-center gap-1.5 rounded px-3 text-sm font-semibold text-ink hover:bg-surface-2 lg:inline-flex" @click="toggle">
              <LayoutGrid :size="18" aria-hidden="true" />카테고리<ChevronDown :size="16" :class="['transition-transform', open ? 'rotate-180' : '']" aria-hidden="true" />
            </button>
          </template>
          <template #default="{ close }">
            <div v-if="rootCategories.length" class="flex max-h-[min(70vh,460px)]">
              <ul class="w-56 shrink-0 overflow-y-auto border-r border-line py-1">
                <li v-for="c in rootCategories" :key="c.id">
                  <RouterLink :to="`/category/${c.slug}`" :class="['flex items-center justify-between px-4 py-2 text-sm', activeRoot?.id === c.id ? 'bg-primary-soft font-semibold text-primary-soft-ink' : 'text-ink hover:bg-surface-2']" @mouseenter="activeRoot = c" @focus="activeRoot = c" @click="close()">
                    <span class="truncate">{{ c.name }}</span>
                  </RouterLink>
                </li>
              </ul>
              <div class="min-w-0 flex-1 overflow-y-auto p-4">
                <div class="mb-3 flex items-center justify-between">
                  <p class="font-semibold">{{ activeRoot?.name }}</p>
                  <RouterLink v-if="activeRoot" :to="`/category/${activeRoot.slug}`" class="text-sm font-medium text-primary hover:underline" @click="close()">전체 보기</RouterLink>
                </div>
                <ul v-if="subCategories.length" class="grid grid-cols-2 gap-1">
                  <li v-for="s in subCategories" :key="s.id">
                    <RouterLink :to="`/category/${s.slug}`" class="flex items-center justify-between rounded-sm px-3 py-2 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink" @click="close()">
                      <span class="truncate">{{ s.name }}</span><span v-if="s.product_count" class="text-xs text-ink-subtle om-num">{{ s.product_count }}</span>
                    </RouterLink>
                  </li>
                </ul>
                <p v-else class="py-8 text-center text-sm text-ink-subtle">하위 카테고리가 없습니다.</p>
              </div>
            </div>
            <p v-else class="p-6 text-center text-sm text-ink-muted">카테고리를 불러오지 못했습니다.</p>
          </template>
        </OmPopover>
      </template>

      <div class="mx-auto w-full max-w-2xl">
        <OmSearchBar :fetcher="searchFetcher" placeholder="상품, 브랜드, 카테고리 검색" label="상품 검색" empty-text="검색 결과가 없습니다." @select="onSearchSelect" @submit="onSearchSubmit" />
      </div>

      <template #end>
        <div class="hidden items-center gap-1 sm:flex">
          <template v-if="auth.isAuthenticated">
            <OmPopover placement="bottom-end" width="w-80" role="dialog">
              <template #trigger="{ toggle, attrs }">
                <OmIconButton v-bind="attrs" label="알림" :badge="unread || null" @click="toggle"><Bell :size="20" /></OmIconButton>
              </template>
              <template #default="{ close }">
                <div class="flex items-center justify-between border-b border-line px-4 py-3">
                  <p class="text-sm font-semibold">알림</p>
                  <OmBadge v-if="unread" tone="primary" size="sm">미확인 {{ unread }}</OmBadge>
                </div>
                <p v-if="notiError" class="p-6 text-center text-sm text-danger">알림을 불러오지 못했습니다.</p>
                <ul v-else-if="notifications.length" class="max-h-80 divide-y divide-line overflow-y-auto">
                  <li v-for="n in notifications" :key="n.id">
                    <button type="button" class="block w-full px-4 py-3 text-left hover:bg-surface-2" @click="openNotification(n, close)">
                      <span class="flex items-center gap-2 text-sm" :class="Number(n.is_read) === 0 ? 'font-semibold text-ink' : 'text-ink-muted'">
                        <span v-if="Number(n.is_read) === 0" class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="읽지 않음" />{{ n.title }}
                      </span>
                      <span class="mt-0.5 block text-xs text-ink-muted">{{ n.message }}</span>
                      <span class="mt-1 block text-2xs text-ink-subtle">{{ formatDateTime(n.created_at) }}</span>
                    </button>
                  </li>
                </ul>
                <p v-else class="p-6 text-center text-sm text-ink-muted">받은 알림이 없습니다.</p>
              </template>
            </OmPopover>
            <OmIconButton label="찜한 상품" @click="router.push('/wishlist')"><Heart :size="20" /></OmIconButton>
            <OmPopover placement="bottom-end" width="w-56" role="menu">
              <template #trigger="{ toggle, attrs }">
                <button type="button" v-bind="attrs" class="flex h-10 items-center gap-2 rounded px-2 hover:bg-surface-2" @click="toggle">
                  <span class="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-ink">{{ (auth.user?.name || '회').charAt(0) }}</span>
                  <span class="hidden max-w-[7rem] truncate text-sm font-medium xl:inline">{{ auth.user?.name }}</span>
                </button>
              </template>
              <template #default="{ close }">
                <ul class="py-1 text-sm">
                  <li><RouterLink to="/profile" class="flex items-center gap-2 px-4 py-2 hover:bg-surface-2" @click="close()"><User :size="16" />마이페이지</RouterLink></li>
                  <li><RouterLink to="/orders" class="flex items-center gap-2 px-4 py-2 hover:bg-surface-2" @click="close()"><Package :size="16" />주문·배송</RouterLink></li>
                  <li><RouterLink to="/coupons" class="flex items-center gap-2 px-4 py-2 hover:bg-surface-2" @click="close()"><Ticket :size="16" />쿠폰·적립금</RouterLink></li>
                  <li class="my-1 h-px bg-line-divider" role="separator" />
                  <li><button type="button" class="flex w-full items-center gap-2 px-4 py-2 text-left text-ink-muted hover:bg-surface-2 hover:text-ink" @click="close(); logout()"><LogOut :size="16" />로그아웃</button></li>
                </ul>
              </template>
            </OmPopover>
          </template>
          <RouterLink v-else to="/login" class="flex h-10 items-center gap-1.5 rounded px-3 text-sm font-medium hover:bg-surface-2"><User :size="20" />로그인</RouterLink>
          <RouterLink to="/cart" class="ml-1 flex h-10 items-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-primary-on hover:bg-primary-hover">
            <ShoppingBag :size="18" aria-hidden="true" />장바구니
            <span v-if="cart.totalCount" class="rounded-full bg-white/20 px-1.5 text-xs om-num">{{ cart.totalCount }}</span>
          </RouterLink>
        </div>
        <OmIconButton class="sm:hidden" label="장바구니" :badge="cart.totalCount || null" @click="router.push('/cart')"><ShoppingBag :size="20" /></OmIconButton>
      </template>

      <template #bottom>
        <div class="border-t border-line"><div class="om-container"><OmNavigation :items="categoryNav" label="쇼핑 메뉴" /></div></div>
      </template>
    </OmHeader>

    <main id="main" :class="['flex-1', hideBottomNav ? '' : 'pb-20 md:pb-0']">
      <RouterView />
    </main>

    <OmNavigation v-if="!hideBottomNav" variant="bottom" :items="bottomNav" label="하단 메뉴" />

    <OmFooter :columns="footerColumns">
      <template #brand>
        <p class="flex items-center gap-2 text-lg font-bold tracking-tight">
          <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" class="fill-primary" /><circle cx="16" cy="16" r="7.5" fill="none" stroke="white" stroke-width="3" /><circle cx="22.5" cy="9.5" r="2.5" class="fill-highlight" /></svg>
          olmoa
        </p>
        <p class="max-w-xs text-sm text-ink-muted">국내외 판매자의 상품을 한곳에서 비교하고 구매하는 오픈마켓입니다.</p>
      </template>
      <template #legal>
        <div v-if="biz" data-testid="business-info" class="space-y-1">
          <p>
            상호 {{ biz.legal_name }} · 대표자 {{ biz.representative_name }} · 사업자등록번호 {{ biz.business_reg_number }}
            <a :href="`https://www.ftc.go.kr/bizCommPop.do?wrkr_no=${String(biz.business_reg_number).replace(/-/g, '')}`" target="_blank" rel="noopener" class="underline hover:text-ink">사업자정보확인</a>
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
        <p v-else-if="bizLoaded" data-testid="business-info-missing" class="font-semibold text-warning">운영 사업자 정보가 등록되지 않았습니다. 사업자 정보 등록 전에는 주문이 접수되지 않습니다.</p>
      </template>
    </OmFooter>
    <OmToast />
  </div>
</template>
