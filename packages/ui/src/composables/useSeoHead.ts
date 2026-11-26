// Client head manager for the SPA storefront (no Nuxt SSR in this repo).
// Mirrors the gateway seo-head policy: canonical per path, noindex on
// private routes, ko-KR + x-default hreflang, OG/Twitter, JSON-LD injection.
// Pure policy + thin DOM writers (guarded for SSR/test runtimes).

export const NOINDEX_PREFIXES = ['/cart', '/checkout', '/my', '/orders', '/login',
  '/register', '/forgot-password', '/verify-email', '/addresses', '/wishlist',
  '/coupons', '/payments']

/** 6-2: locale sub-paths of the storefront mirrors (ko has no prefix). */
export const LOCALE_PREFIXES: Record<string, string> = { ko: '', en: '/en', ja: '/ja' }
export const LOCALE_OF_PREFIX: Record<string, string> = { '': 'ko', '/en': 'en', '/ja': 'ja' }
export const OG_LOCALE: Record<string, string> = { ko: 'ko_KR', en: 'en_US', ja: 'ja_JP' }

/** Locales advertised to search engines. The /en and /ja mirrors render the same
 *  Korean catalog and UI (no translations exist), so advertising them as en-US/ja-JP
 *  alternates would publish three copies of one page. Only ko-KR is advertised and
 *  every mirror canonicalizes to its bare ko URL; add a locale here only together
 *  with real translated content. */
export const HREFLANG_LOCALES = [
  { key: 'ko', lang: 'ko-KR', prefix: '', og: 'ko_KR' }
]

/** Strip a leading /en or /ja mirror prefix (bare path, always with leading slash). */
export function barePathOf(path: string): string {
  const p = String(path || '/').split('?')[0] || '/'
  const m = p.match(/^\/(en|ja)(\/|$)/)
  if (!m) return p.startsWith('/') ? p : `/${p}`
  const rest = p.slice(m[0].length) || '/'
  return rest.startsWith('/') ? rest : `/${rest}`
}

export function localeOfPath(path: string): string {
  const p = String(path || '/').split('?')[0] || '/'
  const m = p.match(/^\/(en|ja)(\/|$)/)
  return m ? m[1] : 'ko'
}

export function isNoindexPath(path: string): boolean {
  const p = barePathOf(path)
  return NOINDEX_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))
}

/** 6-8: search result pages are never indexed, but their links are followed. */
export const SEARCH_PATH = '/search'

export function isSearchPath(path: string): boolean {
  const p = barePathOf(path)
  return p === SEARCH_PATH || p.startsWith(`${SEARCH_PATH}/`)
}

/** 6-8: robots per path — search keeps link-following, private paths do not. */
export function robotsOf(path: string): string {
  if (isSearchPath(path)) return 'noindex,follow'
  return isNoindexPath(path) ? 'noindex,nofollow' : 'index,follow'
}

/** 6-8: pagination keeps its page (?page=N, N>=2); page=1 is the bare URL. */
export function pageOfQuery(query: unknown): number {
  const q = (query || {}) as Record<string, unknown>
  const raw = Array.isArray(q.page) ? q.page[0] : q.page
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return Number.isInteger(n) && n >= 2 ? (n as number) : 1
}

export function pageSuffixOf(query: unknown): string {
  const n = pageOfQuery(query)
  return n > 1 ? `?page=${n}` : ''
}

/** 6-8: every query is stripped except ?page=N (N>=2, self-canonical per page).
 *  /en and /ja mirrors canonicalize to the bare ko URL (same content). */
export function canonicalOf(base: string, path: string, query?: unknown): string {
  const b = String(base || '').replace(/\/$/, '')
  return `${b}${barePathOf(path)}${pageSuffixOf(query)}`
}

/** Advertised locale alternates (HREFLANG_LOCALES) plus x-default (always the ko URL — Korean market). */
export function hreflangOf(base: string, path: string, query?: unknown): Array<{ lang: string; href: string }> {
  const b = String(base || '').replace(/\/$/, '')
  const bare = barePathOf(path)
  const suf = pageSuffixOf(query)
  return [
    ...HREFLANG_LOCALES.map(({ lang, prefix }) => ({ lang, href: `${b}${prefix}${bare === '/' && prefix ? '' : bare}${suf}` })),
    { lang: 'x-default', href: `${b}${bare}${suf}` }
  ]
}

export interface RouteHeadInput { path: string; base: string; title: string; description?: string; image?: string; query?: unknown }

export function routeHeadOf(input: RouteHeadInput) {
  const canonical = canonicalOf(input.base, input.path, input.query)
  return {
    title: input.title,
    robots: robotsOf(input.path),
    canonical,
    description: String(input.description || '').slice(0, 160),
    image: input.image || ''
  }
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  const doc = (globalThis as any).document
  if (!doc) return
  let el = doc.head.querySelector(`meta[${attr}="${key}"]`) as any
  if (!el) { el = doc.createElement('meta'); el.setAttribute(attr, key); doc.head.appendChild(el) }
  el.setAttribute('content', content)
}

function upsertLink(rel: string, href: string, hreflang = '') {
  const doc = (globalThis as any).document
  if (!doc) return
  const sel = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]`
  let el = doc.head.querySelector(sel) as any
  if (!el) { el = doc.createElement('link'); el.setAttribute('rel', rel); if (hreflang) el.setAttribute('hreflang', hreflang); doc.head.appendChild(el) }
  el.setAttribute('href', href)
}

/** 6-5: markdown alternate per page (null where no .md counterpart exists). */
export function mdAlternateOf(base: string, path: string): string | null {
  const b = String(base || '').replace(/\/$/, '')
  const bare = barePathOf(path)
  const prod = bare.match(/^\/product\/([^/]+)$/)
  if (prod) return `${b}/llms/product/${prod[1]}.md`
  const cat = bare.match(/^\/category\/([^/]+)$/)
  if (cat) return `${b}/llms/category/${cat[1]}.md`
  return null
}

/** Apply title/robots/canonical/hreflang/OG/Twitter for a route. */
export function applyRouteHead(input: RouteHeadInput): void {
  const doc = (globalThis as any).document
  const head = routeHeadOf(input)
  if (!doc) return
  doc.title = head.title
  const md = mdAlternateOf(input.base, input.path)
  const stale = doc.head.querySelector('link[rel="alternate"][type="text/markdown"]')
  if (md) {
    let el = stale
    if (!el) {
      el = doc.createElement('link')
      el.setAttribute('rel', 'alternate')
      el.setAttribute('type', 'text/markdown')
      doc.head.appendChild(el)
    }
    el.setAttribute('href', md)
  } else if (stale) {
    stale.remove()
  }
  upsertMeta('name', 'robots', head.robots)
  upsertMeta('name', 'description', head.description)
  upsertLink('canonical', head.canonical)
  for (const alt of hreflangOf(input.base, input.path, input.query)) upsertLink('alternate', alt.href, alt.lang)
  upsertMeta('property', 'og:url', head.canonical)
  upsertMeta('property', 'og:title', head.title)
  upsertMeta('property', 'og:locale', 'ko_KR')
  // Drop hreflang links for locales no longer advertised (static shell or older navigation).
  const advertised = new Set([...HREFLANG_LOCALES.map((l) => l.lang), 'x-default'])
  doc.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el: any) => {
    if (!advertised.has(el.getAttribute('hreflang'))) el.remove()
  })
  // og:locale:alternate only for advertised locales other than ko (none today).
  doc.head.querySelectorAll('meta[property="og:locale:alternate"]').forEach((el: any) => el.remove())
  for (const loc of HREFLANG_LOCALES) {
    if (loc.key === 'ko') continue
    const el = doc.createElement('meta')
    el.setAttribute('property', 'og:locale:alternate')
    el.setAttribute('content', loc.og)
    doc.head.appendChild(el)
  }
  if (head.image) upsertMeta('property', 'og:image', head.image)
  upsertMeta('name', 'twitter:card', 'summary_large_image')
  upsertMeta('name', 'twitter:title', head.title)
}

/** Inject (or replace) one JSON-LD graph under a stable script id. */
export function injectJsonLd(id: string, obj: unknown): void {
  const doc = (globalThis as any).document
  if (!doc) return
  doc.getElementById(id)?.remove()
  const el = doc.createElement('script')
  el.id = id
  el.type = 'application/ld+json'
  el.textContent = JSON.stringify(obj).replace(/</g, '\\u003c')
  doc.head.appendChild(el)
}
