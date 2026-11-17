// tests/p1_funds_abuse_test.mjs
// NEW-P0-01 (lowest-price compensation, RETIRED by 5-5/decision-15: new claims
// rejected, legacy rows readable/settleable) + NEW-P0-02 (welcome credit)
// fund-abuse guards. Baseline failures were proven by the 14:13 audit repro
// (instant +196,080 credit on a 100-won bait drop; 9,900원 order paid 0원 with
// unverified welcome credit).
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

// ---------- NEW-P0-01 RETIRED (5-5, decision-15): the lowest-price compensation
// scheme is closed. New claims are rejected; only rows stored before the
// closure stay readable and settleable as a terminated scheme.
await t.test('P0-01 retired: PRICE_ADJUSTMENT claim is rejected 400', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const uid = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com').id;
  const { orderId } = mkPaidOrder(g, 'rej', { customerId: uid, skuId: 'sku_001_w', unitPrice: 49900, qty: 1, paid: 49900 });
  setSku(g, 'sku_001_w', 49000, '2020-01-01 00:00:00'); // a real, stable drop no longer matters
  const before = balance(g, uid);
  const r = await g.call(`/api/v1/orders/${orderId}/claims`, { method: 'POST', token: cust, body: { type: 'PRICE_ADJUSTMENT' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'INVALID_CLAIM_TYPE');
  assert.equal(g.one('SELECT COUNT(*) c FROM returns WHERE order_id = ?', orderId).c, 0);
  assert.equal(balance(g, uid), before);
});

await t.test('P0-01 retired: PRICE_MATCH alias is rejected 400, never mapped', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const uid = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com').id;
  const { orderId } = mkPaidOrder(g, 'alias', { customerId: uid, skuId: 'sku_001_w', unitPrice: 49900, qty: 1, paid: 49900 });
  setSku(g, 'sku_001_w', 49000, '2020-01-01 00:00:00');
  for (const body of [{ type: 'PRICE_MATCH' }, { claim_type: 'PRICE_MATCH' }, { type: 'price_match' }]) {
    const r = await g.call(`/api/v1/orders/${orderId}/claims`, { method: 'POST', token: cust, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.code, 'INVALID_CLAIM_TYPE');
  }
  assert.equal(g.one('SELECT COUNT(*) c FROM returns WHERE order_id = ?', orderId).c, 0);
});

await t.test('P0-01 legacy: stored claim stays readable in admin list and order detail', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const uid = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com').id;
  const adm = await g.login('admin@openmarket.com', PW, 'ADMIN');
  const { orderId, subId } = mkPaidOrder(g, 'legacy', { customerId: uid, skuId: 'sku_001_w', unitPrice: 49900, qty: 1, paid: 49900 });
  insertRow(g, 'returns', {
    id: 'clm_legacy_551', order_id: orderId, user_id: uid, claim_type: 'PRICE_ADJUSTMENT',
    reason: 'stored before the scheme closed', status: 'REQUESTED', refund_amount: 900,
    notes: 'legacy', items_json: JSON.stringify([{ order_item_id: 'itm_funds_legacy', sub_order_id: subId, qty: 1, unit_diff: 900, line_diff: 900 }])
  });
  const list = await g.call('/api/v1/admin/claims', { token: adm });
  assert.equal(list.status, 200, list.text);
  assert.ok(list.json.data.some((r) => r.id === 'clm_legacy_551'), 'legacy row in the admin list');
  const filtered = await g.call('/api/v1/admin/claims?claim_type=PRICE_ADJUSTMENT', { token: adm });
  assert.equal(filtered.status, 200, filtered.text);
  assert.ok(filtered.json.data.some((r) => r.id === 'clm_legacy_551'), 'legacy row under the terminated filter');
  const detail = await g.call(`/api/v1/orders/${orderId}`, { token: cust });
  assert.equal(detail.status, 200, detail.text);
  assert.ok((detail.json.data.claims || []).some((r) => r.id === 'clm_legacy_551'), 'legacy row in the buyer order detail');
});

await t.test('P0-01 legacy: pending legacy claim settles exactly once under the old cap', async () => {
  const g = await boot();
  const uid = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com').id;
  const adm = await g.login('admin@openmarket.com', PW, 'ADMIN');
  const { orderId, subId } = mkPaidOrder(g, 'settle', { customerId: uid, skuId: 'sku_001_w', unitPrice: 49900, qty: 10, paid: 499000 });
  const before = balance(g, uid);
  insertRow(g, 'returns', {
    id: 'clm_legacy_552', order_id: orderId, user_id: uid, claim_type: 'PRICE_ADJUSTMENT',
    reason: 'stored before the scheme closed', status: 'REQUESTED', refund_amount: 100000,
    notes: 'legacy', items_json: JSON.stringify([{ order_item_id: 'itm_funds_settle', sub_order_id: subId, qty: 10, unit_diff: 10000, line_diff: 100000 }])
  });
  const a1 = await g.call('/api/v1/admin/claims/clm_legacy_552', { method: 'PUT', token: adm, body: { decision: 'APPROVE' } });
  assert.equal(a1.status, 200, a1.text);
  assert.equal(a1.json.granted, 10000); // min(100000 raw, 49900 = 10% paid, 10000 hard cap)
  assert.equal(balance(g, uid) - before, 10000);
  const claim = g.one('SELECT status, refund_amount FROM returns WHERE id = ?', 'clm_legacy_552');
  assert.equal(claim.status, 'REFUNDED');
  assert.equal(claim.refund_amount, 10000);
  const stl = g.one('SELECT id FROM settlements WHERE sub_order_id = ?', subId);
  const adj = g.all('SELECT net_delta, partner_id FROM settlement_adjustments WHERE settlement_id = ?', stl.id);
  assert.equal(adj.length, 1);
  assert.equal(adj[0].net_delta, -10000);
  assert.equal(adj[0].partner_id, 'pt_001');
  const a2 = await g.call('/api/v1/admin/claims/clm_legacy_552', { method: 'PUT', token: adm, body: { decision: 'APPROVE' } });
  assert.equal(a2.status, 409);
  assert.equal(a2.json.code, 'CLAIM_ALREADY_PROCESSED');
  assert.equal(balance(g, uid) - before, 10000);
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
  // 2-6: sku_002_65w rides the seed flash deal (18900), so the 20% cap applies to 37800.
  assert.equal(r.json.data.credit_used_amount, 7560); // floor(37800 * 0.20)
});

await t.test('P0-02 UI copy matches the retired price scheme and the credit cap', async () => {
  const detail = fs.readFileSync('apps/storefront/src/views/OrderDetailView.vue', 'utf8');
  assert.ok(!detail.includes('PRICE_ADJUSTMENT'), 'no price-claim filing from the order screen');
  assert.ok(!detail.includes('차액 보상 신청'), 'price-claim button gone from the order screen');
  assert.ok(detail.includes('handleLateDeliveryClaim'), 'late-delivery claim stays on the order screen');
  const claims = fs.readFileSync('apps/admin/src/views/claims/ClaimListView.vue', 'utf8');
  assert.ok(claims.includes('PRICE_ADJUSTMENT') && claims.includes('종료된 제도'), 'admin still reads legacy price claims as a terminated scheme');
  assert.ok(claims.includes('승인·적립금 지급'), 'admin can settle pending legacy price claims');
  const checkout = fs.readFileSync('apps/storefront/src/views/CheckoutView.vue', 'utf8');
  assert.ok(checkout.includes('20%까지'), 'checkout states the credit cap');
  const partner = fs.readFileSync('apps/cloudflare-gateway/src/routes/partner.js', 'utf8');
  // T06: each price PUT stamps in scoped-SKU form (WHERE id) and bulk form
  // (WHERE product_id), so the 24h P0-01 clock is preserved per SKU.
  // 2-9: bulk-update adds the fifth unconditional stamp (the skus[] upsert
  // stamps conditionally via CASE WHEN, so it is not counted here).
  assert.equal(partner.split('price_updated_at = CURRENT_TIMESTAMP').length - 1, 5, 'all price PUTs stamp the 24h clock in scoped and bulk form');
  assert.ok(partner.includes('price_updated_at = CURRENT_TIMESTAMP WHERE id = ?'), 'scoped SKU update stamps only that SKU');
  const bidding = fs.readFileSync('apps/cloudflare-gateway/src/routes/bidding-m2c.js', 'utf8');
  assert.ok(bidding.includes('price_updated_at = CURRENT_TIMESTAMP'), 'bidding award stamps the 24h clock');
});

t.finish();
