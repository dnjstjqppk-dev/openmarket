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
//
// 6-2 edge rendering: public page paths (PAGE_PATHS) get their head, JSON-LD and
// a plain summary from the API (`/api/v1/seo/page`) injected into index.html, so
// crawlers and AI agents read the page without running JavaScript. The injected
// HTML is the same for every visitor (no user-agent branching). Any API failure
// or timeout serves index.html untouched — the site always loads.

import { renderHeadHtml } from '../../cloudflare-gateway/src/lib/seo-head.js';

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

// 6-2: public storefront pages rendered at the edge (plus their /en, /ja mirrors,
// which canonicalize to the ko URL).
export const PAGE_PATHS = [
  '/product/*',
  '/category/*',
  '/store/*',
  '/categories',
  '/channel/*',
  '/legal/*',
  '/policy/*',
  '/support',
  '/en',
  '/en/*',
  '/ja',
  '/ja/*'
];

// Mirror of [assets] run_worker_first in root wrangler.toml (order kept).
export const RUN_WORKER_FIRST = [...CRAWL_PATHS, HOME_PATH, ...PAGE_PATHS];

export function isPagePath(pathname) {
  return pathname === HOME_PATH || PAGE_PATHS.some((p) => (p.endsWith('/*') ? pathname.startsWith(p.slice(0, -1)) : pathname === p));
}

/** API budget for edge data; past it the untouched shell is served. */
export const SEO_TIMEOUT_MS = 800;

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

// Static-shell tags the edge head replaces (title, description, robots, canonical,
// hreflang, OG page fields, Twitter). og:locale, keywords, icons stay.
const REPLACED_HEAD = [
  /<title>[\s\S]*?<\/title>\s*/gi,
  /<meta\s+name="(?:title|description|robots)"[^>]*>\s*/gi,
  /<link\s+rel="canonical"[^>]*>\s*/gi,
  /<link\s+rel="alternate"\s+hreflang="[^"]*"[^>]*>\s*/gi,
  /<meta\s+property="og:(?:type|url|title|description|image|site_name)"[^>]*>\s*/gi,
  /<meta\s+(?:name|property)="twitter:[^"]*"[^>]*>\s*/gi
];

const ldTag = (obj) => `<script type="application/ld+json" data-olmoa-edge>${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

/**
 * Inject one /api/v1/seo/page result into the shell. Pure: the same input
 * always yields the same HTML. Without </head> the shell passes through as-is.
 */
export function injectPage(html, data) {
  if (!data || !data.head || !html.includes('</head>')) return html;
  let out = html;
  for (const re of REPLACED_HEAD) out = out.replace(re, '');
  const head = [renderHeadHtml(data.head), ...(data.jsonld || []).map(ldTag)].join('\n');
  out = out.replace('</head>', `${head}\n</head>`);
  // Inside #app: Vue's mount replaces it, so people see the app and crawlers the facts.
  if (data.summary_html) {
    out = out.replace('<div id="app"></div>', `<div id="app"><main data-olmoa-edge>${data.summary_html}</main></div>`);
  }
  return out;
}

async function pageData(request, env, pathname) {
  if (!env.API || typeof env.API.fetch !== 'function') return null;
  const origin = new URL(request.url).origin;
  const apiReq = new Request(`${origin}/api/v1/seo/page?path=${encodeURIComponent(pathname)}`, { method: 'GET' });
  const cache = globalThis.caches && globalThis.caches.default;
  try {
    let res = cache ? await cache.match(apiReq) : null;
    if (!res) {
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SEO_TIMEOUT_MS); });
      res = await Promise.race([env.API.fetch(apiReq), timeout]);
      clearTimeout(timer);
      if (!res || !res.ok) return null;
      if (cache) {
        const copy = new Response(res.clone().body, res);
        copy.headers.set('Cache-Control', 'public, s-maxage=300');
        await cache.put(apiReq, copy).catch(() => {});
      }
    }
    const data = await res.json();
    return data && (data.status === 200 || data.status === 404) ? data : null;
  } catch {
    return null;
  }
}

function htmlResponse(res, html, status = res.status) {
  const headers = new Headers(res.headers);
  headers.delete('Content-Length');
  headers.delete('ETag');
  return new Response(html, { status, statusText: status === res.status ? res.statusText : '', headers });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (isPagePath(pathname)) {
      const res = await env.ASSETS.fetch(request);
      if (!String(res.headers.get('Content-Type') || '').includes('text/html')) return res;
      let out = await res.text();
      if (pathname === HOME_PATH) out = injectVerifyMeta(out, env);
      if (request.method !== 'GET') return htmlResponse(res, out);
      const data = await pageData(request, env, pathname);
      if (!data) return htmlResponse(res, out);
      return htmlResponse(res, injectPage(out, data), data.status === 404 ? 404 : res.status);
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
