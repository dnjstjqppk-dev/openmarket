// tests/input_abuse_guards_test.mjs
// Public/machine ingestion endpoints cap and validate their inputs:
// search/log keyword length, milestone-webhook stage allowlist + field caps.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

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

t.finish();
