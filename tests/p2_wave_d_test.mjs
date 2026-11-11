// tests/p2_wave_d_test.mjs
// P2 Wave D suite: SEC-10 (PII at-rest encryption), NEW-18 (Sentry error reporting),
// S16 (privacy contact), S06 (honest copy).
// Run: node tests/p2_wave_d_test.mjs   (requires: node scripts/gen-dev-seed.mjs once)

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import * as piiCrypto from '../apps/cloudflare-gateway/src/lib/pii-crypto.js';
import { sha256Hex } from '../apps/cloudflare-gateway/src/utils/crypto-auth.js';

const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = {
  JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox',
  PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef',
  CARRIER_WEBHOOK_SECRET: 'carrier-secret-0123456789ab'
};
const ADDR = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };
const PCCC = 'P123456789012';

async function boot(env = {}) {
  const g = await createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const all = (sql, ...p) => g.db.prepare(sql).all(...p).map((r) => ({ ...r }));
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, one, all, login };
}

const brnOf = (nine) => {
  const d = String(nine).split('').map(Number); const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const s = d.reduce((a, x, i) => a + x * w[i], 0) + Math.floor((d[8] * 5) / 10);
  return `${nine}${(10 - (s % 10)) % 10}`;
};
const application = (over = {}) => ({
  email: 'sealed.seller@example.com', password: 'SellerApply!2026', contact_name: '신청 담당', phone: '010-2222-3333',
  business_name: '암호상회', representative_name: '대표 이름', business_reg_number: brnOf('123456789'),
  mail_order_reg_number: '제2026-서울강남-0001호', bank_code: '004', bank_account_number: '123-456-789012', bank_account_holder: '암호상회',
  customer_service_phone: '02-123-4567', return_shipping_address: '서울특별시 강남구 반품로 1',
  business_address: '서울특별시 강남구 사업로 2', cs_email: 'cs@sealed.example.com',
  agree_seller_terms: true, agree_privacy: true, ...over
});

const t = createRunner('P2 Wave D (SEC-10, NEW-18, S16, S06)');

// ---------- SEC-10: PII at-rest encryption ----------
await t.test('SEC-10 pii-crypto seals, opens, and versions ciphertext', async () => {
  const env = { ENVIRONMENT: 'test', JWT_SECRET: SECRET };
  const sealed = await piiCrypto.sealPii(env, '123-456-789012');
  assert.ok(sealed.startsWith('enc:v1:'), `versioned envelope, got ${sealed.slice(0, 20)}`);
  assert.equal(await piiCrypto.openPii(env, sealed), '123-456-789012');
  assert.notEqual(await piiCrypto.sealPii(env, '123-456-789012'), sealed, 'random IV: two seals differ');
  assert.equal(await piiCrypto.maybeOpenPii(env, 'legacy-plaintext'), 'legacy-plaintext', 'lazy migration: plaintext passes through');
  assert.equal(await piiCrypto.maybeOpenPii(env, sealed), '123-456-789012');
  assert.equal(await piiCrypto.sealPii(env, null), null);
  assert.equal(await piiCrypto.sealPii(env, ''), '');
  await assert.rejects(() => piiCrypto.openPii(env, 'enc:v1:tampered:payload'), /PII_SEAL_INVALID/);
});

await t.test('SEC-10 production refuses to seal without PII_ENCRYPTION_KEY', async () => {
  const prodNoKey = { ENVIRONMENT: 'production', JWT_SECRET: SECRET };
  await assert.rejects(() => piiCrypto.sealPii(prodNoKey, 'x'), /PII_KEY_NOT_CONFIGURED/);
  const prodKey = { ENVIRONMENT: 'production', JWT_SECRET: SECRET, PII_ENCRYPTION_KEY: 'prod-pii-key-0123456789abcdefghijklmnop' };
  const sealed = await piiCrypto.sealPii(prodKey, 'x');
  assert.equal(await piiCrypto.openPii(prodKey, sealed), 'x');
  const derived = await piiCrypto.sealPii({ ENVIRONMENT: 'test', JWT_SECRET: SECRET }, 'x');
  assert.equal(await piiCrypto.openPii({ ENVIRONMENT: 'test', JWT_SECRET: SECRET }, derived), 'x');
});

await t.test('SEC-10 onboarding stores a sealed account; admin reads masked', async () => {
  const g = await boot();
  const r = await g.call('/api/v1/partner-applications', { method: 'POST', body: application() });
  assert.equal(r.status, 201, r.text);
  const stored = g.one("SELECT bank_account_number n, bank_account_holder h FROM partners WHERE business_name = '암호상회'");
  assert.ok(stored.n.startsWith('enc:v1:'), `account sealed at rest, got ${String(stored.n).slice(0, 20)}`);
  assert.ok(stored.h.startsWith('enc:v1:'), 'holder sealed at rest');
  assert.ok(!stored.n.includes('123-456-789012'), 'no plaintext account in the row');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const li = await g.call('/api/v1/admin/partners', { token: adm });
  assert.equal(li.status, 200, li.text);
  const row = li.json.data.find((x) => x.business_name === '암호상회');
  assert.equal(row.bank_account_number, '****9012', 'admin list shows last-4 of the real number');
  const ap = await g.call('/api/v1/admin/partner-applications?kyc_status=ALL', { token: adm });
  assert.equal(ap.status, 200, ap.text);
  const appRow = ap.json.data.find((x) => x.business_name === '암호상회');
  assert.equal(appRow.bank_account_number, '****9012');
  assert.equal(appRow.bank_account_holder, '암호상회', 'operator verifying KYB still sees the holder name');
});

await t.test('SEC-10 payout change request is sealed; approval audit is masked', async () => {
  const g = await boot();
  const pt = await g.login('partner2@olmoa-tech.com', 'PARTNER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const q = await g.call('/api/v1/partner/profile', { method: 'PUT', token: pt, body: { bank_account_number: '999-888-777666', bank_account_holder: '변경예금주' } });
  assert.equal(q.status, 200, q.text);
  assert.equal(q.json.payout_change_pending, true);
  const reqJson = g.one("SELECT payout_change_request_json j FROM partners WHERE id = 'pt_002'").j;
  assert.ok(!reqJson.includes('999-888-777666'), 'no plaintext account in the queued request');
  assert.ok(reqJson.includes('enc:v1:'), 'queued request holds sealed values');
  const prof = await g.call('/api/v1/partner/profile', { token: pt });
  assert.equal(prof.json.data.bank_account_number, '****' + g.one("SELECT bank_account_number n FROM partners WHERE id = 'pt_002'").n.slice(-4));
  const ok = await g.call('/api/v1/admin/partners/pt_002/payout-account', { method: 'POST', token: adm, body: { decision: 'APPROVE', verification_evidence: 'ARS 실명확인 2026-11-11' } });
  assert.equal(ok.status, 200, ok.text);
  const after = g.one("SELECT bank_account_number n FROM partners WHERE id = 'pt_002'").n;
  assert.ok(after.startsWith('enc:v1:'), 'approved account stored sealed');
  const audit = g.one("SELECT before_json b, after_json a FROM admin_audit_log WHERE action = 'PAYOUT_ACCOUNT_CHANGE_APPROVE' ORDER BY rowid DESC LIMIT 1");
  assert.ok(!audit.a.includes('999-888-777666') && !audit.b.includes('999-888-777666'), 'audit holds no full account number');
  assert.ok(audit.a.includes('****7666'), 'audit keeps last-4 for traceability');
  const q2 = await g.call('/api/v1/partner/profile', { method: 'PUT', token: pt, body: { bank_account_number: '111-222-333444' } });
  assert.equal(q2.json.payout_change_pending, true);
  const rej = await g.call('/api/v1/admin/partners/pt_002/payout-account', { method: 'POST', token: adm, body: { decision: 'REJECT' } });
  assert.equal(rej.status, 200, rej.text);
  const auditR = g.one("SELECT before_json b FROM admin_audit_log WHERE action = 'PAYOUT_ACCOUNT_CHANGE_REJECT' ORDER BY rowid DESC LIMIT 1");
  assert.ok(!auditR.b.includes('111-222-333444'), 'reject audit holds no full account number');
});

await t.test('SEC-10 checkout seals PCCC; authorized reads open, others stay masked', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const sku = g.db.prepare("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get();
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, pccc: PCCC, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(co.status, 201, co.text);
  const stored = g.one('SELECT pccc FROM orders WHERE id = ?', co.json.order_id).pccc;
  assert.ok(stored.startsWith('enc:v1:'), `PCCC sealed at rest, got ${String(stored).slice(0, 20)}`);
  assert.ok(!stored.includes(PCCC), 'no plaintext PCCC in the row');
  const inv = await g.call(`/api/v1/orders/${co.json.order_id}/commercial-invoice`, { token: cust });
  assert.equal(inv.status, 200, inv.text);
  assert.equal(inv.json.data.consignee.pccc, PCCC, 'owner sees the full PCCC on the invoice');
  const sub = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(co.json.order_id);
  const tr = await g.call(`/api/v1/logistics/tracking/${sub.id}`, { token: cust });
  assert.equal(tr.status, 200, tr.text);
  assert.equal(tr.json.data.pccc, '***********12', 'tracking shows last-2 only');
  g.db.prepare('INSERT INTO returns (id, order_id, user_id, claim_type, reason) VALUES (?,?,?,?,?)')
    .run('ret_d10', co.json.order_id, g.one("SELECT id FROM users WHERE email = 'customer@example.com'").id, 'RETURN', 'r');
  const dp = await g.call('/api/v1/admin/disputes', { token: adm });
  assert.equal(dp.status, 200, dp.text);
  assert.equal(dp.json.data.find((x) => x.id === 'ret_d10').pccc, '****' + PCCC.slice(-4), 'disputes list masks PCCC');
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const po = await g.call('/api/v1/partner/orders', { token: pt });
  assert.equal(po.status, 200, po.text);
  const mine = po.json.data.find((x) => x.parent_order_id === co.json.order_id);
  if (mine) assert.equal(mine.pccc, PCCC, 'fulfilling seller sees the full PCCC');
  const ao = await g.call('/api/v1/admin/orders?per_page=5', { token: adm });
  assert.equal(ao.status, 200, ao.text);
  const arow = ao.json.data.find((x) => x.id === co.json.order_id);
  assert.equal(arow.pccc, PCCC, 'admin order list opens the sealed PCCC');
});

await t.test('SEC-10 dispatch seals recipient/content; withdrawal purges by blind index', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const dr = await g.call('/api/v1/notifications/dispatch', { method: 'POST', token: adm, body: { recipient: '01012345678', content: '결제 완료 안내' } });
  assert.equal(dr.status, 200, dr.text);
  const log = g.one('SELECT recipient r, content c, recipient_hash h FROM notification_delivery_logs WHERE id = ?', dr.json.data.log_id);
  assert.ok(log.r.startsWith('enc:v1:'), 'recipient sealed at rest');
  assert.ok(log.c.startsWith('enc:v1:'), 'content sealed at rest');
  assert.equal(log.h, await sha256Hex('01012345678'), 'blind index matches the exact recipient');
  // Fresh user: dispatch to their email, then withdraw -> the sealed row is purged via the hash.
  const email = 'purge.case@example.com';
  const reg = await g.call('/api/v1/auth/register', { method: 'POST', body: { email, password: 'PurgePass!2026#', full_name: '파기테', phone: '010-9999-0001', agree_terms: true, agree_privacy: true } });
  assert.equal(reg.status, 201, reg.text);
  const d2 = await g.call('/api/v1/notifications/dispatch', { method: 'POST', token: adm, body: { recipient: email, content: '마케팅 수신 동의 감사' } });
  assert.equal(d2.status, 200, d2.text);
  assert.equal(g.one('SELECT COUNT(*) c FROM notification_delivery_logs WHERE id = ?', d2.json.data.log_id).c, 1);
  const w = await g.call('/api/v1/auth/withdraw', { method: 'POST', token: reg.json.token, body: { confirm: true, password: 'PurgePass!2026#', acknowledge_credit_forfeit: true } });
  assert.equal(w.status, 200, w.text);
  assert.equal(g.one('SELECT COUNT(*) c FROM notification_delivery_logs WHERE id = ?', d2.json.data.log_id).c, 0, 'sealed row purged on withdrawal');
  // Legacy plaintext rows are still purged (OR branch).
  const email2 = 'legacy.case@example.com';
  const reg2 = await g.call('/api/v1/auth/register', { method: 'POST', body: { email: email2, password: 'PurgePass!2026#', full_name: '레거시', phone: '010-9999-0002', agree_terms: true, agree_privacy: true } });
  assert.equal(reg2.status, 201, reg2.text);
  g.db.prepare('INSERT INTO notification_delivery_logs (id, channel, recipient, template_code, title, content, status, provider) VALUES (?,?,?,?,?,?,?,?)')
    .run('dlv_legacy', 'SMS', email2, 'T', 't', 'legacy plaintext', 'SENT', 'SOLAPI');
  const w2 = await g.call('/api/v1/auth/withdraw', { method: 'POST', token: reg2.json.token, body: { confirm: true, password: 'PurgePass!2026#', acknowledge_credit_forfeit: true } });
  assert.equal(w2.status, 200, w2.text);
  assert.equal(g.one("SELECT COUNT(*) c FROM notification_delivery_logs WHERE id = 'dlv_legacy'").c, 0, 'legacy plaintext row purged on withdrawal');
});

await t.test('SEC-10 legacy plaintext rows stay readable (lazy migration)', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const rawBank = g.one("SELECT bank_account_number b FROM partners WHERE id = 'pt_001'").b;
  assert.ok(!rawBank.startsWith('enc:'), 'seed row is legacy plaintext');
  const li = await g.call('/api/v1/admin/partners', { token: adm });
  assert.equal(li.json.data.find((r) => r.id === 'pt_001').bank_account_number, `****${String(rawBank).slice(-4)}`);
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const custId = g.one("SELECT id FROM users WHERE email = 'customer@example.com'").id;
  g.db.prepare('INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code, pccc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('ord_d10leg', 'ORD-D10LEG', custId, 10000, 0, 0, 10000, 'READY', 'R', '010-1111-2222', 'A', '', '06236', PCCC);
  g.db.prepare('INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('sub_d10leg', 'ord_d10leg', 'SUB-D10LEG', 'pt_001', 0, 10000, 0, 10000, 'PAYMENT_CONFIRMED');
  const tr = await g.call('/api/v1/logistics/tracking/sub_d10leg', { token: cust });
  assert.equal(tr.status, 200, tr.text);
  assert.equal(tr.json.data.pccc, '***********12', 'legacy plaintext PCCC still masks');
  const inv = await g.call('/api/v1/orders/ord_d10leg/commercial-invoice', { token: cust });
  assert.equal(inv.status, 200, inv.text);
  assert.equal(inv.json.data.consignee.pccc, PCCC, 'legacy plaintext PCCC still invoices');
});

// ---------- NEW-18: server error reporting to Sentry ----------
const SENTRY_DSN = 'https://publickey1234567890@sentry.example.com/42';

async function triggerServerError(g) {
  // Corrupt payout JSON makes JSON.parse throw a non-HttpError -> honest 500.
  g.db.prepare("UPDATE partners SET payout_change_request_json = 'not-json{{{' WHERE id = 'pt_002'").run();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  return g.call('/api/v1/admin/partners/pt_002/payout-account', { method: 'POST', token: adm, body: { decision: 'APPROVE', verification_evidence: 'x' } });
}

await t.test('NEW-18 without SENTRY_DSN no report is sent (no-op)', async () => {
  const g = await boot();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...a) => { calls.push(a); return new Response('{}', { status: 200 }); };
  try {
    const r = await triggerServerError(g);
    assert.equal(r.status, 500, r.text);
    assert.equal(r.json.code, 'INTERNAL_ERROR');
    await Promise.allSettled(g.scheduled);
    assert.equal(calls.length, 0, 'no outbound report without a DSN');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t.test('NEW-18 unexpected errors post a Sentry envelope; business errors do not', async () => {
  const g = await boot({ SENTRY_DSN });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...a) => { calls.push(a); return new Response('{}', { status: 200 }); };
  try {
    const r = await triggerServerError(g);
    assert.equal(r.status, 500, r.text);
    await Promise.allSettled(g.scheduled);
    assert.equal(calls.length, 1, 'one envelope POST per unexpected error');
    const [url, init] = calls[0];
    assert.equal(String(url), 'https://sentry.example.com/api/42/envelope/');
    assert.ok(String(new Headers(init.headers).get('X-Sentry-Auth')).includes('publickey1234567890'), 'DSN public key authenticates');
    const body = String(init.body);
    assert.ok(body.includes('"type":"event"'), 'envelope carries an event item');
    assert.ok(body.includes(r.json.request_id), 'event tags the response request_id');
    assert.ok(body.includes('/api/v1/admin/partners/pt_002/payout-account'), 'event records the request path');
    assert.ok(!body.includes('verification_evidence'), 'request bodies are never shipped');
    // A business error (400) on the same gateway sends nothing more.
    const before = calls.length;
    const bad = await g.call('/api/v1/customs/validate-pccc', { method: 'POST', token: await g.login('customer@example.com'), body: { pccc: 'P1' } });
    assert.equal(bad.status, 400, bad.text);
    await Promise.allSettled(g.scheduled);
    assert.equal(calls.length, before, 'HttpError outcomes are not reported');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t.test('NEW-18 an invalid DSN never breaks the error path', async () => {
  const g = await boot({ SENTRY_DSN: 'not-a-dsn' });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...a) => { calls.push(a); return new Response('{}', { status: 200 }); };
  try {
    const r = await triggerServerError(g);
    assert.equal(r.status, 500, r.text);
    assert.equal(r.json.code, 'INTERNAL_ERROR');
    await Promise.allSettled(g.scheduled);
    assert.equal(calls.length, 0, 'unparseable DSN sends nothing');
  } finally {
    globalThis.fetch = realFetch;
  }
});

t.finish();
