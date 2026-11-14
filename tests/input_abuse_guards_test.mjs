// tests/input_abuse_guards_test.mjs
// Public/machine ingestion endpoints cap and validate their inputs:
// search/log keyword length, milestone-webhook stage allowlist + field caps.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { classify } from '../apps/cloudflare-gateway/src/lib/ratelimit.js';

const t = createRunner('Input Abuse Guards');

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      CARRIER_WEBHOOK_SECRET: 'test-carrier-secret-abcdef'
    }
  });
}

await t.test('1. search/log caps keyword length', async () => {
  const g = await newGateway();
  assert.equal((await g.call('/api/v1/search/log', { method: 'POST', body: { keyword: '가방' } })).status, 200);
  assert.equal((await g.call('/api/v1/search/log', { method: 'POST', body: {} })).status, 200);
  const over = await g.call('/api/v1/search/log', { method: 'POST', body: { keyword: 'x'.repeat(101) } });
  assert.equal(over.status, 400);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM search_keywords WHERE LENGTH(keyword) > 100').get().c, 0);
});

await t.test('2. milestone webhook enforces stage allowlist and field caps', async () => {
  const g = await newGateway();
  const uid = g.db.prepare("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' LIMIT 1").get().id;
  const pid = g.db.prepare('SELECT id FROM partners LIMIT 1').get().id;
  g.db.prepare(`INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_pay_amount,
    recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code)
    VALUES ('ord_w1', 'O-W1', ?, 10000, 3000, 13000, '김', '010-1', 'A', 'B', '12345')`).run(uid);
  g.db.prepare(`INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, total_amount, status)
    VALUES ('so_w1', 'ord_w1', 'S-W1', ?, 3000, 10000, 13000, 'SHIPPED')`).run(pid);
  const H = { 'X-Carrier-Webhook-Secret': 'test-carrier-secret-abcdef' };
  const post = (body, headers = H) => g.call('/api/v1/logistics/milestone-webhook', { method: 'POST', body, headers });

  assert.equal((await post({ sub_order_id: 'so_w1', stage_code: 'IN_TRANSIT_AIR', location: '인천공항' })).status, 200);
  const row = g.db.prepare('SELECT stage_code, stage_name FROM milestone_tracking_logs WHERE sub_order_id = ?').get('so_w1');
  assert.equal(row.stage_code, 'IN_TRANSIT_AIR');
  assert.equal(row.stage_name, '국제 항공편 운송 중');

  const unknown = await post({ sub_order_id: 'so_w1', stage_code: 'TELEPORTED' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.code, 'UNKNOWN_STAGE');
  assert.equal((await post({ sub_order_id: 'so_w1' })).status, 400);
  assert.equal((await post({ sub_order_id: 'so_w1', stage_code: 'SHIPPED', location: 'x'.repeat(201) })).status, 400);
  assert.equal((await post({ sub_order_id: 'so_w1', stage_code: 'SHIPPED' }, {})).status, 401);
  assert.equal(g.db.prepare("SELECT COUNT(*) AS c FROM milestone_tracking_logs WHERE stage_code = 'TELEPORTED'").get().c, 0);
});

async function partnerToken(g) {
  const r = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'seller@temu-supply.com', password: 'DevPass!2026#', role: 'PARTNER' }
  });
  assert.equal(r.status, 200);
  return r.json.token;
}

await t.test('3. 2-10.2 coupon and payout amounts reject abuse shapes', async () => {
  const g = await newGateway();
  const pt = await partnerToken(g);
  const base = { code: 'ABUSE', title: 't', discount_type: 'FIXED_AMOUNT' };
  for (const v of [-5, 10.5, 'lots', 999999999999]) {
    const r = await g.call('/api/v1/partner/coupons', { method: 'POST', token: pt, body: { ...base, discount_value: v } });
    assert.equal(r.status, 400, `discount ${JSON.stringify(v)} refused`);
  }
  const over = await g.call('/api/v1/partner/payout-requests', {
    method: 'POST', token: pt, headers: { 'X-Idempotency-Key': 'abuse-pay-huge' }, body: { amount: 99999999999999 }
  });
  assert.ok([400, 409].includes(over.status), 'huge payout refused without processing');
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM payout_requests WHERE idempotency_key = ?').get('abuse-pay-huge').n, 0, 'nothing queued');
  const deal = await g.call('/api/v1/partner/flash-sales/fls_today/apply', {
    method: 'POST', token: pt, body: { sku_id: 'sku_001_w', deal_price: -100, allocated_stock: 1 }
  });
  assert.equal(deal.status, 400, 'negative deal refused');
});

await t.test('4. 2-10.2 list-length caps hold on the new bulk endpoints', async () => {
  const g = await newGateway();
  const pt = await partnerToken(g);
  const custLogin = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'customer@example.com', password: 'DevPass!2026#', role: 'CUSTOMER' }
  });
  const cust = custLogin.json.token;
  assert.equal((await g.call('/api/v1/partner/orders/confirm', {
    method: 'PUT', token: pt, body: { sub_order_ids: Array.from({ length: 201 }, (_, i) => `x${i}`) }
  })).status, 400);
  assert.equal((await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt, body: { updates: Array.from({ length: 501 }, (_, i) => ({ product_id: `x${i}` })) }
  })).status, 400);
  assert.equal((await g.call('/api/v1/me/recently-viewed/merge', {
    method: 'POST', token: cust, body: { product_ids: Array.from({ length: 51 }, (_, i) => `p${i}`) }
  })).status, 400);
  assert.equal((await g.call('/api/v1/products?brand=a,b,c,d,e,f,g,h,i,j,k', {})).status, 400);
});

await t.test('5. 2-10.5 claims, votes, reports and follows share RL_WRITE', async () => {
  assert.equal(classify('POST', '/api/v1/coupons/claim'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/reviews/rv_x/helpful'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/reviews/rv_x/report'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/stores/pt_001/follow'), 'RL_WRITE');
  assert.equal(classify('DELETE', '/api/v1/stores/pt_001/follow'), 'RL_WRITE');
  assert.equal(classify('GET', '/api/v1/coupons'), 'RL_API', 'reads stay on the wide bucket');
});

t.finish();
