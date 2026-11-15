// tests/coupon_engine_test.mjs
// Work order 2-3: platform/store coupon split, scopes, burden sharing, refunds.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Coupon engine (2-3)');

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
const addr = (postal) => ({
  recipient_name: '홍길동', recipient_phone: '010-1234-5678',
  shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: postal
});

async function login(g, email, role = 'CUSTOMER') {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

function sellerSkus(g, partnerId, n) {
  const rows = g.db.prepare(
    `SELECT s.id, s.product_id, s.sale_price FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.partner_id = ? AND p.status = 'ACTIVE' AND s.stock_quantity > 0 LIMIT 60`
  ).all(partnerId);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.product_id)) continue;
    seen.add(r.product_id);
    out.push(r);
    if (out.length >= n) break;
  }
  assert.ok(out.length >= n, `need ${n} distinct-product skus`);
  return out;
}

function mkCoupon(g, over = {}) {
  const id = `cp_${Math.random().toString(36).slice(2, 10)}`;
  const row = {
    id, code: `CODE_${id}`, title: 't', discount_type: 'FIXED_AMOUNT', discount_value: 1000,
    min_order_amount: 0, max_discount_amount: null, expires_at: '2099-01-01 00:00:00', is_active: 1,
    issuer: 'PLATFORM', seller_id: null, scope: 'ALL', platform_share_bps: 10000, dup_group: 'PLATFORM',
    issue_method: 'DOWNLOAD', total_quantity: null, issued_count: 0, per_user_limit: null, starts_at: null,
    ...over, id
  };
  const keys = Object.keys(row);
  g.db.prepare(`INSERT INTO coupons (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => row[k]));
  return id;
}

function grant(g, userId, couponId) {
  const id = `uc_${Math.random().toString(36).slice(2, 10)}`;
  g.db.prepare('INSERT INTO user_coupons (id, user_id, coupon_id, is_used) VALUES (?, ?, ?, 0)')
    .run(id, userId, couponId);
  return id;
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

// 2-6 deal layer: an approved flash item in a live campaign replaces the
// ticket price (services/orders.js). Absolute expectations price the charged
// amount, not the shelf price.
function chargedPrice(g, sku) {
  const deal = g.db.prepare(`SELECT f.deal_price AS d FROM flash_sale_items f
    JOIN flash_sale_campaigns c ON c.id = f.campaign_id
    WHERE f.status = 'APPROVED' AND c.status = 'ACTIVE' AND c.starts_at <= CURRENT_TIMESTAMP AND c.ends_at > CURRENT_TIMESTAMP
      AND f.deal_price > 0 AND ((f.sku_id IS NOT NULL AND f.sku_id = ?) OR (f.sku_id IS NULL AND f.product_id = ?))
    ORDER BY (f.sku_id IS NULL) ASC, f.deal_price ASC LIMIT 1`).get(sku.id, sku.product_id);
  return deal ? deal.d : sku.sale_price;
}

await t.test('1. coupon tables and columns exist', async () => {
  const g = await newGateway();
  for (const c of ['issuer', 'seller_id', 'scope', 'platform_share_bps', 'dup_group',
    'issue_method', 'total_quantity', 'issued_count', 'per_user_limit', 'starts_at']) {
    assert.ok(columns(g.db, 'coupons').includes(c), `coupons has ${c}`);
  }
  for (const c of ['coupon_id', 'target_type', 'target_id']) {
    assert.ok(columns(g.db, 'coupon_targets').includes(c), `coupon_targets has ${c}`);
  }
  for (const c of ['store_coupon_alloc', 'platform_coupon_alloc', 'seller_burden_amount',
    'refunded_store_coupon_amount', 'refunded_platform_coupon_amount', 'refunded_seller_burden_amount']) {
    assert.ok(columns(g.db, 'order_items').includes(c), `order_items has ${c}`);
  }
  assert.ok(columns(g.db, 'sub_orders').includes('applied_store_coupon_id'), 'sub_orders has applied_store_coupon_id');
  assert.ok(columns(g.db, 'settlements').includes('seller_coupon_burden'), 'settlements has seller_coupon_burden');
  assert.ok(columns(g.db, 'user_coupons').includes('claim_idempotency_key'), 'user_coupons has claim_idempotency_key');
});

await t.test('2. seller coupons must name a seller, store group and zero platform share', async () => {
  const g = await newGateway();
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  assert.throws(() => mkCoupon(g, { issuer: 'SELLER' }), 'seller coupon without seller_id is rejected');
  assert.throws(() => mkCoupon(g, { issuer: 'SELLER', seller_id: pid, dup_group: 'PLATFORM', platform_share_bps: 0 }),
    'seller coupon outside the store group is rejected');
  assert.throws(() => mkCoupon(g, { issuer: 'SELLER', seller_id: pid, dup_group: 'STORE', platform_share_bps: 5000 }),
    'seller coupon with platform share is rejected');
  mkCoupon(g, { issuer: 'SELLER', seller_id: pid, dup_group: 'STORE', platform_share_bps: 0, scope: 'SELLER' });
});

await t.test('3. duplication rules: one platform coupon, one store coupon per seller', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const me = g.db.prepare('SELECT id FROM users WHERE email = ?').get('customer@example.com').id;
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const [s1] = sellerSkus(g, pid, 1);
  const p1 = mkCoupon(g, { discount_value: 500 });
  const p2 = mkCoupon(g, { discount_value: 600 });
  const u1 = grant(g, me, p1);
  const u2 = grant(g, me, p2);
  const st1 = mkCoupon(g, { issuer: 'SELLER', seller_id: pid, dup_group: 'STORE', platform_share_bps: 0, scope: 'SELLER', discount_value: 100 });
  const st2 = mkCoupon(g, { issuer: 'SELLER', seller_id: pid, dup_group: 'STORE', platform_share_bps: 0, scope: 'SELLER', discount_value: 200 });
  const su1 = grant(g, me, st1);
  const su2 = grant(g, me, st2);
  const items = [{ sku_id: s1.id, quantity: 1 }];
  const ok = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items, platform_coupon_id: u1, store_coupon_ids: [su1] }
  });
  assert.equal(ok.status, 200, ok.text);
  const dupPlat = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items, user_coupon_id: u1, platform_coupon_id: u2 }
  });
  assert.equal(dupPlat.status, 409, dupPlat.text);
  assert.equal(dupPlat.json.code, 'COUPON_DUPLICATE_GROUP');
  const dupStore = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items, store_coupon_ids: [su1, su2] }
  });
  assert.equal(dupStore.status, 409, dupStore.text);
  assert.equal(dupStore.json.code, 'COUPON_DUPLICATE_GROUP');
});

await t.test('4. minimum order and scope narrow the eligible sum', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const me = g.db.prepare('SELECT id FROM users WHERE email = ?').get('customer@example.com').id;
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const [s1, s2] = sellerSkus(g, pid, 2);
  const cat = g.db.prepare('SELECT category_id FROM products WHERE id = ?').get(s1.product_id).category_id;
  const cp = mkCoupon(g, { discount_type: 'PERCENT', discount_value: 10, min_order_amount: 1000000, scope: 'CATEGORY' });
  g.db.prepare('INSERT INTO coupon_targets (coupon_id, target_type, target_id) VALUES (?, ?, ?)').run(cp, 'CATEGORY', cat);
  const u = grant(g, me, cp);
  const small = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }, { sku_id: s2.id, quantity: 1 }], platform_coupon_id: u }
  });
  assert.equal(small.status, 409, small.text);
  assert.equal(small.json.code, 'COUPON_MIN_ORDER');
  const cp2 = mkCoupon(g, { discount_type: 'PERCENT', discount_value: 10, min_order_amount: 0, scope: 'CATEGORY', max_discount_amount: 1000000 });
  g.db.prepare('INSERT INTO coupon_targets (coupon_id, target_type, target_id) VALUES (?, ?, ?)').run(cp2, 'CATEGORY', cat);
  const u2 = grant(g, me, cp2);
  const scoped = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }, { sku_id: s2.id, quantity: 1 }], platform_coupon_id: u2 }
  });
  assert.equal(scoped.status, 200, scoped.text);
  const s1cat = g.db.prepare('SELECT category_id FROM products WHERE id = ?').get(s2.product_id).category_id;
  const s2eligible = s1cat === cat ? chargedPrice(g, s2) : 0;
  const expect = Math.floor(((chargedPrice(g, s1) + s2eligible) * 10 + 50) / 100);
  assert.equal(scoped.json.data.coupon_discount_amount, expect, 'only the targeted category is discounted');
});

await t.test('5. burden splits round half-up and land on the settlement', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const me = g.db.prepare('SELECT id FROM users WHERE email = ?').get('customer@example.com').id;
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' AND sales_model = 'MARKETPLACE' LIMIT 1").get().id;
  const [s1] = sellerSkus(g, pid, 1);
  const cp = mkCoupon(g, { discount_type: 'FIXED_AMOUNT', discount_value: 101, min_order_amount: 0, platform_share_bps: 3333 });
  const u = grant(g, me, cp);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }], platform_coupon_id: u }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const item = g.db.prepare('SELECT * FROM order_items WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(o.order_id);
  assert.equal(item.platform_coupon_alloc, 101, 'platform alloc stored');
  assert.equal(item.store_coupon_alloc, 0, 'no store alloc');
  assert.equal(item.seller_burden_amount, 67, 'seller share rounds half-up (101 x 6667bps)');
  const st = g.db.prepare('SELECT * FROM settlements WHERE sub_order_id = ?').get(item.sub_order_id);
  assert.equal(st.seller_coupon_burden, 67, 'settlement carries the burden');
  assert.equal(st.net_payout_amount, st.gross_amount - st.commission_amount + st.shipping_fee - 67, 'payout deducts the burden');
});

await t.test('6. store coupons are fully seller-funded and recorded per sub-order', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const me = g.db.prepare('SELECT id FROM users WHERE email = ?').get('customer@example.com').id;
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' AND sales_model = 'MARKETPLACE' LIMIT 1").get().id;
  const [s1] = sellerSkus(g, pid, 1);
  const st = mkCoupon(g, { issuer: 'SELLER', seller_id: pid, dup_group: 'STORE', platform_share_bps: 0, scope: 'SELLER', discount_value: 700 });
  const su = grant(g, me, st);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }], store_coupon_ids: [su] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const item = g.db.prepare('SELECT * FROM order_items WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(o.order_id);
  assert.equal(item.store_coupon_alloc, 700, 'store alloc stored');
  assert.equal(item.seller_burden_amount, 700, 'seller funds the whole store coupon');
  const sub = g.db.prepare('SELECT * FROM sub_orders WHERE parent_order_id = ?').get(o.order_id);
  assert.equal(sub.applied_store_coupon_id, su, 'sub-order records the store coupon');
});

await t.test('7. partial refunds return each share proportionally and stay balanced', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const me = g.db.prepare('SELECT id FROM users WHERE email = ?').get('customer@example.com').id;
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' AND sales_model = 'MARKETPLACE' LIMIT 1").get().id;
  const [s1] = sellerSkus(g, pid, 1);
  const cp = mkCoupon(g, { discount_type: 'FIXED_AMOUNT', discount_value: 1000, min_order_amount: 0, platform_share_bps: 5000 });
  const u = grant(g, me, cp);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 4 }], platform_coupon_id: u }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const item = g.db.prepare('SELECT * FROM order_items WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(o.order_id);
  assert.equal(item.platform_coupon_alloc, 1000, 'coupon lands on the single line');
  const rf = await g.call(`/api/v1/admin/orders/${o.order_id}/refund`, {
    method: 'POST', token: adm,
    body: { reason: 'partial', lines: [{ order_item_id: item.id, quantity: 1 }] }
  });
  assert.equal(rf.status, 200, rf.text);
  const after = g.db.prepare('SELECT * FROM order_items WHERE id = ?').get(item.id);
  assert.equal(after.refunded_platform_coupon_amount, 250, 'platform share returns proportionally');
  assert.equal(after.refunded_store_coupon_amount, 0, 'no store share to return');
  const fin = await g.call(`/api/v1/admin/orders/${o.order_id}/refund`, {
    method: 'POST', token: adm,
    body: { reason: 'rest', lines: [{ order_item_id: item.id, quantity: 3 }] }
  });
  assert.equal(fin.status, 200, fin.text);
  const done = g.db.prepare('SELECT * FROM order_items WHERE id = ?').get(item.id);
  assert.equal(done.refunded_platform_coupon_amount, 1000, 'final refund takes the exact remainder');
  const bal = g.db.prepare("SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) AS b FROM journal_entries WHERE order_id = ?").get(o.order_id).b;
  assert.equal(bal, 0, 'journal stays balanced across coupon order and refunds');
});

await t.test('8. legacy single-coupon requests still apply as platform coupons', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const [s1] = sellerSkus(g, pid, 1);
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }], user_coupon_id: 'uc_002' }
  });
  assert.equal(q.status, 200, q.text);
  assert.equal(q.json.data.coupon_discount_amount, 3000, 'seed fixed coupon applies in full');
});

await t.test('9. one hundred concurrent claims never over-issue', async () => {
  const g = await newGateway();
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  const { claimCoupon } = await import(pathToFileURL(path.join(ROOT, 'apps/cloudflare-gateway/src/services/coupons.js')).href);
  const cp = mkCoupon(g, { total_quantity: 5, per_user_limit: 100 });
  const users = [];
  for (let i = 0; i < 20; i++) {
    const id = `u_load_${i}`;
    g.db.prepare('INSERT INTO users (id, email, password_hash, full_name, phone, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, `load${i}@example.com`, 'x', 'L', '010', 'ROLE_CUSTOMER');
    users.push(id);
  }
  const attempts = await Promise.all(Array.from({ length: 100 }, (_, i) =>
    claimCoupon(g.env, users[i % users.length], cp, `claimload-${i}`)
      .then(() => 'ok')
      .catch((e) => e.code || 'ERR')
  ));
  const ok = attempts.filter((r) => r === 'ok').length;
  assert.equal(ok, 5, `exactly 5 claims succeed, got ${ok}`);
  const row = g.db.prepare('SELECT issued_count FROM coupons WHERE id = ?').get(cp);
  assert.equal(row.issued_count, 5, 'issued count stops at the cap');
  const grants = g.db.prepare('SELECT COUNT(*) AS n FROM user_coupons WHERE coupon_id = ?').get(cp).n;
  assert.equal(grants, 5, 'exactly 5 grants exist');
});

await t.test('10. claims require an idempotency key and replay it', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const cp = mkCoupon(g, {});
  const naked = await g.call('/api/v1/coupons/claim', { method: 'POST', token: cust, body: { coupon_id: cp } });
  assert.equal(naked.status, 400, naked.text);
  assert.equal(naked.json.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const first = await g.call('/api/v1/coupons/claim', {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'claimkey-1' }, body: { coupon_id: cp }
  });
  assert.equal(first.status, 200, first.text);
  const replay = await g.call('/api/v1/coupons/claim', {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'claimkey-1' }, body: { coupon_id: cp }
  });
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.json.idempotent_replay, true, 'same key replays the same grant');
  const n = g.db.prepare('SELECT issued_count FROM coupons WHERE id = ?').get(cp).issued_count;
  assert.equal(n, 1, 'replay issues nothing new');
  const limited = mkCoupon(g, { per_user_limit: 1 });
  const c1 = await g.call('/api/v1/coupons/claim', {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'claimkey-a' }, body: { coupon_id: limited }
  });
  assert.equal(c1.status, 200, c1.text);
  const c2 = await g.call('/api/v1/coupons/claim', {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'claimkey-b' }, body: { coupon_id: limited }
  });
  assert.equal(c2.status, 409, c2.text);
  assert.equal(c2.json.code, 'COUPON_LIMIT_REACHED');
});

await t.test('11. legacy coupon allocations backfill to the platform share', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const fs = await import('node:fs');
  const path = (await import('node:path')).default;
  const { listMigrations, MIGRATIONS_DIR } = await import('./lib/harness.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  for (const f of listMigrations()) {
    if (f >= 'd1_55_coupon_engine.sql') break;
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'));
  }
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`INSERT INTO order_items (id, sub_order_id, sku_id, product_title, option_summary,
    unit_price, quantity, total_price, coupon_alloc, refunded_coupon_amount)
    VALUES ('legacy_itm', 'x', 'y', 't', 'o', 10000, 1, 10000, 800, 300)`);
  db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, 'd1_55_coupon_engine.sql'), 'utf-8'));
  const row = db.prepare('SELECT * FROM order_items WHERE id = ?').get('legacy_itm');
  assert.equal(row.platform_coupon_alloc, 800, 'platform share inherits the legacy alloc');
  assert.equal(row.store_coupon_alloc, 0, 'no store share on legacy rows');
  assert.equal(row.seller_burden_amount, 0, 'no burden on legacy rows');
  assert.equal(row.refunded_platform_coupon_amount, 300, 'platform refund history inherits too');
  db.close();
});

await t.test('12. schema version pin tracks the new migration', async () => {
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  const modPath = path.join(ROOT, 'apps/cloudflare-gateway/src/services/orders.js');
  const { REQUIRED_SCHEMA_VERSION } = await import(pathToFileURL(modPath).href);
  assert.equal(REQUIRED_SCHEMA_VERSION, 'd1_66_banner_placement.sql', 'pin names d1_66');
});

t.finish();
