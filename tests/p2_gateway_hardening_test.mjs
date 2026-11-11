// tests/p2_gateway_hardening_test.mjs
// P2 gateway hardening wave A: P2-SEC-03/08/09/11/12/13, P2-P01, P-N02, P-N03, D-N02
// (COMMERCIALIZATION_REMAINING_2026-11-10 + COMMERCIALIZATION_FULL_AUDIT_2026-11-10).
// Run: node tests/p2_gateway_hardening_test.mjs   (requires: node scripts/gen-dev-seed.mjs once)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, createRunner, ROOT } from './lib/harness.mjs';
import * as httpLib from '../apps/cloudflare-gateway/src/lib/http.js';
import * as authLib from '../apps/cloudflare-gateway/src/lib/auth.js';
import * as totpLib from '../apps/cloudflare-gateway/src/lib/totp.js';
import * as privacy from '../apps/cloudflare-gateway/src/services/privacy.js';

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
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, one, login };
}

const t = createRunner('P2 Gateway Hardening (SEC-03/08/09/11/12/13, P01, P-N02/03, D-N02)');

// ---------- P2-SEC-12: HSTS ----------
await t.test('P2-SEC-12 buildCorsHeaders sets Strict-Transport-Security', async () => {
  const req = new Request('https://api.test.local/api/v1/search/autocomplete?q=%EC%9D%B4%EC%96%B4%ED%8F%B0');
  const h = httpLib.buildCorsHeaders(req, { ENVIRONMENT: 'test' });
  assert.ok((h['Strict-Transport-Security'] || '').startsWith('max-age=31536000'), JSON.stringify(h));
});

await t.test('P2-SEC-12 live responses carry the HSTS header', async () => {
  const g = await boot();
  const r = await g.call('/api/v1/search/autocomplete?q=%EC%9D%B4%EC%96%B4%ED%8F%B0');
  assert.equal(r.status, 200, r.text);
  assert.ok((r.headers.get('strict-transport-security') || '').includes('max-age=31536000'));
});

// ---------- P2-SEC-11: machine-secret compare without length oracle ----------
await t.test('P2-SEC-11 wrong-length and wrong-value secrets fail identically, correct passes', async () => {
  const g = await boot();
  const good = BASE_ENV.CARRIER_WEBHOOK_SECRET;
  const mkReq = (v) => new Request('https://api.test.local/api/v1/logistics/milestone-webhook', { headers: v === null ? {} : { 'X-Carrier-Webhook-Secret': v } });
  for (const bad of ['x', good.slice(0, 8), `${good}-tampered`, 'z'.repeat(good.length)]) {
    assert.throws(() => authLib.requireMachineSecret(mkReq(bad), g.env, 'CARRIER_WEBHOOK_SECRET', 'X-Carrier-Webhook-Secret'), (e) => e && e.status === 401 && e.code === 'UNAUTHENTICATED', `secret ${JSON.stringify(bad)}`);
  }
  assert.doesNotThrow(() => authLib.requireMachineSecret(mkReq(good), g.env, 'CARRIER_WEBHOOK_SECRET', 'X-Carrier-Webhook-Secret'));
  const liveBad = await g.call('/api/v1/logistics/milestone-webhook', { method: 'POST', headers: { 'X-Carrier-Webhook-Secret': 'short' }, body: {} });
  assert.equal(liveBad.status, 401, liveBad.text);
  const liveGood = await g.call('/api/v1/logistics/milestone-webhook', { method: 'POST', headers: { 'X-Carrier-Webhook-Secret': good }, body: {} });
  assert.equal(liveGood.status, 400, liveGood.text); // past auth, then body validation
  assert.equal(liveGood.json.code, 'STAGE_REQUIRED');
});

// ---------- P2-SEC-03: capped strict body parsing ----------
await t.test('P2-SEC-03 malformed JSON is rejected with INVALID_JSON (customer route)', async () => {
  const g = await boot();
  const token = await g.login('customer@example.com', 'CUSTOMER');
  const r = await g.call('/api/v1/customs/validate-pccc', { method: 'POST', token, body: '{oops, not json' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'INVALID_JSON');
});

await t.test('P2-SEC-03 oversized body is rejected with PAYLOAD_TOO_LARGE', async () => {
  const g = await boot();
  const token = await g.login('customer@example.com', 'CUSTOMER');
  const big = JSON.stringify({ pccc: 'P123456789012', pad: 'x'.repeat(1_000_001) });
  const r = await g.call('/api/v1/customs/validate-pccc', { method: 'POST', token, body: big });
  assert.equal(r.status, 413, r.text);
  assert.equal(r.json.code, 'PAYLOAD_TOO_LARGE');
});

await t.test('P2-SEC-03 empty body still parses as {} (no regression)', async () => {
  const g = await boot();
  const token = await g.login('customer@example.com', 'CUSTOMER');
  const r = await g.call('/api/v1/customs/validate-pccc', { method: 'POST', token });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'MISSING_PCCC');
});

await t.test('P2-SEC-03 malformed JSON on pre-auth parse fails before auth (reviews POST)', async () => {
  const g = await boot();
  const prod = g.db.prepare('SELECT id FROM products LIMIT 1').get();
  const r = await g.call(`/api/v1/products/${prod.id}/reviews`, { method: 'POST', body: '{oops' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'INVALID_JSON');
});

// ---------- P2-P01 + P-N02: shared idempotency validator ----------
await t.test('P2-P01 shared validator accepts the canonical shape, rejects the rest', async () => {
  assert.equal(typeof httpLib.idempotencyKey, 'function', 'lib/http.js must export idempotencyKey');
  assert.equal(httpLib.idempotencyKey('abcdefgh'), 'abcdefgh');
  assert.equal(httpLib.idempotencyKey('A1._:-x'.padEnd(100, 'z')).length, 100);
  assert.equal(httpLib.idempotencyKey(null), null);
  assert.equal(httpLib.idempotencyKey(undefined), null);
  for (const badKey of ['', 'short', 'x'.repeat(101), 'has space', 'has/slash', '한글키12345678']) {
    assert.throws(() => httpLib.idempotencyKey(badKey), (e) => e && e.status === 400 && e.code === 'INVALID_IDEMPOTENCY_KEY', `key ${JSON.stringify(badKey)}`);
  }
});

await t.test('P-N02 malformed X-Idempotency-Key on sub-cancel is a 400, valid key proceeds', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const sku = g.db.prepare("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get();
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(co.status, 201, co.text);
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: co.json.order_id, payment_key: 'sandbox_p2hardening01', amount: co.json.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const sub = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(co.json.order_id);
  const badKey = await g.call(`/api/v1/orders/${co.json.order_id}/sub-orders/${sub.id}/cancel`, { method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'bad key!!' }, body: {} });
  assert.equal(badKey.status, 400, badKey.text);
  assert.equal(badKey.json.code, 'INVALID_IDEMPOTENCY_KEY');
  const goodKey = await g.call(`/api/v1/orders/${co.json.order_id}/sub-orders/${sub.id}/cancel`, { method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'p2hardening-cancel-01' }, body: {} });
  assert.equal(goodKey.status, 200, goodKey.text);
});

// ---------- P-N03: duty estimate discloses the FX basis ----------
await t.test('P-N03 estimate-duty returns fx_rate, fx_source and fx_as_of', async () => {
  const g = await boot();
  const r = await g.call('/api/v1/customs/estimate-duty', { method: 'POST', body: { goods_amount_krw: 10000, shipping_fee_krw: 3000, country_origin: 'US' } });
  assert.equal(r.status, 200, r.text);
  const d = r.json.data;
  assert.equal(typeof d.fx_rate, 'number');
  assert.ok(d.fx_rate > 0);
  assert.ok(['OPERATOR_TABLE', 'FALLBACK'].includes(d.fx_source), `fx_source=${d.fx_source}`);
  assert.ok('fx_as_of' in d, 'fx_as_of key present (null when reference rate)');
  assert.equal(d.is_tax_exempt, true); // math unchanged: ~$9.42 under the $200 US threshold
});

// ---------- P2-SEC-09: uniform pre-auth responses + per-account reset cap ----------
await t.test('P2-SEC-09 locked account: wrong password is generic 401, correct password is 423', async () => {
  const g = await boot();
  g.db.prepare("UPDATE users SET locked_until = datetime('now', '+1 hour') WHERE id = 'u_customer_001'").run();
  const wrong = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'customer@example.com', password: 'WrongPass!000', role: 'CUSTOMER' } });
  assert.equal(wrong.status, 401, wrong.text);
  assert.equal(wrong.json.code, 'UNAUTHENTICATED');
  const right = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'customer@example.com', password: PW, role: 'CUSTOMER' } });
  assert.equal(right.status, 423, right.text);
  assert.equal(right.json.code, 'ACCOUNT_LOCKED');
});

await t.test('P2-SEC-09 forgot-password keeps at most 3 active tokens per account', async () => {
  const g = await boot();
  for (let i = 0; i < 5; i++) {
    const r = await g.call('/api/v1/auth/forgot-password', { method: 'POST', body: { email: 'customer@example.com' } });
    assert.equal(r.status, 200, r.text);
  }
  const n = g.db.prepare("SELECT COUNT(*) c FROM password_reset_tokens WHERE user_id = 'u_customer_001' AND used_at IS NULL").get().c;
  assert.ok(n <= 3, `active tokens capped at 3, got ${n}`);
});

// ---------- P2-SEC-08: production requires an independent TOTP seal key ----------
await t.test('P2-SEC-08 production without TOTP_ENCRYPTION_KEY refuses to seal; fallback stays for non-prod', async () => {
  await assert.rejects(() => totpLib.sealSecret({ ENVIRONMENT: 'production', JWT_SECRET: SECRET }), /TOTP_KEY_NOT_CONFIGURED/);
  const prodEnv = { ENVIRONMENT: 'production', JWT_SECRET: SECRET, TOTP_ENCRYPTION_KEY: 'prod-totp-seal-key-0123456789abcdef' };
  const sealed = await totpLib.sealSecret(prodEnv, 'JBSWY3DPEHPK3PXP');
  assert.equal(await totpLib.openSecret(prodEnv, sealed), 'JBSWY3DPEHPK3PXP');
  const devEnv = { ENVIRONMENT: 'test', JWT_SECRET: SECRET };
  const devSealed = await totpLib.sealSecret(devEnv, 'JBSWY3DPEHPK3PXP');
  assert.equal(await totpLib.openSecret(devEnv, devSealed), 'JBSWY3DPEHPK3PXP');
});

// ---------- P2-SEC-13: PCCC mask reveals at most the last 2 chars ----------
await t.test('P2-SEC-13 maskPccc reveals only the last 2 characters', async () => {
  assert.equal(typeof privacy.maskPccc, 'function', 'services/privacy.js must export maskPccc');
  assert.equal(privacy.maskPccc('P123456789012'), '***********12');
  assert.equal(privacy.maskPccc(null), null);
  assert.equal(privacy.maskPccc(''), '');
});

await t.test('P2-SEC-13 tracking timeline exposes only the masked PCCC', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const sku = g.db.prepare("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get();
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, pccc: 'P123456789012', items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(co.status, 201, co.text);
  const sub = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(co.json.order_id);
  const tr = await g.call(`/api/v1/logistics/tracking/${sub.id}`, { token: cust });
  assert.equal(tr.status, 200, tr.text);
  assert.equal(tr.json.data.pccc, '***********12');
});

// ---------- D-N02: fulfill doc requires tracking_number ----------
await t.test('D-N02 channels.yaml fulfill requestBody requires tracking_number', async () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const doc = fs.readFileSync(path.join(HERE, '..', 'docs/openapi/paths/channels.yaml'), 'utf-8');
  const seg = doc.split('/api/v1/channels/orders/{id}/fulfill:')[1].split('/api/v1/')[0];
  assert.ok(seg.includes('required: [tracking_number]'), 'fulfill requestBody schema must require tracking_number');
});

t.finish();
