// apps/cloudflare-gateway/src/routes/seo.js
// Public crawl surface: /sitemap.xml index (+ /sitemap-index.xml alias) over
// /sitemaps/* (per-language product series), /robots.txt, /llms.txt and
// /llms-full.txt. All D1-driven; served pre-ratelimit like /health.

import { STATIC_URLS, PRODUCTS_PER_SITEMAP, categoryUrls, storeUrls, sitemapLangs,
  productUrls, approvedProductCount, productPageCount, renderUrlset, renderIndex } from '../services/seo/sitemap.js';
import { robotsTxt, llmsTxt, llmsFullTxt, couponFeed, returnPolicyFeed, productMarkdown, categoryMarkdown } from '../services/seo/crawl-text.js';
import { buildPdpBrief, renderPdpText } from '../services/seo/pdp-brief.js';
import { renderSeoPage } from '../services/seo/page-render.js';

const xml = (cors, body) => new Response(body, { headers: { ...cors, 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
const txt = (cors, body) => new Response(body, { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
const baseOf = (env) => String(env.PUBLIC_STOREFRONT_URL || 'https://olmoa.com').replace(/\/$/, '');

export async function handleSeoRoutes(request, url, env, corsHeaders) {
  if (request.method !== 'GET') return null;
  const p = url.pathname;
  const base = baseOf(env);

  // 2026-11-27: /sitemap.xml is the index (spec 4.4); /sitemap-index.xml stays as an alias.
  if (p === '/sitemap.xml' || p === '/sitemap-index.xml') {
    const entries = ['/sitemaps/pages.xml', '/sitemaps/categories.xml', '/sitemaps/stores.xml'];
    for (const lang of await sitemapLangs(env)) {
      const pages = productPageCount(await approvedProductCount(env, lang));
      for (let n = 1; n <= pages; n++) entries.push(`/sitemaps/${lang}-products-${n}.xml`);
    }
    return xml(corsHeaders, renderIndex(base, entries));
  }
  if (p === '/sitemaps/pages.xml') {
    return xml(corsHeaders, renderUrlset(base, STATIC_URLS.map((loc) => ({ loc }))));
  }
  if (p === '/sitemaps/categories.xml') {
    return xml(corsHeaders, renderUrlset(base, await categoryUrls(env)));
  }
  if (p === '/sitemaps/stores.xml') {
    return xml(corsHeaders, renderUrlset(base, await storeUrls(env)));
  }
  const pm = p.match(/^\/sitemaps\/(?:([a-z]{2}(?:-[a-z]{2})?)-)?products-(\d+)\.xml$/);
  if (pm) {
    const lang = pm[1] || 'ko'; // products-N.xml (pre-2026-11-27 name) = ko
    const page = Number(pm[2]);
    const langs = await sitemapLangs(env);
    const pages = langs.includes(lang) ? productPageCount(await approvedProductCount(env, lang)) : 0;
    if (!Number.isSafeInteger(page) || page < 1 || page > pages) {
      return new Response('Not Found', { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
    }
    return xml(corsHeaders, renderUrlset(base, await productUrls(env, page, PRODUCTS_PER_SITEMAP, lang)));
  }
  // 6-2: edge rendering data for one storefront path (the apex worker injects
  // it into index.html for every visitor alike). Read-only, public, cached 5 min.
  if (p === '/api/v1/seo/page') {
    const path = String(url.searchParams.get('path') || '/');
    if (path.length > 512 || !path.startsWith('/')) {
      return Response.json({ status: 'pass' }, { status: 400, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
    }
    const data = await renderSeoPage(env, base, path, String(url.searchParams.get('query') || ''));
    return Response.json(data, { headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
  }
  if (p === '/robots.txt') return txt(corsHeaders, robotsTxt(base));
  if (p === '/llms.txt') return txt(corsHeaders, await llmsTxt(env, base));
  if (p === '/llms-full.txt') return txt(corsHeaders, await llmsFullTxt(env, base));
  // 6-7: IndexNow key file from env (never a static file). Official key shape:
  // 8-128 chars of [A-Za-z0-9-] (indexnow.org/documentation). Served byte-exact
  // with no trailing newline; anything else 404s like any unknown file. Placed
  // after the exact .txt files: `llms-full` itself matches the key shape.
  const keyM = p.match(/^\/([A-Za-z0-9-]{8,128})\.txt$/);
  if (keyM) {
    const key = String(env.INDEXNOW_KEY || '');
    if (key && keyM[1] === key) {
      return new Response(key, { headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    return new Response('Not Found', { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
  }
  // 6-1: machine-readable PDP brief — indexable products only, same builder
  // as the storefront detail section (byte-identical by construction).
  const crawlM = p.match(/^\/api\/crawl\/product\/([^/]+)$/);
  if (crawlM) {
    const row = await env.DB.prepare("SELECT id FROM products WHERE id = ? AND status = 'ACTIVE' AND review_status = 'APPROVED'").bind(crawlM[1]).first();
    if (!row) return new Response('Not Found', { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
    const brief = await buildPdpBrief(env, crawlM[1]);
    if (!brief) return new Response('Not Found', { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
    return txt(corsHeaders, renderPdpText(brief));
  }
  // 6-3: coupon + return-policy feeds (live rows only, capped).
  // 6-5: also served under /llms/* so the apex canonical links resolve.
  if (p === '/api/crawl/coupons' || p === '/llms/coupons') {
    return Response.json(await couponFeed(env), { headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' } });
  }
  if (p === '/api/crawl/return-policies' || p === '/llms/return-policies') {
    return Response.json(await returnPolicyFeed(env, base), { headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' } });
  }
  // 6-5: per-product and per-category markdown (live rows only, else 404).
  const prodMd = p.match(/^\/llms\/product\/([^/]+)\.md$/);
  if (prodMd) {
    const md = await productMarkdown(env, base, prodMd[1]);
    if (md === null) return new Response('Not Found', { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
    return new Response(md, { headers: { ...corsHeaders, 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }
  const catMd = p.match(/^\/llms\/category\/([^/]+)\.md$/);
  if (catMd) {
    const md = await categoryMarkdown(env, base, catMd[1]);
    if (md === null) return new Response('Not Found', { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
    return new Response(md, { headers: { ...corsHeaders, 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }
  return null;
}
