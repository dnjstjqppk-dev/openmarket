// tests/api_plp_filters_test.mjs
// Work order 3-2: PLP server filters (sale, domestic, multi category/model).
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('PLP filters (3-2/3-3)');

async function newGateway({ testNowKst } = {}) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      ...(testNowKst ? { TODAY_SHIP_TEST_NOW_KST: testNowKst } : {})
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
  g.db.prepare("INSERT INTO platform_policies (key, value, effective_from) VALUES ('credit.earn_bps', '100', date('now', '+9 hours'))").run();
  const r2 = await g.call('/api/v1/products?per_page=1');
  assert.equal(r2.json.data[0].earn_bps, '100', 'earn policy surfaces');
});

await t.test('F6. price history reads newest-first per product', async () => {
  const g = await newGateway();
  const sku = g.db.prepare("SELECT id, product_id FROM product_skus WHERE product_id = 'prod_001' LIMIT 1").get();
  g.db.prepare('INSERT INTO sku_price_history (id, sku_id, original_price, sale_price) VALUES (?, ?, ?, ?)')
    .run('ph_f6', sku.id, 129000, 49900);
  const r = await g.call('/api/v1/products/prod_001/price-history');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.data.find((h) => h.sku_id === sku.id && h.original_price === 129000), 'history row served');
  const d = await g.call('/api/v1/products/prod_001');
  assert.ok('earn_bps' in d.json.data, 'detail carries earn_bps');
  const gone = await g.call('/api/v1/products/prod_missing/price-history');
  assert.equal(gone.status, 404, 'unknown product hidden');
});

await t.test('F7. best-coupon search takes explicit cart lines', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'customer@example.com', password: 'DevPass!2026#', role: 'CUSTOMER' }
  });
  const cust = login.json.token;
  const r = await g.call('/api/v1/coupons/best', {
    method: 'POST', token: cust, body: { items: [{ sku_id: 'sku_001_w', quantity: 1 }] }
  });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.data.total_discount >= 0, 'estimate computed over the sent lines');
  const bad = await g.call('/api/v1/coupons/best', {
    method: 'POST', token: cust, body: { items: [{ sku_id: 'sku_missing', quantity: 1 }] }
  });
  assert.equal(bad.status, 400, 'unknown skus rejected, never skipped');
});

// ---- 5-4 today-shipment gate (decision-10 pre-state) -------------------------------------
const tsOf = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
// N days ago at 03:00 UTC == 12:00 KST: paid/shipped pairs built around noon
// can never straddle a KST date boundary, whatever time the suite runs.
const kstNoon = (daysAgo, plusHours = 0) => {
  const d = new Date(Date.now() - daysAgo * 86400000);
  d.setUTCHours(3 + plusHours, 0, 0, 0);
  return tsOf(d);
};

function seedTodayShip(g, { policyBps = null } = {}) {
  const cust = g.db.prepare("SELECT id FROM users WHERE email = 'customer@example.com'").get();
  assert.ok(cust, 'seed customer exists');
  // [suffix, cutoff, hits, misses] — suite time is pinned to KST 10:00 via env.
  const sellers = [
    ['a', '15:00', 9, 1], // pre-cutoff, rate 9000
    ['b', '09:00', 9, 1], // post-cutoff, rate 9000
    ['c', '15:00', 1, 9], // pre-cutoff, rate 1000
    ['d', null, 10, 0], // no cutoff template at all
    ['e', '15:00', 0, 0] // cutoff but zero shipment history
  ];
  for (const [s, cutoff, hits, misses] of sellers) {
    g.db.prepare('INSERT INTO users (id, email, password_hash, full_name, phone, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`u_ts_${s}`, `ts_${s}@example.com`, 'x', 'TS', '010', 'ROLE_PARTNER');
    g.db.prepare(`INSERT INTO partners (id, owner_user_id, business_name, business_reg_number, bank_code, bank_account_number, bank_account_holder, status, country_code, sales_model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`pt_ts_${s}`, `u_ts_${s}`, `TS ${s}`, `900-90-9000${s}`, '004', '1', 'H', 'APPROVED', 'KR', 'MARKETPLACE');
    g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`prod_ts_${s}`, `pt_ts_${s}`, 'cat_e_audio', `TS thing ${s}`, 'https://x/y.png', '<p>t</p>', 10000, 9000, 'ACTIVE', 'APPROVED');
    if (cutoff) {
      g.db.prepare(`INSERT INTO shipping_policies (id, partner_id, name, method, fee_type, today_cutoff, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(`sp_ts_${s}`, `pt_ts_${s}`, 'std', 'PARCEL', 'PAID', cutoff, 1);
    }
    const total = hits + misses;
    for (let i = 0; i < total; i++) {
      const hit = i < hits;
      const paidAt = kstNoon(6 + i, 0);
      const shippedAt = hit ? kstNoon(6 + i, 3) : kstNoon(4 + i, 3);
      g.db.prepare(`INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount,
          payment_status, paid_at, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`o_ts_${s}${i}`, `TS-${s}-${i}`, cust.id, 10000, 0, 0, 10000, 'PAID', paidAt, 'R', '010', 'a1', 'a2', '12345');
      g.db.prepare(`INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, total_amount, status, shipped_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`so_ts_${s}${i}`, `o_ts_${s}${i}`, `TSS-${s}-${i}`, `pt_ts_${s}`, 0, 10000, 10000, 'SHIPPED', shippedAt);
    }
  }
  if (policyBps !== null) {
    g.db.prepare("INSERT INTO platform_policies (key, value, effective_from) VALUES ('badge.today_ship_min_rate_bps', ?, date('now', '+9 hours'))").run(String(policyBps));
  }
}

const byId = (rows, id) => rows.find((p) => p.id === id);

await t.test('F8. no policy: today_shipment ignored and excluded from available filters', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedTodayShip(g);
  const plain = await g.call('/api/v1/products?per_page=200');
  const filt = await g.call('/api/v1/products?today_shipment=1&per_page=200');
  assert.equal(filt.status, 200, filt.text);
  assert.equal(filt.json.pagination.total, plain.json.pagination.total, 'param ignored without policy');
  assert.ok(byId(filt.json.data, 'prod_ts_a'), 'cutoff seller still listed when ignored');
  assert.ok(Array.isArray(filt.json.available_filters), 'response carries available_filters');
  assert.ok(!filt.json.available_filters.includes('today_shipment'), 'chip source hides today_shipment');
});

await t.test('F9. with policy: only pre-cutoff + rate-ok sellers pass', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedTodayShip(g, { policyBps: '8000' });
  const filt = await g.call('/api/v1/products?today_shipment=1&per_page=200');
  assert.equal(filt.status, 200, filt.text);
  const ids = filt.json.data.map((p) => p.id);
  assert.ok(ids.includes('prod_ts_a'), 'pre-cutoff + rate-ok included');
  assert.ok(!ids.includes('prod_ts_b'), 'post-cutoff excluded');
  assert.ok(!ids.includes('prod_ts_c'), 'low-rate excluded');
  assert.ok(!ids.includes('prod_ts_d'), 'no-template excluded');
  assert.ok(!ids.includes('prod_ts_e'), 'zero-history excluded');
  assert.ok(filt.json.available_filters.includes('today_shipment'), 'filter advertised with policy');
});

await t.test('F10. has_today gated on policy, not on the clock', async () => {
  const g1 = await newGateway({ testNowKst: '10:00' });
  seedTodayShip(g1);
  const r1 = await g1.call('/api/v1/products?per_page=200');
  for (const id of ['prod_ts_a', 'prod_ts_b', 'prod_ts_c', 'prod_ts_e']) {
    assert.equal(byId(r1.json.data, id).has_today, 0, `${id} badge off without policy`);
  }
  const g2 = await newGateway({ testNowKst: '10:00' });
  seedTodayShip(g2, { policyBps: '8000' });
  const r2 = await g2.call('/api/v1/products?per_page=200');
  assert.equal(byId(r2.json.data, 'prod_ts_a').has_today, 1, 'cutoff template + policy');
  // Post-cutoff sellers keep has_today: the before-cutoff check is the
  // product card's (buyer-local clock vs today_cutoff), not the row flag's.
  assert.equal(byId(r2.json.data, 'prod_ts_b').has_today, 1, 'clock check lives in the card');
  assert.equal(byId(r2.json.data, 'prod_ts_d').has_today, 0, 'no template, no badge');
});

await t.test('F11. invalid policy value fails closed like a missing policy', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedTodayShip(g, { policyBps: 'not-a-number' });
  const plain = await g.call('/api/v1/products?per_page=200');
  const filt = await g.call('/api/v1/products?today_shipment=1&per_page=200');
  assert.equal(filt.json.pagination.total, plain.json.pagination.total, 'garbage policy ignored');
  assert.ok(!filt.json.available_filters.includes('today_shipment'), 'chip hidden on garbage policy');
});

t.finish();
