// apps/cloudflare-gateway/src/lib/seo-head.js
// Edge head policy for storefront routes: canonical, robots, hreflang, OG and
// Twitter tags. The /en and /ja mirrors are untranslated copies that canonicalize
// to the ko URL, so hreflang carries ko-KR + x-default only. Private/transactional
// paths are noindex,nofollow.

const NOINDEX_PREFIXES = ['/cart', '/checkout', '/my', '/orders', '/login', '/register',
  '/forgot-password', '/verify-email', '/addresses', '/wishlist', '/coupons', '/payments'];

/** True when the path must never be indexed (private or transactional). */
export function isNoindex(path) {
  const p = String(path || '/');
  return NOINDEX_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`));
}

/** 6-8: search result pages are never indexed, but their links are followed. */
export function isSearch(path) {
  const p = String(path || '/');
  return p === '/search' || p.startsWith('/search/');
}

/** 6-8: pagination keeps its page (?page=N, N>=2); page=1 is the bare URL. */
export function pageOfQuery(query) {
  const q = query || {};
  const raw = Array.isArray(q.page) ? q.page[0] : q.page;
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 2 ? n : 1;
}

/** Strip tracking/sort/filter params; keep ?page=N (N>=2, self-canonical per page). */
export function canonicalOf(base, path, query) {
  const cleanBase = String(base || 'https://olmoa.com').replace(/\/$/, '');
  const p = String(path || '/').split('?')[0] || '/';
  const page = pageOfQuery(query);
  return `${cleanBase}${p.startsWith('/') ? p : `/${p}`}${page > 1 ? `?page=${page}` : ''}`;
}

/**
 * Full head for a route. Pure — used by edge injection and mirrored by the
 * SPA hook (useSeoHead.ts) for client-side navigation.
 */
export function routeHead({ route = '', path = '/', base, title, description = '', image = '', query }) {
  const canonical = canonicalOf(base, path, query);
  const desc = String(description || '').slice(0, 160);
  const robots = isSearch(path) ? 'noindex,follow' : (isNoindex(path) ? 'noindex,nofollow' : 'index,follow');
  return {
    title: String(title || 'OLMOA'),
    description: desc,
    robots,
    canonical,
    hreflangs: [{ hreflang: 'ko-KR', href: canonical }, { hreflang: 'x-default', href: canonical }],
    og: {
      'og:type': route === 'product' ? 'product' : 'website',
      'og:url': canonical, 'og:title': String(title || 'OLMOA'),
      ...(desc ? { 'og:description': desc } : {}),
      ...(image ? { 'og:image': image } : {}), 'og:site_name': 'OLMOA'
    },
    twitter: {
      'twitter:card': 'summary_large_image', 'twitter:title': String(title || 'OLMOA'),
      ...(desc ? { 'twitter:description': desc } : {}), ...(image ? { 'twitter:image': image } : {})
    }
  };
}

/** Render a routeHead() result as <head> HTML (edge injection). */
export function renderHeadHtml(head) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const tags = [`<title>${esc(head.title)}</title>`, `<meta name="robots" content="${head.robots}">`];
  if (head.description) tags.push(`<meta name="description" content="${esc(head.description)}">`);
  tags.push(`<link rel="canonical" href="${esc(head.canonical)}">`);
  for (const h of head.hreflangs) tags.push(`<link rel="alternate" hreflang="${h.hreflang}" href="${esc(h.href)}">`);
  for (const [k, v] of Object.entries(head.og)) tags.push(`<meta property="${k}" content="${esc(v)}">`);
  for (const [k, v] of Object.entries(head.twitter)) tags.push(`<meta name="${k}" content="${esc(v)}">`);
  return tags.join('\n');
}
