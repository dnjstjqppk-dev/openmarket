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

await t.test('4. award is guarded: 404s, same-winner replay, no re-award', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: ENV });
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const cat = g.db.prepare('SELECT id FROM categories WHERE is_active = 1 LIMIT 1').get();
  const created = await g.call('/api/v1/bidding/campaigns', {
    method: 'POST', token: adm.token,
    body: { title: 'award-guard campaign', category_id: cat.id, ceiling_supply_price: 20000, min_moq: 100 }
  });
  assert.equal(created.status, 201);
  const campId = created.json.data.id;
  async function bid(price) {
    const r = await g.call(`/api/v1/bidding/campaigns/${campId}/bids`, {
      method: 'POST', token: pt.token, body: { bid_supply_price: price, moq: 200, production_lead_days: 5 }
    });
    assert.equal(r.status, 201);
    return r.json.data.id;
  }
  const bid1 = await bid(15000);
  const bid2 = await bid(14000);

  assert.equal((await g.call('/api/v1/admin/bidding/campaigns/nope/award', { method: 'POST', token: adm.token, body: { winning_bid_id: bid1 } })).status, 404);
  assert.equal((await g.call(`/api/v1/admin/bidding/campaigns/${campId}/award`, { method: 'POST', token: adm.token, body: { winning_bid_id: 'bid_nope' } })).status, 404);

  const first = await g.call(`/api/v1/admin/bidding/campaigns/${campId}/award`, { method: 'POST', token: adm.token, body: { winning_bid_id: bid1 } });
  assert.equal(first.status, 200);
  assert.equal(g.db.prepare('SELECT status FROM bidding_campaigns WHERE id = ?').get(campId).status, 'AWARDED');
  assert.equal(g.db.prepare('SELECT status FROM supplier_bids WHERE id = ?').get(bid1).status, 'WON');
  assert.equal(g.db.prepare('SELECT status FROM supplier_bids WHERE id = ?').get(bid2).status, 'LOST');

  const replay = await g.call(`/api/v1/admin/bidding/campaigns/${campId}/award`, { method: 'POST', token: adm.token, body: { winning_bid_id: bid1 } });
  assert.equal(replay.status, 200);

  const steal = await g.call(`/api/v1/admin/bidding/campaigns/${campId}/award`, { method: 'POST', token: adm.token, body: { winning_bid_id: bid2 } });
  assert.equal(steal.status, 409);
  assert.equal(steal.json.code, 'ALREADY_AWARDED');
  assert.equal(g.db.prepare('SELECT winning_bid_id FROM bidding_campaigns WHERE id = ?').get(campId).winning_bid_id, bid1);
});

await t.test('5. consolidate validates existence, status, tracking and hub', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: ENV });
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const adminId = g.db.prepare("SELECT id FROM users WHERE email = 'admin@openmarket.com'").get().id;
  g.db.prepare(`INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_pay_amount,
    recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code)
    VALUES ('ord_t1', 'O-T1', ?, 10000, 3000, 13000, '김', '010-1', 'A', 'B', '12345')`).run(adminId);
  function sub(id, status) {
    g.db.prepare(`INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, total_amount, status)
      VALUES (?, 'ord_t1', ?, ?, 3000, 10000, 13000, ?)`).run(id, `S-${id}`, pt.partner.id, status);
  }
  sub('so_t1', 'PAYMENT_CONFIRMED');
  sub('so_t2', 'PREPARING');
  sub('so_t3', 'SHIPPED');
  const url = '/api/v1/admin/logistics/consolidate';
  const post = (body) => g.call(url, { method: 'POST', token: adm.token, body });

  const ok = await post({ sub_order_ids: ['so_t1', 'so_t2'], consolidated_tracking_number: 'CN-123456', hub_id: 'HUB_TEST' });
  assert.equal(ok.status, 200);
  for (const id of ['so_t1', 'so_t2']) {
    const row = g.db.prepare('SELECT is_consolidated, consolidation_hub_id, consolidated_tracking_number, consolidation_status FROM sub_orders WHERE id = ?').get(id);
    assert.deepEqual([row.is_consolidated, row.consolidation_hub_id, row.consolidated_tracking_number, row.consolidation_status], [1, 'HUB_TEST', 'CN-123456', 'CONSOLIDATED']);
  }

  assert.equal((await post({ sub_order_ids: ['so_t1'], consolidated_tracking_number: 'CN-1', hub_id: 'H' })).status, 400);
  assert.equal((await post({ sub_order_ids: ['so_t1', 'so_t2'], consolidated_tracking_number: 'x', hub_id: 'H' })).status, 400);
  assert.equal((await post({ sub_order_ids: ['so_t1', 'so_t2'], consolidated_tracking_number: 'CN-123456' })).status, 400);
  assert.equal((await post({ sub_order_ids: ['so_t1', 'so_nope'], consolidated_tracking_number: 'CN-123456', hub_id: 'H' })).status, 404);
  const bad = await post({ sub_order_ids: ['so_t1', 'so_t3'], consolidated_tracking_number: 'CN-123456', hub_id: 'H' });
  assert.equal(bad.status, 409);
  assert.equal(bad.json.code, 'NOT_CONSOLIDATABLE');
  const many = await post({ sub_order_ids: Array.from({ length: 201 }, (_, i) => `so_x${i}`), consolidated_tracking_number: 'CN-123456', hub_id: 'H' });
  assert.equal(many.status, 400);
});

await t.test('3. legacy wrong paths stay 404 (contract locked)', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: ENV });
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  assert.equal((await g.call('/api/v1/bidding/negotiations', { token: pt.token })).status, 404);
  assert.equal((await g.call('/api/v1/admin/bidding/campaigns', { token: adm.token })).status, 404);
});

t.finish();
