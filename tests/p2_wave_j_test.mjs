// tests/p2_wave_j_test.mjs
// Wave J: remote/island shipping surcharge (J-1), push deep-link + partner
// FCM (J-2, app-side), and carried-P2 fixes (J-3).
// Each behavior ships its failing test first; the suite joins `test:p1`.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('P2 Wave J (remote shipping, carried P2)');

async function newGateway(env = {}) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef',
      ...env
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

function pickTwoSellerSkus(g) {
  const rows = g.db.prepare(
    `SELECT s.id, p.partner_id FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.status = 'ACTIVE' AND s.stock_quantity > 0 LIMIT 60`
  ).all();
  const a = rows[0];
  const b = rows.find((r) => r.partner_id !== a.partner_id);
  assert.ok(a && b, 'seed spans two sellers');
  return [a.id, b.id];
}

function pickBulkSku(g) {
  const rows = g.db.prepare(
    `SELECT s.id, s.sale_price, s.stock_quantity, pt.free_shipping_threshold AS th
     FROM product_skus s JOIN products p ON p.id = s.product_id JOIN partners pt ON pt.id = p.partner_id
     WHERE p.status = 'ACTIVE' AND s.stock_quantity > 0`
  ).all();
  for (const r of rows) {
    const qty = Math.floor((Number(r.th ?? 30000) + 5000) / r.sale_price) + 1;
    if (qty >= 1 && qty <= r.stock_quantity) return { sku: r.id, qty };
  }
  assert.fail('no seed sku can clear a free-shipping threshold');
}

// ---------- J-1: remote/island surcharge (NEW-20) ----------

await t.test('J-1.1 Jeju postal adds the surcharge to every seller sub-order', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const [sa, sb] = pickTwoSellerSkus(g);
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('63001'), items: [{ sku_id: sa, quantity: 1 }, { sku_id: sb, quantity: 1 }] }
  });
  assert.equal(q.status, 200, q.text);
  const subs = q.json.data.sub_orders;
  assert.equal(subs.length, 2);
  for (const s of subs) {
    assert.equal(s.remote_surcharge, 3000, 'Jeju surcharge per sub-order');
    assert.equal(s.remote_zone, '제주');
    assert.ok(s.shipping_fee >= 3000, 'total shipping covers the surcharge');
  }
  assert.equal(q.json.data.remote_zone, '제주');
});

await t.test('J-1.2 free shipping waives the base fee but never the surcharge', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const { sku, qty } = pickBulkSku(g);
  const base = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items: [{ sku_id: sku, quantity: qty }] }
  });
  assert.equal(base.status, 200, base.text);
  assert.equal(base.json.data.sub_orders[0].shipping_fee, 0, 'threshold met: base waived');
  const jeju = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('63365'), items: [{ sku_id: sku, quantity: qty }] }
  });
  assert.equal(jeju.status, 200, jeju.text);
  assert.equal(jeju.json.data.sub_orders[0].shipping_fee, 3000, 'only the surcharge remains');
  assert.equal(jeju.json.data.sub_orders[0].remote_surcharge, 3000);
});

await t.test('J-1.3 mainland postals pay no surcharge', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const [sa] = pickTwoSellerSkus(g);
  for (const postal of ['06236', '48058', '16856']) {
    const q = await g.call('/api/v1/orders/quote', {
      method: 'POST', token: cust,
      body: { ...addr(postal), items: [{ sku_id: sa, quantity: 1 }] }
    });
    assert.equal(q.status, 200, q.text);
    assert.equal(q.json.data.sub_orders[0].remote_surcharge || 0, 0, `${postal} is not remote`);
  }
  const ulleung = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('40200'), items: [{ sku_id: sa, quantity: 1 }] }
  });
  assert.equal(ulleung.json.data.sub_orders[0].remote_surcharge, 5000, 'Ulleungdo seeded');
  assert.equal(ulleung.json.data.sub_orders[0].remote_zone, '울릉도');
  assert.equal((await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items: [{ sku_id: sa, quantity: 1 }] }
  })).json.data.remote_zone, null);
});

await t.test('J-1.4 persisted shipping includes the surcharge and refunds it back', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const [sa] = pickTwoSellerSkus(g);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('63001'), items: [{ sku_id: sa, quantity: 1 }] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const sub = g.db.prepare('SELECT * FROM sub_orders WHERE parent_order_id = ?').get(o.order_id);
  assert.ok(sub.shipping_fee >= 3000, 'stored shipping covers the surcharge');
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const item = g.db.prepare('SELECT id, quantity FROM order_items WHERE sub_order_id = ?').get(sub.id);
  const rf = await g.call(`/api/v1/admin/orders/${o.order_id}/refund`, {
    method: 'POST', token: adm,
    body: { reason: 'J-1 round trip', lines: [{ order_item_id: item.id, quantity: item.quantity }], shipping_sub_order_ids: [sub.id] }
  });
  assert.equal(rf.status, 200, rf.text);
  assert.equal(rf.json.data.refund.shipping_amount, sub.shipping_fee, 'shipping refund returns the surcharge too');
});

await t.test('J-1.5 zones list publicly; admin owns the rows', async () => {
  const g = await newGateway();
  const list = await g.call('/api/v1/shipping/remote-zones');
  assert.equal(list.status, 200, list.text);
  assert.ok(list.json.data.some((z) => z.postal_prefix === '63' && z.surcharge_amount === 3000), 'Jeju seeded');
  const cust = await login(g, 'customer@example.com');
  const denied = await g.call('/api/v1/admin/shipping/remote-zones', { method: 'PUT', token: cust, body: { postal_prefix: '23', zone_name: 'X', surcharge_amount: 1 } });
  assert.equal(denied.status, 403);
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const badPrefix = await g.call('/api/v1/admin/shipping/remote-zones', { method: 'PUT', token: adm, body: { postal_prefix: '6', zone_name: 'X', surcharge_amount: 1 } });
  assert.equal(badPrefix.status, 400, 'prefixes are 2-5 digits');
  const badAmount = await g.call('/api/v1/admin/shipping/remote-zones', { method: 'PUT', token: adm, body: { postal_prefix: '23', zone_name: 'X', surcharge_amount: -5 } });
  assert.equal(badAmount.status, 400);
  const up = await g.call('/api/v1/admin/shipping/remote-zones', { method: 'PUT', token: adm, body: { postal_prefix: '231', zone_name: '백령도', surcharge_amount: 6000 } });
  assert.equal(up.status, 200, up.text);
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('23100'), items: [{ sku_id: pickTwoSellerSkus(g)[0], quantity: 1 }] }
  });
  assert.equal(q.json.data.sub_orders[0].remote_surcharge, 6000, 'new zone live immediately');
  const del = await g.call('/api/v1/admin/shipping/remote-zones/231', { method: 'DELETE', token: adm });
  assert.equal(del.status, 200);
  const gone = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('23100'), items: [{ sku_id: pickTwoSellerSkus(g)[0], quantity: 1 }] }
  });
  assert.equal(gone.json.data.sub_orders[0].remote_surcharge || 0, 0, 'deleted zone stops matching');
});

// ---------- J-2: seller push + tap deep-link (server half) ----------

async function j2paidOrder(g, cust, skuId) {
  const o = (await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: skuId, quantity: 1 }] } })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  return o;
}

await t.test('J-2.1 paid orders notify the selling partner owner', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const seller = g.db.prepare('SELECT id FROM users WHERE email = ?').get('seller@temu-supply.com');
  const token = `fcm-test-token-${'j'.repeat(40)}`;
  const reg = await g.call('/api/v1/push/tokens', { method: 'POST', token: pt, body: { token, platform: 'ANDROID', app: 'PARTNER' } });
  assert.equal(reg.status, 201, reg.text);
  const sku = g.db.prepare(
    `SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id JOIN partners pt ON pt.id = p.partner_id
     WHERE p.status = 'ACTIVE' AND s.stock_quantity > 0 AND pt.owner_user_id = ? LIMIT 1`
  ).get(seller.id);
  assert.ok(sku, 'seller owns a sellable sku');
  await j2paidOrder(g, cust, sku.id);
  const rows = g.db.prepare("SELECT * FROM notification_delivery_logs WHERE channel = 'PUSH' AND template_code = 'SELLER_NEW_ORDER'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient, seller.id, 'push addressed to the partner owner');
  assert.equal(rows[0].app, 'PARTNER');
  assert.equal(rows[0].status, 'PUSH_NOT_CONFIGURED');
});

// ---------- J-3: carried P2 fixes ----------

await t.test('J-3.1 default SKU is the cheapest in-stock variant, never OOS', async () => {
  const g = await newGateway();
  const pt = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get();
  const cat = g.db.prepare('SELECT id FROM categories LIMIT 1').get();
  const h3pol = g.db.prepare("SELECT id FROM shipping_policies WHERE partner_id = ? AND status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1").get(pt.id);
  g.db.prepare(
    `INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html,
      lowest_original_price, lowest_sale_price, total_sold_count, status, shipping_policy_id)
     VALUES ('h3sku', ?, ?, '재고확인 상품', 'https://img.test/x.jpg', '<p>x</p>', 20000, 5000, 0, 'ACTIVE', ?)`
  ).run(pt.id, cat.id, h3pol.id);
  g.db.prepare(
    `INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, status)
     VALUES ('h3sku-cheap', 'h3sku', 'H3-CHEAP', '{"옵션":"저가"}', 5000, 5000, 0, 'OUT_OF_STOCK'),
            ('h3sku-dear', 'h3sku', 'H3-DEAR', '{"옵션":"정상"}', 20000, 15000, 7, 'IN_STOCK')`
  ).run();
  const r = await g.call('/api/v1/products?per_page=100');
  const row = r.json.data.find((p) => p.id === 'h3sku');
  assert.ok(row, 'product listed');
  assert.equal(row.default_sku_id, 'h3sku-dear', 'cheapest IN-STOCK sku wins');
  g.db.prepare("UPDATE product_skus SET stock_quantity = 0, status = 'OUT_OF_STOCK' WHERE product_id = 'h3sku'").run();
  const r2 = await g.call('/api/v1/products?per_page=100');
  assert.equal(r2.json.data.find((p) => p.id === 'h3sku').default_sku_id, null, 'all-OOS means no orderable default');
});

await t.test('J-3.2 category creation verifies the parent', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const typo = await g.call('/api/v1/admin/categories', { method: 'POST', token: adm, body: { name: '오타 카테고리', parent_id: 'cat_no_such' } });
  assert.equal(typo.status, 400, typo.text);
  assert.equal(typo.json.code, 'INVALID_PARENT_CATEGORY');
  const parent = g.db.prepare('SELECT id FROM categories LIMIT 1').get();
  const child = await g.call('/api/v1/admin/categories', { method: 'POST', token: adm, body: { name: '하위 카테고리', parent_id: parent.id } });
  assert.equal(child.status, 201, child.text);
  const row = g.db.prepare('SELECT parent_id, depth FROM categories WHERE id = ?').get(child.json.data.id);
  assert.equal(row.parent_id, parent.id);
  assert.equal(row.depth, 1);
  const root = await g.call('/api/v1/admin/categories', { method: 'POST', token: adm, body: { name: '최상위 카테고리' } });
  assert.equal(root.status, 201, root.text);
  assert.equal(g.db.prepare('SELECT depth FROM categories WHERE id = ?').get(root.json.data.id).depth, 0);
});

t.finish();
