// Client head manager for the SPA storefront (no SSR runtime in this repo; the
// apex edge worker injects the first response's head). Since 2026-11-27 every
// page lives under /{lang}/{currency}; canonical/robots/hreflang come from the
// same localeUrlPolicy() the edge uses (packages/ui/src/locale.config.ts), so
// client navigation and the edge-rendered first response always agree.
// Pure policy + thin DOM writers (guarded for SSR/test runtimes).

import {
  parseLocalePath, legacyToBare, localeUrlPolicy, isPrivateBare, isSearchBare, pageNumberOf,
  OG_LOCALE_OF, HREFLANG, SOURCE_LANG, DEFAULT_CURRENCY, LANGS, type Lang, type Currency
} from '../locale.config.ts'

export const NOINDEX_PREFIXES = ['/cart', '/checkout', '/my', '/orders', '/login',
  '/register', '/forgot-password', '/verify-email', '/addresses', '/wishlist',
  '/coupons', '/payments']

/** og:locale per language (key = URL lang). */
export const OG_LOCALE: Record<string, string> = { ...OG_LOCALE_OF }

/** Every language the URL scheme serves; which of them a page advertises depends on its content. */
export const HREFLANG_LOCALES = LANGS.map((key) => ({ key, og: OG_LOCALE_OF[key] }))

/** Page path after the /{lang}/{currency} prefix (legacy /en, /ja mirrors and old shapes mapped too). */
export function barePathOf(path: string): string {
  const p = String(path || '/').split('?')[0] || '/'
  const loc = parseLocalePath(p)
  if (loc) return loc.bare
  return legacyToBare(p)
}

export function localeOfPath(path: string): Lang {
  const loc = parseLocalePath(String(path || '/').split('?')[0] || '/')
  if (loc) return loc.lang
  const m = String(path || '').match(/^\/(en|ja)(\/|$)/)
  return m ? (m[1] as Lang) : SOURCE_LANG
}

export function currencyOfPath(path: string): Currency {
  const loc = parseLocalePath(String(path || '/').split('?')[0] || '/')
  return loc ? loc.currency : DEFAULT_CURRENCY[localeOfPath(path)]
}

export function isNoindexPath(path: string): boolean {
  return isPrivateBare(barePathOf(path))
}

/** 6-8: search result pages are never indexed, but their links are followed. */
export const SEARCH_PATH = '/search'

export function isSearchPath(path: string): boolean {
  return isSearchBare(barePathOf(path))
}

/** Per-page head inputs beyond the path: which languages have content and their per-language bare path. */
export interface LocaleContent { contentLangs?: Lang[]; bareFor?: ((lang: Lang) => string) | null }

function policyOf(base: string, path: string, query?: unknown, content: LocaleContent = {}) {
  return localeUrlPolicy({
    lang: localeOfPath(path), currency: currencyOfPath(path), bare: barePathOf(path),
    bareFor: content.bareFor || null, base, query, contentLangs: content.contentLangs
  })
}

/** robots per path: representative URL index,follow; other currency/untranslated noindex,follow; private noindex,nofollow. */
export function robotsOf(path: string, content: LocaleContent = {}): string {
  return policyOf('https://olmoa.com', path, undefined, content).robots
}

/** 6-8: pagination keeps its page (?page=N, N>=2); page=1 is the bare URL. */
export function pageOfQuery(query: unknown): number {
  return pageNumberOf(query)
}

export function pageSuffixOf(query: unknown): string {
  const n = pageOfQuery(query)
  return n > 1 ? `?page=${n}` : ''
}

/** Canonical URL: the representative-currency URL of the page's content language (ko when untranslated). */
export function canonicalOf(base: string, path: string, query?: unknown, content: LocaleContent = {}): string {
  return policyOf(base, path, query, content).canonical
}

/** hreflang alternates: content languages' representative URLs + x-default. */
export function hreflangOf(base: string, path: string, query?: unknown, content: LocaleContent = {}): Array<{ lang: string; href: string }> {
  return policyOf(base, path, query, content).hreflangs.map((h) => ({ lang: h.hreflang, href: h.href }))
}

export interface RouteHeadInput extends LocaleContent { path: string; base: string; title: string; description?: string; image?: string; query?: unknown }

export function routeHeadOf(input: RouteHeadInput) {
  const pol = policyOf(input.base, input.path, input.query, input)
  return {
    title: input.title,
    robots: pol.robots,
    canonical: pol.canonical,
    hreflangs: pol.hreflangs,
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
  const prod = bare.match(/^\/p\/([^/]+)(?:\/[^/]+)?$/)
  if (prod) return `${b}/llms/product/${prod[1]}.md`
  const cat = bare.match(/^\/c\/([^/]+)$/)
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
  // Replace the whole hreflang set: a page advertises only its content languages.
  doc.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el: any) => el.remove())
  for (const alt of head.hreflangs) upsertLink('alternate', alt.href, alt.hreflang)
  upsertMeta('property', 'og:url', head.canonical)
  upsertMeta('property', 'og:title', head.title)
  upsertMeta('property', 'og:locale', OG_LOCALE_OF[localeOfPath(input.path)])
  doc.head.querySelectorAll('meta[property="og:locale:alternate"]').forEach((el: any) => el.remove())
  const advertised = new Set(head.hreflangs.map((h) => h.hreflang))
  for (const loc of HREFLANG_LOCALES) {
    if (loc.key === localeOfPath(input.path)) continue
    if (!advertised.has(HREFLANG[loc.key])) continue
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
