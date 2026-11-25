// apps/storefront/edge/apex-worker.js
// Root storefront worker (`openmarket`, root wrangler.toml) — the worker the apex
// domain is attached to at cutover. Everything is the static SPA from ASSETS except
// the crawl surface, which the API worker generates from D1 (routes/seo.js) and which
// is forwarded here over the `API` service binding. Without this, the SPA fallback
// answers /sitemaps/*.xml and /llms.txt with `200 text/html` (the app shell), so the
// sitemap index the API publishes (`<apex>/sitemaps/...`) would point at HTML.
//
// Only the paths in RUN_WORKER_FIRST reach this script (wrangler `run_worker_first`);
// keep the two lists identical — tests/apex_worker_test.mjs checks they match.

export const CRAWL_PATHS = [
  '/robots.txt',
  '/sitemap.xml',
  '/sitemap-index.xml',
  '/sitemaps/*',
  '/llms.txt',
  '/llms-full.txt',
  '/llms/*',
  '/*.txt' // 6-7: the IndexNow key file (the API serves it from INDEXNOW_KEY)
];

// 6-7: the homepage goes through the worker so search-engine ownership codes
// can be injected at the edge when they exist. Not a crawl path: it is served
// from ASSETS, never forwarded to the API.
export const HOME_PATH = '/';

// Mirror of [assets] run_worker_first in root wrangler.toml (order kept).
export const RUN_WORKER_FIRST = [...CRAWL_PATHS, HOME_PATH];

export function isCrawlPath(pathname) {
  return CRAWL_PATHS.some((p) => {
    if (p.endsWith('/*')) return pathname.startsWith(p.slice(0, -1));
    // Single-`*` glob, `*` matching across segments like the platform (e.g. /*.txt).
    if (p.includes('*')) {
      const star = p.indexOf('*');
      return pathname.startsWith(p.slice(0, star)) && pathname.endsWith(p.slice(star + 1));
    }
    return pathname === p;
  });
}

const VERIFY_META = [
  ['NAVER_SITE_VERIFICATION', 'naver-site-verification'],
  ['GOOGLE_SITE_VERIFICATION', 'google-site-verification']
];

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 6-7: inject engine-verification meta tags into <head> when codes exist.
 *  Without codes (or without </head>) the HTML passes through byte-identical. */
export function injectVerifyMeta(html, env) {
  const tags = [];
  for (const [key, name] of VERIFY_META) {
    const v = String(env[key] || '').trim();
    if (v) tags.push(`<meta name="${name}" content="${escAttr(v)}" />`);
  }
  if (!tags.length || !html.includes('</head>')) return html;
  return html.replace('</head>', `${tags.join('')}\n</head>`);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === HOME_PATH) {
      const res = await env.ASSETS.fetch(request);
      if (!String(res.headers.get('Content-Type') || '').includes('text/html')) return res;
      const headers = new Headers(res.headers);
      headers.delete('Content-Length');
      return new Response(injectVerifyMeta(await res.text(), env),
        { status: res.status, statusText: res.statusText, headers });
    }
    if (!isCrawlPath(pathname)) return env.ASSETS.fetch(request);
    // Fail visibly rather than fall back to the SPA shell (a 200 HTML robots/sitemap
    // is exactly the defect this worker exists to prevent).
    if (!env.API || typeof env.API.fetch !== 'function') {
      return new Response('crawl surface unavailable', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '300', 'Cache-Control': 'no-store' }
      });
    }
    return env.API.fetch(request);
  }
};
