// apps/cloudflare-gateway/src/services/seo/sitemap.js
// D1-driven sitemaps: /sitemap.xml stays a bounded urlset (static + active
// categories + first 1000 approved products, e2e-02 contract), while
// /sitemap-index.xml shards the full catalog into categories + product pages.

export const STATIC_URLS = ['/', '/categories', '/channel/lightning-deals',
  '/channel/best-sellers', '/support', '/legal/terms', '/legal/privacy', '/legal/refund'];
export const PRODUCTS_PER_SITEMAP = 5000;
export const LEGACY_PRODUCT_CAP = 1000;

const APPROVED = "p.status = 'ACTIVE' AND p.review_status = 'APPROVED'";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export async function categoryUrls(env) {
  const { results } = await env.DB.prepare(
    'SELECT slug FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, slug ASC').all();
  return (results || []).map((c) => ({ loc: `/category/${encodeURIComponent(c.slug)}` }));
}

export async function storeUrls(env) {
  const { results } = await env.DB.prepare(
    "SELECT id FROM partners WHERE status = 'APPROVED' ORDER BY id ASC LIMIT 5000").all();
  return (results || []).map((s) => ({ loc: `/store/${encodeURIComponent(s.id)}` }));
}

export async function approvedProductCount(env) {
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM products p WHERE ${APPROVED}`).first('c');
  return Number(n) || 0;
}

export async function productUrls(env, page = 1, perPage = PRODUCTS_PER_SITEMAP) {
  const offset = (Math.max(1, page) - 1) * perPage;
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.updated_at FROM products p WHERE ${APPROVED}
     ORDER BY p.updated_at DESC, p.id ASC LIMIT ? OFFSET ?`).bind(perPage, offset).all();
  return (results || []).map((p) => ({
    loc: `/product/${encodeURIComponent(p.id)}`,
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
