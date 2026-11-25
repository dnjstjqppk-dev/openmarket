// tests/seo_crawl_test.mjs
// Phase 4-6 SEO/GEO/AEO + crawl architecture: entity-based meta rewriting,
// JSON-LD graphs, route head policy, D1-driven sitemaps/robots/llms.txt and
// the IndexNow queue skeleton. Zero-Mock: every URL and figure comes from
// live D1 rows; without keys the IndexNow drain reports degraded.

import assert from 'node:assert/strict';
import { createDatabase, createD1, createGateway, createRunner } from './lib/harness.mjs';
import { productMeta, categoryMeta } from '../apps/cloudflare-gateway/src/lib/seo-meta.js';
import { productGraph, siteGraphs, itemListGraph, faqGraph } from '../apps/cloudflare-gateway/src/lib/seo-jsonld.js';
import { routeHead } from '../apps/cloudflare-gateway/src/lib/seo-head.js';

const t = createRunner('SEO Crawl');
const PW = 'DevPass!2026#';

function freshEnv() {
  const db = createDatabase();
  return { db, env: { DB: createD1(db) } };
}

async function newGateway(env = {}) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      PUBLIC_STOREFRONT_URL: 'https://olmoa.com',
      ...env
    }
  });
}

async function adminToken(g) {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: PW, role: 'ADMIN' } });
  assert.equal(r.status, 200, `admin login: ${r.text}`);
  return r.json.token;
}

await t.test('migration exposes the indexnow queue and ledger row', async () => {
  const { db } = freshEnv();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'indexnow_queue'").get();
  assert.ok(row, 'indexnow_queue exists');
  const v = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('d1_74_seo_crawl.sql');
  assert.ok(v, 'schema ledger carries d1_74');
});

await t.test('product meta derives title/desc/H1 from the entity', async () => {
  const m = productMeta({ id: 'p1', title: '무선 이어폰 프로', description_html: '<p>노이즈캔슬링 이어폰</p>' }, 'Acme');
  assert.equal(m.title, '무선 이어폰 프로 | Acme | OLMOA');
  assert.ok(m.title.length <= 60 && m.description.length <= 160);
  assert.equal(m.h1, '무선 이어폰 프로');
  assert.ok(m.description.includes('노이즈캔슬링') && !m.description.includes('<p>'));
  assert.ok(!m.description.includes('무료배송') && !m.description.includes('만나보세요'), 'facts only');
  const bare = productMeta({ id: 'p2', title: '  ' });
  assert.ok(bare.title.includes('OLMOA') && bare.h1.length > 0, 'blank titles fall back, never empty');
});

await t.test('category meta carries the live product count', async () => {
  const m = categoryMeta({ name: '원피스', slug: 'dress' }, 120, '여성의류', ['원피스', '블라우스', '니트'], 6);
  assert.equal(m.title, '원피스 - 여성의류 | OLMOA');
  assert.ok(m.description.includes('6') && m.description.includes('120'));
  assert.equal(m.h1, '원피스');
  const top = categoryMeta({ name: '뷰티', slug: 'beauty' }, 42);
  assert.equal(top.title, '뷰티 | OLMOA');
  assert.ok(top.description.includes('42'));
});

await t.test('json-ld graphs type every required schema', async () => {
  const g = productGraph('https://olmoa.com', { id: 'p1', title: '이어폰', lowest_sale_price: 29900, thumbnail_url: 'https://x/img.jpg' }, { crumbs: [{ label: '홈', to: '/' }] });
  const types = g.map((n) => n['@type']);
  assert.ok(types.includes('Product') && types.includes('BreadcrumbList'));
  assert.equal(g[0].offers.priceCurrency, 'KRW');
  const site = siteGraphs('https://olmoa.com');
  assert.ok(site.map((n) => n['@type']).includes('Organization') && site.map((n) => n['@type']).includes('WebSite'));
  assert.ok(itemListGraph('https://olmoa.com', '베스트', [{ id: 'p1', title: '이어폰' }])['@type'] === 'ItemList');
  assert.equal(faqGraph([{ q: '배송?', a: '2일' }])['@type'], 'FAQPage');
});

await t.test('route head policy indexes PDP and blocks private routes', async () => {
  const pdp = routeHead({ route: 'product', path: '/product/p1', base: 'https://olmoa.com', title: '이어폰 | OLMOA' });
  assert.equal(pdp.robots, 'index,follow');
  assert.equal(pdp.canonical, 'https://olmoa.com/product/p1');
  assert.ok(pdp.hreflangs[0].hreflang === 'x-default' && pdp.og['og:title'] === '이어폰 | OLMOA');
  assert.ok(pdp.twitter['twitter:card'] === 'summary_large_image');
  for (const path of ['/cart', '/checkout', '/my', '/orders/1', '/login', '/payments/success']) {
    assert.equal(routeHead({ route: 'x', path, base: 'https://olmoa.com', title: 't' }).robots, 'noindex,nofollow', path);
  }
});

await t.test('sitemap.xml stays a urlset of approved products', async () => {
  const g = await newGateway();
  const r = await g.call('/sitemap.xml');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('<urlset') && r.text.includes('/category/'));
});

await t.test('sitemap index shards products and categories', async () => {
  const g = await newGateway();
  const idx = await g.call('/sitemap-index.xml');
  assert.ok(idx.text.includes('<sitemapindex') && idx.text.includes('/sitemaps/categories.xml'));
  const cats = await g.call('/sitemaps/categories.xml');
  assert.ok(cats.text.includes('<urlset') && cats.text.includes('/category/'));
  const prods = await g.call('/sitemaps/products-1.xml');
  assert.equal(prods.status, 200);
  assert.ok(prods.text.includes('<urlset') && prods.text.includes('/product/'));
  assert.equal((await g.call('/sitemaps/products-0.xml')).status, 404);
  const stores = await g.call('/sitemaps/stores.xml');
  assert.ok(stores.text.includes('<urlset') && stores.text.includes('/store/'));
  assert.ok(idx.text.includes('/sitemaps/stores.xml'));
});

await t.test('robots and llms files are served from live data', async () => {
  const g = await newGateway();
  const robots = await g.call('/robots.txt');
  assert.ok(robots.text.includes('Sitemap: https://olmoa.com/sitemap-index.xml'));
  assert.ok(robots.text.includes('Disallow: /api/') && robots.text.includes('Disallow: /checkout'));
  const llms = await g.call('/llms.txt');
  assert.ok(llms.text.includes('# OLMOA') && llms.text.includes('/category/'));
  const full = await g.call('/llms-full.txt');
  assert.ok(full.text.includes('# OLMOA') && full.text.includes('/product/'));
  assert.ok(full.text.includes('## 분류별 상품 요약') && full.text.includes('/category/'));
  assert.ok(full.text.includes('### 이용약관') && full.text.includes('### 개인정보처리방침') && full.text.includes('### 반품·환불 규정'));
});

await t.test('indexnow enqueue and status log are admin-only', async () => {
  const g = await newGateway();
  assert.equal((await g.call('/api/v1/admin/seo/indexnow/queue')).status, 401);
  assert.equal((await g.call('/api/v1/admin/seo/indexnow/enqueue', { method: 'POST', body: { urls: ['https://olmoa.com/product/p1'] } })).status, 401);
  const adm = await adminToken(g);
  const bad = await g.call('/api/v1/admin/seo/indexnow/enqueue', { method: 'POST', token: adm, body: { urls: ['http://evil/x', 'not-a-url'] } });
  assert.equal(bad.status, 400);
  const ok = await g.call('/api/v1/admin/seo/indexnow/enqueue', { method: 'POST', token: adm, body: { urls: ['https://olmoa.com/product/p1'] } });
  assert.equal(ok.json.queued, 1, ok.text);
  const log = await g.call('/api/v1/admin/seo/indexnow/queue', { token: adm });
  assert.equal(log.json.data[0].status, 'PENDING');
  const status = await g.call('/api/v1/admin/seo/indexnow/status', { token: adm });
  assert.equal(status.json.key_configured, false);
  assert.equal(status.json.PENDING, 1);
});

await t.test('indexnow drain fails closed without a key', async () => {
  const g = await newGateway();
  const adm = await adminToken(g);
  await g.call('/api/v1/admin/seo/indexnow/enqueue', { method: 'POST', token: adm, body: { urls: ['https://olmoa.com/product/p9'] } });
  const d = await g.call('/api/v1/admin/seo/indexnow/drain', { method: 'POST', token: adm, body: {} });
  assert.equal(d.json.sent, 0);
  assert.equal(d.json.degraded, 'INDEXNOW_NOT_CONFIGURED');
  const log = await g.call('/api/v1/admin/seo/indexnow/queue?status=PENDING', { token: adm });
  assert.ok(log.json.data.length >= 1, 'unsent rows stay PENDING');
});

await t.test('indexnow drain submits to a live endpoint', async () => {
  const { default: http } = await import('node:http');
  let seen = null;
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { seen = JSON.parse(b); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  try {
    const port = srv.address().port;
    const g = await newGateway({ INDEXNOW_KEY: 'test-key-0123456789', INDEXNOW_ENDPOINT: `http://127.0.0.1:${port}/indexnow` });
    const adm = await adminToken(g);
    await g.call('/api/v1/admin/seo/indexnow/enqueue', { method: 'POST', token: adm, body: { urls: ['https://olmoa.com/product/p1'] } });
    const d = await g.call('/api/v1/admin/seo/indexnow/drain', { method: 'POST', token: adm, body: {} });
    assert.equal(d.json.sent, 1, JSON.stringify(d.json));
    assert.ok(seen && seen.key === 'test-key-0123456789' && seen.urlList.length === 1);
    const log = await g.call('/api/v1/admin/seo/indexnow/queue?status=SENT', { token: adm });
    assert.equal(log.json.data.length, 1);
  } finally {
    srv.close();
  }
});

t.finish();
