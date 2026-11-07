// tests/payout_idempotency_test.mjs
// POST /admin/finance/payouts honours X-Idempotency-Key: same key replays the
// identical payload (200 + idempotent_replay) instead of double-paying, and a
// malformed key is rejected. The key stays optional.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Payout Idempotency');

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

async function fixtures(g, tag) {
  const uid = g.db.prepare("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' LIMIT 1").get().id;
  g.db.prepare(`INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_pay_amount,
    recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code)
    VALUES (?, ?, ?, 10000, 3000, 13000, '김', '010-1', 'A', 'B', '12345')`).run(`ord_p${tag}`, `O-P${tag}`, uid);
  g.db.prepare(`INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, total_amount, status)
    VALUES (?, ?, ?, 'pt_001', 3000, 10000, 13000, 'DELIVERED')`).run(`so_p${tag}`, `ord_p${tag}`, `S-P${tag}`);
  g.db.prepare(`INSERT INTO settlements (id, sub_order_id, partner_id, operator_entity_id, gross_amount, shipping_fee,
    commission_rate, commission_amount, net_payout_amount, status)
    VALUES (?, ?, 'pt_001', 'be_dev_sole', 10000, 3000, 0.1, 1000, 12000, 'ELIGIBLE_FOR_PAYOUT')`).run(`stl_p${tag}`, `so_p${tag}`);
}

await t.test('1. same key replays the identical payout, new key sees nothing left', async () => {
  const g = await newGateway();
  await fixtures(g, '1');
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' } });
  const token = login.json.token;
  const post = (key) => g.call('/api/v1/admin/finance/payouts', {
    method: 'POST', token, headers: key ? { 'X-Idempotency-Key': key } : {}, body: { partner_id: 'pt_001' }
  });

  const first = await post('payout-key-0001');
  assert.equal(first.status, 201);
  const replay = await post('payout-key-0001');
  assert.equal(replay.status, 200);
  assert.equal(replay.json.idempotent_replay, true);
  assert.deepEqual(replay.json.data, first.json.data);
  assert.equal(g.db.prepare("SELECT COUNT(*) AS c FROM payouts WHERE partner_id = 'pt_001'").get().c, 1);

  const other = await post('payout-key-0002');
  assert.equal(other.status, 409);
  assert.equal(other.json.code, 'NOTHING_TO_PAY');
});

await t.test('2. malformed key rejected, key optional', async () => {
  const g = await newGateway();
  await fixtures(g, '2');
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' } });
  const token = login.json.token;
  const bad = await g.call('/api/v1/admin/finance/payouts', {
    method: 'POST', token, headers: { 'X-Idempotency-Key': 'x' }, body: { partner_id: 'pt_001' }
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'INVALID_IDEMPOTENCY_KEY');
  const plain = await g.call('/api/v1/admin/finance/payouts', { method: 'POST', token, body: { partner_id: 'pt_001' } });
  assert.equal(plain.status, 201);
  assert.equal(plain.json.idempotent_replay, undefined);
});

t.finish();
