// tests/restock_notify_test.mjs
// Work order 5-3 (master spec K-05): restock subscriptions must fire.
// A SKU going 0 -> positive on ANY path (seller stock edit, product edit,
// bulk stock edit, unpaid cancel/expiry restore, paid cancel/refund restore,
// return approval restock) creates one in-app notification per pending
// subscriber, attempts a push via notifyUser, and marks notified_at once.
// Halted/deleted products are skipped; notify failures never fail the write.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Restock notify (5-3/K-05)');

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

async function login(g, email, role) {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

async function checkoutUnpaid(g, cust, skuId, qty = 1) {
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: skuId, quantity: qty }] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o)}`);
  return o.order_id;
}

async function checkoutPaid(g, cust, skuId, qty = 1) {
  const r = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: skuId, quantity: qty }] }
  });
  assert.equal(r.status, 201, r.text);
  const o = r.json;
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust,
    body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount }
  });
  assert.equal(pay.status, 200, pay.text);
  return o.order_id;
}

function mkProduct(g, { productId, skuId, title, partnerId = 'pt_001', status = 'ACTIVE', stock = 0 }) {
  // 6-11: edits require an effective policy.
  const pol = g.db.prepare("SELECT id FROM shipping_policies WHERE partner_id = ? AND status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1").get(partnerId);
  g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status, shipping_policy_id)
    VALUES (?, ?, 'cat_e_audio', ?, 'https://x/y.png', '<p>t</p>', 20000, 15000, ?, 'APPROVED', ?)`)
    .run(productId, partnerId, title, status, pol.id);
  g.db.prepare(`INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, status)
    VALUES (?, ?, ?, '{}', 20000, 15000, ?, ?)`)
    .run(skuId, productId, `C-${productId}`, stock, stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');
  return { productId, skuId };
}

async function subscribe(g, token, skuId, expect = 201) {
  const r = await g.call('/api/v1/restock-subscriptions', { method: 'POST', token, body: { sku_id: skuId } });
  assert.equal(r.status, expect, `subscribe ${skuId}: ${r.text}`);
}

const notifCount = (g, userId) => g.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(userId).n;
const pushLogCount = (g, userId, template) => g.db.prepare(
  "SELECT COUNT(*) AS n FROM notification_delivery_logs WHERE recipient = ? AND template_code = ? AND channel = 'PUSH'"
).get(userId, template).n;
const pendingSubs = (g, skuId) => g.db.prepare(
  'SELECT COUNT(*) AS n FROM restock_subscriptions WHERE sku_id = ? AND notified_at IS NULL'
).get(skuId).n;
const stockOf = (g, skuId) => g.db.prepare('SELECT stock_quantity FROM product_skus WHERE id = ?').get(skuId).stock_quantity;

await t.test('1. stock 0->5 notifies two subscribers once each', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  const c2 = await login(g, 'alex.kim@olmoa.com', 'CUSTOMER');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_rs_01', skuId: 'sku_rs_01', title: '재입고 위젯' });
  await subscribe(g, c1, skuId);
  await subscribe(g, c2, skuId);
  const n1 = notifCount(g, 'u_customer_001');
  const n2 = notifCount(g, 'cust_demo_001');

  const r = await g.call(`/api/v1/partner/products/${productId}/stock`, {
    method: 'PUT', token: pt, body: { sku_id: skuId, stock_quantity: 5 }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(stockOf(g, skuId), 5);

  assert.equal(notifCount(g, 'u_customer_001'), n1 + 1, 'subscriber 1 gets exactly one');
  assert.equal(notifCount(g, 'cust_demo_001'), n2 + 1, 'subscriber 2 gets exactly one');
  const row = g.db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get('u_customer_001');
  assert.equal(row.type, 'SYSTEM');
  assert.equal(row.action_url, `/product/${productId}`);
  assert.ok(String(row.title).includes('재입고'), `title names restock: ${row.title}`);
  assert.equal(pendingSubs(g, skuId), 0, 'all subs marked notified_at');
  assert.equal(pushLogCount(g, 'u_customer_001', 'RESTOCK_AVAILABLE'), 1, 'push attempted for sub 1');
  assert.equal(pushLogCount(g, 'cust_demo_001', 'RESTOCK_AVAILABLE'), 1, 'push attempted for sub 2');
});

await t.test('2. further 5->7 sends nothing new', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  const c2 = await login(g, 'alex.kim@olmoa.com', 'CUSTOMER');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_rs_02', skuId: 'sku_rs_02', title: '재입고 위젯 2' });
  await subscribe(g, c1, skuId);
  await subscribe(g, c2, skuId);
  const first = await g.call(`/api/v1/partner/products/${productId}/stock`, {
    method: 'PUT', token: pt, body: { sku_id: skuId, stock_quantity: 5 }
  });
  assert.equal(first.status, 200, first.text);
  const n1 = notifCount(g, 'u_customer_001');
  const n2 = notifCount(g, 'cust_demo_001');

  const r = await g.call(`/api/v1/partner/products/${productId}/stock`, {
    method: 'PUT', token: pt, body: { sku_id: skuId, stock_quantity: 7 }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(notifCount(g, 'u_customer_001'), n1, 'no second notification');
  assert.equal(notifCount(g, 'cust_demo_001'), n2, 'no second notification');
});

await t.test('3. another seller cannot trigger notifications for a foreign SKU', async () => {
  const g = await newGateway();
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_rs_03', skuId: 'sku_rs_03', title: '남의 상품' });
  await subscribe(g, c1, skuId);
  const n1 = notifCount(g, 'u_customer_001');

  const r = await g.call(`/api/v1/partner/products/${productId}/stock`, {
    method: 'PUT', token: pt2, body: { sku_id: skuId, stock_quantity: 5 }
  });
  assert.ok([403, 404].includes(r.status), `cross-seller write refused, got ${r.status}: ${r.text}`);
  assert.equal(stockOf(g, skuId), 0, 'stock untouched');
  assert.equal(notifCount(g, 'u_customer_001'), n1, 'no notification fired');
  assert.equal(pendingSubs(g, skuId), 1, 'subscription still pending');
});

await t.test('4. halted and deleted products send nothing', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  const h = mkProduct(g, { productId: 'prod_rs_04h', skuId: 'sku_rs_04h', title: '판매중지', status: 'HIDDEN' });
  const d = mkProduct(g, { productId: 'prod_rs_04d', skuId: 'sku_rs_04d', title: '삭제됨', status: 'DELETED' });
  await subscribe(g, c1, h.skuId);
  await subscribe(g, c1, d.skuId);
  const n1 = notifCount(g, 'u_customer_001');

  for (const p of [h, d]) {
    const r = await g.call(`/api/v1/partner/products/${p.productId}/stock`, {
      method: 'PUT', token: pt, body: { sku_id: p.skuId, stock_quantity: 5 }
    });
    assert.equal(r.status, 200, r.text);
  }
  assert.equal(notifCount(g, 'u_customer_001'), n1, 'halted/deleted products stay silent');
  assert.equal(pendingSubs(g, h.skuId), 1, 'halted sub stays pending');
  assert.equal(pendingSubs(g, d.skuId), 1, 'deleted sub stays pending');
});

await t.test('5. product edit (skus array) 0->positive notifies', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_rs_05', skuId: 'sku_rs_05', title: '상품수정 위젯' });
  await subscribe(g, c1, skuId);
  const n1 = notifCount(g, 'u_customer_001');

  const r = await g.call(`/api/v1/partner/products/${productId}`, {
    method: 'PUT', token: pt, body: { skus: [{ id: skuId, stock_quantity: 3 }] }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(stockOf(g, skuId), 3);
  assert.equal(notifCount(g, 'u_customer_001'), n1 + 1, 'product-edit restock notifies');
  assert.equal(pendingSubs(g, skuId), 0);
});

await t.test('6. bulk-update stock 0->positive notifies', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_rs_06', skuId: 'sku_rs_06', title: '일괄 위젯' });
  await subscribe(g, c1, skuId);
  const n1 = notifCount(g, 'u_customer_001');

  const r = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt, body: { updates: [{ product_id: productId, stock_quantity: 4 }] }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.failed_count, 0, r.text);
  assert.equal(stockOf(g, skuId), 4);
  assert.equal(notifCount(g, 'u_customer_001'), n1 + 1, 'bulk-update restock notifies');
  assert.equal(pendingSubs(g, skuId), 0);
});

await t.test('7. unpaid order cancel restores stock and notifies', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  const c2 = await login(g, 'alex.kim@olmoa.com', 'CUSTOMER');
  g.db.prepare('UPDATE product_skus SET stock_quantity = 1 WHERE id = ?').run('sku_001_w');
  const orderId = await checkoutUnpaid(g, c1, 'sku_001_w', 1);
  assert.equal(stockOf(g, 'sku_001_w'), 0, 'checkout drains the last unit');
  await subscribe(g, c1, 'sku_001_w');
  await subscribe(g, c2, 'sku_001_w');
  const n1 = notifCount(g, 'u_customer_001');
  const n2 = notifCount(g, 'cust_demo_001');

  const r = await g.call(`/api/v1/orders/${orderId}/cancel`, { method: 'POST', token: c1 });
  assert.equal(r.status, 200, r.text);
  assert.equal(stockOf(g, 'sku_001_w'), 1, 'cancel restores the unit');
  assert.equal(notifCount(g, 'u_customer_001'), n1 + 1, 'cancel-restock notifies sub 1');
  assert.equal(notifCount(g, 'cust_demo_001'), n2 + 1, 'cancel-restock notifies sub 2');
});

await t.test('8. payment expiry restores stock and notifies', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  g.db.prepare('UPDATE product_skus SET stock_quantity = 1 WHERE id = ?').run('sku_001_w');
  const orderId = await checkoutUnpaid(g, c1, 'sku_001_w', 1);
  await subscribe(g, c1, 'sku_001_w');
  const n1 = notifCount(g, 'u_customer_001');
  g.db.prepare("UPDATE orders SET payment_expires_at = datetime('now', '-1 hour') WHERE id = ?").run(orderId);

  const r = await g.call('/api/v1/orders/cron/expire', { method: 'POST', token: adm });
  assert.equal(r.status, 200, r.text);
  assert.equal(stockOf(g, 'sku_001_w'), 1, 'expiry restores the unit');
  assert.equal(notifCount(g, 'u_customer_001'), n1 + 1, 'expiry-restock notifies');
});

await t.test('9. paid order cancel (refund path) notifies', async () => {
  const g = await newGateway();
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  g.db.prepare('UPDATE product_skus SET stock_quantity = 1 WHERE id = ?').run('sku_001_w');
  const orderId = await checkoutPaid(g, c1, 'sku_001_w', 1);
  assert.equal(stockOf(g, 'sku_001_w'), 0, 'paid checkout drains the last unit');
  await subscribe(g, c1, 'sku_001_w');
  const n1 = notifCount(g, 'u_customer_001');

  const r = await g.call(`/api/v1/orders/${orderId}/cancel`, { method: 'POST', token: c1 });
  assert.equal(r.status, 200, r.text);
  assert.equal(stockOf(g, 'sku_001_w'), 1, 'paid cancel restores the unit');
  assert.equal(notifCount(g, 'u_customer_001'), n1 + 1, 'refund-restock notifies');
});

await t.test('10. return approval with restock notifies', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  g.db.prepare('UPDATE product_skus SET stock_quantity = 1 WHERE id = ?').run('sku_001_w');
  const orderId = await checkoutPaid(g, c1, 'sku_001_w', 1);
  const subId = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(orderId).id;
  g.db.prepare("UPDATE sub_orders SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP WHERE id = ?").run(subId);
  await subscribe(g, c1, 'sku_001_w');
  const n1 = notifCount(g, 'u_customer_001');

  const claim = await g.call(`/api/v1/orders/${orderId}/claims`, {
    method: 'POST', token: c1,
    body: { type: 'RETURN', sub_order_id: subId, reason: '불량', reason_code: 'DEFECTIVE' }
  });
  assert.equal(claim.status, 201, claim.text);
  const approve = await g.call(`/api/v1/partner/returns/${claim.json.claim_id}`, {
    method: 'PUT', token: pt, body: { decision: 'APPROVE' }
  });
  assert.equal(approve.status, 200, approve.text);
  assert.equal(stockOf(g, 'sku_001_w'), 1, 'return restocks the unit');
  assert.equal(notifCount(g, 'u_customer_001'), n1 + 1, 'return-restock notifies');
});

await t.test('11. notify failure does not fail the stock edit', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  const { productId, skuId } = mkProduct(g, { productId: 'prod_rs_11', skuId: 'sku_rs_11', title: '고장 위젯' });
  await subscribe(g, c1, skuId);
  g.db.exec('DROP TABLE notifications');

  const r = await g.call(`/api/v1/partner/products/${productId}/stock`, {
    method: 'PUT', token: pt, body: { sku_id: skuId, stock_quantity: 5 }
  });
  assert.equal(r.status, 200, `stock edit survives notify failure: ${r.text}`);
  assert.equal(stockOf(g, skuId), 5, 'stock still applied');
});

await t.test('12. exchange reship with return_received notifies', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const c1 = await login(g, 'customer@example.com', 'CUSTOMER');
  mkProduct(g, { productId: 'prod_rs_13', skuId: 'sku_rs_13a', title: '교환 위젯', stock: 0 });
  g.db.prepare(`INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, status)
    VALUES ('sku_rs_13b', 'prod_rs_13', 'C-prod_rs_13-b', '{"옵션":"B"}', 20000, 15000, 5, 'IN_STOCK')`).run();
  await subscribe(g, c1, 'sku_rs_13a');
  const n1 = notifCount(g, 'u_customer_001');
  const orderId = await checkoutPaid(g, c1, 'sku_001_w', 1);
  const subId = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(orderId).id;
  g.db.prepare("UPDATE sub_orders SET status = 'RETURN_REQUESTED' WHERE id = ?").run(subId);
  g.db.prepare(`INSERT INTO returns (id, order_id, sub_order_id, user_id, claim_type, reason, status, exchange_status, exchange_items_json)
    VALUES ('clm_rs_13', ?, ?, 'u_customer_001', 'EXCHANGE', '교환', 'APPROVED', 'AWAITING_RESHIPMENT', ?)`)
    .run(orderId, subId, JSON.stringify([{ order_item_id: 'oi_dummy', quantity: 2, from_sku_id: 'sku_rs_13a', to_sku_id: 'sku_rs_13b' }]));

  const r = await g.call('/api/v1/partner/returns/clm_rs_13/reship', {
    method: 'POST', token: pt,
    body: { carrier: 'CJ대한통운', tracking_number: 'TRACK-123456', return_received: true }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(stockOf(g, 'sku_rs_13a'), 2, 'received return restocks the from-sku');
  assert.equal(notifCount(g, 'u_customer_001'), n1 + 1, 'reship-restock notifies');
  assert.equal(pendingSubs(g, 'sku_rs_13a'), 0);
});

await t.test('13. notified_at already exists, so d1_68 is not required', async () => {
  const g = await newGateway();
  const cols = g.db.prepare('PRAGMA table_info(restock_subscriptions)').all().map((c) => c.name);
  for (const c of ['id', 'user_id', 'sku_id', 'notified_at', 'created_at']) {
    assert.ok(cols.includes(c), `restock_subscriptions has ${c} (from d1_57)`);
  }
});

t.finish();
