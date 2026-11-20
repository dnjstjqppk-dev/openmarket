// tests/fulfillment_orchestration_test.mjs
// Phase 3 unmanned PO/invoice orchestration: unified channel-order intake,
// PG-webhook mirror, channel polling, auto-PO dispatch, invoice collection
// with channel push-back, and notify hooks. Zero-Mock: without vendor or
// channel keys every worker reports degraded and invents nothing.

import assert from 'node:assert/strict';
import { createDatabase, createD1, createGateway, createRunner } from './lib/harness.mjs';
import '../apps/cloudflare-gateway/src/services/sourcing/domeme-adapter.js';
import '../apps/cloudflare-gateway/src/services/sourcing/ownerclan-adapter.js';
import '../apps/cloudflare-gateway/src/services/sourcing/onchannel-adapter.js';
import '../apps/cloudflare-gateway/src/services/sourcing/cj-adapter.js';
import '../apps/cloudflare-gateway/src/services/channels/smartstore-adapter.js';
import '../apps/cloudflare-gateway/src/services/channels/coupang-adapter.js';
import { normalizeChannelOrder, upsertChannelOrder } from '../apps/cloudflare-gateway/src/services/fulfillment/intake.js';
import { runChannelPoll } from '../apps/cloudflare-gateway/src/services/fulfillment/poll.js';
import { runAutoOrder } from '../apps/cloudflare-gateway/src/services/fulfillment/order.js';
import { runInvoiceSync } from '../apps/cloudflare-gateway/src/services/fulfillment/invoice.js';
import { enqueueNotify, drainNotifyOutbox } from '../apps/cloudflare-gateway/src/services/fulfillment/notify.js';

const t = createRunner('Fulfillment Orchestration');
const PW = 'DevPass!2026#';

function freshEnv() {
  const db = createDatabase();
  return { db, env: { DB: createD1(db) } };
}

async function newGateway(env = {}) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef',
      ...env
    }
  });
}

async function login(g, email, role = 'CUSTOMER') {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

function addIntake(db, o) {
  db.prepare(`INSERT INTO unified_orders (id, channel, external_order_id, status, total_krw, provider, items_json, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(o.id, o.channel || 'smartstore', o.ext || o.id, o.status || 'PAID',
      o.total === undefined ? 15000 : o.total, o.provider === undefined ? null : o.provider,
      JSON.stringify(o.items || []), o.paidAt === undefined ? '2026-11-20 10:00:00' : o.paidAt);
}

await t.test('migration exposes the four fulfillment tables', async () => {
  const { db } = freshEnv();
  for (const tbl of ['unified_orders', 'supplier_pos', 'shipment_trackings', 'notify_outbox']) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tbl);
    assert.ok(row, `${tbl} exists`);
  }
  const v = db.prepare("SELECT version FROM schema_migrations WHERE version = 'd1_73_fulfillment_orchestration.sql'").get();
  assert.ok(v, 'schema ledger carries d1_73');
});

await t.test('intake validates payloads and upserts idempotently', async () => {
  const { db, env } = freshEnv();
  assert.throws(() => normalizeChannelOrder('nope', { externalOrderId: 'A-1', totalKrw: 100 }), /INVALID_CHANNEL_ORDER/);
  assert.throws(() => normalizeChannelOrder('smartstore', { totalKrw: 100 }), /INVALID_CHANNEL_ORDER/);
  assert.throws(() => normalizeChannelOrder('smartstore', { externalOrderId: 'A-1', totalKrw: -5 }), /INVALID_CHANNEL_ORDER/);
  const first = await upsertChannelOrder(env, 'smartstore', { externalOrderId: 'A-1', totalKrw: 12000, paid: true });
  assert.equal(first.created, true);
  const again = await upsertChannelOrder(env, 'smartstore', { externalOrderId: 'A-1', totalKrw: 12000, paid: true });
  assert.equal(again.created, false);
  assert.equal(again.id, first.id);
  const n = db.prepare('SELECT COUNT(*) AS c FROM unified_orders').get().c;
  assert.equal(n, 1);
  assert.equal(db.prepare("SELECT status FROM unified_orders WHERE id = ?").get(first.id).status, 'PAID');
});

await t.test('channel poll fails closed without keys and invents no orders', async () => {
  const { db, env } = freshEnv();
  const r = await runChannelPoll(env, {});
  assert.equal(r.checked, 0);
  assert.equal(r.created, 0);
  assert.equal(r.failed.length, 2);
  assert.deepEqual(r.failed.map((f) => f.code), ['CHANNEL_NOT_CONFIGURED', 'CHANNEL_NOT_CONFIGURED']);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM unified_orders').get().c, 0);
});

await t.test('auto-order drafts POs without vendor keys, never duplicates', async () => {
  const { db, env } = freshEnv();
  addIntake(db, { id: 'co_1', provider: 'domeme' });
  addIntake(db, { id: 'co_2', provider: null });
  const r = await runAutoOrder(env, {});
  assert.equal(r.checked, 2);
  assert.equal(r.sent, 0);
  assert.deepEqual(r.skipped, [{ id: 'co_2', code: 'VENDOR_UNMAPPED' }]);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].code, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(db.prepare("SELECT status FROM supplier_pos WHERE channel_order_id = 'co_1'").get().status, 'DRAFT');
  const rerun = await runAutoOrder(env, {});
  assert.equal(rerun.sent, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM supplier_pos').get().c, 1);
  const notes = db.prepare("SELECT kind FROM notify_outbox WHERE ref_id = 'co_1'").all();
  assert.ok(notes.length >= 1 && notes.every((n) => n.kind === 'PO_FAILED'));
});

await t.test('invoice sync invents no tracking without vendor keys', async () => {
  const { db, env } = freshEnv();
  addIntake(db, { id: 'co_9', provider: 'domeme', status: 'ORDERED' });
  db.prepare(`INSERT INTO supplier_pos (id, channel_order_id, provider, external_po_id, status)
    VALUES ('po_9', 'co_9', 'domeme', 'VPO-1', 'SENT')`).run();
  const r = await runInvoiceSync(env, {});
  assert.equal(r.checked, 1);
  assert.equal(r.shipped, 0);
  assert.equal(r.failed[0].code, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM shipment_trackings').get().c, 0);
  assert.equal(db.prepare("SELECT status FROM unified_orders WHERE id = 'co_9'").get().status, 'ORDERED');
});

await t.test('notify outbox holds without a channel, drains with one', async () => {
  const { env } = freshEnv();
  await enqueueNotify(env, 'PO_SENT', 'po_x', { channel: 'smartstore' });
  const held = await drainNotifyOutbox(env, {});
  assert.equal(held.sent, 0);
  assert.equal(held.channel, false);
  const sent = await drainNotifyOutbox({ DB: env.DB, ALERT_WEBHOOK_URL: 'https://hooks.invalid/x' }, {
    fetchImpl: async () => ({ ok: true })
  });
  assert.equal(sent.sent, 1);
  const again = await drainNotifyOutbox({ DB: env.DB, ALERT_WEBHOOK_URL: 'https://hooks.invalid/x' }, {
    fetchImpl: async () => ({ ok: true })
  });
  assert.equal(again.sent, 0);
});

await t.test('fulfillment routes are admin-guarded and degrade honestly', async () => {
  const g = await newGateway();
  for (const [path, method] of [
    ['/api/v1/admin/channel-orders', 'GET'],
    ['/api/v1/admin/channel-orders/poll', 'POST'],
    ['/api/v1/admin/fulfillment/auto-order/run', 'POST'],
    ['/api/v1/admin/fulfillment/invoices/sync', 'POST'],
    ['/api/v1/admin/fulfillment/outbox', 'GET'],
    ['/api/v1/admin/fulfillment/outbox/drain', 'POST']
  ]) {
    const anon = await g.call(path, { method, body: method === 'POST' ? {} : undefined });
    assert.equal(anon.status, 401, `${method} ${path} guards anonymous`);
  }
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const poll = await g.call('/api/v1/admin/channel-orders/poll', { method: 'POST', token: adm, body: {} });
  assert.equal(poll.status, 200, poll.text);
  assert.equal(poll.json.created, 0);
  assert.equal(poll.json.failed.length, 2);
  const list = await g.call('/api/v1/admin/channel-orders', { token: adm });
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.json.data, []);
  const bad = await g.call('/api/v1/admin/channel-orders/poll', { method: 'POST', token: adm, body: { channel: 'nope' } });
  assert.equal(bad.status, 400);
});

await t.test('sandbox PG webhook mirrors the paid order into the unified intake', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const sku = g.db.prepare(
    `SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.status = 'ACTIVE' AND s.stock_quantity > 0 LIMIT 1`).get().id;
  const chk = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: {
      recipient_name: '홍길동', recipient_phone: '010-1234-5678',
      shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236',
      items: [{ sku_id: sku, quantity: 1 }]
    }
  });
  assert.equal(chk.status, 201, chk.text);
  const orderNo = chk.json.order_no;
  const total = chk.json.total_pay_amount;
  const wh = await g.call('/api/v1/payments/webhook', {
    method: 'POST',
    headers: { 'X-Webhook-Secret': 'wh-secret-0123456789abcdef' },
    body: { eventType: 'PAYMENT_CONFIRMED', data: { paymentKey: 'sb-key-1', orderId: orderNo, totalAmount: total, status: 'DONE' } }
  });
  assert.equal(wh.status, 200, wh.text);
  assert.equal(wh.json.outcome, 'CAPTURED_FROM_WEBHOOK');
  const mirror = g.db.prepare("SELECT status, total_krw FROM unified_orders WHERE channel = 'storefront' AND external_order_id = ?").get(orderNo);
  assert.ok(mirror, 'webhook mirrored into unified_orders');
  assert.equal(mirror.status, 'PAID');
  assert.equal(mirror.total_krw, total);
});

t.finish();
