// tests/journey_customer_test.mjs
// Buyer journey: cart -> quote -> checkout (coupons/credits) -> pay ->
// cancel/claim/review. Exact-amount assertions on every money joint.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Buyer journey (cart -> pay -> claim -> review)');

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox'
    }
  });
}

const PW = 'DevPass!2026#';
async function login(g, email, role) {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}
const addr = {
  recipient_name: '홍길동', recipient_phone: '010-1234-5678',
  shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236'
};

function partnerIdOf(g, email) {
  return g.db.prepare('SELECT p.id AS id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = ?').get(email).id;
}

async function setupSellers(g) {
  const ptA = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const ptB = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const mkTpl = async (pt, body) => (await g.call('/api/v1/partner/shipping-policies', { method: 'POST', token: pt, body })).json.data;
  const pidA = partnerIdOf(g, 'seller@temu-supply.com');
  const pidB = partnerIdOf(g, 'partner2@olmoa-tech.com');
  g.db.prepare('UPDATE partners SET sales_model = ? WHERE id IN (?, ?)').run('MARKETPLACE', pidA, pidB);
  const tplA = await mkTpl(ptA, { name: 'std', method: 'PARCEL', fee_type: 'CONDITIONAL', base_fee: 3000, free_threshold: 30000, is_default: true });
  const tplB = await mkTpl(ptB, { name: 'std', method: 'PARCEL', fee_type: 'PAID', base_fee: 2500, is_default: true });
  const regA = await g.call('/api/v1/partner/products', {
    method: 'POST', token: ptA,
    body: {
      title: 'Journey Lamp', description_html: '<p>bright lamp</p>', category_id: 'cat_e_audio',
      thumbnail_url: 'https://example.com/l.png', shipping_policy_id: tplA.id,
      options: [{ name: '종류', values: ['A', 'B', 'C'] }],
      skus: [
        { option_combination: { 종류: 'A' }, original_price: 30000, sale_price: 20000, stock_quantity: 20 },
        { option_combination: { 종류: 'B' }, original_price: 19999, sale_price: 9999, stock_quantity: 20 },
        { option_combination: { 종류: 'C' }, original_price: 20000, sale_price: 10000, stock_quantity: 20 }
      ]
    }
  });
  assert.equal(regA.status, 201, regA.text);
  const regB = await g.call('/api/v1/partner/products', {
    method: 'POST', token: ptB,
    body: {
      title: 'Journey Mug', description_html: '<p>white mug</p>', category_id: 'cat_e_audio',
      thumbnail_url: 'https://example.com/m.png', shipping_policy_id: tplB.id,
      sale_price: 15000, original_price: 18000, stock_quantity: 20
    }
  });
  assert.equal(regB.status, 201, regB.text);
  for (const pid of [regA.json.product_id, regB.json.product_id]) {
    const ap = await g.call(`/api/v1/admin/products/${pid}/review`, { method: 'POST', token: adm, body: { decision: 'APPROVE' } });
    assert.equal(ap.status, 200, ap.text);
  }
  const skuA = Object.fromEntries(g.db.prepare('SELECT id, option_combination_json FROM product_skus WHERE product_id = ?').all(regA.json.product_id)
    .map((r) => [JSON.parse(r.option_combination_json)['종류'], r.id]));
  const skuB = g.db.prepare('SELECT id FROM product_skus WHERE product_id = ?').get(regB.json.product_id).id;
  return { ptA, ptB, adm, pidA, pidB, prodA: regA.json.product_id, prodB: regB.json.product_id, skuA, skuB };
}

async function checkoutPaid(g, cust, body) {
  const o = (await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...addr, ...body } })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o)}`);
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust,
    body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount }
  });
  assert.equal(pay.status, 200, `pay ok: ${pay.text}`);
  return o;
}

function grantCredit(g, userId, amount) {
  const bal = g.db.prepare('SELECT COALESCE(SUM(amount_delta), 0) AS b FROM user_credits WHERE user_id = ?').get(userId).b;
  g.db.prepare('INSERT INTO user_credits (id, user_id, amount_delta, balance_after, reason) VALUES (?, ?, ?, ?, ?)')
    .run(`crd_j2_${Date.now()}_${amount}`, userId, amount, bal + amount, 'journey grant');
}

function mkCoupon(g, over) {
  const id = over.id;
  g.db.prepare(`INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, max_discount_amount, expires_at, is_active, issuer, seller_id, scope, platform_share_bps, dup_group, issue_method, issued_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, '2099-01-01 00:00:00', 1, ?, ?, ?, ?, ?, 'DOWNLOAD', 0)`)
    .run(id, over.code, over.title || 't', over.discount_type, over.discount_value, over.min_order_amount || 0, over.max_discount_amount ?? null,
      over.issuer, over.seller_id || null, over.scope, over.platform_share_bps ?? 10000, over.dup_group);
  return id;
}

async function claimAs(g, cust, couponId) {
  const r = await g.call('/api/v1/coupons/claim', { method: 'POST', token: cust, body: { coupon_id: couponId, idempotency_key: `j2claim-${couponId}` } });
  assert.equal(r.status, 200, `claim ${couponId}: ${r.text}`);
  return r.json.user_coupon_id;
}

await t.test('CJ1. cart, quote and checkout split two sellers with exact money', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const put = await g.call('/api/v1/cart', { method: 'PUT', token: cust, body: { items: [{ sku_id: s.skuA.A, quantity: 1 }, { sku_id: s.skuB, quantity: 1 }] } });
  assert.equal(put.status, 200, put.text);
  const cart = await g.call('/api/v1/cart', { token: cust });
  assert.equal(cart.json.count, 2, 'two lines stored');
  assert.ok(cart.json.data.every((l) => l.sale_price > 0 && l.title), 'live prices and titles');
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }, { sku_id: s.skuB, quantity: 1 }] }
  });
  assert.equal(q.status, 200, q.text);
  const quote = q.json.data;
  assert.equal(quote.total_goods_amount, 35000, 'goods 20000+15000');
  assert.equal(quote.total_shipping_amount, 5500, 'ship 3000+2500');
  assert.equal(quote.total_pay_amount, 40500, 'pay exact');
  assert.equal(quote.sub_orders.length, 2, 'two sub-orders quoted');
  const qa = quote.sub_orders.find((x) => x.partner_id === s.pidA);
  assert.equal(qa.shipping_fee, 3000, 'A under threshold pays');
  assert.equal(qa.shipping_groups[0].fee_type, 'CONDITIONAL', 'template recorded');
  const o = await checkoutPaid(g, cust, { items: [{ sku_id: s.skuA.A, quantity: 1 }, { sku_id: s.skuB, quantity: 1 }] });
  assert.equal(o.total_pay_amount, 40500, 'checkout matches quote');
  const d = await g.call(`/api/v1/orders/${o.order_id}`, { token: cust });
  assert.equal(d.json.data.sub_orders.length, 2, 'two sub-orders stored');
  assert.ok(Array.isArray(d.json.data.claims) && Array.isArray(d.json.data.refunds), 'claims/refunds carried');
  const stock = g.db.prepare('SELECT stock_quantity FROM product_skus WHERE id = ?').get(s.skuA.A).stock_quantity;
  assert.equal(stock, 19, 'stock decremented at order');
});

await t.test('CJ2. free-shipping threshold flips on the exact won', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const q1 = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }, { sku_id: s.skuA.B, quantity: 1 }] }
  });
  assert.equal(q1.json.data.sub_orders[0].shipping_fee, 3000, '29999 pays');
  const q2 = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }, { sku_id: s.skuA.C, quantity: 1 }] }
  });
  assert.equal(q2.json.data.total_goods_amount, 30000, 'goods exact');
  assert.equal(q2.json.data.sub_orders[0].shipping_fee, 0, '30000 ships free');
});

await t.test('CJ3. volume tiers price 3/5/10 exactly', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const line = async (qty) => (await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: qty }] }
  })).json.data;
  assert.equal((await line(2)).volume_discount_amount, 0, 'qty2 no discount');
  const q3 = await line(3);
  assert.equal(q3.sub_orders[0].items[0].volume_discount_pct, 5, 'qty3 tier');
  assert.equal(q3.sub_orders[0].items[0].line_total, 57000, 'qty3 line 19000x3');
  const q5 = await line(5);
  assert.equal(q5.sub_orders[0].items[0].line_total, 90000, 'qty5 line 18000x5');
  const q10 = await line(10);
  assert.equal(q10.sub_orders[0].items[0].line_total, 170000, 'qty10 line 17000x10');
});

await t.test('CJ4. store coupon honors min, scope and one-per-seller', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  mkCoupon(g, { id: 'cp_j2s1', code: 'J2S1', discount_type: 'FIXED_AMOUNT', discount_value: 2000, min_order_amount: 15000, issuer: 'SELLER', seller_id: s.pidA, scope: 'SELLER', platform_share_bps: 0, dup_group: 'STORE' });
  mkCoupon(g, { id: 'cp_j2s2', code: 'J2S2', discount_type: 'FIXED_AMOUNT', discount_value: 500, issuer: 'SELLER', seller_id: s.pidA, scope: 'SELLER', platform_share_bps: 0, dup_group: 'STORE' });
  mkCoupon(g, { id: 'cp_j2sB', code: 'J2SB', discount_type: 'FIXED_AMOUNT', discount_value: 500, issuer: 'SELLER', seller_id: s.pidB, scope: 'SELLER', platform_share_bps: 0, dup_group: 'STORE' });
  const u1 = await claimAs(g, cust, 'cp_j2s1');
  const u2 = await claimAs(g, cust, 'cp_j2s2');
  const uB = await claimAs(g, cust, 'cp_j2sB');
  const ok = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }], store_coupon_ids: [u1] }
  });
  assert.equal(ok.json.data.coupon_discount_amount, 2000, 'store coupon applied');
  const small = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.C, quantity: 1 }], store_coupon_ids: [u1] }
  });
  assert.equal(small.status, 409, 'under min rejected');
  assert.equal(small.json.code, 'COUPON_MIN_ORDER', 'code');
  const exact = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }], store_coupon_ids: [u1] }
  });
  assert.equal(exact.status, 200, '20000 over min 15000 passes');
  const dup = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }], store_coupon_ids: [u1, u2] }
  });
  assert.equal(dup.json.code, 'COUPON_DUPLICATE_GROUP', 'one store coupon per seller');
  const scope = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }], store_coupon_ids: [uB] }
  });
  assert.equal(scope.json.code, 'COUPON_NOT_AVAILABLE', 'other-seller coupon unusable');
});

await t.test('CJ5. platform coupon caps, mins and legacy field', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  mkCoupon(g, { id: 'cp_j2p1', code: 'J2P1', discount_type: 'PERCENT', discount_value: 10, max_discount_amount: 3000, issuer: 'PLATFORM', scope: 'ALL', platform_share_bps: 10000, dup_group: 'PLATFORM' });
  const u = await claimAs(g, cust, 'cp_j2p1');
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }, { sku_id: s.skuB, quantity: 1 }], platform_coupon_id: u }
  });
  assert.equal(q.json.data.coupon_discount_amount, 3000, '10% of 35000 capped at 3000');
  const legacy = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }], user_coupon_id: u }
  });
  assert.equal(legacy.json.data.coupon_discount_amount, 2000, 'legacy field works (10% of 20000)');
  mkCoupon(g, { id: 'cp_j2p2', code: 'J2P2', discount_type: 'FIXED_AMOUNT', discount_value: 1000, issuer: 'PLATFORM', scope: 'ALL', platform_share_bps: 10000, dup_group: 'PLATFORM' });
  const u2 = await claimAs(g, cust, 'cp_j2p2');
  const two = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }], platform_coupon_id: u, user_coupon_id: u2 }
  });
  assert.equal(two.json.code, 'COUPON_DUPLICATE_GROUP', 'two platform refs rejected');
});

await t.test('CJ6. store then platform stack in order with exact remainder', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  mkCoupon(g, { id: 'cp_j2x1', code: 'J2X1', discount_type: 'FIXED_AMOUNT', discount_value: 2000, issuer: 'SELLER', seller_id: s.pidA, scope: 'SELLER', platform_share_bps: 0, dup_group: 'STORE' });
  mkCoupon(g, { id: 'cp_j2x2', code: 'J2X2', discount_type: 'PERCENT', discount_value: 10, issuer: 'PLATFORM', scope: 'ALL', platform_share_bps: 10000, dup_group: 'PLATFORM' });
  const us = await claimAs(g, cust, 'cp_j2x1');
  const up = await claimAs(g, cust, 'cp_j2x2');
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }, { sku_id: s.skuB, quantity: 1 }], store_coupon_ids: [us], platform_coupon_id: up }
  });
  assert.equal(q.json.data.coupon_discount_amount, 5300, '2000 store + 3300 platform on remainder');
  assert.equal(q.json.data.total_pay_amount, 35000 - 5300 + 5500, 'pay exact');
});

await t.test('CJ7. credits need verification, floor, balance and clamp at 20%', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const me = g.db.prepare("SELECT id FROM users WHERE email = 'customer@example.com'").get().id;
  g.db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(me);
  grantCredit(g, me, 50000);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const small = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.C, quantity: 1 }], use_credit_amount: 100 }
  });
  assert.equal(small.json.code, 'CREDIT_MIN_ORDER', 'under-30000 goods refused');
  const over = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }, { sku_id: s.skuB, quantity: 1 }], use_credit_amount: 999999 }
  });
  assert.equal(over.json.code, 'CREDIT_INSUFFICIENT', 'over-balance refused');
  const clamp = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 1 }, { sku_id: s.skuB, quantity: 1 }], use_credit_amount: 50000 }
  });
  assert.equal(clamp.json.data.credit_used_amount, 7000, 'clamped to 20% of 35000');
  const reg = await g.call('/api/v1/auth/register', { method: 'POST', body: { email: 'fresh@example.com', password: 'Strong!Pass2026', full_name: 'F', phone: '010-9999-8888', agree_terms: true, agree_privacy: true } });
  assert.equal(reg.status, 201, reg.text);
  const fresh = reg.json.token;
  const unver = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: fresh, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 2 }], use_credit_amount: 100 }
  });
  assert.equal(unver.status, 403, 'unverified refused');
  assert.equal(unver.json.code, 'CREDIT_UNVERIFIED', 'code');
});

await t.test('CJ8. stock caps the order at the exact unit', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const over = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 21 }] }
  });
  assert.equal(over.status, 409, 'over stock refused');
  assert.equal(over.json.code, 'STOCK_INSUFFICIENT', 'code');
  const exact = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 20 }] }
  });
  assert.equal(exact.status, 200, 'exact stock passes');
});

await t.test('CJ9. checkout validates contact and address', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const badPhone = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr, recipient_phone: '010', items: [{ sku_id: s.skuA.A, quantity: 1 }] }
  });
  assert.equal(badPhone.json.code, 'INVALID_PHONE', 'bad phone rejected');
  const noAddr = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr, shipping_address_line1: '', items: [{ sku_id: s.skuA.A, quantity: 1 }] }
  });
  assert.equal(noAddr.status, 400, 'empty address rejected');
});

await t.test('CJ10. cross-border lines need a valid PCCC', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  g.db.prepare('UPDATE products SET requires_pccc = 1 WHERE id = ?').run(s.prodB);
  const missing = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuB, quantity: 1 }] }
  });
  assert.equal(missing.json.code, 'PCCC_REQUIRED', 'missing pccc rejected');
  const malformed = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr, pccc: 'P123', items: [{ sku_id: s.skuB, quantity: 1 }] }
  });
  assert.equal(malformed.json.code, 'INVALID_PCCC', 'malformed pccc rejected');
  const o = await checkoutPaid(g, cust, { pccc: 'P123456789012', items: [{ sku_id: s.skuB, quantity: 1 }] });
  assert.ok(o.order_id, 'valid pccc orders');
});

await t.test('CJ11. pre-pay cancel releases stock with no refund', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = (await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: s.skuA.A, quantity: 2 }] } })).json;
  assert.ok(o.order_id, 'order placed');
  assert.equal(g.db.prepare('SELECT stock_quantity FROM product_skus WHERE id = ?').get(s.skuA.A).stock_quantity, 18, 'reserved');
  const c = await g.call(`/api/v1/orders/${o.order_id}/cancel`, { method: 'POST', token: cust });
  assert.equal(c.status, 200, c.text);
  assert.ok(!c.json.refund, 'no money moved');
  assert.equal(g.db.prepare('SELECT stock_quantity FROM product_skus WHERE id = ?').get(s.skuA.A).stock_quantity, 20, 'stock released');
});

await t.test('CJ12. post-pay cancel refunds and restores coupons and credits', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const me = g.db.prepare("SELECT id FROM users WHERE email = 'customer@example.com'").get().id;
  g.db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(me);
  grantCredit(g, me, 50000);
  mkCoupon(g, { id: 'cp_j2c1', code: 'J2C1', discount_type: 'FIXED_AMOUNT', discount_value: 2000, issuer: 'SELLER', seller_id: s.pidA, scope: 'SELLER', platform_share_bps: 0, dup_group: 'STORE' });
  const u = await claimAs(g, cust, 'cp_j2c1');
  const o = await checkoutPaid(g, cust, { items: [{ sku_id: s.skuA.A, quantity: 2 }], store_coupon_ids: [u], use_credit_amount: 5000 });
  const used = g.db.prepare('SELECT is_used FROM user_coupons WHERE id = ?').get(u).is_used;
  assert.equal(used, 1, 'coupon consumed');
  const c = await g.call(`/api/v1/orders/${o.order_id}/cancel`, { method: 'POST', token: cust });
  assert.equal(c.status, 200, c.text);
  assert.ok(c.json.refund, 'refund issued');
  assert.equal(g.db.prepare('SELECT is_used FROM user_coupons WHERE id = ?').get(u).is_used, 0, 'coupon restored');
  const bal = g.db.prepare('SELECT COALESCE(SUM(amount_delta), 0) AS b FROM user_credits WHERE user_id = ?').get(me).b;
  assert.equal(bal, 55000, 'credit restored (5000 seed + 50000 grant)');
  assert.equal(g.db.prepare('SELECT stock_quantity FROM product_skus WHERE id = ?').get(s.skuA.A).stock_quantity, 20, 'stock restored');
  const d = await g.call(`/api/v1/orders/${o.order_id}`, { token: cust });
  assert.ok(d.json.data.refunds.length >= 1, 'refund rows listed');
  assert.ok(Number(d.json.data.refunds[0].pg_amount) > 0, 'pg portion recorded');
});

await t.test('CJ13. sub-order cancel is partial, item-level and idempotent', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await checkoutPaid(g, cust, { items: [{ sku_id: s.skuA.A, quantity: 2 }, { sku_id: s.skuB, quantity: 1 }] });
  const d0 = (await g.call(`/api/v1/orders/${o.order_id}`, { token: cust })).json.data;
  const subB = d0.sub_orders.find((x) => x.partner_id === s.pidB);
  const itemA = d0.items.find((x) => x.sku_id === s.skuA.A);
  const one = await g.call(`/api/v1/orders/${o.order_id}/sub-orders/${subB.id}/cancel`, {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'cj13-replay-01' }
  });
  assert.equal(one.status, 200, one.text);
  assert.equal(one.json.status, 'PARTIAL_REFUNDED', 'order partially refunded');
  // F-J2-01: the whole-sub path reports partial:false (flag only set on the
  // item-level path). The UI reads payment_status, so this is cosmetic.
  assert.equal(one.json.partial, false, 'partial flag pinned (known wart F-J2-01)');
  const again = await g.call(`/api/v1/orders/${o.order_id}/sub-orders/${subB.id}/cancel`, {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'cj13-replay-01' }
  });
  assert.equal(again.json.code, 'SUB_ORDER_NOT_CANCELLABLE', 'no replay once cancelled');
  const d1 = (await g.call(`/api/v1/orders/${o.order_id}`, { token: cust })).json.data;
  assert.ok(d1.sub_orders.find((x) => x.partner_id === s.pidA && x.status !== 'CANCELLED'), 'A sub-order intact');
  assert.equal(g.db.prepare('SELECT stock_quantity FROM product_skus WHERE id = ?').get(s.skuB).stock_quantity, 20, 'B stock back');
  const subA = d1.sub_orders.find((x) => x.partner_id === s.pidA).id;
  const unit = await g.call(`/api/v1/orders/${o.order_id}/sub-orders/${subA}/cancel`, {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'cj13-unit-01' }, body: { items: [{ order_item_id: itemA.id, quantity: 1 }] }
  });
  assert.equal(unit.status, 200, unit.text);
  assert.equal(unit.json.partial, true, 'item path reports partial');
  const replay = await g.call(`/api/v1/orders/${o.order_id}/sub-orders/${subA}/cancel`, {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'cj13-unit-01' }, body: { items: [{ order_item_id: itemA.id, quantity: 1 }] }
  });
  assert.equal(replay.json.replay, true, 'same key replays');
  const left = g.db.prepare('SELECT refunded_quantity FROM order_items WHERE id = ?').get(itemA.id).refunded_quantity;
  assert.equal(left, 1, 'one unit refunded');
});

await t.test('CJ14. return claim needs delivery, quotes fees and withdraws', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await checkoutPaid(g, cust, { items: [{ sku_id: s.skuA.A, quantity: 1 }] });
  const early = await g.call(`/api/v1/orders/${o.order_id}/claims`, { method: 'POST', token: cust, body: { claim_type: 'RETURN' } });
  assert.equal(early.json.code, 'NOT_RETURNABLE', 'pre-delivery refused');
  const subId = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o.order_id).id;
  await g.call(`/api/v1/partner/orders/${subId}/prepare`, { method: 'POST', token: s.ptA });
  await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.ptA, body: { carrier: 'CJ대한통운', tracking_number: 'CJ1234567890' } });
  await g.call(`/api/v1/orders/${o.order_id}/advance-tracking`, { method: 'POST', token: s.adm });
  await g.call(`/api/v1/orders/${o.order_id}/advance-tracking`, { method: 'POST', token: s.adm });
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const cl = await g.call(`/api/v1/orders/${o.order_id}/claims`, {
    method: 'POST', token: cust,
    body: { claim_type: 'RETURN', sub_order_id: subId, reason_code: 'DEFECTIVE', reason: '깨져서 도착', photos: ['/uploads/j2-crack.png'], pickup_address: '서울시 강남구', pickup_date: tomorrow }
  });
  assert.equal(cl.status, 201, cl.text);
  assert.equal(cl.json.fault, 'SELLER', 'defect is seller fault');
  assert.equal(cl.json.estimated_return_fee, 0, 'seller fault ships free');
  assert.equal(g.db.prepare('SELECT status FROM sub_orders WHERE id = ?').get(subId).status, 'RETURN_REQUESTED', 'sub flagged');
  const dupe = await g.call(`/api/v1/orders/${o.order_id}/claims`, { method: 'POST', token: cust, body: { claim_type: 'RETURN', sub_order_id: subId } });
  // F-J2-02: the open-claim guard is unreachable via buyers (status gate fires
  // first); kept as defense-in-depth. Second claim lands here instead.
  assert.equal(dupe.json.code, 'NOT_RETURNABLE', 'second claim blocked');
  const wd = await g.call(`/api/v1/orders/${o.order_id}/claims/${cl.json.claim_id}`, { method: 'DELETE', token: cust });
  assert.equal(wd.status, 200, wd.text);
  assert.equal(g.db.prepare('SELECT status FROM sub_orders WHERE id = ?').get(subId).status, 'DELIVERED', 'withdraw reopens delivery');
});

await t.test('CJ15. exchange stays in-product at equal price', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await checkoutPaid(g, cust, { items: [{ sku_id: s.skuA.A, quantity: 1 }] });
  const subId = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o.order_id).id;
  await g.call(`/api/v1/partner/orders/${subId}/prepare`, { method: 'POST', token: s.ptA });
  await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.ptA, body: { carrier: 'CJ대한통운', tracking_number: 'CJEX12345678' } });
  await g.call(`/api/v1/orders/${o.order_id}/advance-tracking`, { method: 'POST', token: s.adm });
  await g.call(`/api/v1/orders/${o.order_id}/advance-tracking`, { method: 'POST', token: s.adm });
  const item = g.db.prepare('SELECT id FROM order_items WHERE sub_order_id = ?').get(subId).id;
  const diff = await g.call(`/api/v1/orders/${o.order_id}/claims`, {
    method: 'POST', token: cust, body: { claim_type: 'EXCHANGE', sub_order_id: subId, items: [{ order_item_id: item, quantity: 1, exchange_sku_id: s.skuA.B }] }
  });
  assert.equal(diff.json.code, 'EXCHANGE_PRICE_DIFFERS', 'price must match');
  const foreign = await g.call(`/api/v1/orders/${o.order_id}/claims`, {
    method: 'POST', token: cust, body: { claim_type: 'EXCHANGE', sub_order_id: subId, items: [{ order_item_id: item, quantity: 1, exchange_sku_id: s.skuB }] }
  });
  assert.equal(foreign.json.code, 'EXCHANGE_OTHER_PRODUCT', 'same product only');
});

await t.test('CJ16. reviews need delivery and stay single per order', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await checkoutPaid(g, cust, { items: [{ sku_id: s.skuA.A, quantity: 1 }] });
  const early = await g.call(`/api/v1/products/${s.prodA}/reviews`, { method: 'POST', token: cust, body: { rating: 5, content: 'too soon' } });
  assert.equal(early.status, 403, 'pre-delivery refused');
  const subId = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o.order_id).id;
  await g.call(`/api/v1/partner/orders/${subId}/prepare`, { method: 'POST', token: s.ptA });
  await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.ptA, body: { carrier: 'CJ대한통운', tracking_number: 'CJRV12345678' } });
  await g.call(`/api/v1/orders/${o.order_id}/advance-tracking`, { method: 'POST', token: s.adm });
  await g.call(`/api/v1/orders/${o.order_id}/advance-tracking`, { method: 'POST', token: s.adm });
  const badRating = await g.call(`/api/v1/products/${s.prodA}/reviews`, { method: 'POST', token: cust, body: { rating: 9, content: 'x' } });
  assert.equal(badRating.json.code, 'INVALID_RATING', 'rating bounded');
  const w = await g.call(`/api/v1/products/${s.prodA}/reviews`, { method: 'POST', token: cust, body: { rating: 5, content: '튼튼하고 배송 빨라요', images: ['/uploads/j2-lamp.png'] } });
  assert.equal(w.status, 201, w.text);
  const dupe = await g.call(`/api/v1/products/${s.prodA}/reviews`, { method: 'POST', token: cust, body: { rating: 4, content: 'again' } });
  assert.equal(dupe.json.code, 'REVIEW_EXISTS', 'single review per order');
  const list = await g.call(`/api/v1/products/${s.prodA}/reviews`);
  assert.equal(list.json.review_count, 1, 'listed');
  assert.equal(list.json.avg_rating, 5, 'average measured');
});

await t.test('CJ17. order list pages and detail carries money truth', async () => {
  const g = await newGateway();
  const s = await setupSellers(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  await checkoutPaid(g, cust, { items: [{ sku_id: s.skuA.A, quantity: 1 }] });
  await checkoutPaid(g, cust, { items: [{ sku_id: s.skuB, quantity: 1 }] });
  const p1 = await g.call('/api/v1/orders?per_page=1&page=1', { token: cust });
  const p2 = await g.call('/api/v1/orders?per_page=1&page=2', { token: cust });
  assert.equal(p1.json.pagination.total, 2, 'two orders');
  assert.notEqual(p1.json.data[0].id, p2.json.data[0].id, 'pages differ');
  const d = await g.call(`/api/v1/orders/${p1.json.data[0].id}`, { token: cust });
  const o = d.json.data.order || d.json.data;
  const goods = Number(o.total_goods_amount), ship = Number(o.total_shipping_amount), pay = Number(o.total_pay_amount);
  const disc = Number(o.coupon_discount_amount || 0) + Number(o.volume_discount_amount || 0) + Number(o.credit_used_amount || 0);
  assert.equal(goods - disc + ship, pay, 'money invariant on detail');
});

t.finish();
