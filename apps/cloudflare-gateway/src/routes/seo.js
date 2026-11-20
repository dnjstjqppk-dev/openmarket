// apps/cloudflare-gateway/src/routes/seo.js
// Public crawl surface: legacy bounded /sitemap.xml (e2e-02 contract),
// sharded /sitemap-index.xml + /sitemaps/*, /robots.txt, /llms.txt and
// /llms-full.txt. All D1-driven; served pre-ratelimit like /health.

import { STATIC_URLS, LEGACY_PRODUCT_CAP, PRODUCTS_PER_SITEMAP, categoryUrls, storeUrls,
  productUrls, approvedProductCount, productPageCount, renderUrlset, renderIndex } from '../services/seo/sitemap.js';
import { robotsTxt, llmsTxt, llmsFullTxt } from '../services/seo/crawl-text.js';

const xml = (cors, body) => new Response(body, { headers: { ...cors, 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
const txt = (cors, body) => new Response(body, { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
const baseOf = (env) => String(env.PUBLIC_STOREFRONT_URL || 'https://olmoa.com').replace(/\/$/, '');

export async function handleSeoRoutes(request, url, env, corsHeaders) {
  if (request.method !== 'GET') return null;
  const p = url.pathname;
  const base = baseOf(env);

  if (p === '/sitemap.xml') {
    const cats = await categoryUrls(env);
    const prods = await productUrls(env, 1, LEGACY_PRODUCT_CAP);
    const urls = [...STATIC_URLS.map((loc) => ({ loc })), ...cats, ...prods];
    return xml(corsHeaders, renderUrlset(base, urls));
  }
  if (p === '/sitemap-index.xml') {
    const pages = productPageCount(await approvedProductCount(env));
    const entries = ['/sitemaps/categories.xml', '/sitemaps/stores.xml'];
    for (let n = 1; n <= pages; n++) entries.push(`/sitemaps/products-${n}.xml`);
    return xml(corsHeaders, renderIndex(base, entries));
  }
  if (p === '/sitemaps/categories.xml') {
    return xml(corsHeaders, renderUrlset(base, await categoryUrls(env)));
  }
  if (p === '/sitemaps/stores.xml') {
    return xml(corsHeaders, renderUrlset(base, await storeUrls(env)));
  }
  const pm = p.match(/^\/sitemaps\/products-(\d+)\.xml$/);
  if (pm) {
    const page = Number(pm[1]);
    const pages = productPageCount(await approvedProductCount(env));
    if (!Number.isSafeInteger(page) || page < 1 || page > pages) {
      return new Response('Not Found', { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
    }
    return xml(corsHeaders, renderUrlset(base, await productUrls(env, page, PRODUCTS_PER_SITEMAP)));
  }
  if (p === '/robots.txt') return txt(corsHeaders, robotsTxt(base));
  if (p === '/llms.txt') return txt(corsHeaders, await llmsTxt(env, base));
  if (p === '/llms-full.txt') return txt(corsHeaders, await llmsFullTxt(env, base));
  return null;
}
