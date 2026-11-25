// apps/storefront/edge/apex-worker.js
// Root storefront worker (`openmarket`, root wrangler.toml) — the worker the apex
// domain is attached to at cutover. Everything is the static SPA from ASSETS except
// the crawl surface, which the API worker generates from D1 (routes/seo.js) and which
// is forwarded here over the `API` service binding. Without this, the SPA fallback
// answers /sitemaps/*.xml and /llms.txt with `200 text/html` (the app shell), so the
// sitemap index the API publishes (`<apex>/sitemaps/...`) would point at HTML.
//
// Only the paths in CRAWL_PATHS reach this script (wrangler `run_worker_first`);
// keep the two lists identical — tests/apex_worker_test.mjs checks they match.

export const CRAWL_PATHS = [
  '/robots.txt',
  '/sitemap.xml',
  '/sitemap-index.xml',
  '/sitemaps/*',
  '/llms.txt',
  '/llms-full.txt'
];

export function isCrawlPath(pathname) {
  return CRAWL_PATHS.some((p) => (p.endsWith('/*') ? pathname.startsWith(p.slice(0, -1)) : pathname === p));
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
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
