// Static contract tests for the storefront shell: SEO head tags, the theme
// pre-render snippet, service-worker registration and the worker's own safety
// rules (API bypass, hashed-assets-only cache, offline navigation fallback).
// Behavior proof is the storefront typecheck + production build (sw.js ships at
// dist/sw.js via public/) plus a real browser pass over the route matrix.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Storefront shell')
const SF = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps/storefront')
const read = (p) => readFileSync(join(SF, p), 'utf8')

await t.test('H01 head carries canonical, ko + x-default hreflang and the theme pre-render snippet', async () => {
  const html = read('index.html')
  assert.ok(html.includes('<link rel="canonical" href="https://olmoa.com/ko/krw" />'), 'canonical present')
  assert.ok(html.includes('<link rel="alternate" hreflang="ko" href="https://olmoa.com/ko/krw" />'), 'ko hreflang present')
  assert.ok(!/hreflang="(en|ja|zh-TW)/.test(html), 'untranslated locales are not advertised in static shell')
  assert.ok(html.includes('<link rel="alternate" hreflang="x-default" href="https://olmoa.com/ko/krw" />'), 'x-default points at ko')
  assert.ok(html.includes('<meta property="og:locale" content="ko_KR" />'), 'og:locale present')
  // P1: the pre-render snippet lives in /theme-init.js (external) so the CSP
  // script-src 'self' stays strict; an inline copy would be blocked.
  assert.ok(html.includes('<script src="/theme-init.js"></script>'), 'theme pre-render loads before paint')
  const themeInit = read('public/theme-init.js')
  assert.ok(themeInit.includes("localStorage.getItem('olmoa_theme')"), 'theme pre-render reads the saved mode')
  assert.ok(themeInit.includes("setAttribute('data-theme'"), 'theme pre-render sets data-theme')
  assert.ok(html.includes('<link rel="manifest" href="/manifest.webmanifest" />'), 'PWA manifest linked')
})

await t.test('H02 the service worker is registered for production only', async () => {
  const main = read('src/main.ts')
  assert.ok(main.includes("navigator.serviceWorker.register('/sw.js')"), 'sw registered')
  assert.ok(main.includes('import.meta.env.PROD'), 'registration is production-gated')
  assert.ok(existsSync(join(SF, 'public/sw.js')), 'public/sw.js ships to dist root')
})

await t.test('H03 the worker never caches API or auth traffic', async () => {
  const sw = read('public/sw.js')
  assert.ok(/const VERSION = '[\w-]+'/.test(sw), 'versioned cache namespace')
  assert.ok(sw.includes("url.pathname.startsWith('/api/')"), 'API bypass present')
  assert.ok(sw.includes("req.method !== 'GET'"), 'non-GET pass-through present')
  assert.ok(sw.includes('url.origin !== self.location.origin'), 'cross-origin pass-through present')
  assert.ok(sw.includes("url.pathname.startsWith('/assets/')"), 'asset cache scope is /assets/* only')
  assert.ok(sw.includes('OFFLINE_HTML') && sw.includes("req.mode === 'navigate'"), 'offline navigation fallback present')
})

// Work order 1-8: storefront shell behaviors.
await t.test('SH01 mega menu hover delays and keyboard support', async () => {
  const m = read('src/components/MegaMenu.vue')
  assert.ok(m.includes('150'), 'hover opens after 0.15s')
  assert.ok(m.includes('120'), 'diagonal grace is 0.12s')
  assert.ok(m.includes('Escape'), 'ESC closes')
  assert.ok(m.includes('ArrowDown') && m.includes('ArrowRight'), 'arrow-key traversal')
})

await t.test('SH02 search idle panel shows recents, trending and deltas', async () => {
  const app = read('src/App.vue')
  assert.ok(app.includes("locale.t('trendingSearches')") || app.includes('급상승 검색어'), 'trending column headed')
  assert.ok(app.includes("'NEW'") || app.includes('"NEW"'), 'NEW movers labelled')
  assert.ok(app.includes('recommended'), 'recommended categories surfaced while typing')
})

await t.test('SH03 bottom nav drops wishlist/cart for search', async () => {
  const app = read('src/App.vue')
  const nav = app.slice(app.indexOf('const bottomNav'), app.indexOf('const footerColumns'))
  assert.ok(nav.includes("label: '검색'"), 'search tab present')
  assert.ok(!nav.includes('/cart'), 'cart moved to the header icon')
  assert.ok(!nav.includes('/wishlist'), 'wishlist leaves the tab bar')
  assert.ok(app.includes(":label=\"locale.t('cart')\"") || app.includes('label="장바구니"'), 'header keeps the cart icon')
})

await t.test('SH04 recent-products rail on wide screens', async () => {
  const app = read('src/App.vue')
  assert.ok(app.includes('olmoa_recent_products'), 'guest store keyed')
  // 1600px: the 1360px container + a 72px rail on each side only fits from ~1552px (at 1440 it covered the hero)
  assert.ok(app.includes('min-[1600px]'), 'rail shows at 1600px+ where it cannot cover content')
  assert.ok(app.includes("locale.t('scrollTop')") || app.includes('맨 위로'), 'back-to-top present')
  const detail = read('src/views/ProductDetailView.vue')
  assert.ok(detail.includes('olmoa_recent_products'), 'detail view records visits')
})

await t.test('SH05 category bar hides on scroll down', async () => {
  const app = read('src/App.vue')
  assert.ok(app.includes('scrollY'), 'scroll position tracked')
  assert.ok(app.includes('categoryBarHidden'), 'bar visibility state exists')
  // Anti-flutter: direction lock + rAF throttle (behavior in tests/browser/category_tremble.mjs).
  assert.ok(app.includes('requestAnimationFrame(onScrollFrame)'), 'scroll handling is rAF-throttled')
  assert.ok(app.includes('SCROLL_DELTA_PX'), 'flips need sustained movement')
  assert.ok(app.includes('SETTLE_MS'), 'post-flip feedback is absorbed, not re-flipped')
  assert.ok(!app.includes('y > lastScrollY'), 'no per-event direction flip')
  assert.ok(app.includes('resetCategoryBar()'), 'stale state resets on navigation')
})

await t.test('H04 /{lang}/{currency} routes wrap appRoutes and localize plain paths', async () => {
  const r = read('src/router/index.ts')
  assert.ok(r.includes('/:lang(${LANG_RE})/:currency(${CUR_RE})'), 'prefixed locale+currency parent route')
  assert.ok(r.includes('appRoutes'), 'same components, catalog and prices')
  assert.ok(r.includes('localizePath') && r.includes('switchLocalePath'), 'localized path helpers wired')
})

await t.test('H05 head delegates canonical/robots/hreflang to localeUrlPolicy and applies URL locale+currency', async () => {
  const h = readFileSync(join(SF, '..', '..', 'packages/ui/src/composables/useSeoHead.ts'), 'utf8')
  assert.ok(h.includes('localeUrlPolicy') && h.includes('hreflangOf'), 'shared localeUrlPolicy drives head tags')
  assert.ok(h.includes('barePathOf(path)'), 'noindex evaluated on the bare path')
  assert.ok(h.includes('link[rel="alternate"][hreflang]'), 'stale hreflang tags replaced on navigation')
  const m = read('src/main.ts')
  assert.ok(m.includes('applyUrlLocale') && m.includes('applyUrlCurrency'), 'URL locale and currency applied on navigation')
  assert.ok(m.includes('document.documentElement.lang'), 'html lang follows the URL')
})

await t.test('H06 6-2 locale mismatch asks once per session, choices persist', async () => {
  const n = read('src/components/LocaleNudge.vue')
  assert.ok(n.includes('nudgeDismissed') && n.includes('dismissNudge'), 'once-per-session dismissal')
  assert.ok(n.includes('ensureProfile'), 'saved locale read from the server')
  assert.ok(n.includes('로 계속 볼까요?'), 'asks in the saved language')
  const a = read('src/App.vue')
  assert.ok(a.includes('<LocaleNudge />'), 'nudge mounted in the shell')
  assert.ok(a.includes('switchLocale') && a.includes('saveLocale'), 'explicit choice persists + saves')
  assert.ok(!a.includes('locale.setLocale(('), 'switcher routes through the explicit path')
})

await t.test('H07 6-5 head advertises markdown alternates, shell uses the entity', async () => {
  const h = readFileSync(join(SF, '..', '..', 'packages/ui/src/composables/useSeoHead.ts'), 'utf8')
  assert.ok(h.includes('mdAlternateOf'), 'alternate builder present')
  assert.ok(h.includes('/llms/product/') && h.includes('/llms/category/'), 'product and category .md mapped')
  assert.ok(h.includes('text/markdown'), 'markdown MIME advertised')
  const a = read('src/App.vue')
  assert.ok(a.includes('SITE_NAME') && a.includes('SITE_TAGLINE'), 'shell renders the single entity')
  const home = read('src/views/HomeView.vue')
  assert.ok(home.includes('olmoa-jsonld-org') && home.includes('organizationGraph'), 'home injects Organization')
})

await t.test('SH13 edge-rendered crawler text never flashes for JS visitors', async () => {
  // 2026-11-27: the edge HTML inside #app painted as a bare category list for ~1 s before Vue mounted.
  const html = read('index.html')
  assert.ok(html.includes('html.js #app > [data-olmoa-edge] { display: none; }'), 'JS visitors hide the edge text')
  assert.ok(html.indexOf('/theme-init.js') < html.indexOf('html.js #app'), 'class is set before the rule can apply')
  const init = read('public/theme-init.js')
  assert.ok(init.includes("classList.add('js')"), 'theme-init marks JS')
  assert.ok(init.includes("classList.remove('js')") && init.includes('8000'), 'unmounted app shows the edge text again')
})

t.finish()
