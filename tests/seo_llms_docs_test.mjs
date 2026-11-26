// tests/seo_llms_docs_test.mjs
// Phase 6 task 6-5: llms.txt, llms-full.txt and per-entity markdown — every
// link resolves, every figure matches the database, one entity everywhere.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGateway, createRunner } from './lib/harness.mjs';
import { SITE_NAME, SITE_TAGLINE, SITE_LOGO, organizationGraph } from '../apps/cloudflare-gateway/src/lib/site-entity.js';
import { LLMS_TXT_CAP, LLMS_FULL_CAP, LLMS_DOC_CAP } from '../apps/cloudflare-gateway/src/services/seo/crawl-text.js';
import { productGraph } from '../apps/cloudflare-gateway/src/lib/seo-jsonld.js';

const t = createRunner('LLM docs (6-5)');

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      PUBLIC_STOREFRONT_URL: 'https://olmoa.com'
    }
  });
}

const bytesOf = (s) => Buffer.byteLength(s, 'utf8');
const linksOf = (md) => [...String(md).matchAll(/\((https:\/\/olmoa\.com[^)]+)\)/g)].map((m) => m[1]);

// 1. llms.txt follows the house format and the size cap.
await t.test('1. llms.txt carries identity, hubs, policies, docs and citation', async () => {
  const g = await newGateway();
  const r = await g.call('/llms.txt');
  assert.equal(r.status, 200, r.text);
  const text = r.text;
  assert.ok(text.startsWith(`# ${SITE_NAME}\n> ${SITE_TAGLINE}\n`), 'name + tagline lead');
  for (const h of ['## 카테고리', '## 판매 정책', '## 상품 문서', '## 연락처', '## 인용 안내']) {
    assert.ok(text.includes(h), `section ${h}`);
  }
  assert.ok(text.includes('사업자등록번호'), 'operator block present (seed entity active)');
  assert.ok(text.includes('KRW'), 'currency stated');
  assert.ok(bytesOf(text) <= LLMS_TXT_CAP, `under ${LLMS_TXT_CAP} bytes`);
});

// 2. Every llms.txt link resolves.
await t.test('2. llms.txt links all resolve', async () => {
  const g = await newGateway();
  const r = await g.call('/llms.txt');
  const links = [...new Set(linksOf(r.text))];
  assert.ok(links.length > 10, 'a real link set');
  for (const href of links) {
    const u = new URL(href);
    assert.equal(u.host, 'olmoa.com', `apex canonical: ${href}`);
    const m = u.pathname.match(/^\/llms\/product\/([^/]+)\.md$/);
    const c = u.pathname.match(/^\/llms\/category\/([^/]+)\.md$/);
    if (m || c) {
      const d = await g.call(u.pathname);
      assert.equal(d.status, 200, `${href} serves`);
    } else if (u.pathname.startsWith('/ko/krw/c/')) {
      const row = g.db.prepare('SELECT 1 FROM categories WHERE slug = ? AND is_active = 1').get(u.pathname.split('/')[4]);
      assert.ok(row, `${href} names a live category`);
    } else if (u.pathname.startsWith('/ko/krw/policy/') || u.pathname.startsWith('/ko/krw/legal/')) {
      assert.ok(['/ko/krw/policy/shipping', '/ko/krw/legal/refund', '/ko/krw/legal/privacy', '/ko/krw/legal/terms'].includes(u.pathname), `${href} is a known policy page`);
    } else if (u.pathname === '/llms/return-policies') {
      const f = await g.call(u.pathname);
      assert.equal(f.status, 200, 'return-policy feed serves');
    } else {
      assert.fail(`unexpected llms.txt link: ${href}`);
    }
  }
});

// 3. llms-full.txt: full policies + capped per-category summaries.
await t.test('3. llms-full.txt holds policies and stated-cap summaries', async () => {
  const g = await newGateway();
  const r = await g.call('/llms-full.txt');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.text.includes('이용약관') && r.text.includes('개인정보처리방침') && r.text.includes('반품·환불 규정'), 'three policies inline');
  assert.ok(r.text.includes('분류당 상위 5종'), 'cap stated');
  assert.ok(bytesOf(r.text) <= LLMS_FULL_CAP, `under ${LLMS_FULL_CAP} bytes`);
});

// 4. Product .md mirrors the database; removed products 404.
await t.test('4. product markdown matches rows, removed 404s', async () => {
  const g = await newGateway();
  const id = 'prod_001';
  const r = await g.call(`/llms/product/${id}.md`);
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('Content-Type'), /text\/markdown/);
  const p = g.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  assert.ok(r.text.includes(p.title), 'title live');
  assert.ok(r.text.includes(`https://olmoa.com/ko/krw/p/${id}`), 'canonical live');
  assert.ok(r.text.includes(Number(p.lowest_sale_price).toLocaleString('ko-KR')), 'price live');
  assert.ok(r.text.includes(String(p.updated_at).slice(0, 10)), 'freshness live');
  assert.ok(bytesOf(r.text) <= LLMS_DOC_CAP, 'under the doc cap');
  const missing = await g.call('/llms/product/prod_missing.md');
  assert.equal(missing.status, 404);
  const draft = g.db.prepare("SELECT id FROM products WHERE status != 'ACTIVE' LIMIT 1").get();
  if (draft) assert.equal((await g.call(`/llms/product/${draft.id}.md`)).status, 404, 'drafts excluded');
  const target = g.db.prepare("SELECT id FROM products WHERE status = 'ACTIVE' AND review_status = 'APPROVED' LIMIT 1").get();
  g.db.prepare('UPDATE products SET shipping_policy_id = NULL WHERE id = ?').run(target.id);
  assert.equal((await g.call(`/llms/product/${target.id}.md`)).status, 404, 'policy-less rows excluded');
});

// 5. Category .md mirrors subs, counts and picks.
await t.test('5. category markdown mirrors the tree', async () => {
  const g = await newGateway();
  const parent = g.db.prepare("SELECT slug FROM categories WHERE is_active = 1 AND id IN (SELECT parent_id FROM categories WHERE parent_id IS NOT NULL) LIMIT 1").get();
  const r = await g.call(`/llms/category/${parent.slug}.md`);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.text.includes(`/ko/krw/c/${parent.slug}`), 'canonical live');
  const miss = await g.call('/llms/category/no-such-cat.md');
  assert.equal(miss.status, 404);
});

// 6. One entity across Organization, llms.txt, index.html and the footer.
await t.test('6. site name, tagline and logo are identical everywhere', async () => {
  const g = await newGateway();
  const org = organizationGraph('https://olmoa.com');
  assert.equal(org.name, SITE_NAME);
  assert.equal(org.description, SITE_TAGLINE);
  assert.equal(org.logo, `https://olmoa.com${SITE_LOGO}`);
  const llms = await g.call('/llms.txt');
  assert.ok(llms.text.includes(`# ${SITE_NAME}`) && llms.text.includes(`> ${SITE_TAGLINE}`));
  const shell = readFileSync('apps/storefront/index.html', 'utf8');
  assert.ok(shell.includes(`<meta property="og:site_name" content="${SITE_NAME}" />`), 'shell site name');
  assert.ok(shell.includes(`<meta name="description" content="${SITE_TAGLINE}" />`), 'shell description');
  assert.ok(shell.includes(`<meta property="og:description" content="${SITE_TAGLINE}" />`), 'shell og:description');
  assert.ok(shell.includes(`href="${SITE_LOGO}"`), 'shell logo');
  const app = readFileSync('apps/storefront/src/App.vue', 'utf8');
  assert.ok(app.includes('SITE_NAME') && app.includes('SITE_TAGLINE'), 'footer imports the single source');
  assert.ok(app.includes('site-entity'), 'footer points at the module');
  assert.ok(!app.includes('>olmoa<'), 'lowercase wordmark gone');
});

// 7. Freshness agrees: .md stamp, sitemap lastmod, JSON-LD dateModified.
await t.test('7. one freshness value across .md, sitemap and JSON-LD', async () => {
  const g = await newGateway();
  const id = 'prod_001';
  const want = g.db.prepare('SELECT updated_at FROM products WHERE id = ?').get(id).updated_at.slice(0, 10);
  const md = await g.call(`/llms/product/${id}.md`);
  assert.ok(md.text.includes(`갱신: ${want}`), '.md stamp');
  const map = await g.call('/sitemaps/ko-products-1.xml');
  const loc = [...map.text.matchAll(new RegExp(`<loc>https://olmoa\\.com/ko/krw/p/${id}(?:/[^<]+)?</loc>\\s*<lastmod>([^<]+)</lastmod>`, 'g'))][0];
  assert.ok(loc, 'sitemap carries the product');
  assert.equal(loc[1].slice(0, 10), want, 'sitemap lastmod');
  const p = g.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  const [graph] = productGraph('https://olmoa.com', { ...p, thumbnail_url: 'https://x/i.jpg' }, {});
  assert.equal(graph.dateModified, want, 'JSON-LD dateModified');
});

// 8. /llms/* feed aliases mirror the crawl originals.
await t.test('8. llms feed aliases equal their crawl originals', async () => {
  const g = await newGateway();
  for (const [a, b] of [['/llms/coupons', '/api/crawl/coupons'], ['/llms/return-policies', '/api/crawl/return-policies']]) {
    const ra = await g.call(a);
    const rb = await g.call(b);
    assert.equal(ra.status, 200, a);
    const ja = JSON.parse(ra.text);
    const jb = JSON.parse(rb.text);
    delete ja.updated_at;
    delete jb.updated_at;
    assert.deepEqual(ja, jb, `${a} mirrors ${b}`);
  }
});

t.finish();
