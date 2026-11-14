// tests/api_plp_filters_test.mjs
// Work order 3-2: PLP server filters (sale, domestic, multi category/model).
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('PLP filters (3-2/3-3)');

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

await t.test('F1. sale filter keeps only discounted rows', async () => {
  const g = await newGateway();
  const r = await g.call('/api/v1/products?has_discount=1&per_page=100');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.data.length > 0, 'seed has discounted rows');
  assert.ok(r.json.data.every((p) => p.lowest_sale_price < p.lowest_original_price), 'all discounted');
});

await t.test('F2. domestic filter drops overseas sellers', async () => {
  const g = await newGateway();
  g.db.prepare("INSERT INTO users (id, email, password_hash, full_name, phone, role) VALUES ('u_us1', 'us1@example.com', 'x', 'U', '010', 'ROLE_PARTNER')").run();
  g.db.prepare("INSERT INTO partners (id, owner_user_id, business_name, business_reg_number, bank_code, bank_account_number, bank_account_holder, status, country_code, sales_model) VALUES ('pt_us1', 'u_us1', 'US Goods', '999-99-99999', '004', '1', 'H', 'APPROVED', 'US', 'MARKETPLACE')").run();
  g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status)
    VALUES ('prod_us1', 'pt_us1', 'cat_e_audio', 'US thing', 'https://x/y.png', '<p>t</p>', 10000, 9000, 'ACTIVE', 'APPROVED')`).run();
  const all = await g.call('/api/v1/products?per_page=100');
  assert.ok(all.json.data.find((p) => p.id === 'prod_us1'), 'overseas row present unfiltered');
  const dom = await g.call('/api/v1/products?exclude_overseas=1&per_page=100');
  assert.ok(!dom.json.data.find((p) => p.id === 'prod_us1'), 'overseas row excluded');
});

await t.test('F3. category and seller filters take comma lists', async () => {
  const g = await newGateway();
  const one = await g.call('/api/v1/products?category=cat_e_audio&per_page=100');
  const two = await g.call('/api/v1/products?category=cat_e_audio,cat_f_audio&per_page=100');
  assert.equal(two.status, 200, two.text);
  assert.ok(two.json.pagination.total >= one.json.pagination.total, 'union covers the single');
  const both = await g.call('/api/v1/products?sales_model=DIRECT,MARKETPLACE&per_page=1');
  const none = await g.call('/api/v1/products?per_page=1');
  assert.equal(both.json.pagination.total, none.json.pagination.total, 'both models = unfiltered');
  const bad = await g.call('/api/v1/products?sales_model=BOGUS');
  assert.equal(bad.status, 400, 'garbage still rejected');
});

await t.test('F4. facets follow the new filters', async () => {
  const g = await newGateway();
  const r = await g.call('/api/v1/products/facets?has_discount=1');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.data.brands.length >= 0, 'facets respond under filters');
  assert.ok(Number(r.json.data.badges.sale) > 0, 'sale badge counted');
});

await t.test('F5. list rows carry card badge facts', async () => {
  const g = await newGateway();
  const r = await g.call('/api/v1/products?per_page=5');
  assert.equal(r.status, 200, r.text);
  const p = r.json.data[0];
  for (const k of ['sales_model', 'in_stock', 'has_today', 'has_coupon', 'earn_bps', 'sales_30d', 'badges']) {
    assert.ok(k in p, `row carries ${k}`);
  }
  assert.equal(p.earn_bps, null, 'no earn policy in seed');
  g.db.prepare("INSERT INTO platform_policies (key, value, effective_from) VALUES ('credit.earn_bps', '100', date('now'))").run();
  const r2 = await g.call('/api/v1/products?per_page=1');
  assert.equal(r2.json.data[0].earn_bps, '100', 'earn policy surfaces');
});

t.finish();
