// tests/channels_live_audit_6_0_test.mjs
// Phase 6 task 6-0: audit of the 48360ae live bridge (partner-live.js +
// multichannel.js delegation). Proves, attack-style:
//   1. partner A can never touch partner B's channel credentials, products,
//      channel orders or PO/fulfillment flows (live path included);
//   2. production without keys answers 501 CONNECTOR_NOT_INTEGRATED and
//      persists nothing (never SANDBOX_STUB / fake success);
//   3. incomplete credentials fail honest 400/409 (never success);
//   4. forged platform rows are skipped, never imported as 0-won orders.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { signJwt } from '../apps/cloudflare-gateway/src/utils/crypto-auth.js';

const t = createRunner('Channels live-bridge audit (6-0)');

const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase(), headers: init.headers || {}, body: init.body });
    return handler(String(url), init);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const DEV_ENV = {
  JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
  ENVIRONMENT: 'development',
  CONNECTOR_SIMULATION: 'true',
  PAYMENT_MODE: 'sandbox'
};

const PROD_ENV = {
  JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
  ENVIRONMENT: 'production',
  TOTP_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
  PAYMENT_MODE: 'sandbox',
  ADMIN_2FA_REQUIRED: 'false',
  RATE_LIMIT_REQUIRED: 'false'
};

async function partnerLogin(g, email) {
  const r = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email, password: 'DevPass!2026#', role: 'PARTNER' }
  });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

async function prodPartnerToken(g, env, email) {
  const u = g.db.prepare('SELECT u.id, u.token_version, p.id AS pid FROM users u JOIN partners p ON p.owner_user_id = u.id WHERE u.email = ?').get(email);
  assert.ok(u, `seed partner for ${email}`);
  return signJwt({ sub: u.id, role: 'ROLE_PARTNER', tv: u.token_version || 0, pid: u.pid }, env.JWT_SECRET, 3600);
}

function partnerIdOf(g, email) {
  return g.db.prepare('SELECT p.id AS pid FROM users u JOIN partners p ON p.owner_user_id = u.id WHERE u.email = ?').get(email).pid;
}

async function saveCreds(g, token, body) {
  const r = await g.call('/api/v1/channels/credentials', { method: 'POST', token, body });
  assert.equal(r.status, 201, r.text);
  const list = await g.call('/api/v1/channels/credentials', { token });
  const row = list.json.data.find((c) => c.platform_id === body.platform_id && Boolean(c.is_sandbox) === Boolean(body.is_sandbox));
  assert.ok(row, 'saved credential listed');
  return row;
}

function enableFlags(g, keys) {
  for (const k of keys) g.db.prepare('UPDATE feature_flags SET is_enabled = 1 WHERE key = ?').run(k);
}

function ensureChannel(g, platformId, code) {
  let sc = g.db.prepare('SELECT * FROM sales_channels WHERE platform_id = ? AND is_active = 1 LIMIT 1').get(platformId);
  if (!sc) {
    const id = `sc_60_${platformId}`;
    g.db.prepare(`INSERT INTO sales_channels (id, platform_id, channel_code, channel_name, currency, commission_bps, is_active)
      VALUES (?, ?, ?, ?, 'KRW', 600, 1)`).run(id, platformId, code, `${code} test channel`);
    sc = g.db.prepare('SELECT * FROM sales_channels WHERE id = ?').get(id);
  }
  return sc;
}

const A_EMAIL = 'seller@temu-supply.com';
const B_EMAIL = 'partner2@olmoa-tech.com';

// 6-0.1: cross-partner isolation across every channel surface.
await t.test('6-0.1 partner A cannot touch partner B credentials, products, orders or PO', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: DEV_ENV });
  const at = await partnerLogin(g, A_EMAIL);
  const bt = await partnerLogin(g, B_EMAIL);
  const aid = partnerIdOf(g, A_EMAIL);
  const bid = partnerIdOf(g, B_EMAIL);
  assert.notEqual(aid, bid, 'two distinct seed partners');
  enableFlags(g, ['marketplace_order_sync', 'marketplace_listing_publish', 'fulfillment_3pl', 'supplier_order_manual']);

  // A. B's stored credential is invisible to A (verify -> 404, list excludes).
  const bCred = await saveCreds(g, bt, {
    platform_id: 'naver_smartstore', credential_name: 'B live', api_key: 'b-client', secret_key: 'b-secret'
  });
  const aVerifyB = await g.call(`/api/v1/channels/credentials/${bCred.id}/verify`, { method: 'POST', token: at });
  assert.equal(aVerifyB.status, 404);
  const aCreds = await g.call('/api/v1/channels/credentials', { token: at });
  assert.ok(aCreds.json.data.every((c) => c.id !== bCred.id), 'A list carries no B credential');

  // B. A cannot publish B's product (404, nothing persisted).
  let bProd = g.db.prepare("SELECT * FROM products WHERE partner_id = ? AND status = 'ACTIVE' LIMIT 1").get(bid);
  if (!bProd) {
    bProd = g.db.prepare('SELECT * FROM products WHERE partner_id = ? LIMIT 1').get(bid);
    assert.ok(bProd, 'seed has a B product');
    g.db.prepare("UPDATE products SET status = 'ACTIVE' WHERE id = ?").run(bProd.id);
    bProd = g.db.prepare('SELECT * FROM products WHERE id = ?').get(bProd.id);
  }
  const beforePub = g.db.prepare('SELECT COUNT(*) AS c FROM channel_listings').get().c;
  const aPubB = await g.call('/api/v1/channels/listings/publish', {
    method: 'POST', token: at, body: { sales_channel_id: 'sc_coupang_wing', product_id: bProd.id }
  });
  assert.equal(aPubB.status, 404);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM channel_listings').get().c, beforePub);

  // C. Sync imports carry the caller's partner id only; lists never cross.
  const aSync = await g.call('/api/v1/channels/orders/sync', { method: 'POST', token: at, body: { sales_channel_id: 'sc_coupang_wing' } });
  assert.equal(aSync.status, 200, aSync.text);
  const bListAfterA = await g.call('/api/v1/channels/orders', { token: bt });
  assert.equal(bListAfterA.json.data.length, 0, 'B sees none of A synced rows');
  const bSync = await g.call('/api/v1/channels/orders/sync', { method: 'POST', token: bt, body: { sales_channel_id: 'sc_coupang_wing' } });
  assert.equal(bSync.status, 200, bSync.text);
  for (const row of g.db.prepare('SELECT partner_id, sales_channel_id FROM channel_orders').all()) {
    assert.ok([aid, bid].includes(row.partner_id), 'every synced row belongs to its caller');
  }
  const aList = await g.call('/api/v1/channels/orders', { token: at });
  const bList = await g.call('/api/v1/channels/orders', { token: bt });
  const aIds = new Set(aList.json.data.map((o) => o.id));
  for (const o of bList.json.data) assert.ok(!aIds.has(o.id), 'lists never share a row');

  // D. A cannot dispatch-po or fulfill B's channel order (404 either way).
  const bOrder = g.db.prepare('SELECT * FROM channel_orders WHERE partner_id = ? LIMIT 1').get(bid);
  if (bOrder) {
    const aPo = await g.call(`/api/v1/channels/orders/${bOrder.id}/dispatch-po`, {
      method: 'POST', token: at, body: { supplier_id: 'domeggook_domeme', total_cost_krw: 12000 }
    });
    assert.equal(aPo.status, 404);
    const aFul = await g.call(`/api/v1/channels/orders/${bOrder.id}/fulfill`, {
      method: 'POST', token: at, body: { carrier_code: 'CJ_LOGISTICS', tracking_number: '682910482012' }
    });
    assert.equal(aFul.status, 404);
    assert.equal(g.db.prepare('SELECT order_status FROM channel_orders WHERE id = ?').get(bOrder.id).order_status, bOrder.order_status);
  }
});

// 6-0.2: the live path uses only the caller's keys (B's keys never serve A).
await t.test('6-0.2 production live path stays credential-scoped: A without keys gets 501', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: PROD_ENV });
  const at = await prodPartnerToken(g, PROD_ENV, A_EMAIL);
  const bt = await prodPartnerToken(g, PROD_ENV, B_EMAIL);
  enableFlags(g, ['marketplace_order_sync', 'marketplace_listing_publish']);
  await saveCreds(g, bt, {
    platform_id: 'coupang_wing', credential_name: 'B live', api_key: 'b-ak', secret_key: 'b-sk', seller_account_id: 'VB'
  });

  // A has no credential: 501 + nothing persisted, even though B is live-wired.
  const f = stubFetch(async () => { throw new Error('A must never reach the platform'); });
  try {
    const aSync = await g.call('/api/v1/channels/orders/sync', { method: 'POST', token: at, body: { sales_channel_id: 'sc_coupang_wing' } });
    assert.equal(aSync.status, 501);
    assert.equal(aSync.json.code, 'CONNECTOR_NOT_INTEGRATED');
    const aPub = await g.call('/api/v1/channels/listings/publish', { method: 'POST', token: at, body: { sales_channel_id: 'sc_coupang_wing', product_id: 'prod_001' } });
    assert.equal(aPub.status, 501);
    assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM channel_orders').get().c, 0);
    assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM channel_listings').get().c, 0);
    assert.equal(f.calls.length, 0, 'no platform call without the caller keys');
  } finally { f.restore(); }

  // B with real keys still takes the live path (empty platform stays empty).
  const f2 = stubFetch(async (url) => {
    assert.ok(url.includes('/marketplace/orders'), `polls orders: ${url}`);
    assert.ok(url.includes('vendorId=VB'), 'scoped to B vendor id');
    return J({ data: [] });
  });
  try {
    const bSync = await g.call('/api/v1/channels/orders/sync', { method: 'POST', token: bt, body: { sales_channel_id: 'sc_coupang_wing' } });
    assert.equal(bSync.status, 200, bSync.text);
    assert.equal(bSync.json.simulated, false);
  } finally { f2.restore(); }
});

// 6-0.3: production without keys is 501 everywhere, never simulated success.
await t.test('6-0.3 production without keys: 501 + persist nothing on every action', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: PROD_ENV });
  const at = await prodPartnerToken(g, PROD_ENV, A_EMAIL);
  const aid = partnerIdOf(g, A_EMAIL);
  enableFlags(g, ['marketplace_order_sync', 'marketplace_listing_publish', 'fulfillment_3pl']);
  g.db.prepare(`INSERT INTO channel_orders (id, sales_channel_id, partner_id, external_order_id, external_order_no,
      buyer_name, recipient_name, shipping_address, total_order_amount, order_status)
    VALUES ('cord_60_no_key', 'sc_coupang_wing', ?, 'CPG-NO_KEY', 'no-1', 'B', 'R', 'Seoul', 10000, 'COLLECTED')`).run(aid);

  const f = stubFetch(async () => { throw new Error('no platform call without keys'); });
  try {
    const sync = await g.call('/api/v1/channels/orders/sync', { method: 'POST', token: at, body: { sales_channel_id: 'sc_coupang_wing' } });
    assert.equal(sync.status, 501);
    assert.equal(sync.json.code, 'CONNECTOR_NOT_INTEGRATED');
    const pub = await g.call('/api/v1/channels/listings/publish', { method: 'POST', token: at, body: { sales_channel_id: 'sc_coupang_wing', product_id: 'prod_001' } });
    assert.equal(pub.status, 501);
    const ful = await g.call('/api/v1/channels/orders/cord_60_no_key/fulfill', {
      method: 'POST', token: at, body: { carrier_code: 'CJ_LOGISTICS', tracking_number: '682910482012' }
    });
    assert.equal(ful.status, 501);
    for (const r of [sync, pub, ful]) {
      assert.notEqual(r.json.simulated, true, 'production never reports simulated success');
    }
    assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM channel_listings').get().c, 0);
    assert.equal(g.db.prepare("SELECT COUNT(*) AS c FROM channel_orders WHERE id != 'cord_60_no_key'").get().c, 0);
    assert.equal(g.db.prepare("SELECT order_status FROM channel_orders WHERE id = 'cord_60_no_key'").get().order_status, 'COLLECTED');
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }

  // A non-delegated platform stays 501 in production even WITH real keys.
  await saveCreds(g, at, { platform_id: 'eleven_street', credential_name: '11st keys', api_key: 'k', secret_key: 's' });
  const sc11 = ensureChannel(g, 'eleven_street', 'ELEVEN_TEST');
  const f2 = stubFetch(async () => { throw new Error('stub platform must never fetch'); });
  try {
    const r = await g.call('/api/v1/channels/orders/sync', { method: 'POST', token: at, body: { sales_channel_id: sc11.id } });
    assert.equal(r.status, 501);
    assert.equal(r.json.code, 'CONNECTOR_NOT_INTEGRATED');
    assert.equal(f2.calls.length, 0);
  } finally { f2.restore(); }
});

// 6-0.4: incomplete credentials fail honest 400/409 and persist nothing.
await t.test('6-0.4 incomplete credentials fail closed with named fields, never success', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: DEV_ENV });
  const at = await partnerLogin(g, A_EMAIL);
  enableFlags(g, ['marketplace_listing_publish']);

  // A. Coupang without a vendor id: VALIDATION_ERROR naming vendor_id, no fetch.
  await saveCreds(g, at, {
    platform_id: 'coupang_wing', credential_name: 'no vendor', api_key: 'ak', secret_key: 'sk', seller_account_id: ''
  });
  const before = g.db.prepare('SELECT COUNT(*) AS c FROM channel_listings').get().c;
  const f1 = stubFetch(async () => { throw new Error('invalid payload must never fetch'); });
  try {
    const r = await g.call('/api/v1/channels/listings/publish', {
      method: 'POST', token: at,
      body: {
        sales_channel_id: 'sc_coupang_wing', product_id: 'prod_001', sale_price: 18900,
        brand: 'RouteBrand', delivery_company: 'CJGLS', external_category_id: '101',
        delivery_fee_type: 'CHARGE', delivery_fee: 3000
      }
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'VALIDATION_ERROR');
    assert.ok(r.json.error.includes('vendor_id'), 'missing field is named');
    assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM channel_listings').get().c, before);
    assert.equal(f1.calls.length, 0);
  } finally { f1.restore(); }

  // B. Naver without a secret: CREDENTIAL_INCOMPLETE naming the blank field.
  await saveCreds(g, at, {
    platform_id: 'naver_smartstore', credential_name: 'no secret', api_key: 'cid-only', secret_key: ''
  });
  const sc = ensureChannel(g, 'naver_smartstore', 'NAVER_TEST');
  const f2 = stubFetch(async () => { throw new Error('missing secret must never fetch'); });
  try {
    const r = await g.call('/api/v1/channels/listings/publish', {
      method: 'POST', token: at,
      body: {
        sales_channel_id: sc.id, product_id: 'prod_001', sale_price: 18900,
        brand: 'RouteBrand', as_phone: '010-2222-3333', delivery_company: 'CJGLS',
        external_category_id: '50000803', delivery_fee_type: 'CHARGE', delivery_fee: 3000
      }
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'CREDENTIAL_INCOMPLETE');
    assert.ok(r.json.error.includes('Client Secret'), `blank field is named: ${r.json.error}`);
    assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM channel_listings').get().c, before);
    assert.equal(f2.calls.length, 0);
  } finally { f2.restore(); }
});

// 6-0.5: forged platform rows are skipped, never imported as 0-won orders.
await t.test('6-0.5 sync skips rows with missing ids and invalid totals', async () => {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: DEV_ENV });
  const at = await partnerLogin(g, A_EMAIL);
  enableFlags(g, ['marketplace_order_sync']);
  await saveCreds(g, at, {
    platform_id: 'naver_smartstore', credential_name: 'live', api_key: 'cid', secret_key: 'csec'
  });
  const sc = ensureChannel(g, 'naver_smartstore', 'NAVER_TEST');
  const f = stubFetch(async (url) => {
    if (url.includes('/oauth2/token')) return J({ access_token: 'tok', expires_in: 1 });
    if (url.includes('/orders/paid')) {
      return J({ orders: [
        {
          orderId: 'NVR-OK-1', orderNo: '2026-0001', totalAmount: 15000,
          buyerName: 'B', recipientName: 'R', shippingAddress: 'Seoul',
          items: [{ product_title: 'T', quantity: 1, unit_price: 15000 }]
        },
        // forged: complete-looking row but no total -> must be skipped
        { orderId: 'NVR-NO_TOTAL', orderNo: '2026-0002', buyerName: 'B', recipientName: 'R', shippingAddress: 'Seoul' },
        // forged: no order id at all -> must be dropped
        { buyerName: 'B', recipientName: 'R', shippingAddress: 'Seoul', totalAmount: 5000 }
      ] });
    }
    throw new Error(`unexpected live URL: ${url}`);
  });
  try {
    const r = await g.call('/api/v1/channels/orders/sync', { method: 'POST', token: at, body: { sales_channel_id: sc.id } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.simulated, false);
    assert.equal(r.json.imported_orders_count, 1);
    assert.ok(r.json.message.includes('불완전 행 2건 제외'), `skip note counts both: ${r.json.message}`);
    const rows = g.db.prepare('SELECT external_order_id, total_order_amount FROM channel_orders').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].external_order_id, 'NVR-OK-1');
    assert.equal(rows[0].total_order_amount, 15000);
  } finally { f.restore(); }
});

t.finish();
