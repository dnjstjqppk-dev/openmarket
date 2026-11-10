// tests/p1_phase4_test.mjs
// Phase 4 (Partner P1): T02 shipment carrier required, T06 sku-scoped price,
// T10 settlement-cycle enum, T15 import-job detail, T-N01 payouts/adjustments.
// Run: node tests/p1_phase4_test.mjs

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = { JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox', PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef' };
const ADDR = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };

async function boot(env = {}) {
  const g = await createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, one, login };
}

async function paidSubOrder(g, cust, ptEmail, skuId) {
  const o = (await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: skuId, quantity: 1 }] } })).json;
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const pt = await g.login(ptEmail, 'PARTNER');
  const sub = g.one("SELECT id FROM sub_orders WHERE parent_order_id = ? AND status IN ('PAYMENT_CONFIRMED','PREPARING')", o.order_id);
  assert.ok(sub, 'shippable sub-order exists');
  return { order: o, subId: sub.id, pt };
}

const t = createRunner('P1 partner defects (T02/T06/T10/T15/T-N01)');

await t.test('T02 shipment without carrier is 400, with carrier ships', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const { subId, pt } = await paidSubOrder(g, cust, 'seller@temu-supply.com', 'sku_001_w');
  const noCarrier = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'PUT', token: pt, body: { tracking_number: 'TRK40000001' } });
  assert.equal(noCarrier.status, 400);
  assert.ok(String(noCarrier.json.error).includes('택배사'), noCarrier.text);
  assert.equal(g.one('SELECT status FROM sub_orders WHERE id = ?', subId).status, 'PAYMENT_CONFIRMED');
  const ok = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'TRK40000001' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.carrier, 'CJ대한통운');
  assert.equal(g.one('SELECT status FROM sub_orders WHERE id = ?', subId).status, 'SHIPPED');
  assert.ok(g.one('SELECT id FROM milestone_tracking_logs WHERE sub_order_id = ? AND stage_code = ?', subId, 'SHIPPED'), 'milestone logged');
});

await t.test('T02 bulk shipment reports per-item carrier errors instead of inventing one', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const { subId, pt } = await paidSubOrder(g, cust, 'seller@temu-supply.com', 'sku_001_b');
  const r = await g.call('/api/v1/partner/orders/bulk-shipment', { method: 'PUT', token: pt, body: { shipments: [{ sub_order_id: subId, tracking_number: 'TRK40000002' }] } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.updated_count, 0);
  assert.ok(String(r.json.results[0].error).includes('택배사'), r.text);
  assert.equal(g.one('SELECT status FROM sub_orders WHERE id = ?', subId).status, 'PAYMENT_CONFIRMED');
});

await t.test('T06 sku_id scopes the price move to one SKU and recomputes the floor', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const beforeB = g.one('SELECT sale_price, price_updated_at FROM product_skus WHERE id = ?', 'sku_001_b');
  const r = await g.call('/api/v1/partner/products/prod_001/price', { method: 'PUT', token: pt, body: { sku_id: 'sku_001_w', sale_price: 45000 } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.scope, 'SKU');
  assert.equal(g.one('SELECT sale_price FROM product_skus WHERE id = ?', 'sku_001_w').sale_price, 45000);
  const afterB = g.one('SELECT sale_price, price_updated_at FROM product_skus WHERE id = ?', 'sku_001_b');
  assert.equal(afterB.sale_price, beforeB.sale_price, 'sibling SKU price untouched');
  assert.equal(afterB.price_updated_at, beforeB.price_updated_at, 'sibling SKU 24h clock untouched');
  assert.notEqual(g.one('SELECT price_updated_at c FROM product_skus WHERE id = ?', 'sku_001_w').c, '2000-01-01 00:00:00');
  assert.equal(g.one('SELECT lowest_sale_price FROM products WHERE id = ?', 'prod_001').lowest_sale_price, 45000);
});

await t.test('T06 price without sku_id is an explicit all-SKU bulk set', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const r = await g.call('/api/v1/partner/products/prod_001/price', { method: 'PUT', token: pt, body: { sale_price: 47000 } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.scope, 'ALL_SKUS');
  assert.equal(g.one('SELECT COUNT(*) c FROM product_skus WHERE product_id = ? AND sale_price = 47000', 'prod_001').c, 2);
});

await t.test('T06 foreign sku_id is 404, not a cross-product write', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER'); // pt_001
  const r = await g.call('/api/v1/partner/products/prod_001/price', { method: 'PUT', token: pt, body: { sku_id: 'sku_002_65w', sale_price: 100 } });
  assert.equal(r.status, 404);
  assert.equal(g.one('SELECT sale_price FROM product_skus WHERE id = ?', 'sku_002_65w').sale_price, 24500);
});

await t.test('T10 unknown settlement cycle is 400, BIWEEKLY persists', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  assert.equal((await g.call('/api/v1/partner/profile', { method: 'PUT', token: pt, body: { settlement_cycle: 'DAILY' } })).status, 400);
  assert.equal((await g.call('/api/v1/partner/profile', { method: 'PUT', token: pt, body: { settlement_cycle: 'DAILY' } })).json.code, 'INVALID_CYCLE');
  assert.equal((await g.call('/api/v1/partner/profile', { method: 'PUT', token: pt, body: { settlement_cycle: 'BI_WEEKLY' } })).status, 400);
  const ok = await g.call('/api/v1/partner/profile', { method: 'PUT', token: pt, body: { settlement_cycle: 'BIWEEKLY' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(g.one('SELECT settlement_cycle c FROM partners WHERE id = ?', 'pt_001').c, 'BIWEEKLY');
});

await t.test('T15 import-job detail returns the stored preview; foreign jobs are 404', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const crawl = await g.call('/api/v1/imports/crawl', { method: 'POST', token: pt, body: { url: 'https://supply.example.com/p/1', html_override: '<!DOCTYPE html><html><head><meta property="og:title" content="T15 Probe Mug" /><meta property="og:description" content="probe" /><meta property="og:image" content="https://img.example.com/m.png" /><meta property="product:price:amount" content="12000" /><meta property="product:price:currency" content="KRW" /></head></html>' } });
  assert.equal(crawl.status, 201, crawl.text);
  const jobId = crawl.json.job_id;
  const mine = await g.call(`/api/v1/imports/${jobId}`, { token: pt });
  assert.equal(mine.status, 200, mine.text);
  assert.equal(mine.json.data.preview.product.title, 'T15 Probe Mug');
  assert.ok(mine.json.data.preview.pricing.calculated_sale_price > 0);
  assert.equal((await g.call('/api/v1/imports/imp_nope', { token: pt })).status, 404);
  const pt2 = await g.login('partner2@olmoa-tech.com', 'PARTNER');
  assert.equal((await g.call(`/api/v1/imports/${jobId}`, { token: pt2 })).status, 404);
});

await t.test('M05 cart PUT replaces lines, GET returns live prices; unknown SKU is 400', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const put = await g.call('/api/v1/cart', { method: 'PUT', token: cust, body: { items: [{ sku_id: 'sku_001_w', quantity: 2 }, { sku_id: 'sku_002_65w', quantity: 1 }] } });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.count, 2);
  const get = await g.call('/api/v1/cart', { token: cust });
  assert.equal(get.status, 200, get.text);
  assert.equal(get.json.count, 2);
  const w = get.json.data.find((l) => l.sku_id === 'sku_001_w');
  assert.equal(w.quantity, 2);
  assert.ok(w.title && w.sale_price > 0, 'enriched with live product data');
  const badSku = await g.call('/api/v1/cart', { method: 'PUT', token: cust, body: { items: [{ sku_id: 'sku_nope', quantity: 1 }] } });
  assert.equal(badSku.status, 400);
  assert.equal(badSku.json.code, 'INVALID_SKU');
  assert.equal(badSku.json.sku_id, 'sku_nope');
  const badQty = await g.call('/api/v1/cart', { method: 'PUT', token: cust, body: { items: [{ sku_id: 'sku_001_w', quantity: 0 }] } });
  assert.equal(badQty.status, 400);
  assert.equal((await g.call('/api/v1/cart')).status, 401);
  // Failed writes leave the stored cart untouched (delete-then-insert is atomic per call).
  assert.equal((await g.call('/api/v1/cart', { token: cust })).json.count, 2);
});

await t.test('M05 cart lines are per-customer and cleared by an empty PUT', async () => {
  const g = await boot();
  const a = await g.login('customer@example.com');
  const b = await g.login('alex.kim@olmoa.com');
  await g.call('/api/v1/cart', { method: 'PUT', token: a, body: { items: [{ sku_id: 'sku_001_w', quantity: 1 }] } });
  assert.equal((await g.call('/api/v1/cart', { token: b })).json.count, 0);
  const clear = await g.call('/api/v1/cart', { method: 'PUT', token: a, body: { items: [] } });
  assert.equal(clear.status, 200);
  assert.equal((await g.call('/api/v1/cart', { token: a })).json.count, 0);
});

await t.test('T-N01 settlements payload carries payouts and per-row adjustments', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const r = await g.call('/api/v1/partner/settlements', { token: pt });
  assert.equal(r.status, 200, r.text);
  assert.ok(Array.isArray(r.json.data.payouts), 'payouts array present');
  assert.ok(Array.isArray(r.json.data.settlements), 'settlements array present');
  assert.ok('adjustments' in r.json.data.summary, 'summary.adjustments present');
});

t.finish();
