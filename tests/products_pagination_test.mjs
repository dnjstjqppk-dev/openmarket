// tests/products_pagination_test.mjs
// Focused regression suite for GET /api/v1/products offset pagination
// (routes/catalog.js): page/per_page contract, legacy `limit` alias,
// disjoint pages, filtered totals, and invalid-value fallbacks.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Catalog Products Pagination');

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox'
    }
  });
}

await t.test('1. page/per_page contract with total and total_pages', async () => {
  const g = await newGateway();
  const r = await g.call('/api/v1/products?per_page=2&page=1');
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  const p = r.json.pagination;
  assert.equal(p.page, 1);
  assert.equal(p.per_page, 2);
  assert.ok(Number.isInteger(p.total) && p.total >= 0);
  assert.equal(p.total_pages, Math.max(1, Math.ceil(p.total / 2)));
  assert.equal(r.json.count, r.json.data.length);
  assert.ok(r.json.data.length <= 2);
  // The reported total matches the real ACTIVE count in D1.
  const real = g.db.prepare("SELECT COUNT(*) AS c FROM products WHERE status = 'ACTIVE'").get().c;
  assert.equal(p.total, real);
});

await t.test('2. consecutive pages are disjoint and stable', async () => {
  const g = await newGateway();
  const first = await g.call('/api/v1/products?per_page=2&page=1&sort=newest');
  const total = first.json.pagination.total;
  if (total <= 2) return; // not enough rows to page; contract already proven above
  const second = await g.call('/api/v1/products?per_page=2&page=2&sort=newest');
  assert.equal(second.status, 200);
  assert.equal(second.json.pagination.total, total);
  const a = first.json.data.map((r) => r.id);
  const b = second.json.data.map((r) => r.id);
  assert.equal(new Set([...a, ...b]).size, a.length + b.length, 'pages must not overlap');
  const again = await g.call('/api/v1/products?per_page=2&page=1&sort=newest');
  assert.deepEqual(again.json.data.map((r) => r.id), a, 'same page must be stable');
});

await t.test('3. legacy limit alias and invalid values fall back safely', async () => {
  const g = await newGateway();
  const legacy = await g.call('/api/v1/products?limit=1');
  assert.equal(legacy.status, 200);
  assert.equal(legacy.json.pagination.per_page, 1);
  assert.ok(legacy.json.data.length <= 1);

  const invalid = await g.call('/api/v1/products?page=abc&per_page=xx&min_price=xx&max_price=yy');
  assert.equal(invalid.status, 200, 'invalid numerics must not 500');
  assert.equal(invalid.json.pagination.page, 1);
  assert.equal(invalid.json.pagination.per_page, 100);
  const clampedLow = await g.call('/api/v1/products?per_page=-5');
  assert.equal(clampedLow.json.pagination.per_page, 1);
  const clampedHigh = await g.call('/api/v1/products?per_page=9999');
  assert.equal(clampedHigh.json.pagination.per_page, 200);
});

await t.test('4. filtered total never exceeds the unfiltered total', async () => {
  const g = await newGateway();
  const all = await g.call('/api/v1/products?per_page=1');
  const cat = g.db.prepare('SELECT slug FROM categories WHERE is_active = 1 LIMIT 1').get();
  if (!cat) return;
  const filtered = await g.call(`/api/v1/products?per_page=1&category=${encodeURIComponent(cat.slug)}`);
  assert.equal(filtered.status, 200);
  assert.ok(filtered.json.pagination.total <= all.json.pagination.total);
});

t.finish();
