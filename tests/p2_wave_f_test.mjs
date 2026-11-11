// tests/p2_wave_f_test.mjs
// Wave F gateway legs: P2-S12 phone backstop, P2-A01 user search,
// P2-A02 banner image requirement.
// Run: node tests/p2_wave_f_test.mjs

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = {
  JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox',
  PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef',
  CARRIER_WEBHOOK_SECRET: 'carrier-secret-0123456789ab'
};
const ADDR = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };

async function boot(env = {}) {
  const g = await createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, login };
}

const t = createRunner('P2 Wave F gateway legs');

await t.test('F-S12 server rejects non-numeric recipient phones', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const sku = g.db.prepare("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 5 LIMIT 1").get();
  for (const badPhone of ['+++++++++', 'abc-def-ghij', '12345', '010-1234-56789012345']) {
    const r = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust,
      body: { ...ADDR, recipient_phone: badPhone, items: [{ sku_id: sku.id, quantity: 1 }] } });
    assert.equal(r.status, 400, `${badPhone}: ${r.text}`);
    assert.equal(r.json.code, 'INVALID_PHONE');
  }
  const ok = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust,
    body: { ...ADDR, recipient_phone: '02-123-4567', items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(ok.status, 201, ok.text);
});

await t.test('F-A01 admin user search narrows by id or email prefix', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const all = await g.call('/api/v1/admin/users', { token: adm });
  assert.equal(all.status, 200, all.text);
  assert.ok(all.json.count >= 3, 'bare call keeps the latest-100 list');
  const one = await g.call('/api/v1/admin/users?q=customer@example.com', { token: adm });
  assert.equal(one.status, 200, one.text);
  assert.equal(one.json.count, 1);
  assert.equal(one.json.data[0].email, 'customer@example.com');
  const none = await g.call('/api/v1/admin/users?q=nobody-at-all-%', { token: adm });
  assert.equal(none.json.count, 0, 'LIKE metacharacters are escaped, not wildcards');
});

await t.test('F-A02 banner create requires an explicit image URL', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const r = await g.call('/api/v1/admin/banners', { method: 'POST', token: adm, body: { title: 'No image' } });
  assert.equal(r.status, 400, r.text);
  const ok = await g.call('/api/v1/admin/banners', { method: 'POST', token: adm,
    body: { title: 'Has image', image_url: 'https://cdn.example.com/b.jpg', link_url: '/deals' } });
  assert.equal(ok.status, 201, ok.text);
});

t.finish();
