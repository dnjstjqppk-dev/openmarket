// tests/remind_notify_test.mjs
// Work order 5-9 (master spec K-06, K-09): wishlist price-drop bundles and
// purchase-confirm / review reminders, fired from the Worker scheduled() cron.
// K-06: a sku_price_history sale-price drop on a wishlisted ACTIVE product
//   bundles into one in-app notification per member per KST day (type
//   DISCOUNT, action /wishlist). Drops flagged by the K-13 fake-discount
//   rule (original_price hike within 7 days before the drop, same predicate
//   as the admin review queue) are never sent.
// K-09: DELIVERED sub-orders past remind.confirm_after_days get one
//   ORDER_STATUS reminder before auto-confirm; PURCHASE_CONFIRMED sub-orders
//   past remind.review_after_days with no review for the order get one
//   reminder. Without the policy key nothing is sent; each reminder fires
//   at most once per sub-order (flag columns from d1_70).
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import {
  notifTodayKst, runPriceDropNotifs, runPurchaseReminds
} from '../apps/cloudflare-gateway/src/services/reminders.js';
import { isDropFakeFlagged } from '../apps/cloudflare-gateway/src/lib/fake-discount.js';

const t = createRunner('Remind notifs (5-9/K-06/K-09)');

const DAY_MS = 86400000;
const kstDay = (baseMs, offsetDays = 0) =>
  new Date(baseMs + 9 * 3600 * 1000 + offsetDays * DAY_MS).toISOString().slice(0, 10);
const sqlTs = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').slice(0, 19);

async function newGateway(notifDay = kstDay(Date.now())) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      NOTIF_TEST_TODAY_KST: notifDay
    }
  });
}

const PW = 'DevPass!2026#';
const U1 = 'u_customer_001'; // customer@example.com
const U2 = 'cust_demo_001'; // alex.kim@olmoa.com
const addr = (postal) => ({
  recipient_name: '홍길동', recipient_phone: '010-1234-5678',
  shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: postal
});

async function login(g, email, role) {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

function mkProduct(g, { productId, skuId, title, partnerId = 'pt_001', status = 'ACTIVE', orig = 20000, sale = 15000, stock = 10 }) {
  // 6-11: reminders only fire for sellable products.
  const pol = g.db.prepare("SELECT id FROM shipping_policies WHERE partner_id = ? AND status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1").get(partnerId);
  g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status, shipping_policy_id)
    VALUES (?, ?, 'cat_e_audio', ?, 'https://x/y.png', '<p>t</p>', ?, ?, ?, 'APPROVED', ?)`)
    .run(productId, partnerId, title, orig, sale, status, pol.id);
  g.db.prepare(`INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, status)
    VALUES (?, ?, ?, '{}', ?, ?, ?, ?)`)
    .run(skuId, productId, `C-${productId}`, orig, sale, stock, stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');
  return { productId, skuId };
}

function wish(g, id, userId, productId) {
  g.db.prepare('INSERT INTO wishlists (id, user_id, product_id) VALUES (?, ?, ?)').run(id, userId, productId);
}

function hist(g, id, skuId, orig, sale, changedAt) {
  g.db.prepare('INSERT INTO sku_price_history (id, sku_id, original_price, sale_price, changed_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, skuId, orig, sale, changedAt);
}

function putPolicy(g, key, value) {
  g.db.prepare('INSERT INTO platform_policies (key, value, effective_from) VALUES (?, ?, ?)')
    .run(key, String(value), kstDay(Date.now()));
}

async function dropViaApi(g, ptToken, productId, value) {
  const r = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: ptToken, body: { updates: [{ product_id: productId, price: { mode: 'set', value } }] }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.failed_count, 0, r.text);
}

async function checkoutPaid(g, cust, skuId, qty = 1) {
  const r = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: skuId, quantity: qty }] }
  });
  assert.equal(r.status, 201, r.text);
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust,
    body: { order_id: r.json.order_id, payment_key: `sandbox_${r.json.order_id.slice(-8)}xx`, amount: r.json.total_pay_amount }
  });
  assert.equal(pay.status, 200, pay.text);
  return r.json.order_id;
}

const notifCount = (g, userId, type = null) => g.db.prepare(
  `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?${type ? ' AND type = ?' : ''}`
).get(userId, ...(type ? [type] : [])).n;
const latestNotif = (g, userId) => g.db.prepare(
  'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
).get(userId);
const dropLogCount = (g, userId = null) => g.db.prepare(
  `SELECT COUNT(*) AS n FROM price_drop_notifs${userId ? ' WHERE user_id = ?' : ''}`
).get(...(userId ? [userId] : [])).n;

// ---------- K-06 ----------

await t.test('1. no drops sends nothing', async () => {
  const g = await newGateway();
  const { productId, skuId } = mkProduct(g, { productId: 'prod_pd_01', skuId: 'sku_pd_01', title: '인하 없음 위젯' });
  wish(g, 'wsh_pd_01', U1, productId);
  hist(g, 'sph_pd_01a', skuId, 20000, 15000, sqlTs(-3 * DAY_MS)); // single row: no baseline, no drop
  const n = notifCount(g, U1);
  const r = await runPriceDropNotifs(g.env);
  assert.deepEqual(r, { users: 0, bundled: 0 });
  assert.equal(notifCount(g, U1), n);
  assert.equal(dropLogCount(g), 0);
});

await t.test('2. sale drop bundles once per wisher', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_pd_02', skuId: 'sku_pd_02', title: '인하 위젯' });
  wish(g, 'wsh_pd_02a', U1, productId);
  wish(g, 'wsh_pd_02b', U2, productId);
  hist(g, 'sph_pd_02a', skuId, 20000, 15000, sqlTs(-3 * DAY_MS));
  await dropViaApi(g, pt, productId, 12000);
  const n1 = notifCount(g, U1);
  const n2 = notifCount(g, U2);
  const r = await runPriceDropNotifs(g.env);
  assert.deepEqual(r, { users: 2, bundled: 2 });
  assert.equal(notifCount(g, U1), n1 + 1, 'wisher 1 gets exactly one bundle');
  assert.equal(notifCount(g, U2), n2 + 1, 'wisher 2 gets exactly one bundle');
  const row = latestNotif(g, U1);
  assert.equal(row.type, 'DISCOUNT');
  assert.equal(row.action_url, '/wishlist');
  assert.ok(String(row.message).includes('인하 위젯'), `bundle names the product: ${row.message}`);
  assert.equal(dropLogCount(g, U1), 1, 'drop logged for wisher 1');
  assert.equal(dropLogCount(g, U2), 1, 'drop logged for wisher 2');
  assert.equal(g.db.prepare('SELECT notified_day AS d FROM price_drop_notifs WHERE user_id = ?').get(U1).d, kstDay(Date.now()));
});

await t.test('3. same-day rerun sends nothing new', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_pd_03', skuId: 'sku_pd_03', title: '중복 위젯' });
  wish(g, 'wsh_pd_03', U1, productId);
  hist(g, 'sph_pd_03a', skuId, 20000, 15000, sqlTs(-3 * DAY_MS));
  await dropViaApi(g, pt, productId, 12000);
  const first = await runPriceDropNotifs(g.env);
  assert.equal(first.bundled, 1);
  const n = notifCount(g, U1, 'DISCOUNT');
  const second = await runPriceDropNotifs(g.env);
  assert.deepEqual(second, { users: 0, bundled: 0 });
  assert.equal(notifCount(g, U1, 'DISCOUNT'), n, 'no second bundle the same day');
});

await t.test('4. later drops wait for the next day bundle', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const a = mkProduct(g, { productId: 'prod_pd_04a', skuId: 'sku_pd_04a', title: '첫째 위젯' });
  wish(g, 'wsh_pd_04a', U1, a.productId);
  hist(g, 'sph_pd_04a', a.skuId, 20000, 15000, sqlTs(-3 * DAY_MS));
  await dropViaApi(g, pt, a.productId, 12000);
  assert.equal((await runPriceDropNotifs(g.env)).bundled, 1);
  const b = mkProduct(g, { productId: 'prod_pd_04b', skuId: 'sku_pd_04b', title: '둘째 위젯' });
  const c = mkProduct(g, { productId: 'prod_pd_04c', skuId: 'sku_pd_04c', title: '셋째 위젯' });
  wish(g, 'wsh_pd_04b', U1, b.productId);
  wish(g, 'wsh_pd_04c', U1, c.productId);
  hist(g, 'sph_pd_04b', b.skuId, 20000, 15000, sqlTs(-3 * DAY_MS));
  hist(g, 'sph_pd_04c', c.skuId, 20000, 15000, sqlTs(-3 * DAY_MS));
  await dropViaApi(g, pt, b.productId, 12000);
  await dropViaApi(g, pt, c.productId, 11000);
  const n = notifCount(g, U1, 'DISCOUNT');
  assert.deepEqual(await runPriceDropNotifs(g.env), { users: 0, bundled: 0 }, 'daily-once: nothing more today');
  assert.equal(notifCount(g, U1, 'DISCOUNT'), n);
  g.env.NOTIF_TEST_TODAY_KST = kstDay(Date.now(), 1); // tomorrow
  const next = await runPriceDropNotifs(g.env);
  assert.deepEqual(next, { users: 1, bundled: 1 }, 'rolled-over drops bundle once tomorrow');
  assert.equal(notifCount(g, U1, 'DISCOUNT'), n + 1);
  const row = latestNotif(g, U1);
  assert.ok(String(row.message).includes('외 1개'), `two products bundle: ${row.message}`);
});

await t.test('5. K-13 fake-discount-flagged drops send nothing', async () => {
  const g = await newGateway();
  const { productId, skuId } = mkProduct(g, { productId: 'prod_pd_05', skuId: 'sku_pd_05', title: '부풀리기 위젯' });
  wish(g, 'wsh_pd_05', U1, productId);
  // Same shape as the admin review-queue hike fixture (A17): original raised
  // 10k->15k five days ago, sale cut 9k->7k yesterday (within 7 days).
  hist(g, 'sph_pd_05a', skuId, 10000, 9000, sqlTs(-10 * DAY_MS));
  hist(g, 'sph_pd_05b', skuId, 15000, 9000, sqlTs(-5 * DAY_MS));
  hist(g, 'sph_pd_05c', skuId, 15000, 7000, sqlTs(-1 * DAY_MS));
  const rows = g.db.prepare('SELECT original_price, sale_price, changed_at FROM sku_price_history WHERE sku_id = ? ORDER BY changed_at ASC, rowid ASC').all(skuId);
  assert.equal(isDropFakeFlagged(rows, 2), true, 'fixture is fake-flagged by the shared predicate');
  const n = notifCount(g, U1);
  assert.deepEqual(await runPriceDropNotifs(g.env), { users: 0, bundled: 0 });
  assert.equal(notifCount(g, U1), n, 'fake-flagged drop stays silent');
  assert.equal(dropLogCount(g), 0);
});

await t.test('6. drops on non-wishlisted products send nothing', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_pd_06', skuId: 'sku_pd_06', title: '남의 위젯' });
  hist(g, 'sph_pd_06a', skuId, 20000, 15000, sqlTs(-3 * DAY_MS));
  await dropViaApi(g, pt, productId, 12000);
  const n = notifCount(g, U1);
  assert.deepEqual(await runPriceDropNotifs(g.env), { users: 0, bundled: 0 });
  assert.equal(notifCount(g, U1), n);
});

await t.test('7. hidden products stay silent', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_pd_07', skuId: 'sku_pd_07', title: '숨김 위젯', status: 'HIDDEN' });
  wish(g, 'wsh_pd_07', U1, productId);
  hist(g, 'sph_pd_07a', skuId, 20000, 15000, sqlTs(-3 * DAY_MS));
  await dropViaApi(g, pt, productId, 12000);
  const n = notifCount(g, U1);
  assert.deepEqual(await runPriceDropNotifs(g.env), { users: 0, bundled: 0 });
  assert.equal(notifCount(g, U1), n);
});

// ---------- K-09 confirm ----------

async function deliveredOrder(g, custToken, tag, daysAgo) {
  const { productId, skuId } = mkProduct(g, { productId: `prod_rc_${tag}`, skuId: `sku_rc_${tag}`, title: `확정 위젯 ${tag}`, partnerId: 'pt_002' });
  const orderId = await checkoutPaid(g, custToken, skuId, 1);
  const sub = g.db.prepare('SELECT id, sub_order_no FROM sub_orders WHERE parent_order_id = ?').get(orderId);
  g.db.prepare("UPDATE sub_orders SET status = 'DELIVERED', delivered_at = ? WHERE id = ?").run(sqlTs(-daysAgo * DAY_MS), sub.id);
  return { orderId, subId: sub.id, subNo: sub.sub_order_no, productId };
}

await t.test('8. confirm reminder without policy sends nothing', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  await deliveredOrder(g, c1, '08', 5);
  const n = notifCount(g, U1);
  const r = await runPurchaseReminds(g.env);
  assert.equal(r.confirm, 0);
  assert.equal(notifCount(g, U1), n);
});

await t.test('9. confirm reminder fires once past the policy days', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  putPolicy(g, 'remind.confirm_after_days', 3);
  const o = await deliveredOrder(g, c1, '09', 5);
  const n = notifCount(g, U1, 'ORDER_STATUS');
  const r = await runPurchaseReminds(g.env);
  assert.equal(r.confirm, 1);
  assert.equal(notifCount(g, U1, 'ORDER_STATUS'), n + 1);
  const row = latestNotif(g, U1);
  assert.equal(row.type, 'ORDER_STATUS');
  assert.equal(row.action_url, `/orders/${o.orderId}`);
  assert.ok(String(row.message).includes(o.subNo), `names the sub-order: ${row.message}`);
  const flag = g.db.prepare('SELECT confirm_reminded_at AS f FROM sub_orders WHERE id = ?').get(o.subId).f;
  assert.ok(flag, 'confirm_reminded_at stamped');
});

await t.test('10. confirm reminder never repeats', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  putPolicy(g, 'remind.confirm_after_days', 3);
  await deliveredOrder(g, c1, '10', 5);
  assert.equal((await runPurchaseReminds(g.env)).confirm, 1);
  const n = notifCount(g, U1, 'ORDER_STATUS');
  assert.equal((await runPurchaseReminds(g.env)).confirm, 0);
  assert.equal(notifCount(g, U1, 'ORDER_STATUS'), n);
});

await t.test('11. recently delivered orders are not reminded', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  putPolicy(g, 'remind.confirm_after_days', 3);
  const o = await deliveredOrder(g, c1, '11', 1);
  const n = notifCount(g, U1);
  assert.equal((await runPurchaseReminds(g.env)).confirm, 0);
  assert.equal(notifCount(g, U1), n);
  assert.equal(g.db.prepare('SELECT confirm_reminded_at AS f FROM sub_orders WHERE id = ?').get(o.subId).f, null);
});

await t.test('12. already confirmed orders get no confirm reminder', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  putPolicy(g, 'remind.confirm_after_days', 3);
  const o = await deliveredOrder(g, c1, '12', 10);
  g.db.prepare("UPDATE sub_orders SET status = 'PURCHASE_CONFIRMED', purchase_confirmed_at = CURRENT_TIMESTAMP WHERE id = ?").run(o.subId);
  const n = notifCount(g, U1);
  assert.equal((await runPurchaseReminds(g.env)).confirm, 0);
  assert.equal(notifCount(g, U1), n);
});

// ---------- K-09 review ----------

async function confirmedOrder(g, custToken, tag, daysAgo) {
  const { productId, skuId } = mkProduct(g, { productId: `prod_rv_${tag}`, skuId: `sku_rv_${tag}`, title: `리뷰 위젯 ${tag}`, partnerId: 'pt_002' });
  const orderId = await checkoutPaid(g, custToken, skuId, 1);
  const sub = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(orderId);
  g.db.prepare("UPDATE sub_orders SET status = 'PURCHASE_CONFIRMED', delivered_at = ?, purchase_confirmed_at = ? WHERE id = ?")
    .run(sqlTs(-(daysAgo + 2) * DAY_MS), sqlTs(-daysAgo * DAY_MS), sub.id);
  return { orderId, subId: sub.id, productId };
}

await t.test('13. review reminder without policy sends nothing', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  await confirmedOrder(g, c1, '13', 5);
  const n = notifCount(g, U1);
  const r = await runPurchaseReminds(g.env);
  assert.equal(r.review, 0);
  assert.equal(notifCount(g, U1), n);
});

await t.test('14. review reminder fires once for confirmed-without-review', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  putPolicy(g, 'remind.review_after_days', 2);
  const o = await confirmedOrder(g, c1, '14', 3);
  const n = notifCount(g, U1);
  const r = await runPurchaseReminds(g.env);
  assert.equal(r.review, 1);
  assert.equal(notifCount(g, U1), n + 1);
  const row = latestNotif(g, U1);
  assert.equal(row.type, 'SYSTEM');
  assert.equal(row.action_url, `/orders/${o.orderId}`);
  assert.ok(g.db.prepare('SELECT review_reminded_at AS f FROM sub_orders WHERE id = ?').get(o.subId).f, 'review_reminded_at stamped');
});

await t.test('15. review reminder never repeats', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  putPolicy(g, 'remind.review_after_days', 2);
  await confirmedOrder(g, c1, '15', 3);
  assert.equal((await runPurchaseReminds(g.env)).review, 1);
  const n = notifCount(g, U1);
  assert.equal((await runPurchaseReminds(g.env)).review, 0);
  assert.equal(notifCount(g, U1), n);
});

await t.test('16. reviewed orders get no review reminder', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  putPolicy(g, 'remind.review_after_days', 2);
  const o = await confirmedOrder(g, c1, '16', 3);
  const rev = await g.call(`/api/v1/products/${o.productId}/reviews`, {
    method: 'POST', token: c1, body: { rating: 5, content: '만족합니다. 잘 쓰겠습니다.' }
  });
  assert.equal(rev.status, 201, rev.text);
  const n = notifCount(g, U1);
  assert.equal((await runPurchaseReminds(g.env)).review, 0);
  assert.equal(notifCount(g, U1), n, 'reviewed order stays silent');
});

await t.test('17. recently confirmed orders are not reminded', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  putPolicy(g, 'remind.review_after_days', 2);
  const o = await confirmedOrder(g, c1, '17', 1);
  const n = notifCount(g, U1);
  assert.equal((await runPurchaseReminds(g.env)).review, 0);
  assert.equal(notifCount(g, U1), n);
  assert.equal(g.db.prepare('SELECT review_reminded_at AS f FROM sub_orders WHERE id = ?').get(o.subId).f, null);
});

// ---------- wiring ----------

await t.test('18. scheduled() fires both jobs end to end', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  assert.match(notifTodayKst(g.env), /^\d{4}-\d{2}-\d{2}$/, 'pinned KST day');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_pd_18', skuId: 'sku_pd_18', title: '크론 위젯' });
  wish(g, 'wsh_pd_18', U1, productId);
  hist(g, 'sph_pd_18a', skuId, 20000, 15000, sqlTs(-3 * DAY_MS));
  await dropViaApi(g, pt, productId, 12000);
  putPolicy(g, 'remind.confirm_after_days', 3);
  await deliveredOrder(g, c1, '18', 5);
  const d0 = notifCount(g, U1, 'DISCOUNT');
  const o0 = notifCount(g, U1, 'ORDER_STATUS');
  await g.worker.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' }, g.env, g.ctx);
  await Promise.all(g.scheduled);
  assert.equal(notifCount(g, U1, 'DISCOUNT'), d0 + 1, 'cron bundles the price drop');
  assert.equal(notifCount(g, U1, 'ORDER_STATUS'), o0 + 1, 'cron sends the confirm reminder');
});

t.finish();
