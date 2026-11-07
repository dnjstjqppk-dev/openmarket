// tests/partner_product_fields_test.mjs
// Seller registration/edit round-trips custody_type, supply_price and brand
// instead of silently dropping them; profile business_name stays locked.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Partner Product Fields');

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

async function partnerToken(g) {
  const r = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'seller@temu-supply.com', password: 'DevPass!2026#', role: 'PARTNER' }
  });
  assert.equal(r.status, 200);
  return r.json.token;
}

const BASE = {
  title: '필드 라운드트립 상품',
  sale_price: 25000,
  original_price: 30000,
  stock_quantity: 10,
  category_slug: 'womens-clothing',
  thumbnail_url: 'https://cdn.example/f.png'
};

await t.test('1. create stores custody, supply price and brand', async () => {
  const g = await newGateway();
  const token = await partnerToken(g);
  const r = await g.call('/api/v1/partner/products', {
    method: 'POST', token,
    body: { ...BASE, custody_type: 'FULL_MANAGED', supply_price: 12000, brand: 'Acme' }
  });
  assert.equal(r.status, 201);
  const row = g.db.prepare('SELECT custody_type, supply_price, brand FROM products WHERE id = ?').get(r.json.product_id);
  assert.deepEqual([row.custody_type, row.supply_price, row.brand], ['FULL_MANAGED', 12000, 'Acme']);

  const badCustody = await g.call('/api/v1/partner/products', { method: 'POST', token, body: { ...BASE, title: 'x1', custody_type: 'CHAOS' } });
  assert.equal(badCustody.status, 400);
  const badSupply = await g.call('/api/v1/partner/products', { method: 'POST', token, body: { ...BASE, title: 'x2', supply_price: -1 } });
  assert.equal(badSupply.status, 400);
});

await t.test('2. edit updates the same fields; business_name stays locked', async () => {
  const g = await newGateway();
  const token = await partnerToken(g);
  const r = await g.call('/api/v1/partner/products', { method: 'POST', token, body: BASE });
  assert.equal(r.status, 201);
  const u = await g.call(`/api/v1/partner/products/${r.json.product_id}`, {
    method: 'PUT', token, body: { custody_type: 'FULL_MANAGED', supply_price: 9000, brand: 'Acme2' }
  });
  assert.equal(u.status, 200);
  const row = g.db.prepare('SELECT custody_type, supply_price, brand FROM products WHERE id = ?').get(r.json.product_id);
  assert.deepEqual([row.custody_type, row.supply_price, row.brand], ['FULL_MANAGED', 9000, 'Acme2']);
  assert.equal((await g.call(`/api/v1/partner/products/${r.json.product_id}`, { method: 'PUT', token, body: { custody_type: 'NOPE' } })).status, 400);

  const lock = await g.call('/api/v1/partner/profile', { method: 'PUT', token, body: { business_name: '바꾼상호' } });
  assert.equal(lock.status, 409);
  assert.equal(lock.json.code, 'BUSINESS_NAME_LOCKED');
});

t.finish();
