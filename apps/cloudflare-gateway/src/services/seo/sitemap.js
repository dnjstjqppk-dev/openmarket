// apps/cloudflare-gateway/src/services/seo/sitemap.js
// D1-driven sitemaps under the /{lang}/{currency} scheme (2026-11-27):
// /sitemap.xml (and its alias /sitemap-index.xml) is a sitemap index of
// pages/categories/stores (ko, representative currency) plus one product
// series per content language: /sitemaps/{lang}-products-{n}.xml. Only each
// language's representative-currency URL is listed, and a non-ko language
// lists only products the seller translated (decision 22).

import { sellableSql } from '../../lib/shipping-policy.js';
import { DEFAULT_CURRENCY, SOURCE_LANG, localizedPath, productBarePath, slugify } from '../../../../../packages/ui/src/locale.config.ts';

const ko = (bare) => localizedPath(SOURCE_LANG, DEFAULT_CURRENCY[SOURCE_LANG], bare);

export const STATIC_BARE = ['/', '/categories', '/channel/lightning-deals',
  '/channel/best-sellers', '/support', '/legal/terms', '/legal/privacy', '/legal/refund'];
export const STATIC_URLS = STATIC_BARE.map((b) => localizedPath('ko', 'krw', b));
export const PRODUCTS_PER_SITEMAP = 5000;
export const LEGACY_PRODUCT_CAP = 1000;

const APPROVED = `p.status = 'ACTIVE' AND p.review_status = 'APPROVED' AND ${sellableSql('p')}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export async function categoryUrls(env) {
  const { results } = await env.DB.prepare(
    'SELECT slug FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, slug ASC').all();
  return (results || []).map((c) => ({ loc: ko(`/c/${encodeURIComponent(c.slug)}`) }));
}

export async function storeUrls(env) {
  const { results } = await env.DB.prepare(
    "SELECT id FROM partners WHERE status = 'APPROVED' ORDER BY id ASC LIMIT 5000").all();
  return (results || []).map((s) => ({ loc: ko(`/store/${encodeURIComponent(s.id)}`) }));
}

/** Languages to publish product sitemaps for: ko + every language with >= 1 translation. */
export async function sitemapLangs(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT t.lang FROM product_translations t JOIN products p ON p.id = t.product_id WHERE ${APPROVED} ORDER BY t.lang`).all();
    return [SOURCE_LANG, ...(results || []).map((r) => r.lang)];
  } catch {
    return [SOURCE_LANG]; // database without d1_78
  }
}

export async function approvedProductCount(env, lang = SOURCE_LANG) {
  if (lang !== SOURCE_LANG) {
    try {
      const n = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM product_translations t JOIN products p ON p.id = t.product_id WHERE t.lang = ? AND ${APPROVED}`).bind(lang).first('c');
      return Number(n) || 0;
    } catch {
      return 0;
    }
  }
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM products p WHERE ${APPROVED}`).first('c');
  return Number(n) || 0;
}

export async function productUrls(env, page = 1, perPage = PRODUCTS_PER_SITEMAP, lang = SOURCE_LANG) {
  const offset = (Math.max(1, page) - 1) * perPage;
  const cur = DEFAULT_CURRENCY[lang];
  if (lang !== SOURCE_LANG) {
    const { results } = await env.DB.prepare(
      `SELECT p.id, t.slug, MAX(p.updated_at, t.updated_at) AS updated_at FROM product_translations t
       JOIN products p ON p.id = t.product_id WHERE t.lang = ? AND ${APPROVED}
       ORDER BY p.updated_at DESC, p.id ASC LIMIT ? OFFSET ?`).bind(lang, perPage, offset).all();
    return (results || []).map((p) => ({
      loc: localizedPath(lang, cur, productBarePath(p.id, p.slug)),
      lastmod: String(p.updated_at || '').slice(0, 10) || undefined
    }));
  }
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.updated_at FROM products p WHERE ${APPROVED}
     ORDER BY p.updated_at DESC, p.id ASC LIMIT ? OFFSET ?`).bind(perPage, offset).all();
  return (results || []).map((p) => ({
    loc: localizedPath(lang, cur, productBarePath(p.id, slugify(p.title))),
    lastmod: String(p.updated_at || '').slice(0, 10) || undefined
  }));
}

export function productPageCount(total) {
  return Math.max(1, Math.ceil(Math.max(0, total) / PRODUCTS_PER_SITEMAP));
}

export function renderUrlset(base, urls) {
  const items = urls.map((u) =>
    `  <url><loc>${esc(base)}${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</urlset>`;
}

export function renderIndex(base, entries) {
  const items = entries.map((e) => `  <sitemap><loc>${esc(base)}${esc(e)}</loc></sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>`;
}
