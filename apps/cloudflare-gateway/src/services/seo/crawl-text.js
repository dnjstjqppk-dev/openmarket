// apps/cloudflare-gateway/src/services/seo/crawl-text.js
// robots.txt + llms.txt + llms-full.txt builders. Every listed path comes from
// live D1 rows; an empty catalog yields a minimal valid file, never placeholders.

import { STATIC_URLS } from './sitemap.js';

const PRIVATE_DISALLOWS = ['/api/', '/cart', '/checkout', '/my', '/orders', '/login',
  '/register', '/addresses', '/wishlist', '/coupons', '/payments', '/admin'];

export function robotsTxt(base) {
  const lines = ['User-agent: *', ...PRIVATE_DISALLOWS.map((p) => `Disallow: ${p}`),
    `Sitemap: ${base}/sitemap-index.xml`, `Sitemap: ${base}/sitemap.xml`];
  return `${lines.join('\n')}\n`;
}

async function liveCategories(env) {
  const { results } = await env.DB.prepare(
    'SELECT name, slug FROM categories WHERE is_active = 1 AND depth = 0 ORDER BY sort_order ASC').all();
  return results || [];
}

/** Compact crawler brief: brand line, category hubs, static entries. */
export async function llmsTxt(env, base) {
  const cats = await liveCategories(env);
  const lines = ['# OLMOA', '> Global marketplace storefront. Prices in KRW.',
    '', '## Categories', ...cats.map((c) => `- [${c.name}](${base}/category/${c.slug})`),
    '', '## Entry', ...STATIC_URLS.map((u) => `- ${base}${u}`)];
  return `${lines.join('\n')}\n`;
}

/** Live catalog counters for the full brief (zero rows stay zero). */
export async function catalogStats(env) {
  const cats = Number(await env.DB.prepare('SELECT COUNT(*) AS c FROM categories WHERE is_active = 1').first('c')) || 0;
  const prods = Number(await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM products WHERE status = 'ACTIVE' AND review_status = 'APPROVED'").first('c')) || 0;
  const stores = Number(await env.DB.prepare("SELECT COUNT(*) AS c FROM partners WHERE status = 'APPROVED'").first('c')) || 0;
  return { categories: cats, products: prods, stores };
}

/** Full brief: stats, top-level hubs plus best-selling products (cap 200). */
export async function llmsFullTxt(env, base) {
  const cats = await liveCategories(env);
  const stats = await catalogStats(env);
  const { results } = await env.DB.prepare(
    `SELECT id, title FROM products WHERE status = 'ACTIVE' AND review_status = 'APPROVED'
     ORDER BY total_sold_count DESC, updated_at DESC LIMIT 200`).all();
  const lines = ['# OLMOA', '> Global marketplace storefront. Prices in KRW.',
    '', '## Stats', `- Categories: ${stats.categories}`, `- Products: ${stats.products}`, `- Stores: ${stats.stores}`,
    '', '## Categories', ...cats.map((c) => `- [${c.name}](${base}/category/${c.slug})`),
    '', '## Best sellers', ...(results || []).map((p) => `- [${p.title}](${base}/product/${p.id})`),
    '', '## Entry', ...STATIC_URLS.map((u) => `- ${base}${u}`)];
  return `${lines.join('\n')}\n`;
}
