import { createRouter, createWebHistory, RouterView, type RouteLocationRaw, type RouteRecordRaw } from 'vue-router'
import {
  LANGS, CURRENCIES, DEFAULT_CURRENCY, SOURCE_LANG, isLang, isCurrency, parseLocalePath, buildLocalizedPath,
  resolveEntryLocale, PREF_LANG_COOKIE, PREF_CURRENCY_COOKIE, PREF_CURRENCY_COOKIE_ALT, type Lang, type Currency
} from '@olmoa/ui'
import HomeView from '../views/HomeView.vue'

// 2026-11-27 (owner work order, decisions 22-25): every storefront page lives
// under /{lang}/{currency}. The URL is the single source of truth for page,
// language and currency. Views keep writing plain paths ('/product/123',
// '/cart'); `localize()` below prefixes them with the current lang/currency in
// router.resolve (RouterLink link targets) and router.push/replace, so no link can
// drop the prefix (spec 5.1 buildLocalizedPath, enforced in one place).
const appRoutes: RouteRecordRaw[] = [
    { path: '', name: 'home', component: HomeView },
    { path: 'categories', name: 'categories', component: () => import('../views/CategoriesView.vue') },
    { path: 'c/:slug', name: 'category', component: () => import('../views/CategoryView.vue') },
    // :slug is the immutable product id (kept as the param name the views read); :seo is the localized slug.
    { path: 'p/:slug/:seo?', name: 'product', component: () => import('../views/ProductDetailView.vue') },
    { path: 'cart', name: 'cart', component: () => import('../views/CartView.vue') },
    { path: 'checkout', name: 'checkout', component: () => import('../views/CheckoutView.vue'), meta: { requiresAuth: true } },
    { path: 'profile', name: 'profile', redirect: (to) => `/${String(to.params.lang)}/${String(to.params.currency)}/my/settings` },
    { path: 'my', name: 'my', component: () => import('../views/my/MyHomeView.vue'), meta: { requiresAuth: true } },
    { path: 'my/reviews', name: 'my-reviews', component: () => import('../views/my/MyReviewsView.vue'), meta: { requiresAuth: true } },
    { path: 'my/qna', name: 'my-qna', component: () => import('../views/my/MyQnaView.vue'), meta: { requiresAuth: true } },
    { path: 'my/recent', name: 'my-recent', component: () => import('../views/my/RecentlyViewedView.vue'), meta: { requiresAuth: true } },
    { path: 'my/credits', name: 'my-credits', component: () => import('../views/my/CreditsView.vue'), meta: { requiresAuth: true } },
    { path: 'my/stores', name: 'my-stores', component: () => import('../views/my/FollowedStoresView.vue'), meta: { requiresAuth: true } },
    { path: 'my/settings', name: 'my-settings', component: () => import('../views/ProfileView.vue'), meta: { requiresAuth: true } },
    { path: 'orders', name: 'orders', component: () => import('../views/OrdersView.vue'), meta: { requiresAuth: true } },
    { path: 'orders/:id', name: 'order-detail', component: () => import('../views/OrderDetailView.vue'), meta: { requiresAuth: true } },
    { path: 'search', name: 'search', component: () => import('../views/SearchView.vue') },
    { path: 'login', name: 'login', component: () => import('../views/LoginView.vue') },
    { path: 'forgot-password', name: 'forgot-password', component: () => import('../views/ForgotPasswordView.vue') },
    { path: 'verify-email', name: 'verify-email', component: () => import('../views/VerifyEmailView.vue') },
    { path: 'register', name: 'register', component: () => import('../views/RegisterView.vue') },
    { path: 'channel/lightning-deals', name: 'lightning-deals', component: () => import('../views/LightningDealsView.vue') },
    { path: 'channel/best-sellers', name: 'best-sellers', component: () => import('../views/BestSellersView.vue') },
    { path: 'coupons', name: 'coupons', component: () => import('../views/CouponsView.vue'), meta: { requiresAuth: true } },
    { path: 'addresses', name: 'addresses', component: () => import('../views/AddressesView.vue'), meta: { requiresAuth: true } },
    { path: 'wishlist', name: 'wishlist', component: () => import('../views/WishlistView.vue'), meta: { requiresAuth: true } },
    { path: 'store/:id', name: 'seller-store', component: () => import('../views/SellerStoreView.vue') },
    { path: 'support', name: 'support', component: () => import('../views/SupportView.vue') },
    { path: 'policy/:type', name: 'policy', component: () => import('../views/PolicyView.vue') },
    { path: 'legal/terms', name: 'legal-terms', component: () => import('../views/LegalTermsView.vue') },
    { path: 'legal/privacy', name: 'legal-privacy', component: () => import('../views/LegalPrivacyView.vue') },
    { path: 'payments/success', name: 'payment-success', component: () => import('../views/PaymentResultView.vue'), meta: { requiresAuth: true } },
    { path: 'payments/fail', name: 'payment-fail', component: () => import('../views/PaymentResultView.vue'), meta: { requiresAuth: true } },
    { path: 'legal/refund', name: 'legal-refund', component: () => import('../views/LegalRefundView.vue') },
    { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFoundView.vue') }
]

const LANG_RE = LANGS.join('|')
const CUR_RE = CURRENCIES.join('|')

/** Fallback when a path has no prefix and the edge did not redirect (local dev, in-app pushes). */
function preferredLocale(): { lang: Lang; currency: Currency } {
  const cookies: Record<string, string> = {}
  try {
    for (const part of document.cookie.split(';')) {
      const i = part.indexOf('=')
      if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
    }
  } catch { /* no document */ }
  const r = resolveEntryLocale({
    cookieLang: cookies[PREF_LANG_COOKIE],
    cookieCurrency: cookies[PREF_CURRENCY_COOKIE] || cookies[PREF_CURRENCY_COOKIE_ALT],
    country: null
  })
  // No Geo signal in the browser: a cookie-less visitor stays on the source language.
  return r.source === 'cookie' ? r : { lang: SOURCE_LANG, currency: DEFAULT_CURRENCY[SOURCE_LANG] }
}

const router = createRouter({
  history: createWebHistory((import.meta as any).env?.BASE_URL || '/'),
  scrollBehavior(to, from, saved) {
    // Back/forward restores the scroll position (spec 5.1); new pages start at the top.
    return saved || { top: 0 }
  },
  routes: [
    { path: `/:lang(${LANG_RE})/:currency(${CUR_RE})`, component: RouterView, children: appRoutes },
    // Unprefixed paths: the edge 301/302s them before the app loads; this catches in-app and dev cases.
    {
      path: '/:pathMatch(.*)*',
      name: 'unprefixed',
      redirect: (to) => {
        const pref = currentOr(preferredLocale())
        return buildLocalizedPath(pref.lang, pref.currency, to.path, to.query as Record<string, unknown>) + (to.hash || '')
      }
    }
  ]
})

function currentOr(fallback: { lang: Lang; currency: Currency }): { lang: Lang; currency: Currency } {
  const p = router.currentRoute.value.params
  return isLang(p.lang) && isCurrency(p.currency) ? { lang: p.lang, currency: p.currency } : fallback
}

/** Prefix an absolute, unprefixed path with the current lang/currency (legacy shapes mapped). */
export function localizePath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path
  const [beforeHash, hash = ''] = path.split('#')
  const pathOnly = beforeHash.split('?')[0]
  if (parseLocalePath(pathOnly)) return path
  const { lang, currency } = currentOr(preferredLocale())
  return buildLocalizedPath(lang, currency, beforeHash) + (hash ? `#${hash}` : '')
}

export function localize(to: RouteLocationRaw): RouteLocationRaw {
  if (typeof to === 'string') return localizePath(to)
  if (to && typeof to === 'object' && 'path' in to && typeof to.path === 'string') {
    const p = localizePath(to.path)
    if (p === to.path) return to
    const [pathOnly, qs] = p.split('?')
    let merged = (to as any).query
    if (qs) {
      const fromPath: Record<string, string> = {}
      new URLSearchParams(qs).forEach((v, k) => { fromPath[k] = v })
      merged = { ...fromPath, ...((to as any).query || {}) }
    }
    return { ...to, path: pathOnly, ...(merged ? { query: merged } : {}) }
  }
  return to
}

const rawResolve = router.resolve.bind(router)
const rawPush = router.push.bind(router)
const rawReplace = router.replace.bind(router)
router.resolve = ((to: RouteLocationRaw, current?: any) => rawResolve(localize(to) as any, current)) as typeof router.resolve
router.push = ((to: RouteLocationRaw) => rawPush(localize(to))) as typeof router.push
router.replace = ((to: RouteLocationRaw) => rawReplace(localize(to))) as typeof router.replace

/** The same page in another language/currency (PDP drops its slug; the view restores the right one). */
export function switchLocalePath(path: string, lang: Lang, currency: Currency): string {
  const loc = parseLocalePath(path.split('?')[0])
  let bare = loc ? loc.bare : '/'
  if (loc && lang !== loc.lang) bare = bare.replace(/^(\/p\/[^/]+)\/[^/]+$/, '$1')
  return buildLocalizedPath(lang, currency, bare)
}

export default router
