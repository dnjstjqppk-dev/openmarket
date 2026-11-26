// apps/storefront/edge/apex-worker.js
// Root storefront worker (`openmarket`, root wrangler.toml) on the apex domain.
//
// 1. Crawl surface (robots, sitemaps, llms, IndexNow key) -> the API worker over
//    the `API` service binding (never the SPA's 200 text/html fallback).
// 2. /{lang}/{currency} URL scheme (owner work order 2026-11-27, decisions 22-25;
//    rules and tables in packages/ui/src/locale.config.ts):
//    - valid lower-case prefix: served as is, never Geo-redirected (a Googlebot
//      on a US IP or a Korean visitor on an /en/usd link gets that exact page);
//    - valid prefix with upper case: 301 to the lower-case path;
//    - pre-move indexed URLs (/product/:id, /category/:slug, /store/*, /en/*, ...):
//      301 to their fixed new address (ko/krw, or en/usd and ja/jpy for the old
//      mirrors) — link equity moves, and a 301 never depends on the visitor;
//    - any other path without a prefix (incl. /): 302 by preference cookie,
//      then CF-IPCountry, then en/usd. Path and query are preserved.
//    The same rules apply to every client — there is no user-agent branching.
// 3. Edge rendering (6-2): page head, JSON-LD and a plain summary from the API
//    (`/api/v1/seo/page`) injected into index.html, plus the API's PDP slug
//    repair (301) and 404/410 statuses. Any API failure or timeout serves
//    index.html untouched — the site always loads.

import { renderHeadHtml } from '../../cloudflare-gateway/src/lib/seo-head.js';
import {
  parseLocalePath, localizedPath, legacyToBare, legacyMirrorLang, isLegacyIndexedPath, isUnprefixedPath,
  resolveEntryLocale, DEFAULT_CURRENCY, PREF_LANG_COOKIE, PREF_CURRENCY_COOKIE, PREF_CURRENCY_COOKIE_ALT
} from '../../../packages/ui/src/locale.config.ts';

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

// Mirror of [assets] run_worker_first in root wrangler.toml (order kept).
// Every path reaches this script except the hashed bundle and the static
// files the shell loads directly (they never need a prefix or a redirect).
export const RUN_WORKER_FIRST = ['/*', '!/assets/*', '!/sw.js', '!/theme-init.js', '!/favicon.ico', '!/manifest.webmanifest', '!/icons/*', '!/images/*'];

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

/** The html lang attribute follows the URL (the shell ships lang="ko"). */
export function setHtmlLang(html, lang) {
  const bcp = { ko: 'ko', en: 'en', ja: 'ja', 'zh-tw': 'zh-TW' }[lang] || 'ko';
  return html.replace(/<html\b([^>]*?)\slang="[^"]*"/i, `<html$1 lang="${bcp}"`);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

/** Visitor country: Cloudflare's own signal; MOCK_GEO_COUNTRY only on localhost (dev). */
export function countryOf(request, env) {
  const host = new URL(request.url).hostname;
  if ((host === 'localhost' || host === '127.0.0.1') && env && env.MOCK_GEO_COUNTRY) return String(env.MOCK_GEO_COUNTRY).toUpperCase();
  return String((request.cf && request.cf.country) || request.headers.get('CF-IPCountry') || '').toUpperCase();
}

/**
 * Redirect decision for a request, or null to serve it. Pure over (url, cookies, country).
 *   { status: 301|302, location }  location is path + query (same origin)
 */
export function redirectFor(url, { cookies = {}, country = '' } = {}) {
  const { pathname, search } = url;
  if (isCrawlPath(pathname) || isUnprefixedPath(pathname)) return null;
  const loc = parseLocalePath(pathname);
  if (loc) {
    if (!loc.needsLowercase) return null;
    return { status: 301, location: `${localizedPath(loc.lang, loc.currency, loc.bare)}${search}` };
  }
  const bare = legacyToBare(pathname);
  if (isLegacyIndexedPath(pathname)) {
    const lang = legacyMirrorLang(pathname) || 'ko';
    return { status: 301, location: `${localizedPath(lang, DEFAULT_CURRENCY[lang], bare)}${search}` };
  }
  const entry = resolveEntryLocale({
    cookieLang: cookies[PREF_LANG_COOKIE],
    cookieCurrency: cookies[PREF_CURRENCY_COOKIE] || cookies[PREF_CURRENCY_COOKIE_ALT],
    country
  });
  return { status: 302, location: `${localizedPath(entry.lang, entry.currency, bare)}${search}` };
}

function redirect(origin, r) {
  return new Response(null, {
    status: r.status,
    headers: {
      Location: `${origin}${r.location}`,
      // 302s depend on cookie and country: never cache them anywhere.
      'Cache-Control': r.status === 302 ? 'private, no-store' : 'public, max-age=3600',
      ...(r.status === 302 ? { Vary: 'Cookie' } : {})
    }
  });
}

async function pageData(request, env, pathname, search) {
  if (!env.API || typeof env.API.fetch !== 'function') return null;
  const origin = new URL(request.url).origin;
  const q = search ? `&query=${encodeURIComponent(search.replace(/^\?/, ''))}` : '';
  const apiReq = new Request(`${origin}/api/v1/seo/page?path=${encodeURIComponent(pathname)}${q}`, { method: 'GET' });
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
    if (data && data.status === 301 && typeof data.location === 'string' && data.location.startsWith('/') && !data.location.startsWith('//')) return data;
    return data && [200, 404, 410].includes(data.status) ? data : null;
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
    const url = new URL(request.url);
    const { pathname } = url;
    if (isCrawlPath(pathname)) {
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
    if (isUnprefixedPath(pathname)) return env.ASSETS.fetch(request);

    const r = redirectFor(url, { cookies: parseCookies(request.headers.get('Cookie')), country: countryOf(request, env) });
    if (r) return redirect(url.origin, r);

    const loc = parseLocalePath(pathname);
    const res = await env.ASSETS.fetch(request);
    if (!String(res.headers.get('Content-Type') || '').includes('text/html')) return res;
    let out = setHtmlLang(await res.text(), loc.lang);
    if (loc.bare === '/') out = injectVerifyMeta(out, env);
    if (request.method !== 'GET') return htmlResponse(res, out);
    const data = await pageData(request, env, pathname, url.search);
    if (!data) return htmlResponse(res, out);
    if (data.status === 301) return redirect(url.origin, { status: 301, location: `${data.location}${url.search}` });
    return htmlResponse(res, injectPage(out, data), data.status === 200 ? res.status : data.status);
  }
};
