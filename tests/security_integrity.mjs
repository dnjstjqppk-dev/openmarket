// tests/security_integrity.mjs
// Adversarial security + transaction-integrity suite for the OLMOA gateway (V3.0 directive, sections 4/5/9).
// Run: node tests/security_integrity.mjs        (requires: node scripts/gen-dev-seed.mjs once)

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { signJwt } from '../apps/cloudflare-gateway/src/utils/crypto-auth.js';
import { allocate, proportionalPortion } from '../apps/cloudflare-gateway/src/lib/money.js';

const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = { JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox', PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef', CARRIER_WEBHOOK_SECRET: 'carrier-secret-0123456789ab' };
const ADDR = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };

async function boot(env = {}) {
  const g = await createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
  const q = (sql, ...p) => g.db.prepare(sql).all(...p).map((r) => ({ ...r }));
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  const checkout = (token, items, extra = {}, headers = {}) => g.call('/api/v1/orders/checkout', { method: 'POST', token, headers, body: { ...ADDR, items, ...extra } });
  const pay = (token, order, key = `sandbox_${Math.random().toString(36).slice(2, 12)}xx`) =>
    g.call('/api/v1/payments/confirm', { method: 'POST', token, body: { order_id: order.order_id, payment_key: key, amount: order.total_pay_amount } });
  const directSku = one("SELECT s.id, s.sale_price FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 20 ORDER BY s.id LIMIT 1");
  const mpSkus = q("SELECT s.id, s.sale_price FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 20 ORDER BY s.id LIMIT 3");
  const credit = (uid) => one('SELECT COALESCE(SUM(amount_delta),0) b FROM user_credits WHERE user_id = ?', uid).b;
  const stock = (sku) => one('SELECT stock_quantity s FROM product_skus WHERE id = ?', sku).s;
  const ship = async (ptToken, orderId) => {
    const subs = q("SELECT id FROM sub_orders WHERE parent_order_id = ? AND status IN ('PAYMENT_CONFIRMED','PREPARING')", orderId);
    for (const s of subs) await g.call(`/api/v1/partner/orders/${s.id}/shipment`, { method: 'PUT', token: ptToken, body: { carrier: 'CJ대한통운', tracking_number: `TRK${Math.floor(Math.random() * 1e9)}` } });
  };
  return { ...g, q, one, login, checkout, pay, directSku, mpSkus, credit, stock, ship };
}

const t = createRunner('OLMOA Security & Integrity Suite');

// ============================== SECURITY ==============================
const S = await boot();
const cust = await S.login('customer@example.com');
const cust2 = await S.login('alex.kim@olmoa.com');
const pt1 = await S.login('seller@temu-supply.com', 'PARTNER');
const pt2 = await S.login('partner2@olmoa-tech.com', 'PARTNER');
const adm = await S.login('admin@openmarket.com', 'ADMIN');

await t.test('S01 forged legacy admin token rejected', async () => {
  assert.equal((await S.call('/api/v1/admin/dashboard', { token: 'ey-olmoa-admin-anything' })).status, 401);
  assert.equal((await S.call('/api/v1/admin/users', { token: 'eyJhbGciOiJub25lIn0.e30.' })).status, 401);
});
await t.test('S02 customer and partner JWTs cannot use admin API', async () => {
  assert.equal((await S.call('/api/v1/admin/dashboard', { token: cust })).status, 403);
  assert.equal((await S.call('/api/v1/admin/reconciliation', { token: pt1 })).status, 403);
  assert.equal((await S.call('/api/v1/admin/dashboard', { token: adm })).status, 200);
});
await t.test('S03 admin login requires the real password and matching role', async () => {
  assert.equal((await S.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: 'qwerty123', role: 'ADMIN' } })).status, 401);
  assert.equal((await S.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@x.com', password: 'qwerty', role: 'ADMIN' } })).status, 401);
  const r = await S.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: PW, role: 'ADMIN' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.admin_secret, undefined, 'admin secret must never be returned');
  assert.equal((await S.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: PW, role: 'CUSTOMER' } })).status, 401);
});
await t.test('S04 partner login without password rejected', async () => {
  const r = await S.call('/api/v1/auth/login', { method: 'POST', body: { email: 'seller@temu-supply.com', role: 'PARTNER' } });
  assert.ok([400, 401].includes(r.status));
});
await t.test('S05 identity headers are ignored (X-Partner-Id / X-Customer-Id)', async () => {
  assert.equal((await S.call('/api/v1/partner/settlements', { headers: { 'X-Partner-Id': 'pt_002' } })).status, 401);
  assert.equal((await S.call('/api/v1/addresses', { headers: { 'X-Customer-Id': 'u_customer_001' } })).status, 401);
  assert.equal((await S.call('/api/v1/orders', { headers: { 'X-Customer-Id': 'u_customer_001' } })).status, 401);
  const r = await S.call('/api/v1/partner/settlements', { token: pt1, headers: { 'X-Partner-Id': 'pt_002' } });
  assert.equal(r.json.partner_id, 'pt_001', 'tenant comes from the token, not the header');
});
await t.test('S06 unknown e-mail never falls back to another account', async () => {
  assert.equal((await S.call('/api/v1/auth/login', { method: 'POST', body: { email: 'nobody@nowhere.com', password: 'whatever123!' } })).status, 401);
  assert.equal((await S.call('/api/v1/auth/login', { method: 'POST', body: { email: 'nobody@nowhere.com' } })).status, 400);
});
await t.test('S07 social login with unverified e-mail disabled', async () => {
  const r = await S.call('/api/v1/auth/social-login', { method: 'POST', body: { provider: 'KAKAO', email: 'customer@example.com' } });
  assert.equal(r.status, 501);
  assert.equal(r.json.token, undefined);
});
await t.test('S08 password-reset token never returned outside development', async () => {
  const r = await S.call('/api/v1/auth/forgot-password', { method: 'POST', body: { email: 'customer@example.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.reset_token, undefined);
  assert.equal(r.json.dev_reset_token, undefined);
  const stored = S.one('SELECT token FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1');
  assert.match(stored.token, /^[0-9a-f]{64}$/, 'only the SHA-256 of the token is stored');
});
await t.test('S09 tampered / foreign-key / alg=none JWTs rejected', async () => {
  const [h, , sig] = cust.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ sub: 'u_admin_001', role: 'ROLE_ADMIN', tv: 0, exp: 4102444800 })).toString('base64url');
  assert.equal((await S.call('/api/v1/admin/dashboard', { token: `${h}.${forgedBody}.${sig}` })).status, 401);
  const otherKey = await signJwt({ sub: 'u_admin_001', role: 'ROLE_ADMIN', tv: 0 }, 'another-secret-another-secret-another-secret');
  assert.equal((await S.call('/api/v1/admin/dashboard', { token: otherKey })).status, 401);
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${forgedBody}.`;
  assert.equal((await S.call('/api/v1/admin/dashboard', { token: none })).status, 401);
});
await t.test('S10 missing JWT_SECRET fails closed (no built-in default secret)', async () => {
  const g = await boot({ JWT_SECRET: undefined });
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'customer@example.com', password: PW } });
  assert.equal(r.status, 503);
});
await t.test('S11 brute force locks the account after 5 failures', async () => {
  const g = await boot();
  for (let i = 0; i < 5; i++) await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'alex.kim@olmoa.com', password: `wrong-${i}-Pass!` } });
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'alex.kim@olmoa.com', password: PW } });
  assert.equal(r.status, 423);
});
await t.test('S12 password change revokes previously issued tokens', async () => {
  const g = await boot();
  const tok = await g.login('alex.kim@olmoa.com');
  const r = await g.call('/api/v1/auth/profile', { method: 'PUT', token: tok, body: { current_password: PW, new_password: 'NewPass!2026#x' } });
  assert.equal(r.status, 200);
  assert.equal((await g.call('/api/v1/auth/me', { token: tok })).status, 401);
  assert.equal((await g.call('/api/v1/auth/me', { token: r.json.data.token })).status, 200);
});
await t.test('S13 customer cannot read or cancel another customer\'s order', async () => {
  const o = (await S.checkout(cust, [{ sku_id: S.mpSkus[0].id, quantity: 1 }])).json;
  assert.equal((await S.call(`/api/v1/orders/${o.order_id}`, { token: cust2 })).status, 403);
  assert.equal((await S.call(`/api/v1/orders/${o.order_id}/cancel`, { method: 'POST', token: cust2 })).status, 403);
  assert.equal((await S.call(`/api/v1/orders/${o.order_id}/tracking`, { token: cust2 })).status, 403);
});
await t.test('S14 seller cannot ship another seller\'s sub-order', async () => {
  const o = (await S.checkout(cust, [{ sku_id: S.mpSkus[0].id, quantity: 1 }])).json;
  await S.pay(cust, o);
  const sub = S.one('SELECT id FROM sub_orders WHERE parent_order_id = ?', o.order_id);
  const r = await S.call(`/api/v1/partner/orders/${sub.id}/shipment`, { method: 'PUT', token: pt1, body: { tracking_number: 'TRK12345678' } });
  assert.equal(r.status, 409);
  assert.equal(S.one('SELECT status FROM sub_orders WHERE id = ?', sub.id).status, 'PAYMENT_CONFIRMED');
});
await t.test('S15 unauthenticated payment / carrier webhooks cannot change orders', async () => {
  const o = (await S.checkout(cust, [{ sku_id: S.mpSkus[1].id, quantity: 1 }])).json;
  const w = await S.call('/api/v1/payments/webhook', { method: 'POST', body: { eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: o.order_no, paymentKey: 'sandbox_x1234567', status: 'DONE', totalAmount: o.total_pay_amount } } });
  assert.equal(w.status, 401);
  assert.equal(S.one('SELECT payment_status FROM orders WHERE id = ?', o.order_id).payment_status, 'READY');
  const c = await S.call('/api/v1/logistics/milestone-webhook', { method: 'POST', body: { sub_order_id: 'x', milestone: 'DELIVERED' } });
  assert.equal(c.status, 401);
});
await t.test('S16 admin-only side endpoints (SMS dispatch, QC desk, IPR list, control tower) protected', async () => {
  assert.equal((await S.call('/api/v1/notifications/dispatch', { method: 'POST', token: cust, body: { recipient: '01012345678', content: 'x' } })).status, 403);
  assert.equal((await S.call('/api/v1/notifications/dispatch', { method: 'POST', body: { recipient: '01012345678', content: 'x' } })).status, 401);
  assert.equal((await S.call('/api/v1/admin/sample-qc')).status, 401);
  assert.equal((await S.call('/api/v1/admin/ipr-reports')).status, 401);
  assert.equal((await S.call('/api/v1/admin/control-tower')).status, 401);
  const d = await S.call('/api/v1/notifications/dispatch', { method: 'POST', token: adm, body: { recipient: '01012345678', content: 'x' } });
  assert.equal(d.json.data.status, 'NOT_SENT_PROVIDER_NOT_CONFIGURED', 'no fake SENT without a provider');
});
await t.test('S17 PII endpoints require ownership (tracking, addresses)', async () => {
  const sub = S.one('SELECT id FROM sub_orders LIMIT 1');
  assert.equal((await S.call(`/api/v1/logistics/tracking/${sub.id}`)).status, 401);
  assert.equal((await S.call(`/api/v1/logistics/tracking/${sub.id}`, { token: cust2 })).status, 403);
});
await t.test('S18 upload requires auth and rejects SVG', async () => {
  assert.equal((await S.call('/api/v1/storage/upload', { method: 'POST', body: { file_data: 'aGVsbG8=', content_type: 'image/png' } })).status, 401);
  const svg = Buffer.from('<svg onload="alert(1)"/>').toString('base64');
  assert.equal((await S.call('/api/v1/storage/upload', { method: 'POST', token: pt1, body: { file_data: `data:image/svg+xml;base64,${svg}` } })).status, 400);
});
await t.test('S19 IPR report by an anonymous party does not hide products', async () => {
  const pid = S.one("SELECT id FROM products WHERE status = 'ACTIVE' LIMIT 1").id;
  assert.equal((await S.call('/api/v1/ipr/report', { method: 'POST', body: { target_product_id: pid } })).status, 401);
  await S.call('/api/v1/ipr/report', { method: 'POST', token: cust2, body: { target_product_id: pid, reporter_name: 'x', brand_name: 'y', evidence_url: 'https://e' } });
  assert.equal(S.one('SELECT status FROM products WHERE id = ?', pid).status, 'ACTIVE');
});
await t.test('S20 CORS reflects only allow-listed origins in production', async () => {
  const g = await boot({ ENVIRONMENT: 'production', ALLOWED_ORIGINS: 'https://olmoa.com' });
  const bad = await g.call('/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  const good = await g.call('/health', { headers: { Origin: 'https://olmoa.com' } });
  assert.equal(good.headers.get('Access-Control-Allow-Origin'), 'https://olmoa.com');
});
await t.test('S21 internal errors do not leak details in production', async () => {
  const g = await boot({ ENVIRONMENT: 'production' });
  const realPrepare = g.env.DB.prepare;
  g.env.DB.prepare = (sql) => { if (sql.includes('FROM categories c')) throw new Error('SECRET_INTERNAL_DETAIL'); return realPrepare(sql); };
  const r = await g.call('/api/v1/categories');
  assert.equal(r.status, 500);
  assert.ok(!r.text.includes('SECRET_INTERNAL_DETAIL'));
  assert.ok(r.json.request_id);
});
await t.test('S22 dev-only carrier simulator unavailable in production and to customers', async () => {
  const g = await boot({ ENVIRONMENT: 'production' });
  const tok = await g.login('customer@example.com');
  assert.equal((await g.call('/api/v1/orders/x/advance-tracking', { method: 'POST', token: tok })).status, 404);
  assert.equal((await S.call('/api/v1/orders/x/advance-tracking', { method: 'POST', token: cust })).status, 403);
});

// ============================== INTEGRITY ==============================
const I = await boot();
const c1 = await I.login('customer@example.com');
const c2 = await I.login('alex.kim@olmoa.com');
const p1 = await I.login('seller@temu-supply.com', 'PARTNER');
const p2 = await I.login('partner2@olmoa-tech.com', 'PARTNER');
const ad = await I.login('admin@openmarket.com', 'ADMIN');
const [m0, m1, m2] = I.mpSkus;
const deliver = async (orderId) => {
  await I.ship(p1, orderId); await I.ship(p2, orderId);
  for (const s of I.q("SELECT id FROM sub_orders WHERE parent_order_id = ? AND status = 'SHIPPED'", orderId)) {
    const r = await I.call(`/api/v1/admin/sub-orders/${s.id}/delivered`, { method: 'POST', token: ad, body: { evidence: 'CJ 조회 배송완료' } });
    assert.equal(r.status, 200, r.text);
  }
};

await t.test('I01 checkout reserves stock and creates an UNPAID order (no fake PAID)', async () => {
  const before = I.stock(m0.id);
  const r = await I.checkout(c1, [{ sku_id: m0.id, quantity: 2 }]);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.payment_status, 'READY');
  assert.equal(I.stock(m0.id), before - 2);
  assert.equal(I.one('SELECT COUNT(*) c FROM payment_transactions WHERE order_id = ?', r.json.order_id).c, 0);
  assert.equal(I.one('SELECT st.status FROM settlements st JOIN sub_orders s ON s.id = st.sub_order_id WHERE s.parent_order_id = ?', r.json.order_id).status, 'HOLD');
  assert.equal(I.one('SELECT operator_entity_id e FROM orders WHERE id = ?', r.json.order_id).e, 'be_dev_sole');
});
await t.test('I02 client-supplied prices / customer_id ignored (server price authority)', async () => {
  const r = await I.checkout(c1, [{ sku_id: m0.id, quantity: 1, unit_price: 1 }], { customer_id: 'cust_demo_001' });
  assert.equal(r.json.total_goods_amount, m0.sale_price);
  assert.equal(I.one('SELECT customer_id FROM orders WHERE id = ?', r.json.order_id).customer_id, 'u_customer_001');
});
await t.test('I03 payment confirm: wrong amount rejected, double click idempotent, single capture', async () => {
  const o = (await I.checkout(c1, [{ sku_id: m0.id, quantity: 1 }])).json;
  const bad = await I.call('/api/v1/payments/confirm', { method: 'POST', token: c1, body: { order_id: o.order_id, payment_key: 'sandbox_abcdefgh12', amount: o.total_pay_amount - 1 } });
  assert.equal(bad.status, 400);
  const key = 'sandbox_doubleclick01';
  const [a, b] = await Promise.all([I.pay(c1, o, key), I.pay(c1, o, key)]);
  assert.ok([a.status, b.status].every((s) => s === 200), `${a.text} | ${b.text}`);
  assert.equal(I.one('SELECT COUNT(*) c FROM payment_transactions WHERE order_id = ?', o.order_id).c, 1);
  assert.equal(I.one('SELECT payment_status FROM orders WHERE id = ?', o.order_id).payment_status, 'PAID');
  const other = await I.pay(c1, o, 'sandbox_otherkey9999');
  assert.equal(other.status, 409, 'a second, different payment for the same order is refused');
});
await t.test('I04 duplicate checkout with same idempotency key creates one order', async () => {
  const before = I.stock(m1.id);
  const h = { 'X-Idempotency-Key': 'idem-checkout-0001' };
  const [a, b] = await Promise.all([I.checkout(c1, [{ sku_id: m1.id, quantity: 1 }], {}, h), I.checkout(c1, [{ sku_id: m1.id, quantity: 1 }], {}, h)]);
  assert.equal(a.json.order_id, b.json.order_id);
  assert.equal(I.stock(m1.id), before - 1);
});
await t.test('I05 oversell race: concurrent buyer takes last unit between check and write', async () => {
  I.db.prepare('UPDATE product_skus SET stock_quantity = 1 WHERE id = ?').run(m2.id);
  const real = I.env.DB.batch.bind(I.env.DB);
  I.env.DB.batch = async (st) => { I.db.prepare('UPDATE product_skus SET stock_quantity = 0 WHERE id = ?').run(m2.id); I.env.DB.batch = real; return real(st); };
  const before = I.one('SELECT COUNT(*) c FROM orders').c;
  const r = await I.checkout(c1, [{ sku_id: m2.id, quantity: 1 }]);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'STOCK_INSUFFICIENT');
  assert.equal(I.stock(m2.id), 0);
  assert.equal(I.one('SELECT COUNT(*) c FROM orders').c, before, 'atomic rollback: no order row left behind');
  I.db.prepare('UPDATE product_skus SET stock_quantity = 500 WHERE id = ?').run(m2.id);
});
await t.test('I06 two buyers, one unit: exactly one order succeeds', async () => {
  I.db.prepare('UPDATE product_skus SET stock_quantity = 1 WHERE id = ?').run(m2.id);
  const [a, b] = await Promise.all([I.checkout(c1, [{ sku_id: m2.id, quantity: 1 }]), I.checkout(c2, [{ sku_id: m2.id, quantity: 1 }])]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(I.stock(m2.id), 0);
  I.db.prepare('UPDATE product_skus SET stock_quantity = 500 WHERE id = ?').run(m2.id);
});
await t.test('I07 coupons: must be owned, single use, restored only on full cancel', async () => {
  const notOwned = await I.checkout(c2, [{ sku_id: m0.id, quantity: 3 }], { coupon_code: 'WELCOME10' });
  assert.equal(notOwned.status, 409);
  const o = (await I.checkout(c1, [{ sku_id: m0.id, quantity: 3 }], { coupon_code: 'WELCOME10' })).json;
  assert.ok(o.coupon_discount_amount > 0);
  const reuse = await I.checkout(c1, [{ sku_id: m0.id, quantity: 3 }], { coupon_code: 'WELCOME10' });
  assert.equal(reuse.status, 409);
  await I.call(`/api/v1/orders/${o.order_id}/cancel`, { method: 'POST', token: c1 });
  assert.equal(I.one("SELECT is_used FROM user_coupons WHERE id = 'uc_001'").is_used, 0);
});
await t.test('I08 credits: cannot exceed balance; concurrent double-spend blocked by DB', async () => {
  const bal = I.credit('cust_demo_001');
  I.db.prepare("INSERT INTO user_credits (id, user_id, amount_delta, balance_after, reason) VALUES ('crd_test_seed', 'cust_demo_001', 5000, 5000, 'test grant')").run();
  I.db.prepare("INSERT INTO journal_entries (id, txn_id, txn_type, account_code, debit, credit) VALUES ('j_t1','txn_t1','TEST','MARKETING_EXPENSE',5000,0),('j_t2','txn_t1','TEST','CUSTOMER_CREDIT_LIABILITY',0,5000)").run();
  const total = bal + 5000;
  assert.equal((await I.checkout(c2, [{ sku_id: m0.id, quantity: 1 }], { use_credit_amount: total + 1 })).status, 409);
  const [a, b] = await Promise.all([
    I.checkout(c2, [{ sku_id: m0.id, quantity: 2 }], { use_credit_amount: total }),
    I.checkout(c2, [{ sku_id: m1.id, quantity: 2 }], { use_credit_amount: total })
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409], `${a.text} | ${b.text}`);
  assert.ok(I.credit('cust_demo_001') >= 0);
});
await t.test('I09 cancel unpaid order restores stock & credits exactly once', async () => {
  const s0 = I.stock(m1.id);
  const cr0 = I.credit('u_customer_001');
  const o = (await I.checkout(c1, [{ sku_id: m1.id, quantity: 2 }], { use_credit_amount: Math.min(1000, cr0) })).json;
  assert.equal((await I.call(`/api/v1/orders/${o.order_id}/cancel`, { method: 'POST', token: c1 })).status, 200);
  assert.equal(I.stock(m1.id), s0);
  assert.equal(I.credit('u_customer_001'), cr0);
  assert.equal((await I.call(`/api/v1/orders/${o.order_id}/cancel`, { method: 'POST', token: c1 })).status, 409);
  assert.equal(I.stock(m1.id), s0, 'second cancel must not restock again');
});
await t.test('I10 cancel paid order before shipment: exact PG refund, credits+coupon+stock restored', async () => {
  const s0 = I.stock(m0.id);
  const cr0 = I.credit('u_customer_001');
  const o = (await I.checkout(c1, [{ sku_id: m0.id, quantity: 3 }], { coupon_code: 'WELCOME10', use_credit_amount: Math.min(2000, cr0) })).json;
  await I.pay(c1, o);
  const r = await I.call(`/api/v1/orders/${o.order_id}/cancel`, { method: 'POST', token: c1 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.refund.pg_amount, o.total_pay_amount);
  assert.equal(r.json.refund.credit_amount, o.credit_used_amount);
  assert.equal(I.one('SELECT payment_status FROM orders WHERE id = ?', o.order_id).payment_status, 'CANCELLED');
  assert.equal(I.stock(m0.id), s0);
  assert.equal(I.credit('u_customer_001'), cr0);
  assert.equal(I.one("SELECT is_used FROM user_coupons WHERE id = 'uc_001'").is_used, 0);
});
let mixed;
await t.test('I11 mixed cart (direct + marketplace): split, PO for direct, settlement for marketplace', async () => {
  const r = await I.checkout(c1, [{ sku_id: I.directSku.id, quantity: 1 }, { sku_id: m0.id, quantity: 1 }, { sku_id: m1.id, quantity: 2 }], { coupon_code: 'OLMOA3000', use_credit_amount: 1500 });
  assert.equal(r.status, 201, r.text);
  mixed = r.json;
  assert.equal(mixed.sub_orders_created, 2);
  assert.equal((await I.pay(c1, mixed)).status, 200);
  const subs = I.q('SELECT id, sales_model FROM sub_orders WHERE parent_order_id = ?', mixed.order_id);
  const direct = subs.find((s) => s.sales_model === 'DIRECT');
  const mp = subs.find((s) => s.sales_model === 'MARKETPLACE');
  assert.equal(I.one('SELECT COUNT(*) c FROM purchase_orders WHERE sub_order_id = ?', direct.id).c, 1);
  assert.equal(I.one('SELECT COUNT(*) c FROM settlements WHERE sub_order_id = ?', direct.id).c, 0);
  assert.equal(I.one("SELECT status FROM settlements WHERE sub_order_id = ?", mp.id).status, 'PENDING');
});
await t.test('I12 partial cancel of one seller in a mixed order refunds exactly that seller\'s share', async () => {
  const mp = I.one("SELECT * FROM sub_orders WHERE parent_order_id = ? AND sales_model = 'MARKETPLACE'", mixed.order_id);
  const expectedPg = I.one('SELECT SUM(pg_alloc) v FROM order_items WHERE sub_order_id = ?', mp.id).v + mp.shipping_pg_alloc;
  const r = await I.call(`/api/v1/orders/${mixed.order_id}/sub-orders/${mp.id}/cancel`, { method: 'POST', token: c1 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.refund.pg_amount, expectedPg);
  assert.equal(r.json.status, 'PARTIAL_REFUNDED');
  assert.equal(I.one('SELECT status FROM settlements WHERE sub_order_id = ?', mp.id).status, 'CANCELLED');
  assert.equal(I.one('SELECT status FROM sub_orders WHERE id = ?', mp.id).status, 'CANCELLED');
  const direct = I.one("SELECT status FROM sub_orders WHERE parent_order_id = ? AND sales_model = 'DIRECT'", mixed.order_id);
  assert.equal(direct.status, 'PAYMENT_CONFIRMED');
});
await t.test('I13 seller cannot ship a cancelled sub-order', async () => {
  const mp = I.one("SELECT id FROM sub_orders WHERE parent_order_id = ? AND sales_model = 'MARKETPLACE'", mixed.order_id);
  assert.equal((await I.call(`/api/v1/partner/orders/${mp.id}/shipment`, { method: 'PUT', token: p2, body: { tracking_number: 'TRK99998888' } })).status, 409);
});
await t.test('I14 purchase confirm only after delivery; reward credited once', async () => {
  const o = (await I.checkout(c1, [{ sku_id: m0.id, quantity: 1 }])).json;
  await I.pay(c1, o);
  assert.equal((await I.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: c1 })).status, 409);
  await deliver(o.order_id);
  const cr0 = I.credit('u_customer_001');
  const a = await I.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: c1 });
  assert.equal(a.status, 200, a.text);
  const cr1 = I.credit('u_customer_001');
  assert.ok(cr1 > cr0);
  await I.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: c1 });
  await I.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: c1 });
  assert.equal(I.credit('u_customer_001'), cr1, 'no additional reward');
  assert.equal(I.one('SELECT st.status FROM settlements st JOIN sub_orders s ON s.id = st.sub_order_id WHERE s.parent_order_id = ?', o.order_id).status, 'ELIGIBLE_FOR_PAYOUT');
});
let retOrder;
await t.test('I15 return: client refund amount ignored, refund computed server-side on seller approval', async () => {
  retOrder = (await I.checkout(c1, [{ sku_id: m1.id, quantity: 3 }], { use_credit_amount: 700 })).json;
  await I.pay(c1, retOrder);
  await deliver(retOrder.order_id);
  const sub = I.one('SELECT id FROM sub_orders WHERE parent_order_id = ?', retOrder.order_id);
  const item = I.one('SELECT * FROM order_items WHERE sub_order_id = ?', sub.id);
  const claim = await I.call(`/api/v1/orders/${retOrder.order_id}/claims`, { method: 'POST', token: c1, body: { type: 'RETURN', sub_order_id: sub.id, items: [{ order_item_id: item.id, quantity: 1 }], refund_amount: 9999999, is_returnless: true } });
  assert.equal(claim.status, 201, claim.text);
  assert.equal(claim.json.status, 'REQUESTED', 'no instant self-approved refund');
  assert.equal((await I.call(`/api/v1/partner/returns/${claim.json.claim_id}`, { method: 'PUT', token: p1, body: { decision: 'APPROVE' } })).status, 403, 'other seller cannot approve');
  const ok = await I.call(`/api/v1/partner/returns/${claim.json.claim_id}`, { method: 'PUT', token: p2, body: { decision: 'APPROVE' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.refund.pg_amount + ok.json.refund.credit_amount, Math.floor(item.pg_alloc / 3) + Math.floor(item.credit_alloc / 3));
});
await t.test('I16 repeated partial refunds of the same line sum exactly to what was paid', async () => {
  const sub = I.one('SELECT id FROM sub_orders WHERE parent_order_id = ?', retOrder.order_id);
  const item = I.one('SELECT * FROM order_items WHERE sub_order_id = ?', sub.id);
  for (let i = 0; i < 2; i++) {
    const r = await I.call(`/api/v1/admin/orders/${retOrder.order_id}/refund`, { method: 'POST', token: ad, headers: { 'X-Idempotency-Key': `adm-rf-${i}-xxxx` }, body: { lines: [{ order_item_id: item.id, quantity: 1 }], reason: 'partial test', restock: true } });
    assert.equal(r.status, 200, r.text);
  }
  const after = I.one('SELECT * FROM order_items WHERE id = ?', item.id);
  assert.equal(after.refunded_quantity, 3);
  assert.equal(after.refunded_pg_amount, after.pg_alloc);
  assert.equal(after.refunded_credit_amount, after.credit_alloc);
  const extra = await I.call(`/api/v1/admin/orders/${retOrder.order_id}/refund`, { method: 'POST', token: ad, body: { lines: [{ order_item_id: item.id, quantity: 1 }], reason: 'over' } });
  assert.equal(extra.status, 409, 'cannot refund beyond quantity');
});
await t.test('I17 price adjustment: only on a real price drop, once per order', async () => {
  const o = (await I.checkout(c1, [{ sku_id: m2.id, quantity: 1 }])).json;
  await I.pay(c1, o);
  assert.equal((await I.call(`/api/v1/orders/${o.order_id}/claims`, { method: 'POST', token: c1, body: { type: 'PRICE_MATCH' } })).status, 409);
  I.db.prepare('UPDATE product_skus SET sale_price = sale_price - 1000 WHERE id = ?').run(m2.id);
  const cr0 = I.credit('u_customer_001');
  const a = await I.call(`/api/v1/orders/${o.order_id}/claims`, { method: 'POST', token: c1, body: { type: 'PRICE_MATCH' } });
  assert.equal(a.status, 201, a.text);
  assert.equal(I.credit('u_customer_001') - cr0, 1000);
  assert.equal((await I.call(`/api/v1/orders/${o.order_id}/claims`, { method: 'POST', token: c1, body: { type: 'PRICE_MATCH' } })).status, 409);
  I.db.prepare('UPDATE product_skus SET sale_price = sale_price + 1000 WHERE id = ?').run(m2.id);
});
await t.test('I18 refund after seller payout is carried as a deduction (no silent loss)', async () => {
  const o = (await I.checkout(c1, [{ sku_id: m0.id, quantity: 2 }])).json;
  await I.pay(c1, o);
  await deliver(o.order_id);
  await I.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: c1 });
  const pay1 = await I.call('/api/v1/admin/finance/payouts', { method: 'POST', token: ad, body: { partner_id: 'pt_002' } });
  assert.equal(pay1.status, 201, pay1.text);
  const item = I.one('SELECT i.* FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id WHERE s.parent_order_id = ?', o.order_id);
  const r = await I.call(`/api/v1/admin/orders/${o.order_id}/refund`, { method: 'POST', token: ad, body: { lines: [{ order_item_id: item.id, quantity: 2 }], reason: 'post-payout return' } });
  assert.equal(r.status, 200, r.text);
  const adj = I.one('SELECT SUM(net_delta) n FROM settlement_adjustments WHERE refund_id = ?', r.json.data.refund.id);
  assert.ok(adj.n < 0);
  const pay2 = await I.call('/api/v1/admin/finance/payouts', { method: 'POST', token: ad, body: { partner_id: 'pt_002' } });
  assert.equal(pay2.status, 409);
  assert.equal(pay2.json.code, 'NEGATIVE_BALANCE_CARRIED');
});
await t.test('I19 PG refund failure releases the reservation; retry succeeds', async () => {
  const g = await boot({ __SANDBOX_FAIL_CANCEL: true });
  const tok = await g.login('customer@example.com');
  const o = (await g.checkout(tok, [{ sku_id: g.mpSkus[0].id, quantity: 1 }])).json;
  await g.pay(tok, o);
  const r = await g.call(`/api/v1/orders/${o.order_id}/cancel`, { method: 'POST', token: tok });
  assert.equal(r.status, 502);
  const ord = g.one('SELECT * FROM orders WHERE id = ?', o.order_id);
  assert.equal(ord.payment_status, 'PAID');
  assert.equal(ord.refunded_pg_amount, 0);
  assert.equal(g.one("SELECT status FROM refunds WHERE order_id = ?", o.order_id).status, 'FAILED');
  delete g.env.__SANDBOX_FAIL_CANCEL;
  // idempotency key of the failed attempt is consumed; a fresh admin refund with a new key succeeds
  const item = g.one('SELECT i.id, i.quantity FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id WHERE s.parent_order_id = ?', o.order_id);
  const adm2 = await g.login('admin@openmarket.com', 'ADMIN');
  const sub = g.one('SELECT id FROM sub_orders WHERE parent_order_id = ?', o.order_id);
  const ok = await g.call(`/api/v1/admin/orders/${o.order_id}/refund`, { method: 'POST', token: adm2, body: { lines: [{ order_item_id: item.id, quantity: item.quantity }], shipping_sub_order_ids: [sub.id], reason: 'retry', restock: true } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(g.one('SELECT payment_status FROM orders WHERE id = ?', o.order_id).payment_status, 'REFUNDED');
});
await t.test('I20 payment after expiry refused; expiry job releases stock and credits', async () => {
  const s0 = I.stock(m1.id);
  const cr0 = I.credit('u_customer_001');
  const o = (await I.checkout(c1, [{ sku_id: m1.id, quantity: 1 }], { use_credit_amount: 300 })).json;
  I.db.prepare("UPDATE orders SET payment_expires_at = '2000-01-01 00:00:00' WHERE id = ?").run(o.order_id);
  const p = await I.pay(c1, o);
  assert.equal(p.status, 409);
  assert.equal(p.json.code, 'ORDER_EXPIRED');
  const e = await I.call('/api/v1/orders/cron/expire', { method: 'POST', token: ad });
  assert.ok(e.json.expired_count >= 1);
  assert.equal(I.stock(m1.id), s0);
  assert.equal(I.credit('u_customer_001'), cr0);
  assert.equal(I.one('SELECT payment_status FROM orders WHERE id = ?', o.order_id).payment_status, 'EXPIRED');
});
await t.test('I21 PG approved but DB commit fails -> payment auto-compensated (never "paid" without order)', async () => {
  const o = (await I.checkout(c1, [{ sku_id: m1.id, quantity: 1 }])).json;
  const real = I.env.DB.batch.bind(I.env.DB);
  I.env.DB.batch = async (st) => { I.db.prepare("UPDATE orders SET payment_status = 'EXPIRED' WHERE id = ?").run(o.order_id); I.env.DB.batch = real; return real(st); };
  const r = await I.pay(c1, o);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'PAYMENT_COMPENSATED');
  assert.equal(I.one('SELECT COUNT(*) c FROM payment_transactions WHERE order_id = ?', o.order_id).c, 0);
  assert.equal(I.one("SELECT outcome FROM payment_events WHERE order_id = ? AND event_type = 'CAPTURE_COMPENSATION'", o.order_id).outcome, 'PG_CANCELLED');
});
await t.test('I22 verified webhook captures a READY order; duplicate delivery ignored', async () => {
  const o = (await I.checkout(c1, [{ sku_id: m0.id, quantity: 1 }])).json;
  const body = { eventType: 'PAYMENT_STATUS_CHANGED', createdAt: '2026-11-05T00:00:00', data: { orderId: o.order_no, paymentKey: 'sandbox_webhook0001', status: 'DONE', totalAmount: o.total_pay_amount } };
  const h = { 'X-Webhook-Secret': BASE_ENV.PAYMENT_WEBHOOK_SECRET };
  const a = await I.call('/api/v1/payments/webhook', { method: 'POST', headers: h, body });
  assert.equal(a.json.outcome, 'CAPTURED_FROM_WEBHOOK', a.text);
  const b = await I.call('/api/v1/payments/webhook', { method: 'POST', headers: h, body });
  assert.equal(b.json.duplicate, true);
  assert.equal(I.one('SELECT COUNT(*) c FROM payment_transactions WHERE order_id = ?', o.order_id).c, 1);
});
await t.test('I23 sandbox payments refused in production; no operator -> no checkout', async () => {
  const g = await boot({ ENVIRONMENT: 'production' });
  const tok = await g.login('customer@example.com');
  const o = (await g.checkout(tok, [{ sku_id: g.mpSkus[0].id, quantity: 1 }])).json;
  assert.equal((await g.pay(tok, o)).status, 503);
  g.db.prepare("UPDATE business_entities SET status = 'RETIRED'").run();
  const r = await g.checkout(tok, [{ sku_id: g.mpSkus[0].id, quantity: 1 }]);
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'OPERATOR_NOT_CONFIGURED');
});
await t.test('I24 DIRECT goods without a valid resale authorisation cannot be sold', async () => {
  I.db.prepare('UPDATE supplier_sku_mappings SET resale_authorized = 0 WHERE sku_id = ?').run(I.directSku.id);
  const r = await I.checkout(c1, [{ sku_id: I.directSku.id, quantity: 1 }]);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'DIRECT_SKU_NOT_SOURCEABLE');
  I.db.prepare('UPDATE supplier_sku_mappings SET resale_authorized = 1 WHERE sku_id = ?').run(I.directSku.id);
});
await t.test('I25 seller product needs operator review before it is visible or purchasable', async () => {
  const cr = await I.call('/api/v1/partner/products', { method: 'POST', token: p2, body: { title: '심사 테스트 상품 무선 마우스', sale_price: 19900, original_price: 25000, stock_quantity: 10, category_id: I.one('SELECT id FROM categories LIMIT 1').id, thumbnail_url: 'https://img.example/x.jpg' } });
  assert.equal(cr.status, 201, cr.text);
  const list = await I.call(`/api/v1/products?partner_id=pt_002&limit=200`);
  assert.ok(!list.json.data.some((p) => p.id === cr.json.product_id));
  assert.equal((await I.checkout(c1, [{ sku_id: cr.json.sku_id, quantity: 1 }])).status, 409);
  const ap = await I.call(`/api/v1/admin/products/${cr.json.product_id}/review`, { method: 'POST', token: ad, body: { decision: 'APPROVE' } });
  assert.equal(ap.status, 200);
  assert.equal((await I.checkout(c1, [{ sku_id: cr.json.sku_id, quantity: 1 }])).status, 201);
});
await t.test('I26 seller stock edit cannot overwrite a concurrent reservation', async () => {
  const real = I.env.DB.batch.bind(I.env.DB);
  I.env.DB.batch = async (st) => { I.db.prepare('UPDATE product_skus SET stock_quantity = stock_quantity - 1 WHERE id = ?').run(m0.id); I.env.DB.batch = real; return real(st); };
  const r = await I.call(`/api/v1/partner/products/${m0.id}/stock`, { method: 'PUT', token: p2, body: { sku_id: m0.id, stock_quantity: 999 } });
  assert.equal(r.status, 409);
  assert.notEqual(I.stock(m0.id), 999);
});
await t.test('I27 payout-account change is queued for verification, never applied directly', async () => {
  const before = I.one("SELECT bank_account_number FROM partners WHERE id = 'pt_002'").bank_account_number;
  const r = await I.call('/api/v1/partner/profile', { method: 'PUT', token: p2, body: { bank_account_number: '999-999-999999' } });
  assert.equal(r.json.payout_change_pending, true);
  assert.equal(I.one("SELECT bank_account_number FROM partners WHERE id = 'pt_002'").bank_account_number, before);
});
await t.test('I28 append-only ledgers and frozen entity attribution enforced by the database', async () => {
  assert.throws(() => I.db.prepare('UPDATE journal_entries SET debit = debit + 1').run(), /IMMUTABLE_LEDGER/);
  assert.throws(() => I.db.prepare('DELETE FROM inventory_ledger').run(), /IMMUTABLE_LEDGER/);
  assert.throws(() => I.db.prepare('DELETE FROM user_credits').run(), /IMMUTABLE_LEDGER/);
  assert.throws(() => I.db.prepare("UPDATE orders SET operator_entity_id = 'be_other' WHERE operator_entity_id = 'be_dev_sole'").run(), /ENTITY_ATTRIBUTION_IMMUTABLE/);
  assert.throws(() => I.db.prepare("UPDATE orders SET payment_status = 'PAID' WHERE payment_status = 'CANCELLED'").run(), /ILLEGAL_PAYMENT_TRANSITION/);
});
await t.test('I29 sole proprietor -> corporation switch: history stays, new orders go to the corporation', async () => {
  const oldOrders = I.one("SELECT COUNT(*) c FROM orders WHERE operator_entity_id = 'be_dev_sole'").c;
  const create = await I.call('/api/v1/admin/business-entities', { method: 'POST', token: ad, body: {
    entity_type: 'CORPORATION', legal_name: '주식회사 올모아(개발)', representative_name: '개발 대표', business_reg_number: '2208100016', corporate_reg_number: '110111-1234567',
    mail_order_reg_number: '제0000-법인-0001호', address: '서울특별시 (법인 개발 주소)', cs_phone: '02-1111-1111', cs_email: 'cs@corp.invalid', privacy_officer_name: '법인 책임자', privacy_officer_email: 'p@corp.invalid' } });
  assert.equal(create.status, 201, create.text);
  const corpId = create.json.data.id;
  assert.equal((await I.call(`/api/v1/admin/business-entities/${corpId}/activate`, { method: 'POST', token: ad, body: {} })).status, 400, 'legal review confirmation required');
  const act = await I.call(`/api/v1/admin/business-entities/${corpId}/activate`, { method: 'POST', token: ad, body: { confirm_legal_review: true, note: 'test switch' } });
  assert.equal(act.status, 200, act.text);
  assert.ok(act.json.data.predecessor_open_obligations, 'open obligations of the sole proprietor are reported');
  assert.equal(I.one("SELECT COUNT(*) c FROM orders WHERE operator_entity_id = 'be_dev_sole'").c, oldOrders, 'no re-attribution');
  assert.equal(I.one("SELECT status FROM business_entities WHERE id = 'be_dev_sole'").status, 'RETIRED');
  const o = (await I.checkout(c1, [{ sku_id: I.directSku.id, quantity: 1 }, { sku_id: m0.id, quantity: 1 }])).json;
  assert.equal(I.one('SELECT operator_entity_id e FROM orders WHERE id = ?', o.order_id).e, corpId);
  await I.pay(c1, o);
  assert.equal(I.one('SELECT DISTINCT entity_id e FROM journal_entries WHERE order_id = ?', o.order_id).e, corpId);
  const info = await I.call('/api/v1/business-info');
  assert.equal(info.json.data.legal_name, '주식회사 올모아(개발)');
  const brn = await I.call('/api/v1/admin/business-entities', { method: 'POST', token: ad, body: { entity_type: 'INDIVIDUAL', legal_name: 'x', representative_name: 'y', business_reg_number: '1234567890' } });
  assert.equal(brn.status, 400, 'business registration number check digit validated');
});
await t.test('I30 money allocation is exact for random carts (property test, 2,000 cases)', async () => {
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 2000; k++) {
    const weights = Array.from({ length: 1 + rnd(8) }, () => rnd(200000));
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum === 0) continue;
    const total = rnd(sum + 1);
    const parts = allocate(total, weights);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
    parts.forEach((p, i) => assert.ok(p >= 0 && p <= weights[i]));
    const qty = 1 + rnd(9);
    let refunded = 0; let rq = 0;
    while (rq < qty) { const step = 1 + rnd(qty - rq); refunded += proportionalPortion(parts[0], refunded, step, qty, rq); rq += step; }
    assert.equal(refunded, parts[0], 'sequential partial refunds sum to the allocated amount');
  }
});
// ---- O18 rolling reserve / entity-split payouts, O19 scheduled reconciliation (fresh gateways) ----
async function bootMarketplace(env = {}) {
  const g = await boot(env);
  const tok = { c: await g.login('customer@example.com'), p1: await g.login('seller@temu-supply.com', 'PARTNER'), p2: await g.login('partner2@olmoa-tech.com', 'PARTNER'), ad: await g.login('admin@openmarket.com', 'ADMIN') };
  const sellAndConfirm = async (items) => {
    const o = (await g.checkout(tok.c, items)).json;
    assert.equal((await g.pay(tok.c, o)).status, 200);
    await g.ship(tok.p1, o.order_id); await g.ship(tok.p2, o.order_id);
    for (const s of g.q("SELECT id FROM sub_orders WHERE parent_order_id = ? AND status = 'SHIPPED'", o.order_id)) {
      assert.equal((await g.call(`/api/v1/admin/sub-orders/${s.id}/delivered`, { method: 'POST', token: tok.ad, body: { evidence: 'CJ 조회 배송완료' } })).status, 200);
    }
    assert.equal((await g.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: tok.c })).status, 200);
    return o;
  };
  const payout = () => g.call('/api/v1/admin/finance/payouts', { method: 'POST', token: tok.ad, body: { partner_id: 'pt_002' } });
  const recon = async () => {
    const r = await g.call('/api/v1/admin/reconciliation', { token: tok.ad });
    assert.equal(r.status, 200, r.text);
    return r.json.data.checks.filter((c) => !c.ok && c.id !== 'R07').map((c) => `${c.id}:${JSON.stringify(c.violations).slice(0, 200)}`);
  };
  return { ...g, tok, sellAndConfirm, payout, recon };
}

await t.test('I32 rolling reserve is withheld at payout, stays owed, and is released exactly once after the hold period', async () => {
  const g = await bootMarketplace();
  const verify = (body) => g.call('/api/v1/admin/partners/pt_002/verify', { method: 'PUT', token: g.tok.ad, body: { status: 'APPROVED', ...body } });
  assert.equal((await verify({ rolling_reserve_pct: 80 })).status, 400, 'reserve above 50% rejected');
  assert.equal((await verify({ rolling_reserve_pct: -1 })).status, 400);
  assert.equal((await verify({ rolling_reserve_pct: 10, rolling_reserve_days: 0 })).status, 400);
  assert.equal((await verify({ rolling_reserve_pct: 10, rolling_reserve_days: 30 })).status, 200);

  await g.sellAndConfirm([{ sku_id: g.mpSkus[0].id, quantity: 3 }]);
  const gross = g.one("SELECT SUM(net_payout_amount) n FROM settlements WHERE partner_id = 'pt_002' AND status = 'ELIGIBLE_FOR_PAYOUT'").n;
  const p1 = await g.payout();
  assert.equal(p1.status, 201, p1.text);
  const held = Math.floor(gross * 1000 / 10000);
  assert.ok(held > 0);
  assert.deepEqual([p1.json.data.gross_amount, p1.json.data.reserve_held, p1.json.data.amount], [gross, held, gross - held]);
  const hold = g.one('SELECT * FROM payout_reserve_holds WHERE held_by_payout_id = ?', p1.json.data.payout_id);
  assert.equal(hold.amount, held);
  assert.ok(g.one("SELECT julianday(?) - julianday('now') d", hold.release_after).d > 29, 'held for the contract period');
  const bank = g.one("SELECT SUM(credit) c FROM journal_entries WHERE txn_type = 'SELLER_PAYOUT' AND account_code = 'BANK'").c;
  assert.equal(bank, gross - held, 'only the wired amount leaves the bank; the reserve stays in SELLER_PAYABLE');

  const early = await g.payout();
  assert.equal(early.json.code, 'NOTHING_TO_PAY', 'reserve is not paid before its release date');
  const ps = await g.call('/api/v1/partner/settlements', { token: g.tok.p2 });
  assert.equal(ps.json.summary.reserve_outstanding, held, 'seller sees what is withheld');

  g.db.prepare("UPDATE payout_reserve_holds SET release_after = datetime('now', '-1 minute') WHERE id = ?").run(hold.id);
  const p2 = await g.payout();
  assert.equal(p2.status, 201, p2.text);
  assert.deepEqual([p2.json.data.gross_amount, p2.json.data.reserve_released, p2.json.data.reserve_held, p2.json.data.amount], [0, held, 0, held]);
  assert.equal((await g.payout()).json.code, 'NOTHING_TO_PAY', 'a hold is released once');
  assert.throws(() => g.db.prepare('UPDATE payout_reserve_holds SET released_payout_id = NULL WHERE id = ?').run(hold.id), /RESERVE_HOLD_IMMUTABLE/);
  assert.throws(() => g.db.prepare('UPDATE payouts SET amount = amount + 1 WHERE id = ?').run(p2.json.data.payout_id), /PAYOUT_AMOUNTS_FROZEN/);
  assert.throws(() => g.db.prepare('DELETE FROM payouts WHERE id = ?').run(p1.json.data.payout_id), /IMMUTABLE_LEDGER/);
  assert.equal(g.one("SELECT SUM(credit) - SUM(debit) b FROM journal_entries WHERE account_code = 'SELLER_PAYABLE'").b, 0, 'seller fully paid, nothing lost or duplicated');
  assert.deepEqual(await g.recon(), []);
});

await t.test('I33 reserve is not taken from a net deduction, and released reserve can offset it', async () => {
  const g = await bootMarketplace();
  await g.call('/api/v1/admin/partners/pt_002/verify', { method: 'PUT', token: g.tok.ad, body: { status: 'APPROVED', rolling_reserve_pct: 20, rolling_reserve_days: 10 } });
  const o = await g.sellAndConfirm([{ sku_id: g.mpSkus[0].id, quantity: 2 }]);
  const p1 = await g.payout();
  assert.equal(p1.status, 201, p1.text);
  const item = g.one('SELECT i.* FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id WHERE s.parent_order_id = ?', o.order_id);
  assert.equal((await g.call(`/api/v1/admin/orders/${o.order_id}/refund`, { method: 'POST', token: g.tok.ad, body: { lines: [{ order_item_id: item.id, quantity: 1 }], reason: 'post-payout return' } })).status, 200);
  const neg = await g.payout();
  assert.equal(neg.json.code, 'NEGATIVE_BALANCE_CARRIED');
  assert.equal(g.one('SELECT COUNT(*) c FROM payout_reserve_holds').c, 1, 'no new reserve on a negative balance');
  g.db.prepare("UPDATE payout_reserve_holds SET release_after = datetime('now', '-1 minute')").run();
  const deduction = g.one('SELECT SUM(net_delta) n FROM settlement_adjustments WHERE applied_payout_id IS NULL').n;
  const held = p1.json.data.reserve_held;
  const p2 = await g.payout();
  if (held + deduction > 0) {
    assert.equal(p2.status, 201, p2.text);
    assert.equal(p2.json.data.amount, held + deduction);
  } else {
    assert.equal(p2.json.code, 'NEGATIVE_BALANCE_CARRIED');
  }
  assert.deepEqual(await g.recon(), []);
});

await t.test('I34 after 개인사업자 -> 법인 switch, one payout never mixes entities; each is journalled to its own entity', async () => {
  const g = await bootMarketplace();
  await g.sellAndConfirm([{ sku_id: g.mpSkus[0].id, quantity: 1 }]);
  const create = await g.call('/api/v1/admin/business-entities', { method: 'POST', token: g.tok.ad, body: {
    entity_type: 'CORPORATION', legal_name: '주식회사 올모아(개발)', representative_name: '개발 대표', business_reg_number: '2208100016', corporate_reg_number: '110111-1234567',
    mail_order_reg_number: '제0000-법인-0001호', address: '서울특별시 (법인 개발 주소)', cs_phone: '02-1111-1111', cs_email: 'cs@corp.invalid', privacy_officer_name: '법인 책임자', privacy_officer_email: 'p@corp.invalid' } });
  const corpId = create.json.data.id;
  assert.equal((await g.call(`/api/v1/admin/business-entities/${corpId}/activate`, { method: 'POST', token: g.tok.ad, body: { confirm_legal_review: true, note: 'test switch' } })).status, 200);
  await g.sellAndConfirm([{ sku_id: g.mpSkus[1].id, quantity: 1 }]);
  const a = await g.payout();
  assert.equal(a.status, 201, a.text);
  assert.equal(a.json.data.operator_entity_id, 'be_dev_sole');
  assert.equal(a.json.data.other_entities_pending, true);
  const b = await g.payout();
  assert.equal(b.status, 201, b.text);
  assert.equal(b.json.data.operator_entity_id, corpId);
  assert.equal(b.json.data.other_entities_pending, false);
  for (const [pid, ent] of [[a.json.data.payout_id, 'be_dev_sole'], [b.json.data.payout_id, corpId]]) {
    assert.equal(g.one("SELECT DISTINCT entity_id e FROM journal_entries WHERE txn_type = 'SELLER_PAYOUT' AND memo = ?", pid).e, ent);
  }
  assert.deepEqual(await g.recon(), []);
});

await t.test('I35 reconciliation runs on the cron (hourly), is recorded, and alerts on failure', async () => {
  const g = await bootMarketplace();
  const { recordReconciliation } = await import('../apps/cloudflare-gateway/src/routes/finance.js');
  const tick = async () => { await g.worker.scheduled({ cron: '*/5 * * * *' }, g.env, g.ctx); await Promise.all(g.scheduled.splice(0)); };
  await tick();
  assert.equal(g.one("SELECT COUNT(*) c FROM reconciliation_runs WHERE trigger_source = 'CRON'").c, 1);
  await tick();
  assert.equal(g.one("SELECT COUNT(*) c FROM reconciliation_runs WHERE trigger_source = 'CRON'").c, 1, 'not re-run inside the interval');
  assert.equal(g.one("SELECT ok FROM reconciliation_runs WHERE trigger_source = 'CRON'").ok, 1);

  // Corrupt the books: an unbalanced journal line must be caught and alerted.
  g.db.prepare("INSERT INTO journal_entries (id, txn_id, txn_type, account_code, debit, credit) VALUES ('jrn_bad', 'txn_bad', 'TEST', 'BANK', 1, 0)").run();
  const sent = [];
  const r1 = await recordReconciliation({ ...g.env, ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/x' }, 'CRON', { fetchImpl: async (u, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; } });
  assert.equal(r1.ok, false);
  assert.equal(r1.alert_status, 'SENT');
  assert.ok(sent[0].failed.some((f) => f.id === 'R01'));
  const r2 = await recordReconciliation(g.env, 'CRON');
  assert.equal(r2.alert_status, 'NO_CHANNEL', 'missing alert channel is recorded, not silently ignored');
  const r3 = await recordReconciliation({ ...g.env, ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/x' }, 'CRON', { fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(r3.alert_status, 'FAILED');
  const runs = await g.call('/api/v1/admin/finance/reconciliation-runs', { token: g.tok.ad });
  assert.equal(runs.status, 200);
  assert.equal(runs.json.data.last_cron.ok, false);
  assert.ok(runs.json.data.last_cron.failed_checks.some((f) => f.id === 'R01'));
  assert.equal((await g.call('/api/v1/admin/finance/reconciliation-runs', { token: g.tok.p2 })).status, 403);
  assert.throws(() => g.db.prepare('UPDATE reconciliation_runs SET ok = 1').run(), /IMMUTABLE_LEDGER/);
});

// ---- O10 withdrawal, data-subject export, PII access log, retention purge ----
const P = await bootMarketplace();
const NEW_PW = 'Withdraw!2026#ok';
const reg = await P.call('/api/v1/auth/register', { method: 'POST', body: { email: 'leaver@example.com', full_name: '김탈퇴', phone: '010-9999-0000', password: NEW_PW, agree_terms: true, agree_privacy: true } });
const leaverId = reg.json.customer_id;
let leaverTok = reg.json.token;
let leaverOrder;

await t.test('I36 withdrawal: blocked while an order is open, needs credit-forfeit consent, then pseudonymises and revokes', async () => {
  assert.equal(reg.status, 201, reg.text);
  P.db.prepare("INSERT INTO user_addresses (id, user_id, recipient_name, phone, postal_code, address_line1) VALUES ('adr_leaver', ?, '김탈퇴', '010-9999-0000', '06236', '서울 강남구 1')").run(leaverId);
  const pid = P.one('SELECT product_id p FROM product_skus WHERE id = ?', P.mpSkus[0].id).p;
  P.db.prepare("INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content, user_height_cm) VALUES ('rv_leaver', ?, ?, '김탈퇴', 5, '좋아요', 170)").run(pid, leaverId);
  leaverOrder = (await P.checkout(leaverTok, [{ sku_id: P.mpSkus[0].id, quantity: 1 }])).json;
  assert.equal((await P.pay(leaverTok, leaverOrder)).status, 200);

  const w = (body) => P.call('/api/v1/auth/withdraw', { method: 'POST', token: leaverTok, body: { password: NEW_PW, confirm: true, ...body } });
  const pre = await P.call('/api/v1/auth/withdraw/precheck', { token: leaverTok });
  assert.equal(pre.json.data.can_withdraw, false);
  const blocked = await w({ acknowledge_credit_forfeit: true });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'WITHDRAWAL_BLOCKED', 'cannot withdraw with a paid, undelivered order');
  assert.equal((await P.call(`/api/v1/orders/${leaverOrder.order_id}/cancel`, { method: 'POST', token: leaverTok })).status, 200);

  assert.equal((await w({ password: 'wrong-password-1A!' })).status, 400, 'password re-confirmation required');
  assert.equal((await w({ confirm: false })).status, 400);
  const credit = P.credit(leaverId);
  assert.ok(credit > 0, 'welcome credit present');
  const needConsent = await w({});
  assert.equal(needConsent.json.code, 'CREDIT_FORFEIT_CONSENT_REQUIRED');
  assert.equal((await P.call('/api/v1/auth/withdraw', { method: 'POST', token: P.tok.p2, body: { password: PW, confirm: true } })).json.code, 'WITHDRAWAL_NOT_SELF_SERVICE');

  const ok = await w({ acknowledge_credit_forfeit: true });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.data.credit_forfeited, credit);
  const u = P.one('SELECT * FROM users WHERE id = ?', leaverId);
  assert.equal(u.full_name, '탈퇴회원'); assert.equal(u.phone, ''); assert.equal(u.is_active, 0); assert.ok(u.withdrawn_at);
  assert.ok(!u.email.includes('leaver'), 'e-mail no longer stored');
  assert.equal(P.credit(leaverId), 0);
  assert.equal(P.one("SELECT COUNT(*) c FROM user_addresses WHERE user_id = ?", leaverId).c, 0);
  const rv = P.one("SELECT * FROM product_reviews WHERE id = 'rv_leaver'");
  assert.deepEqual([rv.reviewer_name, rv.user_height_cm, rv.content], ['탈퇴회원', null, '좋아요']);
  assert.equal(P.one('SELECT COUNT(*) c FROM orders WHERE customer_id = ?', leaverId).c, 1, 'order record retained for the legal period');
  assert.equal((await P.call('/api/v1/auth/me', { token: leaverTok })).status, 401, 'existing session revoked');
  assert.equal((await P.call('/api/v1/auth/login', { method: 'POST', body: { email: 'leaver@example.com', password: NEW_PW } })).status, 401);
  assert.throws(() => P.db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(leaverId), /ACCOUNT_WITHDRAWN/);
  assert.equal((await w({ acknowledge_credit_forfeit: true })).status, 401, 'cannot withdraw twice');
  const again = await P.call('/api/v1/auth/register', { method: 'POST', body: { email: 'leaver@example.com', full_name: '재가입', phone: '010-9999-0001', password: NEW_PW, agree_terms: true, agree_privacy: true } });
  assert.equal(again.status, 201, 'e-mail released for a new account');
  assert.notEqual(again.json.customer_id, leaverId);
  assert.ok(P.one("SELECT COUNT(*) c FROM pii_access_log WHERE action = 'WITHDRAW' AND subject_ids_json LIKE ?", `%${leaverId}%`).c === 1);
});

await t.test('I37 data-subject export returns only the caller\'s data and is access-logged', async () => {
  const tok = await P.login('customer@example.com');
  const r = await P.call('/api/v1/auth/privacy/export', { token: tok });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.account.id, 'u_customer_001');
  assert.ok(Array.isArray(r.json.data.orders));
  assert.ok(!JSON.stringify(r.json.data).includes('leaver'), 'no other member\'s data');
  assert.equal(r.json.data.account.password_hash, undefined);
  assert.equal(P.one("SELECT COUNT(*) c FROM pii_access_log WHERE action = 'EXPORT' AND actor_user_id = 'u_customer_001'").c, 1);
  assert.equal((await P.call('/api/v1/auth/privacy/export', { token: P.tok.p2 })).status, 403);
  assert.equal((await P.call('/api/v1/auth/privacy/export')).status, 401);
});

await t.test('I38 admin and seller views of personal data are recorded; the record is append-only and admin-only', async () => {
  const before = P.one('SELECT COUNT(*) c FROM pii_access_log').c;
  assert.equal((await P.call('/api/v1/admin/users', { token: P.tok.ad })).status, 200);
  assert.equal((await P.call('/api/v1/admin/orders', { token: P.tok.ad })).status, 200);
  assert.equal((await P.call('/api/v1/partner/orders', { token: P.tok.p2 })).status, 200);
  const rows = P.q('SELECT * FROM pii_access_log ORDER BY rowid DESC LIMIT 3');
  assert.equal(P.one('SELECT COUNT(*) c FROM pii_access_log').c, before + 3);
  assert.deepEqual(rows.map((r) => r.resource).sort(), ['admin.orders', 'admin.users', 'partner.orders']);
  const seller = rows.find((r) => r.resource === 'partner.orders');
  assert.equal(seller.actor_partner_id, 'pt_002');
  assert.ok(seller.subject_count > 0);
  const log = await P.call(`/api/v1/admin/privacy/access-log?subject_id=${encodeURIComponent(leaverOrder.order_id)}`, { token: P.tok.ad });
  assert.equal(log.status, 200, log.text);
  assert.ok(log.json.data.length >= 1 && log.json.data.every((r) => r.subject_ids.includes(leaverOrder.order_id)), 'filter by data subject');
  assert.equal((await P.call('/api/v1/admin/privacy/access-log', { token: P.tok.p2 })).status, 403);
  assert.equal((await P.call('/api/v1/admin/privacy/access-log', { token: await P.login('customer@example.com') })).status, 403);
  assert.throws(() => P.db.prepare('DELETE FROM pii_access_log').run(), /IMMUTABLE_LEDGER/);
  assert.throws(() => P.db.prepare("UPDATE pii_access_log SET actor_user_id = 'x'").run(), /IMMUTABLE_LEDGER/);
});

await t.test('I39 retention purge destroys withdrawn members\' recipient data after the period, keeps money records', async () => {
  const { purgeExpiredPii } = await import('../apps/cloudflare-gateway/src/services/privacy.js');
  assert.deepEqual(await purgeExpiredPii(P.env), { orders: 0, inquiries: 0 }, 'nothing before the retention period ends');
  P.db.prepare("UPDATE orders SET created_at = datetime('now', '-1826 days') WHERE id = ?").run(leaverOrder.order_id);
  const activeOld = P.one("SELECT id FROM orders WHERE customer_id = 'u_customer_001' LIMIT 1");
  if (activeOld) P.db.prepare("UPDATE orders SET created_at = datetime('now', '-1826 days') WHERE id = ?").run(activeOld.id);
  const money = P.one('SELECT total_pay_amount, refunded_pg_amount, refunded_credit_amount FROM orders WHERE id = ?', leaverOrder.order_id);
  const r = await purgeExpiredPii(P.env);
  assert.equal(r.orders, 1, 'only the withdrawn member\'s expired order');
  const o = P.one('SELECT * FROM orders WHERE id = ?', leaverOrder.order_id);
  assert.deepEqual([o.recipient_name, o.recipient_phone, o.shipping_postal_code, o.pccc], ['(파기됨)', '', '', null]);
  assert.ok(o.pii_purged_at);
  assert.deepEqual({ total_pay_amount: o.total_pay_amount, refunded_pg_amount: o.refunded_pg_amount, refunded_credit_amount: o.refunded_credit_amount }, money);
  if (activeOld) assert.notEqual(P.one('SELECT recipient_name n FROM orders WHERE id = ?', activeOld.id).n, '(파기됨)', 'active members are untouched');
  assert.equal(P.one("SELECT COUNT(*) c FROM pii_access_log WHERE action = 'PURGE' AND actor_role = 'SYSTEM'").c, 1);
  assert.deepEqual(await purgeExpiredPii(P.env), { orders: 0, inquiries: 0 }, 'idempotent');
  assert.deepEqual(await P.recon(), [], 'credit forfeiture and purge keep the books reconciled');
});

// ---- O05 seller onboarding: application, private KYB documents, review ----
const brnOf = (nine) => { // valid 사업자등록번호 for test data (NTS check digit)
  const d = String(nine).split('').map(Number); const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let s = d.reduce((a, x, i) => a + x * w[i], 0) + Math.floor((d[8] * 5) / 10);
  return `${nine}${(10 - (s % 10)) % 10}`;
};
const O = await bootMarketplace();
const APP_PW = 'SellerApply!2026';
const application = (over = {}) => ({
  email: 'newseller@example.com', password: APP_PW, contact_name: '신청 담당', phone: '010-2222-3333', business_name: '새판매자상회', representative_name: '대표 이름',
  business_reg_number: brnOf('123456789'), mail_order_reg_number: '제2026-서울강남-0001호', bank_code: '004', bank_account_number: '123-456-789012', bank_account_holder: '새판매자상회',
  customer_service_phone: '02-123-4567', return_shipping_address: '서울특별시 강남구 반품로 1', agree_seller_terms: true, agree_privacy: true, ...over
});
const upload = (token, folder = 'kyb', type = 'application/pdf') => O.call('/api/v1/storage/upload', { method: 'POST', token, body: { file_name: 'doc.pdf', content_type: type, folder, file_data: Buffer.from('%PDF-1.4 test').toString('base64') } });
let appTok; let appPartnerId;

await t.test('I40 seller application: validated, unique, cannot pick its own commission, and cannot sell before approval', async () => {
  assert.equal((await O.call('/api/v1/partner-applications', { method: 'POST', body: application({ business_reg_number: '1234567890' }) })).json.code, 'INVALID_BRN');
  assert.equal((await O.call('/api/v1/partner-applications', { method: 'POST', body: application({ mail_order_reg_number: '' }) })).json.code, 'MAIL_ORDER_REQUIRED');
  assert.equal((await O.call('/api/v1/partner-applications', { method: 'POST', body: application({ agree_seller_terms: false }) })).json.code, 'CONSENT_REQUIRED');
  assert.equal((await O.call('/api/v1/partner-applications', { method: 'POST', body: application({ password: 'short' }) })).json.code, 'WEAK_PASSWORD');
  const r = await O.call('/api/v1/partner-applications', { method: 'POST', body: application({ commission_rate: 0, commission_rate_bps: 0, status: 'APPROVED' }) });
  assert.equal(r.status, 201, r.text);
  appTok = r.json.data.token; appPartnerId = r.json.data.partner.id;
  const pt = O.one('SELECT * FROM partners WHERE id = ?', appPartnerId);
  assert.deepEqual([pt.status, pt.kyc_status, pt.commission_rate_bps, pt.payout_account_verified], ['PENDING', 'DRAFT', null, 0], 'client cannot set status or commission');
  assert.equal((await O.call('/api/v1/partner-applications', { method: 'POST', body: application({ email: 'other@example.com' }) })).json.code, 'BRN_EXISTS');
  assert.equal((await O.call('/api/v1/partner-applications', { method: 'POST', body: application({ business_reg_number: brnOf('987654321') }) })).json.code, 'EMAIL_TAKEN');
  const login = await O.call('/api/v1/auth/login', { method: 'POST', body: { email: 'newseller@example.com', password: APP_PW, role: 'PARTNER' } });
  assert.equal(login.status, 200, 'applicant can log in to follow the application');
  const blocked = await O.call('/api/v1/partner/products', { token: appTok });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'PARTNER_NOT_APPROVED');
});

let kybFile;
await t.test('I41 KYB documents are private: only the uploader and operators can read them, and operator reads are logged', async () => {
  const up = await upload(appTok);
  assert.equal(up.status, 201, up.text);
  assert.equal(up.json.data.visibility, 'PRIVATE');
  kybFile = up.json.data.file_id;
  const path = `/api/v1/storage/file/${kybFile}`;
  assert.equal((await O.call(path)).status, 404, 'anonymous cannot read');
  assert.equal((await O.call(path, { token: O.tok.p2 })).status, 404, 'another seller cannot read');
  assert.equal((await O.call(path, { token: O.tok.c })).status, 404, 'a customer cannot read');
  const own = await O.call(path, { token: appTok });
  assert.equal(own.status, 200);
  assert.match(own.headers.get('cache-control'), /no-store/);
  const before = O.one("SELECT COUNT(*) c FROM pii_access_log WHERE resource = 'admin.kyb-document'").c;
  const adm = await O.call(path, { token: O.tok.ad });
  assert.equal(adm.status, 200);
  assert.equal(adm.headers.get('access-control-allow-origin') === '*', false, 'never wildcard-CORS a private document');
  assert.equal(O.one("SELECT COUNT(*) c FROM pii_access_log WHERE resource = 'admin.kyb-document'").c, before + 1);
  assert.equal((await upload(O.tok.c)).status, 403, 'customers cannot write into the KYB area');
  assert.equal((await upload(appTok, 'kyb', 'image/gif')).status, 400);
});

await t.test('I42 submit needs every required document; review cannot be bypassed; approval needs commission + evidence', async () => {
  const attach = async (doc_type, file_id) => O.call('/api/v1/partner/application/documents', { method: 'POST', token: appTok, body: { doc_type, file_id } });
  assert.equal((await O.call('/api/v1/partner/application/submit', { method: 'POST', token: appTok })).json.code, 'DOCUMENTS_MISSING');
  const pub = (await upload(appTok, 'products', 'image/png')).json.data.file_id;
  assert.equal((await attach('BUSINESS_REGISTRATION', pub)).json.code, 'INVALID_FILE', 'a public file is not a KYB document');
  const othersFile = (await O.call('/api/v1/storage/upload', { method: 'POST', token: O.tok.p2, body: { file_name: 'x.pdf', content_type: 'application/pdf', folder: 'kyb', file_data: Buffer.from('%PDF').toString('base64') } })).json.data.file_id;
  assert.equal((await attach('BUSINESS_REGISTRATION', othersFile)).json.code, 'INVALID_FILE', 'cannot attach another seller\'s file');
  assert.equal((await attach('BUSINESS_REGISTRATION', kybFile)).status, 201);
  assert.equal((await attach('MAIL_ORDER_REGISTRATION', (await upload(appTok)).json.data.file_id)).status, 201);
  const bankDoc = (await upload(appTok)).json.data.file_id;
  assert.equal((await attach('BANK_ACCOUNT_COPY', bankDoc)).status, 201);
  const sub = await O.call('/api/v1/partner/application/submit', { method: 'POST', token: appTok });
  assert.equal(sub.status, 200, sub.text);
  assert.equal(sub.json.data.kyc_status, 'SUBMITTED');
  assert.equal((await attach('OTHER', (await upload(appTok)).json.data.file_id)).json.code, 'APPLICATION_LOCKED');

  assert.equal((await O.call(`/api/v1/admin/partners/${appPartnerId}/verify`, { method: 'PUT', token: O.tok.ad, body: { status: 'APPROVED' } })).json.code, 'USE_APPLICATION_REVIEW', 'no shortcut around document review');
  const review = (body, token = O.tok.ad) => O.call(`/api/v1/admin/partner-applications/${appPartnerId}/review`, { method: 'POST', token, body });
  assert.equal((await review({ decision: 'APPROVE', confirm_documents_checked: true, business_status_evidence: '국세청 조회: 계속사업자' }, appTok)).status, 403);
  assert.equal((await review({ decision: 'APPROVE', confirm_documents_checked: true, business_status_evidence: '국세청 조회: 계속사업자' })).json.code, 'INVALID_COMMISSION');
  assert.equal((await review({ decision: 'APPROVE', confirm_documents_checked: true, commission_rate: 12.5 })).status, 400, 'business status evidence required');
  assert.equal((await review({ decision: 'APPROVE', business_status_evidence: 'x', commission_rate: 12.5 })).json.code, 'CONFIRM_REQUIRED');

  const queue = await O.call('/api/v1/admin/partner-applications', { token: O.tok.ad });
  const bankRow = queue.json.data.find((a) => a.partner_id === appPartnerId).documents.find((d) => d.doc_type === 'BANK_ACCOUNT_COPY');
  const re = await review({ decision: 'REQUEST_RESUBMIT', note: '통장 사본의 예금주가 보이지 않습니다.', rejected_document_ids: [bankRow.id] });
  assert.equal(re.status, 200, re.text);
  assert.deepEqual([re.json.data.kyc_status, re.json.data.missing_documents], ['RESUBMIT_REQUIRED', ['BANK_ACCOUNT_COPY']]);
  const mine = await O.call('/api/v1/partner/application', { token: appTok });
  assert.equal(mine.json.data.review_note, '통장 사본의 예금주가 보이지 않습니다.', 'applicant sees why');
  assert.equal((await attach('BANK_ACCOUNT_COPY', (await upload(appTok)).json.data.file_id)).status, 201);
  assert.equal((await O.call('/api/v1/partner/application/submit', { method: 'POST', token: appTok })).status, 200);

  const ok = await review({ decision: 'APPROVE', confirm_documents_checked: true, business_status_evidence: '국세청 조회: 계속사업자(일반과세자)', commission_rate: 12.5 });
  assert.equal(ok.status, 200, ok.text);
  const pt = O.one('SELECT * FROM partners WHERE id = ?', appPartnerId);
  assert.deepEqual([pt.status, pt.kyc_status, pt.commission_rate_bps, pt.payout_account_verified], ['APPROVED', 'APPROVED', 1250, 0], 'payout account is verified separately');
  assert.equal((await review({ decision: 'APPROVE', confirm_documents_checked: true, business_status_evidence: 'x', commission_rate: 1 })).json.code, 'NOT_SUBMITTED', 'cannot be re-approved with another rate');
  assert.equal((await O.call('/api/v1/partner/products', { token: appTok })).status, 200, 'approved seller can now work');
  assert.ok(O.one("SELECT COUNT(*) c FROM admin_audit_log WHERE action = 'PARTNER_APPLICATION_APPROVE' AND target_id = ?", appPartnerId).c === 1);
});

await t.test('I43 rejected application stays closed; a reason is mandatory', async () => {
  const r = await O.call('/api/v1/partner-applications', { method: 'POST', body: application({ email: 'reject@example.com', business_reg_number: brnOf('555666777'), mail_order_reg_number: '', mail_order_exempt_reason: '간이과세자 통신판매업 신고 면제' }) });
  assert.equal(r.status, 201, r.text);
  const tok = r.json.data.token; const id = r.json.data.partner.id;
  const view = await O.call('/api/v1/partner/application', { token: tok });
  assert.deepEqual(view.json.data.required_documents, ['BUSINESS_REGISTRATION', 'BANK_ACCOUNT_COPY'], 'exempt seller needs no mail-order certificate');
  for (const dt of ['BUSINESS_REGISTRATION', 'BANK_ACCOUNT_COPY']) {
    const f = (await upload(tok)).json.data.file_id;
    assert.equal((await O.call('/api/v1/partner/application/documents', { method: 'POST', token: tok, body: { doc_type: dt, file_id: f } })).status, 201);
  }
  assert.equal((await O.call('/api/v1/partner/application/submit', { method: 'POST', token: tok })).status, 200);
  assert.equal((await O.call(`/api/v1/admin/partner-applications/${id}/review`, { method: 'POST', token: O.tok.ad, body: { decision: 'REJECT' } })).json.code, 'NOTE_REQUIRED');
  assert.equal((await O.call(`/api/v1/admin/partner-applications/${id}/review`, { method: 'POST', token: O.tok.ad, body: { decision: 'REJECT', note: '취급 품목 정책 위반' } })).status, 200);
  assert.equal(O.one('SELECT status s FROM partners WHERE id = ?', id).s, 'REJECTED');
  assert.equal((await O.call('/api/v1/partner/application/submit', { method: 'POST', token: tok })).json.code, 'APPLICATION_LOCKED');
  assert.equal((await O.call(`/api/v1/admin/partners/${id}/verify`, { method: 'PUT', token: O.tok.ad, body: { status: 'APPROVED' } })).json.code, 'USE_APPLICATION_REVIEW');
  assert.throws(() => O.db.prepare('DELETE FROM partner_kyb_documents WHERE partner_id = ?').run(id), /IMMUTABLE_LEDGER/);
  assert.deepEqual(await O.recon(), []);
});

// ---- O11 operator least privilege, TOTP 2FA, IP allow-list ----
const { totpAt, currentStep, base32Encode } = await import('../apps/cloudflare-gateway/src/lib/totp.js');
const { twoFactorRequired, ipAllowed } = await import('../apps/cloudflare-gateway/src/lib/admin-policy.js');
const A = await bootMarketplace();
const OP_PW = 'Operator!2026#pw';
const mkOperator = async (email, admin_role, token = A.tok.ad) => A.call('/api/v1/admin/admin-users', { method: 'POST', token, body: { email, full_name: email.split('@')[0], admin_role, password: OP_PW } });
const opLogin = async (email, extra = {}, headers = {}) => A.call('/api/v1/auth/login', { method: 'POST', headers, body: { email, password: OP_PW, role: 'ADMIN', ...extra } });

await t.test('I44 operator roles are least-privilege everywhere, including inline admin checks; unmapped admin paths fail closed', async () => {
  for (const [e, r] of [['fin@olmoa.test', 'FINANCE'], ['cs@olmoa.test', 'CS'], ['ops@olmoa.test', 'OPERATIONS'], ['dpo@olmoa.test', 'PRIVACY_OFFICER']]) {
    const c = await mkOperator(e, r);
    assert.equal(c.status, 201, c.text);
  }
  assert.equal((await mkOperator('bad@olmoa.test', 'GOD')).json.code, 'INVALID_ADMIN_ROLE');
  const tk = {};
  for (const e of ['fin', 'cs', 'ops', 'dpo']) tk[e] = (await opLogin(`${e}@olmoa.test`)).json.token;
  const order = (await A.checkout(A.tok.c, [{ sku_id: A.mpSkus[0].id, quantity: 1 }])).json;
  await A.pay(A.tok.c, order);
  const st = async (tok, path, method = 'GET', body) => (await A.call(path, { method, token: tok, body })).status;
  const matrix = [
    // [token, path, method, expected]
    ['fin', '/api/v1/admin/reconciliation', 'GET', 200], ['fin', '/api/v1/admin/finance/payouts', 'GET', 200],
    ['fin', '/api/v1/admin/products', 'GET', 403], ['fin', '/api/v1/admin/privacy/access-log', 'GET', 403], ['fin', '/api/v1/admin/admin-users', 'GET', 403],
    ['fin', '/api/v1/admin/business-entities', 'POST', 403],
    ['cs', '/api/v1/admin/orders', 'GET', 200], ['cs', '/api/v1/admin/users', 'GET', 200], ['cs', `/api/v1/orders/${order.order_id}`, 'GET', 200],
    ['cs', '/api/v1/admin/finance/payouts', 'POST', 403], ['cs', '/api/v1/admin/reconciliation', 'GET', 403], ['cs', '/api/v1/admin/partner-applications', 'GET', 403],
    ['ops', '/api/v1/admin/partner-applications', 'GET', 200], ['ops', '/api/v1/admin/products', 'GET', 200],
    ['ops', '/api/v1/admin/partners/pt_002/payout-account', 'POST', 403], ['ops', `/api/v1/admin/orders/${order.order_id}/refund`, 'POST', 403],
    ['dpo', '/api/v1/admin/privacy/access-log', 'GET', 200], ['dpo', '/api/v1/admin/orders', 'GET', 403], ['dpo', `/api/v1/orders/${order.order_id}`, 'GET', 403],
    ['fin', '/api/v1/admin/some-future-endpoint', 'GET', 403], ['fin', '/api/v1/orders/cron/expire', 'POST', 403]
  ];
  const wrong = [];
  for (const [who, path, method, exp] of matrix) {
    const got = await st(tk[who], path, method, method === 'GET' ? undefined : {});
    if (got !== exp) wrong.push(`${who} ${method} ${path}: ${got} != ${exp}`);
  }
  assert.deepEqual(wrong, []);
  assert.equal(await st(A.tok.ad, '/api/v1/admin/some-future-endpoint'), 404, 'super admin reaches the router (404), others are stopped first');
  const denied = await A.call('/api/v1/admin/products', { token: tk.fin });
  assert.equal(denied.json.code, 'ADMIN_PERMISSION_DENIED');
  const cancel = await A.call(`/api/v1/orders/${order.order_id}/cancel`, { method: 'POST', token: tk.dpo });
  assert.equal(cancel.status, 403, 'operator cancel = refund needs orders.refund');
  assert.equal((await A.call(`/api/v1/orders/${order.order_id}/cancel`, { method: 'POST', token: tk.cs })).status, 200);
  assert.ok(A.one("SELECT COUNT(*) c FROM admin_audit_log WHERE actor_role = 'ROLE_ADMIN:SUPER_ADMIN' AND action = 'ADMIN_USER_CREATE'").c >= 4, 'audit records the operator role');
  assert.throws(() => A.db.prepare("UPDATE users SET admin_role = 'SUPER_ADMIN' WHERE id = 'u_customer_001'").run(), /ADMIN_ROLE_SCOPE/);
});

await t.test('I45 TOTP 2FA: RFC 6238 vector, enrolment revokes old sessions, codes cannot be replayed, recovery codes are one-time', async () => {
  const rfc = base32Encode(new TextEncoder().encode('12345678901234567890'));
  assert.equal(await totpAt(rfc, 1), '287082', 'RFC 6238 SHA-1 vector at T=59s (last 6 digits of 94287082)');
  assert.equal(await totpAt(rfc, 37037036), '081804', 'RFC 6238 vector at T=1111111109');
  let tok = (await opLogin('ops@olmoa.test')).json.token;
  assert.equal((await A.call('/api/v1/auth/2fa/enable', { method: 'POST', token: tok, body: { code: '000000' } })).json.code, 'MFA_SETUP_NOT_STARTED');
  const setup = await A.call('/api/v1/auth/2fa/setup', { method: 'POST', token: tok });
  assert.equal(setup.status, 200, setup.text);
  const secret = setup.json.data.secret;
  assert.match(setup.json.data.otpauth_uri, /^otpauth:\/\/totp\//);
  const stored = A.one("SELECT totp_pending_enc FROM users WHERE email = 'ops@olmoa.test'").totp_pending_enc;
  assert.ok(stored.startsWith('v1:') && !stored.includes(secret), 'secret is encrypted at rest');
  assert.equal((await A.call('/api/v1/auth/2fa/enable', { method: 'POST', token: tok, body: { code: '123456' === (await totpAt(secret, currentStep())) ? '654321' : '123456' } })).json.code, 'OTP_INVALID');
  const en = await A.call('/api/v1/auth/2fa/enable', { method: 'POST', token: tok, body: { code: await totpAt(secret, currentStep()) } });
  assert.equal(en.status, 200, en.text);
  assert.equal(en.json.data.recovery_codes.length, 10);
  assert.equal((await A.call('/api/v1/admin/products', { token: tok })).status, 401, 'pre-2FA session revoked');
  assert.equal((await A.call('/api/v1/admin/products', { token: en.json.data.token })).status, 200);

  assert.equal((await opLogin('ops@olmoa.test')).json.code, 'OTP_REQUIRED');
  assert.equal((await opLogin('ops@olmoa.test', { otp: await totpAt(secret, currentStep()) })).json.code, 'OTP_INVALID', 'the code used for enrolment cannot be replayed');
  const next = await totpAt(secret, currentStep() + 1);
  const ok = await opLogin('ops@olmoa.test', { otp: next });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.mfa_enabled, true);
  assert.equal((await opLogin('ops@olmoa.test', { otp: next })).json.code, 'OTP_INVALID', 'same code twice = replay');
  const rc = en.json.data.recovery_codes[0];
  assert.equal((await opLogin('ops@olmoa.test', { recovery_code: rc })).status, 200);
  assert.equal((await opLogin('ops@olmoa.test', { recovery_code: rc })).json.code, 'OTP_INVALID', 'recovery code is single-use');
  const u = A.one("SELECT id, token_version FROM users WHERE email = 'ops@olmoa.test'");
  const forged = await signJwt({ sub: u.id, role: 'ROLE_ADMIN', tv: u.token_version }, SECRET, 600);
  const noMfa = await A.call('/api/v1/admin/products', { token: forged });
  assert.equal(noMfa.json.code, 'MFA_REQUIRED', 'a password-only token is useless once 2FA is on');

  const reset = await A.call(`/api/v1/admin/admin-users/${u.id}`, { method: 'PUT', token: A.tok.ad, body: { reset_2fa: true } });
  assert.equal(reset.status, 200, reset.text);
  assert.equal((await A.call('/api/v1/admin/products', { token: ok.json.token })).status, 401, 'reset revokes sessions');
  assert.equal((await opLogin('ops@olmoa.test')).status, 200, 'after reset the operator re-enrols');
});

await t.test('I46 2FA is mandatory in production (cannot be switched off) and can be required elsewhere', async () => {
  assert.equal(twoFactorRequired({ ENVIRONMENT: 'production' }), true);
  assert.equal(twoFactorRequired({ ENVIRONMENT: 'production', ADMIN_2FA_REQUIRED: 'false' }), true);
  assert.equal(twoFactorRequired({ ENVIRONMENT: 'test' }), false);
  const g = await boot({ ADMIN_2FA_REQUIRED: 'true' });
  const lg = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: PW, role: 'ADMIN' } });
  assert.equal(lg.status, 200);
  assert.equal(lg.json.mfa_setup_required, true);
  const d = await g.call('/api/v1/admin/dashboard', { token: lg.json.token });
  assert.equal(d.json.code, 'ADMIN_2FA_SETUP_REQUIRED');
  assert.equal((await g.call(`/api/v1/orders/x`, { token: lg.json.token })).json.code, 'ADMIN_2FA_SETUP_REQUIRED', 'inline-checked routes are covered too');
  const s = await g.call('/api/v1/auth/2fa/setup', { method: 'POST', token: lg.json.token });
  assert.equal(s.status, 200, 'enrolment itself stays reachable');
  const en = await g.call('/api/v1/auth/2fa/enable', { method: 'POST', token: lg.json.token, body: { code: await totpAt(s.json.data.secret, currentStep()) } });
  assert.equal((await g.call('/api/v1/admin/dashboard', { token: en.json.data.token })).status, 200);
});

await t.test('I47 operator IP allow-list applies at login and on every request; customers are unaffected', async () => {
  assert.equal(ipAllowed({ ADMIN_IP_ALLOWLIST: '203.0.113.0/24' }, '203.0.113.200'), true);
  assert.equal(ipAllowed({ ADMIN_IP_ALLOWLIST: '203.0.113.0/24' }, '203.0.114.1'), false);
  assert.equal(ipAllowed({ ADMIN_IP_ALLOWLIST: '203.0.113.0/24, 2001:db8::1' }, '2001:DB8::1'), true);
  assert.equal(ipAllowed({ ADMIN_IP_ALLOWLIST: '203.0.113.0/24' }, null), false);
  const g = await boot({ ADMIN_IP_ALLOWLIST: '203.0.113.0/24' });
  const login = (ip) => g.call('/api/v1/auth/login', { method: 'POST', headers: ip ? { 'CF-Connecting-IP': ip } : {}, body: { email: 'admin@openmarket.com', password: PW, role: 'ADMIN' } });
  assert.equal((await login('198.51.100.7')).json.code, 'ADMIN_IP_NOT_ALLOWED');
  assert.equal((await login(null)).json.code, 'ADMIN_IP_NOT_ALLOWED');
  const ok = await login('203.0.113.9');
  assert.equal(ok.status, 200);
  assert.equal((await g.call('/api/v1/admin/dashboard', { token: ok.json.token, headers: { 'CF-Connecting-IP': '203.0.113.50' } })).status, 200);
  assert.equal((await g.call('/api/v1/admin/dashboard', { token: ok.json.token, headers: { 'CF-Connecting-IP': '198.51.100.7' } })).json.code, 'ADMIN_IP_NOT_ALLOWED', 'stolen token is useless elsewhere');
  const c = await g.call('/api/v1/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.7' }, body: { email: 'customer@example.com', password: PW } });
  assert.equal(c.status, 200);
});

await t.test('I48 operator account guards: no self-lockout, always one active super admin, changes revoke sessions', async () => {
  const me = A.one("SELECT id FROM users WHERE email = 'admin@openmarket.com'").id;
  assert.equal((await A.call(`/api/v1/admin/admin-users/${me}`, { method: 'PUT', token: A.tok.ad, body: { admin_role: 'CS' } })).json.code, 'SELF_LOCKOUT');
  assert.equal((await A.call(`/api/v1/admin/admin-users/${me}`, { method: 'PUT', token: A.tok.ad, body: { is_active: false } })).json.code, 'SELF_LOCKOUT');
  const s2 = await mkOperator('super2@olmoa.test', 'SUPER_ADMIN');
  const s2tok = (await opLogin('super2@olmoa.test')).json.token;
  assert.equal((await A.call(`/api/v1/admin/admin-users/${me}`, { method: 'PUT', token: s2tok, body: { is_active: false } })).status, 200, 'another super admin may deactivate');
  assert.equal((await A.call('/api/v1/admin/dashboard', { token: A.tok.ad })).status, 401, 'deactivated operator is out immediately');
  assert.equal((await A.call(`/api/v1/admin/admin-users/${s2.json.data.id}`, { method: 'PUT', token: s2tok, body: { admin_role: 'FINANCE' } })).json.code, 'SELF_LOCKOUT');
  const fin = A.one("SELECT id FROM users WHERE email = 'fin@olmoa.test'").id;
  const finTok = (await opLogin('fin@olmoa.test')).json.token;
  assert.equal((await A.call(`/api/v1/admin/admin-users/${fin}`, { method: 'PUT', token: s2tok, body: { admin_role: 'CS' } })).status, 200);
  assert.equal((await A.call('/api/v1/admin/reconciliation', { token: finTok })).status, 401, 'role change revokes old sessions');
  // Re-activate the original super admin so later checks (I31 uses the I gateway) are unaffected here.
  assert.equal((await A.call(`/api/v1/admin/admin-users/${me}`, { method: 'PUT', token: s2tok, body: { is_active: true } })).status, 200);
});

// ---- O14 return shipping fee, exchange flow, quantity-level cancel ----
const C = await bootMarketplace();
const deliverOnly = async (orderId) => {
  await C.ship(C.tok.p1, orderId); await C.ship(C.tok.p2, orderId);
  for (const s of C.q("SELECT id FROM sub_orders WHERE parent_order_id = ? AND status = 'SHIPPED'", orderId)) {
    assert.equal((await C.call(`/api/v1/admin/sub-orders/${s.id}/delivered`, { method: 'POST', token: C.tok.ad, body: { evidence: 'CJ 조회 배송완료' } })).status, 200);
  }
};
const buyDelivered = async (items) => { const o = (await C.checkout(C.tok.c, items)).json; assert.equal((await C.pay(C.tok.c, o)).status, 200); await deliverOnly(o.order_id); return o; };
const subOf = (orderId) => C.one('SELECT * FROM sub_orders WHERE parent_order_id = ?', orderId);
const itemOf = (orderId) => C.one('SELECT i.* FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id WHERE s.parent_order_id = ?', orderId);
const claim = (orderId, body) => C.call(`/api/v1/orders/${orderId}/claims`, { method: 'POST', token: C.tok.c, body });
const decide = (claimId, body) => C.call(`/api/v1/partner/returns/${claimId}`, { method: 'PUT', token: C.tok.p2, body });

await t.test('I49 change-of-mind return withholds the seller\'s return fee; the books stay exact', async () => {
  assert.equal((await C.call('/api/v1/partner/profile', { method: 'PUT', token: C.tok.p2, body: { return_shipping_fee: 3500 } })).status, 200);
  const o = await buyDelivered([{ sku_id: C.mpSkus[0].id, quantity: 2 }]);
  const detail = await C.call(`/api/v1/orders/${o.order_id}`, { token: C.tok.c });
  assert.equal(detail.json.data.sub_orders[0].return_shipping_fee, 3500, 'buyer sees the fee before asking');
  const it = itemOf(o.order_id);
  assert.equal((await claim(o.order_id, { type: 'RETURN', reason_code: 'NOPE', items: [{ order_item_id: it.id, quantity: 1 }] })).json.code, 'INVALID_REASON_CODE');
  const c = await claim(o.order_id, { type: 'RETURN', reason_code: 'CHANGE_OF_MIND', reason: '마음이 바뀜', items: [{ order_item_id: it.id, quantity: 1 }] });
  assert.equal(c.status, 201, c.text);
  const share = Math.floor((it.pg_alloc + it.credit_alloc) / 2);
  assert.deepEqual([c.json.fault, c.json.estimated_return_fee, c.json.estimated_refund_amount], ['CUSTOMER', 3500, share - 3500]);
  const settleBefore = C.one('SELECT COALESCE(SUM(net_delta),0) n FROM settlement_adjustments').n;
  const ok = await decide(c.json.claim_id, { decision: 'APPROVE' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.return_fee, 3500);
  const rf = C.one('SELECT * FROM refunds WHERE claim_id = ?', c.json.claim_id);
  assert.equal(rf.pg_amount + rf.credit_amount, share - 3500, 'customer gets the item share minus the fee');
  assert.equal(rf.return_fee_amount, 3500);
  const adj = C.one('SELECT * FROM settlement_adjustments WHERE refund_id = ?', rf.id);
  assert.equal(adj.shipping_delta, 3500, 'the seller, who pays the courier, keeps the fee');
  assert.equal(C.one('SELECT COALESCE(SUM(net_delta),0) n FROM settlement_adjustments').n - settleBefore, adj.net_delta);
  assert.throws(() => C.db.prepare('UPDATE refunds SET return_fee_amount = 0 WHERE id = ?').run(rf.id), /IMMUTABLE_LEDGER/);
  assert.deepEqual(await C.recon(), []);
});

await t.test('I50 seller-fault return is free and refunds outbound shipping; shifting blame needs a written reason', async () => {
  const o = await buyDelivered([{ sku_id: C.mpSkus[1].id, quantity: 1 }]);
  const sub = subOf(o.order_id);
  const it = itemOf(o.order_id);
  const c = await claim(o.order_id, { type: 'RETURN', reason_code: 'DEFECTIVE', reason: '불량' });
  assert.deepEqual([c.json.fault, c.json.estimated_return_fee], ['SELLER', 0]);
  const ok = await decide(c.json.claim_id, { decision: 'APPROVE' });
  assert.equal(ok.status, 200, ok.text);
  const rf = C.one('SELECT * FROM refunds WHERE claim_id = ?', c.json.claim_id);
  assert.equal(rf.return_fee_amount, 0);
  assert.equal(rf.pg_amount + rf.credit_amount, it.pg_alloc + it.credit_alloc + sub.shipping_pg_alloc + sub.shipping_credit_alloc, 'full refund incl. outbound shipping');
  assert.equal(subOf(o.order_id).shipping_refunded, sub.shipping_fee > 0 ? 1 : 0);

  const o2 = await buyDelivered([{ sku_id: C.mpSkus[2].id, quantity: 1 }]);
  const c2 = await claim(o2.order_id, { type: 'RETURN', reason_code: 'NOT_AS_DESCRIBED' });
  assert.equal((await decide(c2.json.claim_id, { decision: 'APPROVE', fault: 'CUSTOMER' })).json.code, 'FAULT_REASON_REQUIRED');
  const ok2 = await decide(c2.json.claim_id, { decision: 'APPROVE', fault: 'CUSTOMER', notes: '회수 상품 확인 결과 상세페이지와 동일, 사용 흔적 있음' });
  assert.equal(ok2.status, 200, ok2.text);
  assert.ok(ok2.json.return_fee > 0);
  const row = C.one('SELECT fault, fault_note, return_fee_amount FROM returns WHERE id = ?', c2.json.claim_id);
  assert.equal(row.fault, 'CUSTOMER'); assert.ok(row.fault_note.includes('사용 흔적'));
  assert.equal(row.return_fee_amount, ok2.json.return_fee);
  assert.deepEqual(await C.recon(), []);
});

await t.test('I51 exchange: same-price option only, re-shipment moves stock once, and the order completes normally', async () => {
  const base = C.mpSkus[0];
  const cols = C.q('PRAGMA table_info(product_skus)').map((c) => c.name);
  C.db.exec('CREATE TEMP TABLE sku_clone AS SELECT * FROM product_skus WHERE 0');
  C.db.prepare('INSERT INTO sku_clone SELECT * FROM product_skus WHERE id = ?').run(base.id);
  const sets = ["id = 'sku_exchange_alt'", 'stock_quantity = 5', ...['sku_code', 'option_name', 'option_value', 'barcode'].filter((c) => cols.includes(c)).map((c) => `${c} = ${c} || '-ALT'`)];
  C.db.exec(`UPDATE sku_clone SET ${sets.join(', ')}`);
  C.db.exec('INSERT INTO product_skus SELECT * FROM sku_clone; DROP TABLE sku_clone');
  const o = await buyDelivered([{ sku_id: base.id, quantity: 1 }]);
  const it = itemOf(o.order_id);
  const other = C.mpSkus.find((s) => C.one('SELECT product_id p FROM product_skus WHERE id = ?', s.id).p !== C.one('SELECT product_id p FROM product_skus WHERE id = ?', base.id).p);
  if (other) assert.equal((await claim(o.order_id, { type: 'EXCHANGE', reason_code: 'SIZE_COLOR', items: [{ order_item_id: it.id, quantity: 1, exchange_sku_id: other.id }] })).json.code, 'EXCHANGE_OTHER_PRODUCT');
  C.db.prepare('UPDATE product_skus SET sale_price = sale_price + 1000 WHERE id = ?').run('sku_exchange_alt');
  assert.equal((await claim(o.order_id, { type: 'EXCHANGE', reason_code: 'SIZE_COLOR', items: [{ order_item_id: it.id, quantity: 1, exchange_sku_id: 'sku_exchange_alt' }] })).json.code, 'EXCHANGE_PRICE_DIFFERS');
  C.db.prepare('UPDATE product_skus SET sale_price = sale_price - 1000 WHERE id = ?').run('sku_exchange_alt');
  const c = await claim(o.order_id, { type: 'EXCHANGE', reason_code: 'SIZE_COLOR', items: [{ order_item_id: it.id, quantity: 1, exchange_sku_id: 'sku_exchange_alt' }] });
  assert.equal(c.status, 201, c.text);
  assert.ok(c.json.customer_shipping_note, 'customer-fault exchange tells the buyer about round-trip shipping');
  const ap = await decide(c.json.claim_id, { decision: 'APPROVE' });
  assert.equal(ap.json.exchange_status, 'AWAITING_RESHIPMENT');
  assert.equal(subOf(o.order_id).status, 'RETURN_REQUESTED');
  assert.equal((await claim(o.order_id, { type: 'RETURN', reason_code: 'DEFECTIVE' })).status, 409, 'no second claim while the exchange is open');
  const reship = (body, token = C.tok.p2) => C.call(`/api/v1/partner/returns/${c.json.claim_id}/reship`, { method: 'POST', token, body });
  assert.equal((await reship({ carrier: 'CJ대한통운', tracking_number: 'EXCH0001' }, C.tok.p1)).status, 403, 'another seller cannot reship');
  C.db.prepare("UPDATE product_skus SET stock_quantity = 0 WHERE id = 'sku_exchange_alt'").run();
  const oos = await reship({ carrier: 'CJ대한통운', tracking_number: 'EXCH0001', return_received: true });
  assert.equal(oos.json.code, 'EXCHANGE_OUT_OF_STOCK');
  assert.equal(C.one("SELECT COUNT(*) c FROM inventory_ledger WHERE reference_id = ?", c.json.claim_id).c, 0, 'nothing moved on failure');
  C.db.prepare("UPDATE product_skus SET stock_quantity = 5 WHERE id = 'sku_exchange_alt'").run();
  const fromBefore = C.stock(base.id);
  const rs = await reship({ carrier: 'CJ대한통운', tracking_number: 'EXCH0001', return_received: true });
  assert.equal(rs.status, 200, rs.text);
  assert.deepEqual([C.stock('sku_exchange_alt'), C.stock(base.id)], [4, fromBefore + 1]);
  assert.equal(C.one("SELECT COUNT(*) c FROM inventory_ledger WHERE reference_id = ?", c.json.claim_id).c, 2);
  assert.equal((await reship({ carrier: 'CJ대한통운', tracking_number: 'EXCH0002', return_received: true })).json.code, 'NOT_AWAITING_RESHIPMENT');
  assert.equal(C.stock('sku_exchange_alt'), 4, 'stock moved exactly once');
  const sub = subOf(o.order_id);
  assert.deepEqual([sub.status, sub.tracking_number], ['SHIPPED', 'EXCH0001']);
  assert.equal(C.one('SELECT original_tracking_number t FROM returns WHERE id = ?', c.json.claim_id).t !== null, true);
  assert.equal((await C.call(`/api/v1/admin/sub-orders/${sub.id}/delivered`, { method: 'POST', token: C.tok.ad, body: { evidence: '교환품 배송완료' } })).status, 200);
  assert.equal((await C.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: C.tok.c })).status, 200, 'previously stuck: exchange orders now complete');
  assert.equal(C.one('SELECT status s FROM settlements WHERE sub_order_id = ?', sub.id).s, 'ELIGIBLE_FOR_PAYOUT');
  assert.deepEqual(await C.recon(), []);
});

await t.test('I52 quantity-level cancel before shipment: exact refund, double-click safe, shipping refunded only with the last unit', async () => {
  const o = (await C.checkout(C.tok.c, [{ sku_id: C.mpSkus[2].id, quantity: 3 }])).json;
  await C.pay(C.tok.c, o);
  const sub = subOf(o.order_id);
  const it = itemOf(o.order_id);
  const cancel = (qty, key = `qc-${qty}-${Math.random().toString(36).slice(2, 10)}`) => C.call(`/api/v1/orders/${o.order_id}/sub-orders/${sub.id}/cancel`, { method: 'POST', token: C.tok.c, headers: { 'X-Idempotency-Key': key }, body: { items: [{ order_item_id: it.id, quantity: qty }] } });
  const stock0 = C.stock(C.mpSkus[2].id);
  const a = await cancel(1, 'qcancel-click-0001');
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json.partial, true);
  assert.equal(a.json.refund.pg_amount + a.json.refund.credit_amount, Math.floor((it.pg_alloc + it.credit_alloc) / 3));
  assert.equal(subOf(o.order_id).shipping_refunded, 0, 'still shipping the rest');
  const again = await cancel(1, 'qcancel-click-0001');
  assert.equal(again.json.replay, true, 'a retry with the same idempotency key is a replay');
  assert.equal(C.one('SELECT COUNT(*) c FROM refunds WHERE order_id = ?', o.order_id).c, 1);
  assert.equal(C.stock(C.mpSkus[2].id), stock0 + 1);
  assert.equal((await cancel(3)).json.code, 'REFUND_EXCEEDS_PAID');
  const b = await cancel(2);
  assert.equal(b.status, 200, b.text);
  const after = C.one('SELECT * FROM order_items WHERE id = ?', it.id);
  assert.deepEqual([after.refunded_pg_amount, after.refunded_credit_amount], [it.pg_alloc, it.credit_alloc], 'three partial cancels sum exactly to what was paid');
  const s2 = subOf(o.order_id);
  assert.deepEqual([s2.status, s2.shipping_refunded], ['CANCELLED', s2.shipping_fee > 0 ? 1 : 0]);
  await C.ship(C.tok.p2, o.order_id);
  assert.deepEqual(await C.recon(), []);
});

await t.test('I53 saving store settings with the masked account number does not queue a payout-account change', async () => {
  const prof = await C.call('/api/v1/partner/profile', { token: C.tok.p2 });
  assert.ok(prof.json.data.bank_account_number.startsWith('****'));
  const r = await C.call('/api/v1/partner/profile', { method: 'PUT', token: C.tok.p2, body: { ...prof.json.data, return_shipping_fee: 4000 } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.payout_change_pending, false);
  assert.equal(C.one("SELECT payout_change_request_json j FROM partners WHERE id = 'pt_002'").j, null);
  assert.equal(C.one("SELECT return_shipping_fee f FROM partners WHERE id = 'pt_002'").f, 4000);
  const real = await C.call('/api/v1/partner/profile', { method: 'PUT', token: C.tok.p2, body: { bank_account_number: '110-999-888777' } });
  assert.equal(real.json.payout_change_pending, true, 'a real change is still queued for verification');
});

// ---- O12 rate limiting (fake Workers Rate Limiting bindings with the production limits) ----
const fakeLimiter = (limit) => { const seen = new Map(); return { limit: async ({ key }) => { const n = (seen.get(key) || 0) + 1; seen.set(key, n); return { success: n <= limit }; } }; };
await t.test('I54 rate limits: login brute force, per-account guessing, checkout floods; customers on one IP are not lumped together', async () => {
  const g = await boot({ RL_AUTH: fakeLimiter(10), RL_LOGIN: fakeLimiter(5), RL_WRITE: fakeLimiter(30), RL_API: fakeLimiter(300) });
  const login = (email, ip) => g.call('/api/v1/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: { email, password: 'wrong-Pass-123' } });
  const st = [];
  for (let i = 0; i < 6; i++) st.push((await login('customer@example.com', `198.51.100.${i}`)).status);
  assert.equal(st[5], 429, 'the 6th guess at one account from rotating IPs is refused');
  const r = await login('alex.kim@olmoa.com', '198.51.100.200');
  assert.notEqual(r.status, 429, 'other accounts unaffected');
  const ipSt = [];
  for (let i = 0; i < 11; i++) ipSt.push((await login(`nobody${i}@x.com`, '203.0.113.77')).status);
  assert.equal(ipSt[10], 429, 'the 11th auth request from one IP is refused');
  const lim = await login('another@x.com', '203.0.113.77');
  assert.equal(lim.headers.get('retry-after'), '60');
  assert.equal(lim.json.code, 'RATE_LIMITED');
  // Two customers behind the same carrier IP each get their own write budget.
  const a = (await g.call('/api/v1/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.10' }, body: { email: 'customer@example.com', password: PW } })).json.token;
  const b = (await g.call('/api/v1/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.11' }, body: { email: 'alex.kim@olmoa.com', password: PW } })).json.token;
  const co = (tok) => g.call('/api/v1/orders/checkout', { method: 'POST', token: tok, headers: { 'CF-Connecting-IP': '192.0.2.1' }, body: { items: [] } });
  const aSt = [];
  for (let i = 0; i < 31; i++) aSt.push((await co(a)).status);
  assert.equal(aSt[30], 429, 'checkout flood stopped');
  assert.ok(aSt.slice(0, 30).every((s) => s !== 429));
  assert.notEqual((await co(b)).status, 429, 'second customer on the same IP still has budget');
  assert.equal((await g.call('/health', { headers: { 'CF-Connecting-IP': '203.0.113.77' } })).status, 200, 'health is never limited');
});
await t.test('I55 limiter missing: open by default (dev), closed when RATE_LIMIT_REQUIRED=true', async () => {
  const g = await boot({ RATE_LIMIT_REQUIRED: 'true' });
  assert.equal((await g.call('/api/v1/products')).json.code, 'RATE_LIMIT_NOT_CONFIGURED');
  const h = await boot({ RL_API: { limit: async () => { throw new Error('limiter down'); } } });
  assert.equal((await h.call('/api/v1/products')).status, 200, 'a broken limiter does not take the shop down');
});

await t.test('I56 d1_30 removes seeded reviews and invented sold counts (present up to d1_29, gone after)', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { listMigrations, MIGRATIONS_DIR } = await import('./lib/harness.mjs');
  const db = new DatabaseSync(':memory:');
  const files = listMigrations();
  const cut = files.indexOf('d1_30_remove_seeded_reviews_and_sales.sql');
  assert.ok(cut > 0, 'd1_30 is part of the migration chain');
  for (const f of files.slice(0, cut)) db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  const before = { reviews: db.prepare('SELECT COUNT(*) c FROM product_reviews').get().c, sold: db.prepare('SELECT SUM(total_sold_count) s FROM products').get().s };
  assert.ok(before.reviews >= 10 && before.sold > 100000, `fabricated rows exist before d1_30: ${JSON.stringify(before)}`);
  for (const f of files.slice(cut)) db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM product_reviews').get().c, 0, 'no review without an order of its author survives');
  assert.equal(db.prepare('SELECT COALESCE(SUM(total_sold_count), 0) s FROM products').get().s, 0, 'no inventory activity → nothing sold');
});

await t.test('I57 seller store rating is the real review average (null without reviews); only approved sellers have a store', async () => {
  const store = await I.call('/api/v1/partners/pt_002/store');
  assert.equal(store.status, 200, store.text);
  const real = I.one('SELECT ROUND(AVG(r.rating), 1) a, COUNT(*) c FROM product_reviews r JOIN products p ON p.id = r.product_id WHERE p.partner_id = ?', 'pt_002');
  assert.equal(store.json.data.metrics.review_count, real.c);
  assert.equal(store.json.data.metrics.avg_rating, real.c ? real.a : null);
  assert.notEqual(store.json.data.metrics.avg_rating, 4.9, 'no fixed 4.9');
  I.db.prepare("UPDATE partners SET status = 'SUSPENDED' WHERE id = 'pt_002'").run();
  try {
    assert.equal((await I.call('/api/v1/partners/pt_002/store')).status, 404, 'suspended seller has no public store');
  } finally {
    I.db.prepare("UPDATE partners SET status = 'APPROVED' WHERE id = 'pt_002'").run();
  }
});

await t.test('I58 review rating must be chosen by the buyer (no default 5); summary is null without reviews', async () => {
  const sku = I.one("SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 5 AND NOT EXISTS (SELECT 1 FROM product_reviews r WHERE r.product_id = p.id) ORDER BY s.id DESC LIMIT 1");
  assert.ok(sku, 'a product without reviews exists');
  const empty = await I.call(`/api/v1/products/${sku.product_id}/reviews`);
  assert.equal(empty.json.avg_rating, null, 'no invented 4.8');
  assert.equal(empty.json.review_count, 0);
  const o = (await I.checkout(c2, [{ sku_id: sku.id, quantity: 1 }])).json;
  assert.equal((await I.pay(c2, o)).status, 200);
  await deliver(o.order_id);
  const noRating = await I.call(`/api/v1/products/${sku.product_id}/reviews`, { method: 'POST', token: c2, body: { content: '잘 받았습니다' } });
  assert.equal(noRating.status, 400, noRating.text);
  assert.equal(noRating.json.code, 'INVALID_RATING');
  assert.equal((await I.call(`/api/v1/products/${sku.product_id}/reviews`, { method: 'POST', token: c2, body: { content: '잘 받았습니다', rating: 3.5 } })).status, 400, 'fractions rejected');
  const ok = await I.call(`/api/v1/products/${sku.product_id}/reviews`, { method: 'POST', token: c2, body: { content: '잘 받았습니다', rating: 3 } });
  assert.equal(ok.status, 201, ok.text);
  const after = await I.call(`/api/v1/products/${sku.product_id}/reviews`);
  assert.equal(after.json.avg_rating, 3);
  assert.equal(after.json.review_count, 1);
});

await t.test('I59 d1_31 voids orders marked PAID without payment: stock, ledger, settlements, audit; real orders untouched; idempotent', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { MIGRATIONS_DIR } = await import('./lib/harness.mjs');
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, 'd1_31_void_unpaid_orders_marked_paid.sql'), 'utf8');
  const sku = I.one("SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 20 ORDER BY s.id LIMIT 1 OFFSET 2");
  const real = (await I.checkout(c1, [{ sku_id: sku.id, quantity: 1 }])).json;
  assert.equal((await I.pay(c1, real)).status, 200);
  const stockBefore = I.stock(sku.id);
  // what the pre-V3 checkout left behind: PAID with no paid_at / payment_key / transaction, settlements PENDING
  const fakes = [];
  for (const qty of [2, 3]) {
    const o = (await I.checkout(c1, [{ sku_id: sku.id, quantity: qty }])).json;
    I.db.prepare("UPDATE orders SET payment_status = 'PAID', paid_at = NULL, payment_key = NULL WHERE id = ?").run(o.order_id);
    I.db.prepare("UPDATE sub_orders SET status = 'PAYMENT_CONFIRMED' WHERE parent_order_id = ?").run(o.order_id);
    I.db.prepare("UPDATE settlements SET status = 'PENDING' WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)").run(o.order_id);
    fakes.push(o.order_id);
  }
  assert.equal(I.stock(sku.id), stockBefore - 5);
  const realBefore = I.one('SELECT payment_status, paid_at, payment_key FROM orders WHERE id = ?', real.order_id);

  I.db.exec(sql);

  for (const id of fakes) {
    assert.equal(I.one('SELECT payment_status FROM orders WHERE id = ?', id).payment_status, 'CANCELLED');
    assert.deepEqual(I.q('SELECT DISTINCT status FROM sub_orders WHERE parent_order_id = ?', id).map((r) => r.status), ['CANCELLED']);
    assert.deepEqual(I.q('SELECT DISTINCT st.status FROM settlements st JOIN sub_orders s ON s.id = st.sub_order_id WHERE s.parent_order_id = ?', id).map((r) => r.status), ['CANCELLED']);
    assert.equal(I.one("SELECT COUNT(*) c FROM inventory_ledger WHERE reference_id = ? AND change_type = 'ORDER_CANCEL'", id).c, 1);
    assert.equal(I.one("SELECT COUNT(*) c FROM admin_audit_log WHERE target_id = ? AND action = 'ORDER_VOID_NO_PAYMENT'", id).c, 1);
  }
  assert.equal(I.stock(sku.id), stockBefore, 'exactly the deducted stock comes back');
  assert.deepEqual(I.one('SELECT payment_status, paid_at, payment_key FROM orders WHERE id = ?', real.order_id), realBefore, 'real paid order untouched');
  const ledgerSold = I.one("SELECT -SUM(l.quantity_delta) q FROM inventory_ledger l JOIN product_skus s ON s.id = l.sku_id WHERE s.product_id = ? AND l.change_type IN ('PURCHASE_DEDUCT','ORDER_CANCEL','RETURN_RESTOCK')", sku.product_id).q;
  assert.equal(I.one('SELECT total_sold_count c FROM products WHERE id = ?', sku.product_id).c, Math.max(0, ledgerSold));

  const snap = () => JSON.stringify([I.stock(sku.id), I.one('SELECT COUNT(*) c FROM inventory_ledger').c, I.one('SELECT COUNT(*) c FROM admin_audit_log').c, I.q('SELECT id, status FROM settlements ORDER BY id')]);
  const s1 = snap();
  I.db.exec(sql);
  assert.equal(snap(), s1, 'second run changes nothing');
});

await t.test('I31 full reconciliation passes after every scenario above (R01–R21)', async () => {
  const r = await I.call('/api/v1/admin/reconciliation', { token: ad });
  assert.equal(r.status, 200, r.text);
  const failedChecks = r.json.data.checks.filter((c) => !c.ok && c.id !== 'R07');
  assert.deepEqual(failedChecks.map((c) => `${c.id}:${JSON.stringify(c.violations).slice(0, 200)}`), []);
});

const res = t.finish();
if (res.failed) process.exit(1);
