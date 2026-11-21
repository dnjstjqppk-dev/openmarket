// tests/p1_api_data_test.mjs
// P1 api/data regression suite: P1-P01..P06 (error envelopes, PriceScanner docs,
// pagination) + P1-D01/D02/D03/D05 (schema integrity) + P-N01 (FK dev/test parity).
// Run: node tests/p1_api_data_test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, createRunner, createDatabase } from './lib/harness.mjs';

const t = createRunner('P1 API & Data Integrity');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = 'DevPass!2026#';
const ENV = {
  JWT_SECRET: 'p1-test-secret-0123456789abcdefghijklmnop',
  ENVIRONMENT: 'development',
  PAYMENT_MODE: 'sandbox',
  PRICESCANNER_API_KEY: 'pscan-test-key-0123456789abcdef',
  CARRIER_WEBHOOK_SECRET: 'carrier-test-secret-0123456789ab'
};
const ADDR = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };

async function newGateway() {
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: ENV });
  const login = async (email, role) => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, login };
}

function assertEnvelope(r, status, code) {
  assert.equal(r.status, status, `status: ${r.text}`);
  assert.equal(r.json.success, false);
  assert.equal(r.json.code, code, `code: ${r.text}`);
  assert.ok(typeof r.json.error === 'string' && r.json.error.length > 0);
}

function assertPageMeta(pagination, page, perPage) {
  for (const k of ['page', 'per_page', 'total', 'total_pages']) {
    assert.ok(Number.isInteger(pagination[k]), `pagination.${k} integer: ${JSON.stringify(pagination)}`);
  }
  assert.equal(pagination.page, page);
  assert.equal(pagination.per_page, perPage);
  assert.equal(pagination.total_pages, Math.max(1, Math.ceil(pagination.total / perPage)));
}

// ---------------- P1-P01: catalog 404 envelopes ----------------
await t.test('P01 catalog 404s use the full ErrorResponse envelope', async () => {
  const g = await newGateway();
  const cases = [
    ['/api/v1/products/NOPE_SUCH', 'Product not found', {}],
    ['/api/v1/categories/NOPE_SUCH', 'Category not found', { slug: 'NOPE_SUCH' }],
    ['/api/v1/products/NOPE_SUCH/buy-box', 'Product not found', { product_id: 'NOPE_SUCH' }],
    ['/api/v1/partners/NOPE_SUCH/store', 'Partner store not found', {}],
    ['/api/v1/products/NOPE_SUCH/live-activity', '상품을 찾을 수 없습니다.', {}]
  ];
  for (const [url, msg, extra] of cases) {
    const r = await g.call(url);
    assertEnvelope(r, 404, 'NOT_FOUND');
    assert.equal(r.json.error, msg, url);
    for (const [k, v] of Object.entries(extra)) assert.equal(r.json[k], v, `${url} extra ${k}`);
  }
});

// ---------------- P1-P02: storage upload envelopes ----------------
await t.test('P02 storage upload errors use HttpError envelopes', async () => {
  const g = await newGateway();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  assertEnvelope(await g.call('/api/v1/storage/upload', { method: 'POST', token: cust, body: {} }), 400, 'FILE_REQUIRED');
  const badType = await g.call('/api/v1/storage/upload', { method: 'POST', token: cust, headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assertEnvelope(badType, 415, 'UNSUPPORTED_MEDIA_TYPE');
  assertEnvelope(await g.call('/api/v1/storage/upload', { method: 'POST', token: cust, body: { file_data: 'aGk=', content_type: 'text/plain' } }), 400, 'INVALID_FILE_TYPE');
  assertEnvelope(await g.call('/api/v1/storage/upload', { method: 'POST', token: cust, body: { file_data: 'A'.repeat(14 * 1024 * 1024), content_type: 'image/png' } }), 400, 'FILE_TOO_LARGE');
});

// ---------------- P1-P03: admin + integrations bare envelopes ----------------
await t.test('P03 admin bare errors and feed 401 use envelopes', async () => {
  const g = await newGateway();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  assertEnvelope(await g.call('/api/v1/admin/banners/NOPE', { method: 'PUT', token: adm, body: { title: 't' } }), 404, 'NOT_FOUND');
  assertEnvelope(await g.call('/api/v1/admin/notifications', { method: 'POST', token: adm, body: {} }), 400, 'NOTIFICATION_REQUIRED');
  assertEnvelope(await g.call('/api/v1/admin/coupons', { method: 'POST', token: adm, body: {} }), 400, 'COUPON_REQUIRED');
  assertEnvelope(await g.call('/api/v1/admin/categories', { method: 'POST', token: adm, body: {} }), 400, 'CATEGORY_NAME_REQUIRED');
  assertEnvelope(await g.call('/api/v1/integrations/pricescanner/feed'), 401, 'UNAUTHENTICATED');
});

// ---------------- P1-P04: features/logistics/customs/storage envelopes ----------------
await t.test('P04 customer-feature bare errors use envelopes', async () => {
  const g = await newGateway();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  assertEnvelope(await g.call('/api/v1/products/prod_001/qna', { method: 'POST', token: cust, body: {} }), 400, 'QUESTION_REQUIRED');
  assertEnvelope(await g.call('/api/v1/coupons/claim', { method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'p1-claim-nope' }, body: { code: 'NOPE' } }), 404, 'NOT_FOUND');
  assertEnvelope(await g.call('/api/v1/wishlist', { method: 'POST', token: cust, body: {} }), 400, 'PRODUCT_REQUIRED');
  assertEnvelope(await g.call('/api/v1/support/inquiries', { method: 'POST', token: cust, body: {} }), 400, 'INQUIRY_REQUIRED');
  assertEnvelope(await g.call('/api/v1/addresses', { method: 'POST', token: cust, body: {} }), 400, 'ADDRESS_REQUIRED');
  assertEnvelope(await g.call('/api/v1/addresses/NOPE/default', { method: 'PUT', token: cust }), 404, 'NOT_FOUND');
  assertEnvelope(await g.call('/api/v1/addresses/NOPE', { method: 'DELETE', token: cust }), 404, 'NOT_FOUND');
  assertEnvelope(await g.call('/api/v1/notifications/dispatch', { method: 'POST', token: adm, body: {} }), 400, 'RECIPIENT_REQUIRED');
  assertEnvelope(await g.call('/api/v1/logistics/tracking/', { token: cust }), 400, 'SUB_ORDER_REQUIRED');
  const t404 = await g.call('/api/v1/logistics/tracking/NOPE', { token: cust });
  assertEnvelope(t404, 404, 'NOT_FOUND');
  assert.equal(t404.json.sub_order_id, 'NOPE');
  const inv401 = await g.call('/api/v1/orders/NOPE/commercial-invoice');
  assertEnvelope(inv401, 401, 'UNAUTHORIZED');
  const inv404 = await g.call('/api/v1/orders/NOPE/commercial-invoice', { token: cust });
  assertEnvelope(inv404, 404, 'NOT_FOUND');
  assert.equal(inv404.json.order_id, 'NOPE');
  const fk = await g.call('/api/v1/storage/file/');
  assertEnvelope(fk, 400, 'FILE_KEY_REQUIRED');
  assert.match(fk.headers.get('content-type') || '', /application\/json/, 'file-key error must be JSON, not plain text');
  const f404 = await g.call('/api/v1/storage/file/NOPE');
  assertEnvelope(f404, 404, 'NOT_FOUND');
  assert.equal(f404.json.error, 'File not found in storage');
});

await t.test('P04 review-content branch uses an envelope after a delivered purchase', async () => {
  const g = await newGateway();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const sku = g.db.prepare("SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get();
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(co.status, 201, co.text);
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: co.json.order_id, payment_key: 'sandbox_p1reviewtestkey', amount: co.json.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const sub = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(co.json.order_id);
  const ship = await g.call(`/api/v1/partner/orders/${sub.id}/shipment`, { method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'TRK12345678' } });
  assert.equal(ship.status, 200, ship.text);
  assert.equal((await g.call(`/api/v1/orders/${co.json.order_id}/advance-tracking`, { method: 'POST', token: adm })).status, 200);
  assert.equal((await g.call(`/api/v1/orders/${co.json.order_id}/advance-tracking`, { method: 'POST', token: adm })).status, 200);
  assert.equal(g.db.prepare('SELECT status s FROM sub_orders WHERE id = ?').get(sub.id).s, 'DELIVERED');
  assertEnvelope(await g.call(`/api/v1/products/${sku.product_id}/reviews`, { method: 'POST', token: cust, body: { rating: 5, content: '   ' } }), 400, 'CONTENT_REQUIRED');
  const ok = await g.call(`/api/v1/products/${sku.product_id}/reviews`, { method: 'POST', token: cust, body: { rating: 5, content: '배송이 빠르고 만족합니다.' } });
  assert.equal(ok.status, 201, ok.text);
});

await t.test('P04 invoice authz branches and logistics webhook use envelopes', async () => {
  const g = await newGateway();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const cust2 = await g.login('alex.kim@olmoa.com', 'CUSTOMER');
  const sku = g.db.prepare("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get();
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(co.status, 201, co.text);
  const other = await g.call(`/api/v1/orders/${co.json.order_id}/commercial-invoice`, { token: cust2 });
  assertEnvelope(other, 403, 'FORBIDDEN');
  const missing = await g.call(`/api/v1/orders/${co.json.order_id}/commercial-invoice`, { token: cust });
  assertEnvelope(missing, 422, 'INCOMPLETE_CUSTOMS_DATA');
  assert.ok(Array.isArray(missing.json.missing_fields) && missing.json.missing_fields.includes('pccc'));
  const wh = { 'X-Carrier-Webhook-Secret': ENV.CARRIER_WEBHOOK_SECRET };
  assertEnvelope(await g.call('/api/v1/logistics/milestone-webhook', { method: 'POST', headers: wh, body: { milestone: 'SHIPPED' } }), 400, 'SUB_ORDER_REQUIRED');
  const sub = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(co.json.order_id);
  const stale = await g.call('/api/v1/logistics/milestone-webhook', { method: 'POST', headers: wh, body: { sub_order_id: sub.id, milestone: 'SHIPPED' } });
  assertEnvelope(stale, 409, 'NOT_IN_TRANSIT_STATE');
});

// ---------------- P1-P05: PriceScanner doc reconciliation ----------------
await t.test('P05 pricescanner doc matches the implementation', async () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/integrations/pricescanner-openapi.yaml'), 'utf8');
  assert.ok(!doc.includes('page_size'), 'doc must not name page_size');
  assert.ok(!doc.includes('name: since'), 'doc must not name since');
  for (const s of ['name: page', 'name: limit', 'name: per_page', 'name: updated_after']) assert.ok(doc.includes(s), `doc names ${s}`);
  assert.ok(doc.includes('s-maxage=60') && !doc.includes('s-maxage=300'), 'doc pins s-maxage=60');
  for (const s of ['sku_id:', 'stock_status:', 'product_url:', 'total_pages:', 'UNAUTHENTICATED']) assert.ok(doc.includes(s), `doc covers ${s}`);
  const g = await newGateway();
  const key = { 'X-Integration-Key': ENV.PRICESCANNER_API_KEY };
  const r = await g.call('/api/v1/integrations/pricescanner/feed?limit=1', { headers: key });
  assert.equal(r.status, 200, r.text);
  assert.ok((r.headers.get('cache-control') || '').includes('s-maxage=60'));
  assert.ok(r.json.data.items.length <= 1);
  const item = r.json.data.items[0];
  for (const k of ['partner_id', 'product_id', 'sku_id', 'title', 'sale_price', 'currency', 'stock_status', 'product_url']) {
    assert.ok(item[k] !== undefined && item[k] !== null, `feed item carries ${k}`);
  }
  for (const k of ['page', 'per_page', 'limit', 'total', 'total_pages', 'has_more']) {
    assert.ok(r.json.pagination[k] !== undefined, `pagination carries ${k}`);
  }
  assert.equal(r.json.pagination.per_page, r.json.pagination.limit);
  const alias = await g.call('/api/v1/integrations/pricescanner/feed?per_page=1', { headers: key });
  assert.equal(alias.json.pagination.per_page, 1);
  const inc = await g.call('/api/v1/integrations/pricescanner/feed?updated_after=2999-01-01', { headers: key });
  assert.equal(inc.json.pagination.total, 0);
  assert.deepEqual(inc.json.data.items, []);
  const unauth = await g.call('/api/v1/integrations/pricescanner/feed');
  assertEnvelope(unauth, 401, 'UNAUTHENTICATED');
  assert.ok(item.product_url.startsWith('https://olmoa.com/product/'), `feed links follow the storefront base: ${item.product_url}`);
  const g2 = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env: { ...ENV, PUBLIC_STOREFRONT_URL: 'https://shop.example/' } });
  const r2 = await g2.call('/api/v1/integrations/pricescanner/feed?limit=1', { headers: key });
  assert.equal(r2.status, 200, r2.text);
  assert.ok(r2.json.data.items[0].product_url.startsWith('https://shop.example/product/'), `feed honors PUBLIC_STOREFRONT_URL: ${r2.json.data.items[0].product_url}`);
});

// ---------------- P1-P06: OffsetPageMeta pagination ----------------
await t.test('P06 my-orders list is paginated with OffsetPageMeta', async () => {
  const g = await newGateway();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const sku = g.db.prepare("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get();
  for (let i = 0; i < 2; i++) {
    const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
    assert.equal(co.status, 201, co.text);
  }
  const p1 = await g.call('/api/v1/orders?per_page=1&page=1', { token: cust });
  const p2 = await g.call('/api/v1/orders?per_page=1&page=2', { token: cust });
  assertPageMeta(p1.json.pagination, 1, 1);
  assert.equal(p1.json.pagination.total, 2);
  assert.notEqual(p1.json.data[0].id, p2.json.data[0].id, 'pages must be disjoint');
  const legacy = await g.call('/api/v1/orders?limit=1', { token: cust });
  assert.equal(legacy.json.pagination.per_page, 1, 'limit stays a legacy alias');
});

await t.test('P06 notifications and admin lists are paginated with honest totals', async () => {
  const g = await newGateway();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const uid = g.db.prepare("SELECT id FROM users WHERE email = 'customer@example.com'").get().id;
  for (let i = 0; i < 2; i++) {
    const b = await g.call('/api/v1/admin/notifications', { method: 'POST', token: adm, body: { target: uid, title: `P06-${i}`, message: 'm', type: 'SYSTEM' } });
    assert.equal(b.status, 201, b.text);
  }
  const realTotal = g.db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ?').get(uid).c;
  const realUnread = g.db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0').get(uid).c;
  const n = await g.call('/api/v1/notifications?per_page=1&page=1', { token: cust });
  assertPageMeta(n.json.pagination, 1, 1);
  assert.equal(n.json.pagination.total, realTotal);
  assert.equal(n.json.unread_count, realUnread, 'unread stays global, not page-scoped');
  const def = await g.call('/api/v1/notifications', { token: cust });
  assert.equal(def.json.pagination.per_page, 20, 'default page size preserved');
  for (const [url, table] of [['/api/v1/admin/orders', 'orders'], ['/api/v1/admin/ledger', 'settlements'], ['/api/v1/admin/claims', 'returns']]) {
    const r = await g.call(`${url}?per_page=1&page=1`, { token: adm });
    assert.equal(r.status, 200, `${url}: ${r.text}`);
    assertPageMeta(r.json.pagination, 1, 1);
    assert.equal(r.json.pagination.total, g.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c, `${url} total is honest`);
  }
  const ledDef = await g.call('/api/v1/admin/ledgers', { token: adm });
  assert.equal(ledDef.json.pagination.per_page, 50, 'ledger alias keeps the default cap');
});

// ---------------- P1-D01: canonical fulfillment_orders ----------------
await t.test('D01 fulfillment_orders is the d1_27 shape; dead d1_29 satellites are gone', async () => {
  const g = await newGateway();
  const cols = g.db.prepare('PRAGMA table_info(fulfillment_orders)').all().map((c) => c.name);
  for (const c of ['supplier_order_id', 'warehouse_id', 'carrier_code', 'tracking_number', 'shipped_at']) {
    assert.ok(cols.includes(c), `canonical shape keeps ${c}`);
  }
  for (const c of ['provider_id', 'warehouse_code', 'label_pdf_url']) {
    assert.ok(!cols.includes(c), `ghost d1_29 column ${c} absent`);
  }
  const sql = g.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'fulfillment_orders'").get().sql;
  assert.ok(sql.includes("'SHIPPED'"), 'writer status SHIPPED allowed by the CHECK');
  for (const dead of ['fulfillment_providers', 'shipment_tracking_events']) {
    assert.equal(g.db.prepare('SELECT COUNT(*) c FROM sqlite_master WHERE name = ?').get(dead).c, 0, `${dead} dropped`);
  }
  const fks = g.db.prepare('PRAGMA foreign_key_list(fulfillment_orders)').all();
  assert.ok(fks.some((f) => f.from === 'supplier_order_id' && f.table === 'supplier_orders'), 'supplier_order_id references supplier_orders');
});

// ---------------- P1-D02: restored L2 categories ----------------
await t.test('D02 slug-collision L2 rows exist with unique slugs', async () => {
  const g = await newGateway();
  const cel = g.db.prepare('SELECT * FROM categories WHERE id = ?').get('sub_cel_03');
  const wat = g.db.prepare('SELECT * FROM categories WHERE id = ?').get('sub_wat_03');
  assert.equal(cel.slug, 'gan-chargers');
  assert.equal(cel.parent_id, 'cat_cellphones');
  assert.equal(wat.slug, 'watch-straps');
  assert.equal(wat.parent_id, 'cat_watches');
  assert.equal(g.db.prepare('SELECT COUNT(*) c FROM categories WHERE slug IN (?, ?)').get('chargers-power', 'watches-straps').c, 2, 'original d1_03 slugs untouched');
});

// ---------------- P1-D03: purchase_order_items.sku_id FK ----------------
await t.test('D03 purchase_order_items.sku_id references product_skus', async () => {
  const g = await newGateway();
  const fks = g.db.prepare('PRAGMA foreign_key_list(purchase_order_items)').all();
  assert.ok(fks.some((f) => f.from === 'sku_id' && f.table === 'product_skus'), 'sku_id FK present');
  const sku = g.db.prepare('SELECT id FROM product_skus LIMIT 1').get().id;
  g.db.prepare('INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code) VALUES (?, ?, ?, 100, 0, 0, 100, ?, ?, ?, ?, ?, ?)').run('ord_d03', 'D03-1', 'u_customer_001', 'READY', 'n', '010', 'a', '', '06236');
  g.db.prepare('INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, coupon_discount_allocated, status) VALUES (?, ?, ?, ?, 0, 100, 0, 100, 0, ?)').run('sub_d03', 'ord_d03', 'D03S-1', 'pt_001', 'PAYMENT_CONFIRMED');
  g.db.prepare('INSERT INTO order_items (id, sub_order_id, sku_id, product_title, option_summary, unit_price, quantity, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('itm_d03', 'sub_d03', sku, 't', 'o', 100, 1, 100);
  g.db.prepare("INSERT INTO purchase_orders (id, po_no, supplier_id, sub_order_id, fulfillment_mode, status, total_cost) VALUES (?, ?, 'sup_dev_001', ?, 'DROP_SHIP', 'DRAFT', 60)").run('po_d03', 'PO-D03-1', 'sub_d03');
  assert.throws(() => g.db.prepare('INSERT INTO purchase_order_items (id, purchase_order_id, order_item_id, sku_id, supplier_sku_code, quantity, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?)').run('poi_bad', 'po_d03', 'itm_d03', 'sku_no_such', 'SUP-X', 1, 60), /FOREIGN KEY/i, 'orphan sku_id rejected');
  g.db.prepare('INSERT INTO purchase_order_items (id, purchase_order_id, order_item_id, sku_id, supplier_sku_code, quantity, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?)').run('poi_ok', 'po_d03', 'itm_d03', sku, 'SUP-X', 1, 60);
  assert.equal(g.db.prepare('SELECT COUNT(*) c FROM purchase_order_items WHERE id = ?').get('poi_ok').c, 1);
});

// ---------------- P1-D05: payout-link existence guard ----------------
await t.test('D05 typo payout_id cannot ghost-link a settlement', async () => {
  const g = await newGateway();
  assert.ok(g.db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name LIKE 'trg_settlements_payout_known_%'").get().c >= 2, 'existence triggers installed');
  g.db.prepare('INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code) VALUES (?, ?, ?, 100, 0, 0, 100, ?, ?, ?, ?, ?, ?)').run('ord_d05', 'D05-1', 'u_customer_001', 'PAID', 'n', '010', 'a', '', '06236');
  g.db.prepare('INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, coupon_discount_allocated, status) VALUES (?, ?, ?, ?, 0, 100, 0, 100, 0, ?)').run('sub_d05', 'ord_d05', 'D05S-1', 'pt_001', 'DELIVERED');
  g.db.prepare('INSERT INTO settlements (id, sub_order_id, partner_id, gross_amount, shipping_fee, commission_rate, commission_amount, net_payout_amount, status) VALUES (?, ?, ?, 100, 0, 10, 10, 90, ?)').run('stl_d05', 'sub_d05', 'pt_001', 'ELIGIBLE_FOR_PAYOUT');
  assert.throws(() => g.db.prepare('UPDATE settlements SET payout_id = ? WHERE id = ?').run('pay_typo_no_such', 'stl_d05'), /PAYOUT_UNKNOWN/, 'typo payout_id update rejected');
  assert.throws(() => g.db.prepare('INSERT INTO settlements (id, sub_order_id, partner_id, gross_amount, shipping_fee, commission_rate, commission_amount, net_payout_amount, status, payout_id) VALUES (?, ?, ?, 100, 0, 10, 10, 90, ?, ?)').run('stl_d05b', 'sub_d05', 'pt_001', 'PAID_OUT', 'pay_typo_no_such'), /PAYOUT_UNKNOWN|UNIQUE/i, 'typo payout_id insert rejected');
  g.db.prepare("INSERT INTO payouts (id, partner_id, amount, settlement_count, status, approved_by) VALUES (?, 'pt_001', 90, 1, 'APPROVED', 'u_admin_001')").run('pay_d05');
  g.db.prepare('UPDATE settlements SET payout_id = ? WHERE id = ?').run('pay_d05', 'stl_d05');
  assert.equal(g.db.prepare('SELECT payout_id p FROM settlements WHERE id = ?').get('stl_d05').p, 'pay_d05');
});

// ---------------- P-N01: FK dev/test parity ----------------
await t.test('N01 test database enforces FKs from the first migration (D1 parity)', async () => {
  const g = await newGateway();
  assert.equal(g.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'FK enforcement on');
  assert.ok(g.db.prepare('SELECT COUNT(*) c FROM categories').get().c > 0, 'migrations+seeds applied under FK ON');
  const sku = g.db.prepare('SELECT id FROM product_skus LIMIT 1').get().id;
  assert.throws(() => g.db.prepare('INSERT INTO order_items (id, sub_order_id, sku_id, product_title, option_summary, unit_price, quantity, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('itm_orphan', 'sub_no_such', sku, 't', 'o', 1, 1, 1), /FOREIGN KEY/i, 'orphan order_item rejected like D1 rejects it');
  const badSeed = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p1n01-')), 'bad_seed.sql');
  fs.writeFileSync(badSeed, "INSERT INTO order_items (id, sub_order_id, sku_id, product_title, option_summary, unit_price, quantity, total_price) VALUES ('itm_badseed', 'sub_no_such', 'sku_no_such', 't', 'o', 1, 1, 1);");
  assert.throws(() => createDatabase({ seedFiles: [badSeed] }), /FOREIGN KEY/i, 'FK-violating seed must fail the build, as on D1');
  fs.rmSync(path.dirname(badSeed), { recursive: true, force: true });
});

t.finish();
