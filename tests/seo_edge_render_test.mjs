// tests/seo_edge_render_test.mjs
// Phase 6 task 6-2: edge rendering. The apex worker (called directly, fake
// ASSETS + the in-process API) must put DB-true head, JSON-LD and a summary
// into index.html for product/category/store/support pages, answer 404 for
// missing or not-live entities, serve the untouched shell when the API fails,
// and return byte-identical HTML whatever the user agent (no cloaking).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGateway, createRunner } from './lib/harness.mjs';
import apex, { injectPage, isPagePath, RUN_WORKER_FIRST } from '../apps/storefront/edge/apex-worker.js';
import { barePath } from '../apps/cloudflare-gateway/src/services/seo/page-render.js';

const t = createRunner('Edge rendering (6-2)');
const SHELL = fs.readFileSync(new URL('../apps/storefront/index.html', import.meta.url), 'utf8');
const assets = { fetch: async () => new Response(SHELL, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) };

const g = await createGateway({
  seedFiles: ['migrations/dev/seed_local_dev.sql'],
  env: { JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu', ENVIRONMENT: 'development', PUBLIC_STOREFRONT_URL: 'https://olmoa.com' }
});
const env = { ASSETS: assets, API: { fetch: (req) => g.worker.fetch(req, g.env, g.ctx) } };
const get = (p, ua = 'Mozilla/5.0') => apex.fetch(new Request(`https://olmoa.com${p}`, { headers: { 'User-Agent': ua } }), env);
const one = async (sql, ...b) => g.env.DB.prepare(sql).bind(...b).first();

const titleOf = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1];
const canonicalOf = (html) => (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
const countOf = (html, re) => (html.match(re) || []).length;
const graphsOf = (html) => [...html.matchAll(/<script type="application\/ld\+json" data-olmoa-edge>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

await t.test('E01 product page: head, Product JSON-LD and summary match the DB row', async () => {
  const p = await one(`SELECT p.*, sp.fee_type, sp.base_fee FROM products p JOIN shipping_policies sp ON sp.id = p.shipping_policy_id
    WHERE p.status = 'ACTIVE' AND p.review_status = 'APPROVED' AND sp.status = 'ACTIVE' ORDER BY p.id LIMIT 1`);
  assert.ok(p, 'seed has a live product');
  const r = await get(`/product/${p.id}`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(decode(titleOf(html)).startsWith(p.title.slice(0, 20)), 'title from the product row');
  assert.equal(canonicalOf(html), `https://olmoa.com/product/${p.id}`);
  assert.equal(countOf(html, /<title>/g), 1, 'one title (static one replaced)');
  assert.equal(countOf(html, /rel="canonical"/g), 1, 'one canonical');
  assert.equal(countOf(html, /name="description"/g), 1, 'one description');
  assert.ok(!/hreflang="(en|ja)/.test(html), 'no en/ja alternates');
  const product = graphsOf(html).find((x) => x['@type'] === 'Product');
  assert.ok(product, 'Product graph present without JS');
  assert.equal(product.name, p.title);
  assert.equal(product.offers.price, Number(p.lowest_sale_price), 'price is the DB value');
  const rate = p.fee_type === 'FREE' ? 0 : Number(p.base_fee);
  assert.equal(product.offers.shippingDetails.shippingRate.value, rate, 'shipping rate from the seller policy');
  assert.ok(graphsOf(html).some((x) => x['@type'] === 'BreadcrumbList'), 'breadcrumb graph');
  assert.match(html, /<div id="app"><main data-olmoa-edge><nav aria-label="경로">/, 'summary sits inside #app');
  assert.ok(html.includes('<dt>판매가</dt>'), 'key-facts table in the summary');
});

await t.test('E02 category page: title rule, ItemList of live products only', async () => {
  const c = await one(`SELECT c.* FROM categories c WHERE c.is_active = 1 AND EXISTS (
    SELECT 1 FROM products p JOIN shipping_policies sp ON sp.id = p.shipping_policy_id
    WHERE p.category_id = c.id AND p.status = 'ACTIVE' AND p.review_status = 'APPROVED' AND sp.status = 'ACTIVE') ORDER BY c.slug LIMIT 1`);
  assert.ok(c, 'seed has a category with live products');
  const r = await get(`/category/${c.slug}`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(decode(titleOf(html)).startsWith(c.name), 'title starts with the category name');
  assert.equal(canonicalOf(html), `https://olmoa.com/category/${c.slug}`);
  const list = graphsOf(html).find((x) => x['@type'] === 'ItemList');
  assert.ok(list && list.itemListElement.length > 0, 'ItemList present');
  for (const it of list.itemListElement) {
    const id = decodeURIComponent(it.url.split('/product/')[1]);
    const live = await one(`SELECT 1 AS ok FROM products p JOIN shipping_policies sp ON sp.id = p.shipping_policy_id
      WHERE p.id = ? AND p.status = 'ACTIVE' AND p.review_status = 'APPROVED' AND sp.status = 'ACTIVE'`, id);
    assert.ok(live, `listed product is live: ${id}`);
  }
});

await t.test('E03 store and support pages carry facts; support lists published FAQ', async () => {
  const s = await one("SELECT id, business_name FROM partners WHERE status = 'APPROVED' ORDER BY id LIMIT 1");
  const store = await (await get(`/store/${s.id}`)).text();
  assert.equal(decode(titleOf(store)), `${s.business_name} | OLMOA`.slice(0, 60), 'store title matches the store view');
  assert.ok(!store.includes('만나보세요'), 'no marketing phrase');
  const sup = await get('/support');
  assert.equal(sup.status, 200);
  const html = await sup.text();
  const faq = graphsOf(html).find((x) => x['@type'] === 'FAQPage');
  const n = (await one('SELECT COUNT(*) AS n FROM faqs WHERE is_published = 1')).n;
  assert.equal(faq ? faq.mainEntity.length : 0, Math.min(n, 50), 'FAQPage has the published rows');
  assert.match(html, /<meta name="robots" content="index,follow">/, 'public support center is indexable');
});

await t.test('E04 missing and not-live entities answer 404 with the SPA body', async () => {
  for (const p of ['/product/does-not-exist', '/category/does-not-exist', '/store/does-not-exist']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    const html = await r.text();
    assert.ok(html.includes('<div id="app">'), `${p} still serves the SPA`);
    assert.match(html, /<meta name="robots" content="noindex,nofollow">/, `${p} noindex`);
  }
  const live = await one("SELECT id FROM products WHERE status = 'ACTIVE' AND review_status = 'APPROVED' AND shipping_policy_id IS NOT NULL ORDER BY id LIMIT 1");
  await g.env.DB.prepare('UPDATE products SET shipping_policy_id = NULL WHERE id = ?').bind(live.id).run();
  const r = await get(`/product/${live.id}`);
  assert.equal(r.status, 404, 'policy-less product is not exposed (6-11)');
});

await t.test('E05 API failure or timeout serves the untouched shell (200)', async () => {
  const broken = { ASSETS: assets, API: { fetch: async () => { throw new Error('down'); } } };
  const r = await apex.fetch(new Request('https://olmoa.com/category/x'), broken);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), SHELL);
  const err = { ASSETS: assets, API: { fetch: async () => new Response('boom', { status: 500 }) } };
  const r2 = await apex.fetch(new Request('https://olmoa.com/product/x'), err);
  assert.equal(r2.status, 200);
  assert.equal(await r2.text(), SHELL);
  const none = await apex.fetch(new Request('https://olmoa.com/store/x'), { ASSETS: assets });
  assert.equal(await none.text(), SHELL, 'no API binding: shell as-is');
});

await t.test('E06 same HTML for every user agent (no cloaking)', async () => {
  const p = await one("SELECT id FROM products WHERE status = 'ACTIVE' AND review_status = 'APPROVED' AND shipping_policy_id IS NOT NULL ORDER BY id LIMIT 1");
  for (const path of ['/', `/product/${p.id}`, '/support']) {
    const human = await (await get(path, 'Mozilla/5.0 (iPhone)')).text();
    for (const ua of ['Googlebot/2.1', 'GPTBot/1.0', 'Yeti/1.1', 'ClaudeBot/1.0']) {
      assert.equal(await (await get(path, ua)).text(), human, `${path} ${ua}`);
    }
  }
});

await t.test('E07 /en and /ja mirrors canonicalize to the ko URL', async () => {
  const p = await one("SELECT id FROM products WHERE status = 'ACTIVE' AND review_status = 'APPROVED' AND shipping_policy_id IS NOT NULL ORDER BY id LIMIT 1");
  const html = await (await get(`/en/product/${p.id}`)).text();
  assert.equal(canonicalOf(html), `https://olmoa.com/product/${p.id}`);
  assert.equal(barePath('/ja'), '/');
  assert.equal(barePath('/en/category/a/'), '/category/a');
  assert.equal(barePath('/entertainment'), '/entertainment', 'only whole /en segments are prefixes');
});

await t.test('E08 routing: page paths go through the worker, assets do not', () => {
  for (const p of ['/', '/product/1', '/category/a', '/store/s', '/support', '/categories', '/channel/best-sellers', '/legal/terms', '/policy/shipping', '/en', '/ja/product/1']) {
    assert.equal(isPagePath(p), true, p);
  }
  for (const p of ['/assets/index.js', '/olmoa-symbol.svg', '/cart', '/my', '/search']) assert.equal(isPagePath(p), false, p);
  for (const p of ['/product/*', '/category/*', '/store/*', '/support']) assert.ok(RUN_WORKER_FIRST.includes(p), p);
  assert.equal(injectPage('<html><body>x</body></html>', { head: { title: 't' } }), '<html><body>x</body></html>', 'no </head>: as-is');
});

t.finish();
