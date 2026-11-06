// tests/bidding_contract_test.mjs
// Contract suite for the M2C reverse-bidding + MD negotiation surface
// (routes/bidding-m2c.js): the exact paths/fields the partner BiddingView and
// admin SuppliersView consume. Locks P1-13/P2R-04 fixed: no more 404s.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Bidding & Negotiation Contract');

const ENV = {
  JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
  ENVIRONMENT: 'development',
  PAYMENT_MODE: 'sandbox'
};

async function login(g, email, role) {
  const r = await g.call('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password: 'DevPass!2026#', role }
  });
  assert.equal(r.status, 200, `${role} ${email} logs in`);
  return r.json;
}

await t.test('1. campaign create -> bid -> my-bids round-trip', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: ENV });
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');

  const cat = g.db.prepare('SELECT id FROM categories WHERE is_active = 1 LIMIT 1').get();
  const created = await g.call('/api/v1/bidding/campaigns', {
    method: 'POST',
    token: adm.token,
    body: { title: 'contract-test campaign', category_id: cat.id, ceiling_supply_price: 20000, min_moq: 100 }
  });
  assert.equal(created.status, 201);
  const campId = created.json.data.id;

  const list = await g.call('/api/v1/bidding/campaigns?status=ALL', { token: adm.token });
  assert.equal(list.status, 200);
  assert.ok(list.json.data.some((c) => c.id === campId), 'admin sees the campaign');
  assert.ok('ceiling_supply_price' in list.json.data[0]);

  const bid = await g.call(`/api/v1/bidding/campaigns/${campId}/bids`, {
    method: 'POST',
    token: pt.token,
    body: { bid_supply_price: 15000, moq: 200, production_lead_days: 5, bid_notes: 'contract test' }
  });
  assert.equal(bid.status, 201);

  const mine = await g.call('/api/v1/bidding/my-bids', { token: pt.token });
  assert.equal(mine.status, 200);
  const row = mine.json.data.find((b) => b.id === bid.json.data.id);
  assert.ok(row, 'my-bids contains the submitted bid');
  assert.equal(row.bid_supply_price, 15000);
  assert.equal(row.moq, 200);
  assert.equal(row.production_lead_days, 5);
  assert.equal(row.campaign_title, 'contract-test campaign');
  assert.equal(row.status, 'SUBMITTED');

  assert.equal((await g.call('/api/v1/bidding/my-bids')).status, 401);
});

await t.test('2. MD negotiation propose -> partner reject round-trip', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: ENV });
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const partnerId = pt.partner.id;

  const prod = g.db.prepare('SELECT id, lowest_sale_price FROM products WHERE partner_id = ? LIMIT 1').get(partnerId);
  assert.ok(prod, 'seed partner owns a product');
  const target = Math.max(100, prod.lowest_sale_price - 1000);

  const proposed = await g.call('/api/v1/admin/pricing/negotiations', {
    method: 'POST',
    token: adm.token,
    body: { product_id: prod.id, suggested_target_price: target, md_proposal_notes: 'contract test round' }
  });
  assert.equal(proposed.status, 201);

  const list = await g.call('/api/v1/pricing/negotiations', { token: pt.token });
  assert.equal(list.status, 200);
  const row = list.json.data.find((n) => n.id === proposed.json.data.id);
  assert.ok(row, 'partner sees the proposal');
  assert.equal(row.current_sale_price, prod.lowest_sale_price);
  assert.equal(row.suggested_target_price, target);
  assert.equal(row.status, 'PROPOSED');

  const rejected = await g.call(`/api/v1/partner/pricing/negotiations/${row.id}/respond`, {
    method: 'POST',
    token: pt.token,
    body: { accept: false, partner_response_notes: '[역제안 희망가 19000원] 원자재 상승' }
  });
  assert.equal(rejected.status, 200);
  const again = await g.call(`/api/v1/partner/pricing/negotiations/${row.id}/respond`, {
    method: 'POST',
    token: pt.token,
    body: { accept: true }
  });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'ALREADY_RESOLVED');
});

await t.test('3. legacy wrong paths stay 404 (contract locked)', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: ENV });
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  assert.equal((await g.call('/api/v1/bidding/negotiations', { token: pt.token })).status, 404);
  assert.equal((await g.call('/api/v1/admin/bidding/campaigns', { token: adm.token })).status, 404);
});

t.finish();
