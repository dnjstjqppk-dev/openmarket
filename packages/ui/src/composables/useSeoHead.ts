// Client head manager for the SPA storefront (no Nuxt SSR in this repo).
// Mirrors the gateway seo-head policy: canonical per path, noindex on
// private routes, x-default hreflang, OG/Twitter, JSON-LD injection.
// Pure policy + thin DOM writers (guarded for SSR/test runtimes).

export const NOINDEX_PREFIXES = ['/cart', '/checkout', '/my', '/orders', '/login',
  '/register', '/forgot-password', '/verify-email', '/addresses', '/wishlist',
  '/coupons', '/payments', '/support']

export function isNoindexPath(path: string): boolean {
  const p = String(path || '/')
  return NOINDEX_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))
}

export function canonicalOf(base: string, path: string): string {
  const b = String(base || '').replace(/\/$/, '')
  const p = String(path || '/').split('?')[0] || '/'
  return `${b}${p.startsWith('/') ? p : `/${p}`}`
}

export interface RouteHeadInput { path: string; base: string; title: string; description?: string; image?: string }

export function routeHeadOf(input: RouteHeadInput) {
  const canonical = canonicalOf(input.base, input.path)
  return {
    title: input.title,
    robots: isNoindexPath(input.path) ? 'noindex,nofollow' : 'index,follow',
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

/** Apply title/robots/canonical/hreflang/OG/Twitter for a route. */
export function applyRouteHead(input: RouteHeadInput): void {
  const doc = (globalThis as any).document
  const head = routeHeadOf(input)
  if (!doc) return
  doc.title = head.title
  upsertMeta('name', 'robots', head.robots)
  upsertMeta('name', 'description', head.description)
  upsertLink('canonical', head.canonical)
  upsertLink('alternate', head.canonical, 'x-default')
  upsertMeta('property', 'og:url', head.canonical)
  upsertMeta('property', 'og:title', head.title)
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
