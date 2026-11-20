// apps/cloudflare-gateway/src/lib/seo-head.js
// Edge head policy for storefront routes: canonical, robots, hreflang, OG and
// Twitter tags. Single-URL app (locale switches in-app), so hreflang carries
// x-default only. Private/transactional paths are noindex,nofollow.

const NOINDEX_PREFIXES = ['/cart', '/checkout', '/my', '/orders', '/login', '/register',
  '/forgot-password', '/verify-email', '/addresses', '/wishlist', '/coupons', '/payments', '/support'];

/** True when the path must never be indexed (private or transactional). */
export function isNoindex(path) {
  const p = String(path || '/');
  return NOINDEX_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`));
}

/** Strip tracking params; keep facet params out of the canonical. */
export function canonicalOf(base, path) {
  const cleanBase = String(base || 'https://olmoa.com').replace(/\/$/, '');
  const p = String(path || '/').split('?')[0] || '/';
  return `${cleanBase}${p.startsWith('/') ? p : `/${p}`}`;
}

/**
 * Full head for a route. Pure — used by edge injection and mirrored by the
 * SPA hook (useSeoHead.ts) for client-side navigation.
 */
export function routeHead({ route = '', path = '/', base, title, description = '', image = '' }) {
  const canonical = canonicalOf(base, path);
  const noindex = isNoindex(path);
  const desc = String(description || '').slice(0, 160);
  return {
    title: String(title || 'OLMOA'),
    robots: noindex ? 'noindex,nofollow' : 'index,follow',
    canonical,
    hreflangs: [{ hreflang: 'x-default', href: canonical }],
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
  const tags = [`<title>${esc(head.title)}</title>`, `<meta name="robots" content="${head.robots}">`,
    `<link rel="canonical" href="${esc(head.canonical)}">`];
  for (const h of head.hreflangs) tags.push(`<link rel="alternate" hreflang="${h.hreflang}" href="${esc(h.href)}">`);
  for (const [k, v] of Object.entries(head.og)) tags.push(`<meta property="${k}" content="${esc(v)}">`);
  for (const [k, v] of Object.entries(head.twitter)) tags.push(`<meta name="${k}" content="${esc(v)}">`);
  return tags.join('\n');
}
