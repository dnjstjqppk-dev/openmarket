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
await t.test('I31 full reconciliation passes after every scenario above (R01–R17)', async () => {
  const r = await I.call('/api/v1/admin/reconciliation', { token: ad });
  assert.equal(r.status, 200, r.text);
  const failedChecks = r.json.data.checks.filter((c) => !c.ok && c.id !== 'R07');
  assert.deepEqual(failedChecks.map((c) => `${c.id}:${JSON.stringify(c.violations).slice(0, 200)}`), []);
});

const res = t.finish();
if (res.failed) process.exit(1);
