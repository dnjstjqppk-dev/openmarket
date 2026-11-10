// tests/p1_funds_abuse_test.mjs
// NEW-P0-01 (lowest-price compensation) + NEW-P0-02 (welcome credit) fund-abuse guards.
// Baseline failures were proven by the 14:13 audit repro (instant +196,080 credit on a
// 100-won bait drop; 9,900원 order paid 0원 with unverified welcome credit).
// Run: node tests/p1_funds_abuse_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGateway, createRunner } from './lib/harness.mjs';
import { sqlNow } from '../apps/cloudflare-gateway/src/lib/ids.js';
import { sha256Hex } from '../apps/cloudflare-gateway/src/utils/crypto-auth.js';

const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const ADDR = { recipient_name: '홍길동', recipient_phone: '010-2222-3333', shipping_address_line1: '서울특별시 중구 세종대로 110', shipping_postal_code: '04524' };

async function boot() {
  const g = await createGateway({ seedFiles: SEED, env: { JWT_SECRET: 'x'.repeat(40), ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox' } });
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const all = (sql, ...p) => g.db.prepare(sql).all(...p).map((r) => ({ ...r }));
  const login = async (email, password = PW, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, one, all, login };
}

// Drift-robust row insert: fill NOT NULL columns without defaults, then apply overrides.
function insertRow(g, table, overrides) {
  const cols = g.db.prepare(`PRAGMA table_info(${table})`).all();
  const row = { ...overrides };
  for (const c of cols) {
    if (c.name in row || c.notnull !== 1 || c.dflt_value !== null) continue;
    row[c.name] = /^INT/i.test(c.type) ? 0 : 't';
  }
  const names = Object.keys(row);
  g.db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => row[n]));
}

const balance = (g, userId) => g.db.prepare('SELECT COALESCE(SUM(amount_delta), 0) AS b FROM user_credits WHERE user_id = ?').get(userId).b;

// A paid single-sub order for price-adjustment tests. Returns { orderId, subId, sku }.
function mkPaidOrder(g, tag, { customerId, skuId, unitPrice, qty, paid }) {
  const sku = g.db.prepare('SELECT * FROM product_skus WHERE id = ?').get(skuId);
  const orderId = `o_funds_${tag}`;
  insertRow(g, 'orders', { id: orderId, order_no: `FUNDS-${tag}`, customer_id: customerId, payment_status: 'PAID', paid_at: sqlNow(), total_pay_amount: paid, total_goods_amount: paid, operator_entity_id: 'be_dev_sole' });
  const subId = `sub_funds_${tag}`;
  insertRow(g, 'sub_orders', { id: subId, parent_order_id: orderId, sub_order_no: `SUB-${tag}`, partner_id: 'pt_001', sales_model: 'MARKETPLACE', status: 'DELIVERED', goods_amount: paid, total_amount: paid });
  insertRow(g, 'order_items', { id: `itm_funds_${tag}`, sub_order_id: subId, sku_id: skuId, product_id: sku.product_id, unit_price: unitPrice, quantity: qty, total_price: unitPrice * qty, refunded_quantity: 0, volume_discount_pct: 0 });
  insertRow(g, 'settlements', { id: `stl_funds_${tag}`, sub_order_id: subId, partner_id: 'pt_001', operator_entity_id: 'be_dev_sole', gross_amount: paid, shipping_fee: 0, commission_rate_bps: 1000, commission_amount: Math.floor(paid * 0.1), net_payout_amount: paid - Math.floor(paid * 0.1), status: 'HOLD' });
  return { orderId, subId, sku };
}

const setSku = (g, skuId, price, priceTs) =>
  g.db.prepare('UPDATE product_skus SET sale_price = ?, price_updated_at = ? WHERE id = ?').run(price, priceTs, skuId);

const t = createRunner('P1 fund-abuse guards (NEW-P0-01/02)');

// ---------- NEW-P0-01: price-adjustment claim gates ----------
await t.test('P0-01 fresh drop (<24h) is held, not paid', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const uid = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com').id;
  const { orderId } = mkPaidOrder(g, 'hold', { customerId: uid, skuId: 'sku_001_w', unitPrice: 49900, qty: 1, paid: 49900 });
  setSku(g, 'sku_001_w', 49000, sqlNow());
  const r = await g.call(`/api/v1/orders/${orderId}/claims`, { method: 'POST', token: cust, body: { type: 'PRICE_ADJUSTMENT' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'PRICE_HOLD_PERIOD');
  assert.equal(g.one('SELECT COUNT(*) c FROM returns WHERE order_id = ?', orderId).c, 0);
});

await t.test('P0-01 crash price (100-won bait) is excluded as suspect', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const uid = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com').id;
  const { orderId } = mkPaidOrder(g, 'suspect', { customerId: uid, skuId: 'sku_001_w', unitPrice: 49900, qty: 1, paid: 49900 });
  setSku(g, 'sku_001_w', 100, '2020-01-01 00:00:00');
  const r = await g.call(`/api/v1/orders/${orderId}/claims`, { method: 'POST', token: cust, body: { type: 'PRICE_ADJUSTMENT' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'PRICE_DROP_SUSPECT');
  assert.equal(g.one('SELECT COUNT(*) c FROM returns WHERE order_id = ?', orderId).c, 0);
});

await t.test('P0-01 legit claim freezes REQUESTED with zero grant', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const uid = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com').id;
  const { orderId, subId } = mkPaidOrder(g, 'pend', { customerId: uid, skuId: 'sku_001_w', unitPrice: 49900, qty: 1, paid: 49900 });
  setSku(g, 'sku_001_w', 49000, '2020-01-01 00:00:00');
  const r = await g.call(`/api/v1/orders/${orderId}/claims`, { method: 'POST', token: cust, body: { type: 'PRICE_ADJUSTMENT' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'REQUESTED');
  assert.equal(r.json.refund_amount, 900);
  assert.equal(g.one('SELECT COUNT(*) c FROM user_credits WHERE reference_id = ?', r.json.claim_id).c, 0);
  const row = g.one('SELECT status, items_json FROM returns WHERE id = ?', r.json.claim_id);
  assert.equal(row.status, 'REQUESTED');
  const snap = JSON.parse(row.items_json);
  assert.equal(snap.length, 1);
  assert.equal(snap[0].sub_order_id, subId);
  assert.equal(snap[0].line_diff, 900);
});

await t.test('P0-01 approve pays capped grant and charges the seller settlement', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const uid = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com').id;
  const adm = await g.login('admin@openmarket.com', PW, 'ADMIN');
  const { orderId, subId } = mkPaidOrder(g, 'appr', { customerId: uid, skuId: 'sku_001_w', unitPrice: 49900, qty: 10, paid: 499000 });
  const beforeAppr = balance(g, uid);
  setSku(g, 'sku_001_w', 39900, '2020-01-01 00:00:00'); // 20% drop: passes the 70% suspect line
  const c = await g.call(`/api/v1/orders/${orderId}/claims`, { method: 'POST', token: cust, body: { type: 'PRICE_ADJUSTMENT' } });
  assert.equal(c.status, 201);
  assert.equal(c.json.refund_amount, 100000);
  const a = await g.call(`/api/v1/admin/claims/${c.json.claim_id}`, { method: 'PUT', token: adm, body: { decision: 'APPROVE' } });
  assert.equal(a.status, 200);
  assert.equal(a.json.granted, 10000); // min(100000 raw, 49900 = 10% paid, 10000 hard cap)
  assert.equal(balance(g, uid) - beforeAppr, 10000);
  const claim = g.one('SELECT status, refund_amount FROM returns WHERE id = ?', c.json.claim_id);
  assert.equal(claim.status, 'REFUNDED');
  assert.equal(claim.refund_amount, 10000);
  const stl = g.one('SELECT id FROM settlements WHERE sub_order_id = ?', subId);
  const adj = g.all('SELECT net_delta, partner_id FROM settlement_adjustments WHERE settlement_id = ?', stl.id);
  assert.equal(adj.length, 1);
  assert.equal(adj[0].net_delta, -10000);
  assert.equal(adj[0].partner_id, 'pt_001');
});

await t.test('P0-01 duplicate claim on one order is rejected', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const uid = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com').id;
  const { orderId } = mkPaidOrder(g, 'dup', { customerId: uid, skuId: 'sku_001_w', unitPrice: 49900, qty: 1, paid: 49900 });
  setSku(g, 'sku_001_w', 49000, '2020-01-01 00:00:00');
  const first = await g.call(`/api/v1/orders/${orderId}/claims`, { method: 'POST', token: cust, body: { type: 'PRICE_ADJUSTMENT' } });
  assert.equal(first.status, 201);
  const second = await g.call(`/api/v1/orders/${orderId}/claims`, { method: 'POST', token: cust, body: { type: 'PRICE_ADJUSTMENT' } });
  assert.equal(second.status, 409);
  assert.equal(second.json.code, 'ALREADY_ADJUSTED');
});

await t.test('P0-01 double approve pays exactly once', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const uid = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com').id;
  const adm = await g.login('admin@openmarket.com', PW, 'ADMIN');
  const { orderId } = mkPaidOrder(g, 'dbl', { customerId: uid, skuId: 'sku_001_w', unitPrice: 49900, qty: 1, paid: 49900 });
  const beforeDbl = balance(g, uid);
  setSku(g, 'sku_001_w', 49000, '2020-01-01 00:00:00');
  const c = await g.call(`/api/v1/orders/${orderId}/claims`, { method: 'POST', token: cust, body: { type: 'PRICE_ADJUSTMENT' } });
  assert.equal(c.status, 201);
  const a1 = await g.call(`/api/v1/admin/claims/${c.json.claim_id}`, { method: 'PUT', token: adm, body: { decision: 'APPROVE' } });
  assert.equal(a1.status, 200);
  assert.equal(a1.json.granted, 900); // min(900 raw, 4990 = 10% paid, 10000)
  const a2 = await g.call(`/api/v1/admin/claims/${c.json.claim_id}`, { method: 'PUT', token: adm, body: { decision: 'APPROVE' } });
  assert.equal(a2.status, 409);
  assert.equal(a2.json.code, 'CLAIM_ALREADY_PROCESSED');
  assert.equal(balance(g, uid) - beforeDbl, 900);
});

// ---------- NEW-P0-02: welcome credit after verification + spend rules ----------
async function registerFresh(g, email) {
  const r = await g.call('/api/v1/auth/register', { method: 'POST', body: { email, password: 'TestPass!2026', full_name: 'Funds Tester', phone: '010-1234-5678', agree_terms: true, agree_privacy: true } });
  assert.equal(r.status, 201, r.text);
  return r.json;
}

async function verifyFresh(g, userId) {
  const token = `verify-${userId}`;
  const hash = await sha256Hex(token);
  g.db.prepare('INSERT INTO email_verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(`evt_${userId}`, userId, hash, '2999-01-01T00:00:00.000Z');
  const r = await g.call('/api/v1/auth/verify-email', { method: 'POST', body: { token } });
  assert.equal(r.status, 200, r.text);
  return r.json;
}

await t.test('P0-02 register grants nothing; verify-email grants 10000 exactly once', async () => {
  const g = await boot();
  const reg = await registerFresh(g, 'funds1@test.com');
  assert.equal(reg.welcome_credit, 0);
  const uid = reg.customer_id;
  assert.equal(balance(g, uid), 0);
  const v1 = await verifyFresh(g, uid);
  assert.equal(v1.welcome_credit_granted, 10000);
  assert.equal(balance(g, uid), 10000);
  const token = `verify-${uid}`;
  const v2 = await g.call('/api/v1/auth/verify-email', { method: 'POST', body: { token } });
  assert.equal(v2.status, 400);
  assert.equal(balance(g, uid), 10000);
});

await t.test('P0-02 unverified checkout with credit is 403 (0-won repro blocked)', async () => {
  const g = await boot();
  const reg = await registerFresh(g, 'funds2@test.com');
  const tok = await g.login('funds2@test.com', 'TestPass!2026');
  assert.equal(reg.welcome_credit, 0);
  const r = await g.call('/api/v1/orders/quote', { method: 'POST', token: tok, body: { ...ADDR, items: [{ sku_id: 'sku_002_65w', quantity: 1 }], use_credit_amount: 24500 } });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'CREDIT_UNVERIFIED');
});

await t.test('P0-02 verified credit under 30000원 goods is 409', async () => {
  const g = await boot();
  const reg = await registerFresh(g, 'funds3@test.com');
  await verifyFresh(g, reg.customer_id);
  const tok = await g.login('funds3@test.com', 'TestPass!2026');
  const r = await g.call('/api/v1/orders/quote', { method: 'POST', token: tok, body: { ...ADDR, items: [{ sku_id: 'sku_002_65w', quantity: 1 }], use_credit_amount: 5000 } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'CREDIT_MIN_ORDER');
});

await t.test('P0-02 credit clamps to 20% of net goods', async () => {
  const g = await boot();
  const reg = await registerFresh(g, 'funds4@test.com');
  await verifyFresh(g, reg.customer_id);
  const tok = await g.login('funds4@test.com', 'TestPass!2026');
  const r = await g.call('/api/v1/orders/quote', { method: 'POST', token: tok, body: { ...ADDR, items: [{ sku_id: 'sku_002_65w', quantity: 2 }], use_credit_amount: 10000 } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.credit_used_amount, 9800); // floor(49000 * 0.20)
});

await t.test('P0-02 UI copy matches the approval-gated, capped policy', async () => {
  const detail = fs.readFileSync('apps/storefront/src/views/OrderDetailView.vue', 'utf8');
  assert.ok(detail.includes('관리자 승인 후 지급'), 'price-claim message names post-approval payout');
  assert.ok(!detail.includes('차액 ${won(json.refund_amount)}이 적립금으로 지급되었습니다'), 'no instant-grant claim copy');
  const ledger = fs.readFileSync('apps/admin/src/views/LedgerAuditView.vue', 'utf8');
  assert.ok(ledger.includes('PRICE_ADJUSTMENT') && ledger.includes('Approve Credit'), 'admin can approve pending price claims');
  const checkout = fs.readFileSync('apps/storefront/src/views/CheckoutView.vue', 'utf8');
  assert.ok(checkout.includes('20%까지'), 'checkout states the credit cap');
  const partner = fs.readFileSync('apps/cloudflare-gateway/src/routes/partner.js', 'utf8');
  assert.equal(partner.split('price_updated_at = CURRENT_TIMESTAMP').length - 1, 2, 'both price PUTs stamp the 24h clock');
  const bidding = fs.readFileSync('apps/cloudflare-gateway/src/routes/bidding-m2c.js', 'utf8');
  assert.ok(bidding.includes('price_updated_at = CURRENT_TIMESTAMP'), 'bidding award stamps the 24h clock');
});

t.finish();
