// tests/api_partner_2_9_test.mjs
// Work order 2-9 seller-center APIs.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Partner APIs (2-9)');

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

async function checkoutPaid(g, cust, skuId, qty = 1) {
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: skuId, quantity: qty }] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o)}`);
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust,
    body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount }
  });
  assert.equal(pay.status, 200, pay.text);
  return o.order_id;
}

function pt2Product(g,overrides = {}) {
  const pid = overrides.id || 'prod_pt2_01';
  g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status)
    VALUES (?, 'pt_002', 'cat_e_audio', ?, 'https://x/y.png', '<p>t</p>', 20000, 15000, 'ACTIVE', 'APPROVED')`)
    .run(pid, overrides.title || 'pt2 product');
  g.db.prepare(`INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, status)
    VALUES (?, ?, ?, '{}', 20000, 15000, 100, 'IN_STOCK')`).run(overrides.sku || 'sku_pt2_01', pid, `C-${pid}`);
  return { productId: pid, skuId: overrides.sku || 'sku_pt2_01' };
}

await t.test('P1. pipeline counts match the list APIs', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  await checkoutPaid(g, cust, 'sku_001_w');
  const r = await g.call('/api/v1/partner/dashboard/pipeline', { token: pt });
  assert.equal(r.status, 200, r.text);
  const d = r.json.data;
  for (const k of ['new_orders', 'preparing', 'due_today', 'in_transit', 'cancel_requests',
    'return_requests', 'exchange_requests', 'unanswered_qna', 'qna_overdue_24h',
    'settlement', 'penalty_count', 'penalty_points', 'grade']) {
    assert.ok(k in d, `pipeline carries ${k}`);
  }
  assert.equal(d.new_orders, 1, 'one fresh order');
  const list = await g.call('/api/v1/partner/orders?status=PAYMENT_CONFIRMED', { token: pt });
  assert.equal(list.json.pagination.total, d.new_orders, 'pipeline matches the orders list');
  const qna = await g.call('/api/v1/products/prod_001/qna', { method: 'POST', token: cust, body: { question: '언제 오나요' } });
  assert.equal(qna.status, 201, qna.text);
  const r2 = await g.call('/api/v1/partner/dashboard/pipeline', { token: pt });
  assert.equal(r2.json.data.unanswered_qna, 1, 'waiting question counted');
});

await t.test('P2. orders list filters, masks and reveals with a reason', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const o1 = await checkoutPaid(g, cust, 'sku_001_w');
  const o2 = await checkoutPaid(g, cust, 'sku_003_set');
  const s1 = g.db.prepare('SELECT id, sub_order_no FROM sub_orders WHERE parent_order_id = ?').get(o1).id;
  await g.call(`/api/v1/partner/orders/${s1}/prepare`, { method: 'POST', token: pt });
  g.db.prepare("UPDATE sub_orders SET ship_by_deadline = date('now') WHERE id = ?").run(s1);
  const prep = await g.call('/api/v1/partner/orders?status=PREPARING', { token: pt });
  assert.equal(prep.json.pagination.total, 1, 'status narrows');
  const paid = await g.call('/api/v1/partner/orders?status=PAYMENT_CONFIRMED', { token: pt });
  assert.equal(paid.json.pagination.total, 1, 'other status narrows');
  const bad = await g.call('/api/v1/partner/orders?status=BOGUS', { token: pt });
  assert.equal(bad.status, 400, 'status validated');
  const today = new Date().toISOString().slice(0, 10);
  const dated = await g.call(`/api/v1/partner/orders?date_field=paid&from=${today}&to=${today}`, { token: pt });
  assert.equal(dated.json.pagination.total, 2, 'paid-day window matches both');
  const old = await g.call('/api/v1/partner/orders?date_field=paid&from=2001-01-01&to=2001-01-02', { token: pt });
  assert.equal(old.json.pagination.total, 0, 'old window matches none');
  const byNo = await g.call(`/api/v1/partner/orders?q=${o1.slice(0, 8)}`, { token: pt });
  assert.ok(byNo.json.data.length >= 1, 'order-no search hits');
  const byName = await g.call('/api/v1/partner/orders?q=' + encodeURIComponent('노이즈캔슬링'), { token: pt });
  assert.ok(byName.json.data.length >= 1, 'product-name search hits');
  const ship = await g.call(`/api/v1/partner/orders/${s1}/shipment`, { method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'TRKP2000001' } });
  assert.equal(ship.status, 200, ship.text);
  const byCarrier = await g.call('/api/v1/partner/orders?carrier=' + encodeURIComponent('CJ대한통운'), { token: pt });
  assert.equal(byCarrier.json.pagination.total, 1, 'carrier narrows');
  const byTracking = await g.call('/api/v1/partner/orders?q=TRKP2000001', { token: pt });
  assert.equal(byTracking.json.pagination.total, 1, 'tracking search hits');
  const dueFar = await g.call('/api/v1/partner/orders?due_before=2999-01-01', { token: pt });
  assert.ok(dueFar.json.data.some((r) => r.id === s1), 'far due date keeps the dated row');
  const duePast = await g.call('/api/v1/partner/orders?due_before=2001-01-01', { token: pt });
  assert.equal(duePast.json.pagination.total, 0, 'past due date matches none');
  const dueBad = await g.call('/api/v1/partner/orders?due_before=nope', { token: pt });
  assert.equal(dueBad.status, 400, 'bad due date rejected');
  const page = await g.call('/api/v1/partner/orders?per_page=1', { token: pt });
  assert.equal(page.json.data.length, 1, 'pagination applies');
  assert.equal(page.json.pagination.total, 2, 'total counts all');
  const csv = await g.call('/api/v1/partner/orders?format=csv', { token: pt });
  assert.equal(csv.status, 200, csv.text);
  assert.match(csv.headers.get('content-type') || '', /text\/csv/, 'csv content type');
  assert.ok(csv.text.includes(o1) || csv.text.includes('order_no'), 'csv carries order rows');
  const row = page.json.data[0];
  assert.ok(row.recipient_phone.includes('*'), 'contact masked');
  assert.notEqual(row.recipient_phone, '010-1234-5678', 'raw phone hidden');
  assert.ok(row.recipient_name.includes('*'), 'name masked');
  assert.equal(row.pccc, null, 'no pccc on a domestic order');
  const noReason = await g.call(`/api/v1/partner/orders/${s1}/contact`, { token: pt });
  assert.equal(noReason.status, 400, 'reveal needs a reason');
  const reveal = await g.call(`/api/v1/partner/orders/${s1}/contact?reason=` + encodeURIComponent('송장 출력'), { token: pt });
  assert.equal(reveal.status, 200, reveal.text);
  assert.equal(reveal.json.data.recipient_phone, '010-1234-5678', 'full contact with a reason');
  const logged = g.db.prepare("SELECT COUNT(*) AS n FROM pii_access_log WHERE resource = 'partner.orders.contact'").get().n;
  assert.equal(logged, 1, 'reveal access-logged');
});

await t.test('P3. bulk confirm moves own payable orders, failures listed', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const o1 = await checkoutPaid(g, cust, 'sku_001_w');
  const o2 = await checkoutPaid(g, cust, 'sku_001_b');
  const s1 = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o1).id;
  const s2 = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o2).id;
  const other = pt2Product(g);
  const o3 = await checkoutPaid(g, cust, other.skuId);
  const s3 = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o3).id;
  const r = await g.call('/api/v1/partner/orders/confirm', {
    method: 'PUT', token: pt, body: { sub_order_ids: [s1, s2, s3, 'sub_missing'] }
  });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([...r.json.data.updated].sort(), [s1, s2].sort(), 'own orders confirmed');
  assert.equal(r.json.data.failed.length, 2, 'foreign and missing ids fail separately');
  assert.equal(g.db.prepare('SELECT status FROM sub_orders WHERE id = ?').get(s1).status, 'PREPARING', 'status moved');
  assert.ok(g.db.prepare('SELECT confirmed_at FROM sub_orders WHERE id = ?').get(s1).confirmed_at, 'confirm time recorded');
  assert.equal(g.db.prepare('SELECT status FROM sub_orders WHERE id = ?').get(s3).status, 'PAYMENT_CONFIRMED', 'foreign order untouched');
  const over = await g.call('/api/v1/partner/orders/confirm', {
    method: 'PUT', token: pt, body: { sub_order_ids: Array.from({ length: 201 }, (_, i) => `x${i}`) }
  });
  assert.equal(over.status, 400, 'bulk capped at 200');
  const empty = await g.call('/api/v1/partner/orders/confirm', { method: 'PUT', token: pt, body: { sub_order_ids: [] } });
  assert.equal(empty.status, 400, 'empty bulk rejected');
});

await t.test('P4. delay notice extends the deadline and notifies the buyer', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const me = g.db.prepare("SELECT id FROM users WHERE email = 'customer@example.com'").get().id;
  const o = await checkoutPaid(g, cust, 'sku_001_w');
  const s = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o).id;
  const today = new Date().toISOString().slice(0, 10);
  const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const noReason = await g.call(`/api/v1/partner/orders/${s}/delay-notice`, {
    method: 'PUT', token: pt, body: { new_ship_by: plus(3) }
  });
  assert.equal(noReason.status, 400, 'reason required');
  const early = await g.call(`/api/v1/partner/orders/${s}/delay-notice`, {
    method: 'PUT', token: pt, body: { reason: '물량 폭주', new_ship_by: today }
  });
  assert.equal(early.status, 400, 'new date must be later');
  const far = await g.call(`/api/v1/partner/orders/${s}/delay-notice`, {
    method: 'PUT', token: pt, body: { reason: '물량 폭주', new_ship_by: plus(15) }
  });
  assert.equal(far.status, 400, 'new date within 14 days');
  const ok = await g.call(`/api/v1/partner/orders/${s}/delay-notice`, {
    method: 'PUT', token: pt, body: { reason: '물량 폭주', new_ship_by: plus(3) }
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(g.db.prepare('SELECT ship_by_deadline FROM sub_orders WHERE id = ?').get(s).ship_by_deadline, plus(3), 'deadline extended');
  const note = g.db.prepare("SELECT * FROM notifications WHERE user_id = ? AND message LIKE '%연기되었습니다%' ORDER BY created_at DESC").get(me);
  assert.ok(note && note.message.includes('물량 폭주'), 'buyer notified with the reason');
  g.db.prepare('UPDATE sub_orders SET ship_by_deadline = ? WHERE id = ?').run(plus(2), s);
  const back = await g.call(`/api/v1/partner/orders/${s}/delay-notice`, {
    method: 'PUT', token: pt, body: { reason: 'x', new_ship_by: plus(1) }
  });
  assert.equal(back.status, 400, 'earlier than the current deadline rejected');
});

await t.test('P5. shipping templates CRUD, in-use delete refused', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const bad = await g.call('/api/v1/partner/shipping-policies', {
    method: 'POST', token: pt, body: { name: 'x', method: 'DRONE', fee_type: 'PAID', base_fee: 3000 }
  });
  assert.equal(bad.status, 400, 'method validated');
  const c = await g.call('/api/v1/partner/shipping-policies', {
    method: 'POST', token: pt, body: { name: '기본', method: 'PARCEL', fee_type: 'PAID', base_fee: 3000 }
  });
  assert.equal(c.status, 201, c.text);
  const id = c.json.data.id;
  const list = await g.call('/api/v1/partner/shipping-policies', { token: pt });
  assert.ok(list.json.data.find((x) => x.id === id), 'created template listed');
  const other = await g.call('/api/v1/partner/shipping-policies', { token: pt2 });
  assert.ok(!other.json.data.find((x) => x.id === id), 'tenant isolated');
  const u = await g.call(`/api/v1/partner/shipping-policies/${id}`, {
    method: 'PUT', token: pt, body: { base_fee: 2500 }
  });
  assert.equal(u.status, 200, u.text);
  assert.equal(u.json.data.base_fee, 2500, 'fee updated');
  const foreign = await g.call(`/api/v1/partner/shipping-policies/${id}`, {
    method: 'PUT', token: pt2, body: { base_fee: 1 }
  });
  assert.equal(foreign.status, 404, 'foreign template hidden');
  g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = ?').run(id, 'prod_001');
  const blocked = await g.call(`/api/v1/partner/shipping-policies/${id}`, { method: 'DELETE', token: pt });
  assert.equal(blocked.status, 409, 'in-use template kept');
  g.db.prepare('UPDATE products SET shipping_policy_id = NULL WHERE id = ?').run('prod_001');
  const gone = await g.call(`/api/v1/partner/shipping-policies/${id}`, { method: 'DELETE', token: pt });
  assert.equal(gone.status, 200, gone.text);
});

const FULL_PRODUCT = {
  title: '풀스펙 테스트 상품',
  category_slug: 'audio-video',
  brand: 'AcmeTest',
  description_html: '<p>좋은 상품입니다</p>',
  images: [
    { image_url: '/api/v1/storage/file/p6a.png', alt_text: '앞' },
    { image_url: '/api/v1/storage/file/p6b.png', alt_text: '뒤' }
  ],
  options: [{ name: '색상', values: ['Black', 'White'] }],
  skus: [
    { sku_code: 'P6-BLK', option_combination: { 색상: 'Black' }, original_price: 20000, sale_price: 15000, stock_quantity: 5 },
    { sku_code: 'P6-WHT', option_combination: { 색상: 'White' }, original_price: 20000, sale_price: 15000, stock_quantity: 7 }
  ],
  notice_info: { 모델명: 'P6' },
  bundle_group_key: 'BND-P6'
};

function noticeTemplate(g, id = 'nt_p6') {
  g.db.prepare('INSERT INTO notice_templates (id, name, items_json, version) VALUES (?, ?, ?, 1)')
    .run(id, 't', JSON.stringify([{ key: '모델명', label: '모델명', required: 1 }]));
  return id;
}

await t.test('P6. product create/update validates gallery, options, notice and price', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const tpl = noticeTemplate(g);
  const sp = (await g.call('/api/v1/partner/shipping-policies', {
    method: 'POST', token: pt, body: { name: 't', method: 'PARCEL', fee_type: 'PAID', base_fee: 3000 }
  })).json.data.id;
  const before = g.db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  const badImages = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { ...FULL_PRODUCT, notice_template_id: tpl, shipping_policy_id: sp, images: Array.from({ length: 11 }, (_, i) => ({ image_url: `/api/v1/storage/file/p6${i}.png` })) }
  });
  assert.equal(badImages.status, 400, 'gallery capped at 10');
  const extImg = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { ...FULL_PRODUCT, notice_template_id: tpl, shipping_policy_id: sp, images: [{ image_url: 'https://evil.example/x.png' }] }
  });
  assert.equal(extImg.status, 400, 'gallery is own-storage only');
  const badPrice = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { ...FULL_PRODUCT, notice_template_id: tpl, shipping_policy_id: sp, skus: [{ sku_code: 'P6X', option_combination: { 색상: 'Black' }, original_price: 10000, sale_price: 15000, stock_quantity: 1 }] }
  });
  assert.equal(badPrice.status, 400, 'sale above original rejected');
  const dupCombo = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { ...FULL_PRODUCT, notice_template_id: tpl, shipping_policy_id: sp, skus: [
      { sku_code: 'P6A', option_combination: { 색상: 'Black' }, original_price: 20000, sale_price: 15000, stock_quantity: 1 },
      { sku_code: 'P6B', option_combination: { 색상: 'Black' }, original_price: 20000, sale_price: 15000, stock_quantity: 1 }
    ] }
  });
  assert.equal(dupCombo.status, 400, 'duplicate combinations rejected');
  const manyOpts = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { ...FULL_PRODUCT, notice_template_id: tpl, shipping_policy_id: sp,
      options: [{ name: 'a', values: ['1'] }, { name: 'b', values: ['1'] }, { name: 'c', values: ['1'] }, { name: 'd', values: ['1'] }],
      skus: [{ sku_code: 'P6C', option_combination: { a: '1', b: '1', c: '1', d: '1' }, original_price: 20000, sale_price: 15000, stock_quantity: 1 }] }
  });
  assert.equal(manyOpts.status, 400, 'option kinds capped at 3');
  const leftover = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { ...FULL_PRODUCT, notice_template_id: tpl, shipping_policy_id: sp, description_html: '<p>[판매자 작성] 가이드</p>' }
  });
  assert.equal(leftover.status, 400, 'authoring placeholder refused');
  const noNotice = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { ...FULL_PRODUCT, notice_template_id: tpl, shipping_policy_id: sp, notice_info: {} }
  });
  assert.equal(noNotice.status, 400, 'required notice items enforced');
  const manySkus = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { ...FULL_PRODUCT, notice_template_id: tpl, shipping_policy_id: sp,
      skus: Array.from({ length: 201 }, (_, i) => ({ sku_code: `P6M${i}`, option_combination: { 색상: `v${i}` }, original_price: 20000, sale_price: 15000, stock_quantity: 1 })) }
  });
  assert.equal(manySkus.status, 400, 'skus capped at 200');
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM products').get().n, before, 'failed creates save nothing');
  const ok = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt, body: { ...FULL_PRODUCT, notice_template_id: tpl, shipping_policy_id: sp }
  });
  assert.equal(ok.status, 201, ok.text);
  const pid = ok.json.product_id;
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?').get(pid).n, 2, 'gallery stored');
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM product_skus WHERE product_id = ?').get(pid).n, 2, 'skus stored');
  const row = g.db.prepare('SELECT notice_template_id, notice_template_version, shipping_policy_id, bundle_group_key, status FROM products WHERE id = ?').get(pid);
  assert.deepEqual([row.notice_template_id, row.notice_template_version, row.shipping_policy_id, row.bundle_group_key, row.status], [tpl, 1, sp, 'BND-P6', 'DRAFT']);
  const sku = g.db.prepare('SELECT id, sale_price FROM product_skus WHERE product_id = ? LIMIT 1').get(pid);
  const up = await g.call(`/api/v1/partner/products/${pid}`, {
    method: 'PUT', token: pt, body: { sale_price: 14000, original_price: 20000, sku_id: sku.id }
  });
  assert.equal(up.status, 200, up.text);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM sku_price_history WHERE sku_id = ?').get(sku.id).n, 1, 'price change journaled');
  const badUp = await g.call(`/api/v1/partner/products/${pid}`, {
    method: 'PUT', token: pt, body: { images: [{ image_url: 'https://evil.example/x.png' }] }
  });
  assert.equal(badUp.status, 400, 'update gallery is own-storage only');
});

await t.test('P7. bulk update changes status, price and stock with failures apart', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const mk = async (title) => (await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { title, sale_price: 10000, original_price: 12000, stock_quantity: 5, category_slug: 'audio-video', thumbnail_url: 'https://cdn.example/x.png' }
  })).json.product_id;
  const a = await mk('벌크 A');
  const b = await mk('벌크 B');
  const other = pt2Product(g);
  const r = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt,
    body: { updates: [
      { product_id: a, status: 'HIDDEN' },
      { product_id: b, price: { mode: 'ratio', value: 90 }, stock_quantity: 9 },
      { product_id: other.productId, status: 'HIDDEN' },
      { product_id: 'prod_missing', status: 'HIDDEN' }
    ] }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.updated.length, 2, 'own products applied');
  assert.equal(r.json.data.failed.length, 2, 'foreign and missing fail apart');
  assert.equal(g.db.prepare('SELECT status FROM products WHERE id = ?').get(a).status, 'HIDDEN', 'status moved');
  assert.equal(g.db.prepare('SELECT sale_price FROM product_skus WHERE product_id = ?').get(b).sale_price, 9000, 'ratio price applied');
  assert.equal(g.db.prepare('SELECT stock_quantity FROM product_skus WHERE product_id = ?').get(b).stock_quantity, 9, 'stock applied');
  assert.ok(g.db.prepare('SELECT COUNT(*) AS n FROM sku_price_history WHERE sku_id IN (SELECT id FROM product_skus WHERE product_id = ?)').get(b).n >= 1, 'bulk price journaled');
  const live = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt, body: { updates: [{ product_id: a, status: 'ACTIVE' }] }
  });
  assert.equal(live.json.data.failed.length, 1, 'self-activation refused without review');
  const over = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt, body: { updates: Array.from({ length: 501 }, (_, i) => ({ product_id: `x${i}` })) }
  });
  assert.equal(over.status, 400, 'bulk capped at 500');
});

await t.test('P8. store coupons are server-forced and freeze after issue', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const c = await g.call('/api/v1/partner/coupons', {
    method: 'POST', token: pt,
    body: { code: 'STORE1000', title: 't', discount_type: 'FIXED_AMOUNT', discount_value: 1000, issuer: 'PLATFORM', dup_group: 'PLATFORM', platform_share_bps: 5000 }
  });
  assert.equal(c.status, 201, c.text);
  const row = g.db.prepare('SELECT issuer, seller_id, dup_group, platform_share_bps FROM coupons WHERE id = ?').get(c.json.data.id);
  assert.deepEqual([row.issuer, row.seller_id, row.dup_group, row.platform_share_bps], ['SELLER', 'pt_001', 'STORE', 0], 'server forces the split columns');
  const mine = await g.call('/api/v1/partner/coupons', { token: pt });
  assert.ok(mine.json.data.find((x) => x.id === c.json.data.id), 'own coupon listed');
  const theirs = await g.call('/api/v1/partner/coupons', { token: pt2 });
  assert.ok(!theirs.json.data.find((x) => x.id === c.json.data.id), 'tenant isolated');
  const pre = await g.call(`/api/v1/partner/coupons/${c.json.data.id}`, {
    method: 'PUT', token: pt, body: { discount_value: 2000 }
  });
  assert.equal(pre.status, 200, pre.text);
  const claim = await g.call('/api/v1/coupons/claim', {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'p8-claim-store1' }, body: { code: 'STORE1000' }
  });
  assert.equal(claim.status, 200, claim.text);
  const frozen = await g.call(`/api/v1/partner/coupons/${c.json.data.id}`, {
    method: 'PUT', token: pt, body: { discount_value: 3000 }
  });
  assert.equal(frozen.status, 409, 'discount frozen after issue starts');
  const stop = await g.call(`/api/v1/partner/coupons/${c.json.data.id}`, {
    method: 'PUT', token: pt, body: { is_active: 0 }
  });
  assert.equal(stop.status, 200, stop.text);
  assert.equal(g.db.prepare('SELECT is_active FROM coupons WHERE id = ?').get(c.json.data.id).is_active, 0, 'suspend allowed');
});

await t.test('P9. flash-sale applications validate deal and stock', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const list = await g.call('/api/v1/partner/flash-sales', { token: pt });
  assert.equal(list.status, 200, list.text);
  assert.ok(list.json.data.find((x) => x.id === 'fls_today'), 'live campaign listed');
  const pricey = await g.call('/api/v1/partner/flash-sales/fls_today/apply', {
    method: 'POST', token: pt, body: { sku_id: 'sku_001_w', deal_price: 49900, allocated_stock: 10 }
  });
  assert.equal(pricey.status, 400, 'deal below sale enforced');
  const greedy = await g.call('/api/v1/partner/flash-sales/fls_today/apply', {
    method: 'POST', token: pt, body: { sku_id: 'sku_001_w', deal_price: 39900, allocated_stock: 999999 }
  });
  assert.equal(greedy.status, 400, 'allocation within stock enforced');
  const other = pt2Product(g);
  const foreign = await g.call('/api/v1/partner/flash-sales/fls_today/apply', {
    method: 'POST', token: pt, body: { sku_id: other.skuId, deal_price: 10000, allocated_stock: 1 }
  });
  assert.equal(foreign.status, 404, 'foreign sku hidden');
  const missing = await g.call('/api/v1/partner/flash-sales/fls_missing/apply', {
    method: 'POST', token: pt, body: { sku_id: 'sku_001_w', deal_price: 39900, allocated_stock: 1 }
  });
  assert.equal(missing.status, 404, 'unknown campaign rejected');
  g.db.prepare("INSERT INTO flash_sale_campaigns (id, title, starts_at, ends_at, status) VALUES ('fls_old', 't', '2001-01-01 00:00:00', '2001-01-02 00:00:00', 'ENDED')").run();
  const closed = await g.call('/api/v1/partner/flash-sales/fls_old/apply', {
    method: 'POST', token: pt, body: { sku_id: 'sku_001_w', deal_price: 39900, allocated_stock: 1 }
  });
  assert.equal(closed.status, 409, 'ended campaign closed');
  const ok = await g.call('/api/v1/partner/flash-sales/fls_today/apply', {
    method: 'POST', token: pt, body: { sku_id: 'sku_001_b', deal_price: 39900, allocated_stock: 10 }
  });
  assert.equal(ok.status, 201, ok.text);
  const row = g.db.prepare('SELECT status, applicant_partner_id FROM flash_sale_items WHERE id = ?').get(ok.json.data.id);
  assert.deepEqual([row.status, row.applicant_partner_id], ['REQUESTED', 'pt_001'], 'application queued for review');
});

await t.test('P10. payout requests guard full-only amount, account and inflight (5-2)', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const other = pt2Product(g);
  const o = await checkoutPaid(g, cust, other.skuId);
  g.db.prepare("UPDATE settlements SET status = 'ELIGIBLE_FOR_PAYOUT' WHERE sub_order_id = (SELECT id FROM sub_orders WHERE parent_order_id = ?)")
    .run(o);
  const avail = g.db.prepare("SELECT net_payout_amount FROM settlements WHERE sub_order_id = (SELECT id FROM sub_orders WHERE parent_order_id = ?)").get(o).net_payout_amount;
  assert.ok(avail > 0, 'fixture has payable money');
  const list0 = await g.call('/api/v1/partner/payout-requests', { token: pt2 });
  assert.equal(list0.status, 200, list0.text);
  assert.equal(list0.json.data.available_amount, avail, 'available previewed');
  g.db.prepare('UPDATE partners SET payout_account_verified = 0 WHERE id = ?').run('pt_002');
  const unverified = await g.call('/api/v1/partner/payout-requests', {
    method: 'POST', token: pt2, headers: { 'X-Idempotency-Key': 'p10-req-1' }, body: { amount: avail }
  });
  assert.equal(unverified.status, 409, 'unverified account refused');
  g.db.prepare('UPDATE partners SET payout_account_verified = 1 WHERE id = ?').run('pt_002');
  const nokey = await g.call('/api/v1/partner/payout-requests', { method: 'POST', token: pt2, body: { amount: avail } });
  assert.equal(nokey.status, 400, 'idempotency key required');
  const over = await g.call('/api/v1/partner/payout-requests', {
    method: 'POST', token: pt2, headers: { 'X-Idempotency-Key': 'p10-req-2' }, body: { amount: avail + 1 }
  });
  assert.equal(over.status, 400, 'over-full refused with 400');
  assert.equal(over.json.code, 'WITHDRAWAL_FULL_AMOUNT_ONLY', 'over-full code');
  const partial = await g.call('/api/v1/partner/payout-requests', {
    method: 'POST', token: pt2, headers: { 'X-Idempotency-Key': 'p10-req-2b' }, body: { amount: Math.max(0, avail - 1) }
  });
  assert.equal(partial.status, 400, 'partial amount refused with 400');
  assert.equal(partial.json.code, 'WITHDRAWAL_FULL_AMOUNT_ONLY', 'partial code');
  const ok = await g.call('/api/v1/partner/payout-requests', {
    method: 'POST', token: pt2, headers: { 'X-Idempotency-Key': 'p10-req-3' }, body: {}
  });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.data.amount, avail, 'server fills the full amount');
  const id = ok.json.data.id;
  const again = await g.call('/api/v1/partner/payout-requests', {
    method: 'POST', token: pt2, headers: { 'X-Idempotency-Key': 'p10-req-4' }, body: { amount: 1 }
  });
  assert.equal(again.status, 409, 'second request sees nothing left');
  assert.equal(again.json.code, 'NOTHING_TO_WITHDRAW', 'second request code');
  const cancel = await g.call(`/api/v1/partner/payout-requests/${id}/cancel`, { method: 'POST', token: pt2 });
  assert.equal(cancel.status, 200, cancel.text);
  assert.equal(g.db.prepare('SELECT status FROM payout_requests WHERE id = ?').get(id).status, 'CANCELLED', 'cancel recorded');
  const recancel = await g.call(`/api/v1/partner/payout-requests/${id}/cancel`, { method: 'POST', token: pt2 });
  assert.equal(recancel.status, 409, 'cancel is one-way');
  const equal = await g.call('/api/v1/partner/payout-requests', {
    method: 'POST', token: pt2, headers: { 'X-Idempotency-Key': 'p10-req-5' }, body: { amount: avail }
  });
  assert.equal(equal.status, 201, equal.text);
  assert.equal(equal.json.data.amount, avail, 'exact-full amount still accepted');
});

await t.test('P11. store profile decor restricts featured products', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const empty = await g.call('/api/v1/partner/store-profile', { token: pt });
  assert.equal(empty.status, 200, empty.text);
  assert.equal(empty.json.data.profile, null, 'no profile yet');
  const other = pt2Product(g);
  const foreign = await g.call('/api/v1/partner/store-profile', {
    method: 'PUT', token: pt, body: { intro: 'x', featured_product_ids: [other.productId] }
  });
  assert.equal(foreign.status, 400, 'foreign products cannot feature');
  const draft = (await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { title: '초안', sale_price: 10000, stock_quantity: 1, category_slug: 'audio-video', thumbnail_url: 'https://cdn.example/x.png' }
  })).json.product_id;
  const notLive = await g.call('/api/v1/partner/store-profile', {
    method: 'PUT', token: pt, body: { featured_product_ids: [draft] }
  });
  assert.equal(notLive.status, 400, 'only on-sale products feature');
  const ok = await g.call('/api/v1/partner/store-profile', {
    method: 'PUT', token: pt, body: { intro: '우리 가게', notice: '공지', featured_product_ids: ['prod_001'] }
  });
  assert.equal(ok.status, 200, ok.text);
  const back = await g.call('/api/v1/partner/store-profile', { token: pt });
  assert.equal(back.json.data.profile.intro, '우리 가게', 'profile round-trips');
  assert.deepEqual(JSON.parse(back.json.data.profile.featured_product_ids_json), ['prod_001'], 'featured stored');
});

await t.test('P12. review replies and reports stay on own products', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const other = pt2Product(g);
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content)
    VALUES ('rv_p12a', 'prod_001', 'u_customer_001', 't', 5, 'x')`).run();
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content)
    VALUES ('rv_p12b', ?, 'u_customer_001', 't', 5, 'x')`).run(other.productId);
  const foreign = await g.call('/api/v1/partner/reviews/rv_p12b/reply', { method: 'PUT', token: pt, body: { body: '감사합니다' } });
  assert.equal(foreign.status, 404, 'foreign review hidden');
  const empty = await g.call('/api/v1/partner/reviews/rv_p12a/reply', { method: 'PUT', token: pt, body: { body: '' } });
  assert.equal(empty.status, 400, 'reply body required');
  const ok = await g.call('/api/v1/partner/reviews/rv_p12a/reply', { method: 'PUT', token: pt, body: { body: '감사합니다' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(g.db.prepare('SELECT body FROM review_replies WHERE review_id = ?').get('rv_p12a').body, '감사합니다', 'reply stored');
  const del = await g.call('/api/v1/partner/reviews/rv_p12a/reply', { method: 'DELETE', token: pt });
  assert.equal(del.status, 200, del.text);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM review_replies WHERE review_id = ?').get('rv_p12a').n, 0, 'reply removed');
  const repForeign = await g.call('/api/v1/partner/reviews/rv_p12b/report', { method: 'POST', token: pt, body: { reason: 'AD' } });
  assert.equal(repForeign.status, 404, 'foreign report hidden');
  const repBad = await g.call('/api/v1/partner/reviews/rv_p12a/report', { method: 'POST', token: pt, body: { reason: 'NOPE' } });
  assert.equal(repBad.status, 400, 'report reason validated');
  const rep = await g.call('/api/v1/partner/reviews/rv_p12a/report', { method: 'POST', token: pt, body: { reason: 'AD' } });
  assert.equal(rep.status, 201, rep.text);
});

await t.test('P13. penalties list and appeal once', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  g.db.prepare(`INSERT INTO partner_penalties (id, partner_id, penalty_amount, reason, status) VALUES ('pp_p13a', 'pt_001', 5000, '늦은 출고', 'DEDUCTED')`).run();
  g.db.prepare(`INSERT INTO partner_penalties (id, partner_id, penalty_amount, reason, status) VALUES ('pp_p13b', 'pt_002', 5000, 'x', 'DEDUCTED')`).run();
  const list = await g.call('/api/v1/partner/penalties', { token: pt });
  assert.equal(list.status, 200, list.text);
  assert.equal(list.json.data.length, 1, 'own penalties only');
  const foreign = await g.call('/api/v1/partner/penalties/pp_p13b/appeal', { method: 'POST', token: pt, body: { body: ' 억울합니다 ' } });
  assert.equal(foreign.status, 404, 'foreign penalty hidden');
  const empty = await g.call('/api/v1/partner/penalties/pp_p13a/appeal', { method: 'POST', token: pt, body: { body: '' } });
  assert.equal(empty.status, 400, 'appeal body required');
  const ok = await g.call('/api/v1/partner/penalties/pp_p13a/appeal', { method: 'POST', token: pt, body: { body: '택배사 파업이었습니다' } });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(g.db.prepare('SELECT appeal_body FROM partner_penalties WHERE id = ?').get('pp_p13a').appeal_body, 'appeal recorded');
  const twice = await g.call('/api/v1/partner/penalties/pp_p13a/appeal', { method: 'POST', token: pt, body: { body: '또' } });
  assert.equal(twice.status, 409, 'one appeal only');
});

async function deliveredSub(g, cust, skuId) {
  const o = await checkoutPaid(g, cust, skuId);
  const s = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o).id;
  g.db.prepare("UPDATE sub_orders SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP WHERE id = ?").run(s);
  return { orderId: o, subId: s };
}

await t.test('P14. returns list filters by type, status and period', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const a = await deliveredSub(g, cust, 'sku_001_w');
  const b = await deliveredSub(g, cust, 'sku_001_b');
  const claim = await g.call(`/api/v1/orders/${a.orderId}/claims`, {
    method: 'POST', token: cust, body: { sub_order_id: a.subId, reason_code: 'CHANGE_OF_MIND' }
  });
  assert.equal(claim.status, 201, claim.text);
  g.db.prepare(`INSERT INTO returns (id, order_id, sub_order_id, user_id, claim_type, reason, status, created_at)
    VALUES ('ret_p14x', ?, ?, 'u_customer_001', 'EXCHANGE', 'x', 'REQUESTED', CURRENT_TIMESTAMP)`)
    .run(b.orderId, b.subId);
  g.db.prepare(`INSERT INTO returns (id, order_id, sub_order_id, user_id, claim_type, reason, status, created_at)
    VALUES ('ret_p14o', ?, ?, 'u_customer_001', 'RETURN', 'x', 'REQUESTED', '2001-01-01 00:00:00')`)
    .run(b.orderId, b.subId);
  const all = await g.call('/api/v1/partner/returns', { token: pt });
  assert.equal(all.json.pagination.total, 3, 'three open claims');
  const ret = await g.call('/api/v1/partner/returns?claim_type=RETURN', { token: pt });
  assert.equal(ret.json.pagination.total, 2, 'type narrows');
  const bad = await g.call('/api/v1/partner/returns?claim_type=BOGUS', { token: pt });
  assert.equal(bad.status, 400, 'type validated');
  const today = new Date().toISOString().slice(0, 10);
  const fresh = await g.call(`/api/v1/partner/returns?from=${today}&to=${today}`, { token: pt });
  assert.equal(fresh.json.pagination.total, 2, 'period excludes the old row');
  const page = await g.call('/api/v1/partner/returns?per_page=1', { token: pt });
  assert.equal(page.json.data.length, 1, 'pagination applies');
  assert.equal(page.json.pagination.total, 3, 'total counts all');
});

await t.test('P15. pickup and inspection follow the stage order', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  g.db.prepare('UPDATE partners SET return_shipping_fee = 3000 WHERE id = ?').run('pt_001');
  const a = await deliveredSub(g, cust, 'sku_001_w');
  const claim = (await g.call(`/api/v1/orders/${a.orderId}/claims`, {
    method: 'POST', token: cust, body: { sub_order_id: a.subId, reason_code: 'CHANGE_OF_MIND' }
  })).json;
  const early = await g.call(`/api/v1/partner/returns/${claim.claim_id}/inspect`, {
    method: 'PUT', token: pt, body: { result: 'NORMAL' }
  });
  assert.equal(early.status, 409, 'inspect needs pickup first');
  const badTrk = await g.call(`/api/v1/partner/returns/${claim.claim_id}/pickup`, {
    method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'ab!' }
  });
  assert.equal(badTrk.status, 400, 'tracking validated');
  const pick = await g.call(`/api/v1/partner/returns/${claim.claim_id}/pickup`, {
    method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'RTN0000001' }
  });
  assert.equal(pick.status, 200, pick.text);
  assert.equal(g.db.prepare('SELECT collection_tracking_number FROM returns WHERE id = ?').get(claim.claim_id).collection_tracking_number, 'RTN0000001', 'pickup stored');
  const repick = await g.call(`/api/v1/partner/returns/${claim.claim_id}/pickup`, {
    method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'RTN0000002' }
  });
  assert.equal(repick.status, 409, 'pickup recorded once');
  const manyPhotos = await g.call(`/api/v1/partner/returns/${claim.claim_id}/inspect`, {
    method: 'PUT', token: pt, body: { result: 'NORMAL', photos: ['https://x/1.png', 'https://x/2.png', 'https://x/3.png', 'https://x/4.png', 'https://x/5.png', 'https://x/6.png'] }
  });
  assert.equal(manyPhotos.status, 400, 'inspection photos capped at 5');
  const badResult = await g.call(`/api/v1/partner/returns/${claim.claim_id}/inspect`, {
    method: 'PUT', token: pt, body: { result: 'FINE' }
  });
  assert.equal(badResult.status, 400, 'result validated');
  const insp = await g.call(`/api/v1/partner/returns/${claim.claim_id}/inspect`, {
    method: 'PUT', token: pt, body: { result: 'NORMAL', memo: '정상', photos: ['https://x/1.png'] }
  });
  assert.equal(insp.status, 200, insp.text);
  const approve = await g.call(`/api/v1/partner/returns/${claim.claim_id}/status`, {
    method: 'PUT', token: pt, body: { decision: 'APPROVE' }
  });
  assert.equal(approve.status, 200, approve.text);
  assert.ok(approve.json.return_fee > 0, 'customer fault keeps the return fee');
  const late = await g.call(`/api/v1/partner/returns/${claim.claim_id}/inspect`, {
    method: 'PUT', token: pt, body: { result: 'NORMAL' }
  });
  assert.equal(late.status, 409, 'closed claims stay closed');
  const c = await deliveredSub(g, cust, 'sku_001_b');
  const claim2 = (await g.call(`/api/v1/orders/${c.orderId}/claims`, {
    method: 'POST', token: cust, body: { sub_order_id: c.subId, reason_code: 'CHANGE_OF_MIND' }
  })).json;
  await g.call(`/api/v1/partner/returns/${claim2.claim_id}/pickup`, {
    method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'RTN0000003' }
  });
  const defect = await g.call(`/api/v1/partner/returns/${claim2.claim_id}/inspect`, {
    method: 'PUT', token: pt, body: { result: 'DEFECTIVE', memo: '파손 확인' }
  });
  assert.equal(defect.status, 200, defect.text);
  assert.equal(g.db.prepare('SELECT fault FROM returns WHERE id = ?').get(claim2.claim_id).fault, 'SELLER', 'defect flips fault to the seller');
  const approve2 = await g.call(`/api/v1/partner/returns/${claim2.claim_id}/status`, {
    method: 'PUT', token: pt, body: { decision: 'APPROVE' }
  });
  assert.equal(approve2.status, 200, approve2.text);
  assert.equal(approve2.json.return_fee, 0, 'seller fault drops the fee');
});

await t.test('P16. product list pages and filters on the server', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const mk = async (title) => (await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { title, sale_price: 10000, original_price: 12000, stock_quantity: 5, category_slug: 'audio-video', thumbnail_url: 'https://cdn.example/x.png' }
  })).json.product_id;
  const a = await mk('P16 판매중');
  const b = await mk('P16 품절');
  g.db.prepare("UPDATE products SET status = 'ACTIVE', review_status = 'APPROVED' WHERE id IN (?, ?)").run(a, b);
  g.db.prepare('UPDATE product_skus SET stock_quantity = 0 WHERE product_id = ?').run(b);
  const p1 = await g.call('/api/v1/partner/products?per_page=1&page=1', { token: pt });
  assert.equal(p1.status, 200, p1.text);
  assert.ok(p1.json.pagination && p1.json.pagination.total >= 2, 'pagination with total');
  const p2 = await g.call('/api/v1/partner/products?per_page=1&page=2', { token: pt });
  const ids1 = [...new Set(p1.json.data.map((r) => r.id || r.product_id))];
  const ids2 = [...new Set(p2.json.data.map((r) => r.product_id))];
  assert.ok(ids1.length === 1 && ids2.length === 1 && ids1[0] !== ids2[0], 'pages split by product');
  const so = await g.call('/api/v1/partner/products?status=SOLDOUT', { token: pt });
  const soIds = so.json.data.map((r) => r.product_id || r.id);
  assert.ok(soIds.includes(b) && !soIds.includes(a), 'soldout isolates zero stock');
  const pend = await g.call('/api/v1/partner/products?status=PENDING', { token: pt });
  assert.ok(!pend.json.data.map((r) => r.product_id || r.id).includes(a), 'approved product out of pending');
  const q = await g.call(`/api/v1/partner/products?q=${encodeURIComponent('P16 판매중')}`, { token: pt });
  assert.ok(q.json.data.length > 0 && q.json.data.every((r) => (r.title || '').includes('P16 판매중')), 'title search narrows');
  const bad = await g.call('/api/v1/partner/products?status=BOGUS', { token: pt });
  assert.equal(bad.status, 400, 'unknown status rejected');
});

await t.test('P17. resume to ACTIVE needs an approved review', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const mk = async (title) => (await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { title, sale_price: 10000, original_price: 12000, stock_quantity: 5, category_slug: 'audio-video', thumbnail_url: 'https://cdn.example/x.png' }
  })).json.product_id;
  const a = await mk('P17 재개');
  g.db.prepare("UPDATE products SET status = 'ACTIVE', review_status = 'APPROVED' WHERE id = ?").run(a);
  await g.call('/api/v1/partner/products/bulk-update', { method: 'PUT', token: pt, body: { updates: [{ product_id: a, status: 'HIDDEN' }] } });
  assert.equal(g.db.prepare('SELECT status FROM products WHERE id = ?').get(a).status, 'HIDDEN');
  const r = await g.call('/api/v1/partner/products/bulk-update', { method: 'PUT', token: pt, body: { updates: [{ product_id: a, status: 'ACTIVE' }] } });
  assert.equal(r.json.data.failed.length, 0, 'approved resume succeeds');
  assert.equal(g.db.prepare('SELECT status FROM products WHERE id = ?').get(a).status, 'ACTIVE', 'back on sale');
  const b = await mk('P17 미심사');
  const r2 = await g.call('/api/v1/partner/products/bulk-update', { method: 'PUT', token: pt, body: { updates: [{ product_id: b, status: 'ACTIVE' }] } });
  assert.equal(r2.json.data.failed.length, 1, 'unapproved activation still refused');
});

await t.test('P18. single product carries gallery and skus for the edit form', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const created = await g.call('/api/v1/partner/products', { method: 'POST', token: pt,
    body: { title: 'P18 단건', sale_price: 10000, original_price: 12000, stock_quantity: 5, category_slug: 'audio-video',
      thumbnail_url: 'https://cdn.example/p18.png', images: [{ image_url: '/api/v1/storage/file/p18a.png' }, { image_url: '/api/v1/storage/file/p18b.png' }] } });
  assert.equal(created.status, 201, created.text);
  const id = created.json.product_id;
  const r = await g.call(`/api/v1/partner/products/${id}`, { token: pt });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.id, id, 'product returned');
  assert.equal(r.json.data.images.length, 2, 'gallery in order');
  assert.equal(r.json.data.images[0].image_url, '/api/v1/storage/file/p18a.png', 'sort order kept');
  assert.ok(r.json.data.skus.length >= 1 && r.json.data.skus[0].sale_price === 10000, 'skus with prices');
  const other = pt2Product(g);
  const denied = await g.call(`/api/v1/partner/products/${other.id}`, { token: pt });
  assert.equal(denied.status, 404, 'other seller product hidden');
});

await t.test('P19. shipment ships without double-moving stock', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const stockOf = () => g.db.prepare('SELECT stock_quantity FROM product_skus WHERE id = ?').get('sku_001_w').stock_quantity;
  const before = stockOf();
  const o = await checkoutPaid(g, cust, 'sku_001_w');
  assert.equal(stockOf(), before - 1, 'checkout reserves stock');
  const sub = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o).id;
  await g.call('/api/v1/partner/orders/confirm', { method: 'PUT', token: pt, body: { sub_order_ids: [sub] } });
  const ship = await g.call(`/api/v1/partner/orders/${sub}/shipment`, { method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'TRKP190001' } });
  assert.equal(ship.status, 200, ship.text);
  assert.equal(stockOf(), before - 1, 'shipment moves no stock twice');
  const s = g.db.prepare('SELECT status, tracking_number FROM sub_orders WHERE id = ?').get(sub);
  assert.equal(s.status, 'SHIPPED', 'shipped');
  assert.equal(s.tracking_number, 'TRKP190001', 'tracking stored');
  const log = g.db.prepare("SELECT COUNT(*) AS n FROM milestone_tracking_logs WHERE sub_order_id = ? AND stage_code = 'SHIPPED'").get(sub).n;
  assert.equal(log, 1, 'milestone logged');
});

await t.test('P20. orders list accepts combined statuses', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const o1 = await checkoutPaid(g, cust, 'sku_001_w');
  const o2 = await checkoutPaid(g, cust, 'sku_001_b');
  const s1 = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o1).id;
  await g.call(`/api/v1/partner/orders/${s1}/prepare`, { method: 'POST', token: pt });
  const both = await g.call('/api/v1/partner/orders?status=PREPARING,PAYMENT_CONFIRMED', { token: pt });
  assert.equal(both.status, 200, both.text);
  assert.ok(both.json.pagination.total >= 2, 'union returned');
  const bad = await g.call('/api/v1/partner/orders?status=PREPARING,BOGUS', { token: pt });
  assert.equal(bad.status, 400, 'bad element rejected');
});

await t.test('P21. sellers suspend own coupons; list carries issue and use counts', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const created = await g.call('/api/v1/partner/coupons', { method: 'POST', token: pt,
    body: { code: 'P21STOP', title: 'P21 중지', discount_type: 'FIXED_AMOUNT', discount_value: 500 } });
  assert.equal(created.status, 201, created.text);
  const id = created.json.coupon_id || created.json.id || created.json.data?.id;
  const list = await g.call('/api/v1/partner/coupons', { token: pt });
  const row = list.json.data.find((c) => c.id === id);
  assert.ok(row && Number.isInteger(row.issued_count) && Number.isInteger(row.used_count), 'issue and use counts present');
  const stop = await g.call(`/api/v1/partner/coupons/${id}/suspend`, { method: 'PUT', token: pt });
  assert.equal(stop.status, 200, stop.text);
  assert.equal(g.db.prepare('SELECT is_active FROM coupons WHERE id = ?').get(id).is_active, 0, 'suspended');
  g.db.prepare("INSERT INTO coupons (id, code, title, discount_type, discount_value, expires_at, is_active, issuer, seller_id, scope, dup_group, issue_method) VALUES ('cp_p21x', 'P21X', 'x', 'FIXED_AMOUNT', 100, '2099-01-01 00:00:00', 1, 'SELLER', 'pt_002', 'SELLER', 'STORE', 'DOWNLOAD')").run();
  const denied = await g.call('/api/v1/partner/coupons/cp_p21x/suspend', { method: 'PUT', token: pt });
  assert.equal(denied.status, 404, 'other seller coupon untouched');
});

await t.test('P22. review list shows own products with reply state', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pid = g.db.prepare("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'").get().id;
  const prod = g.db.prepare('SELECT id FROM products WHERE partner_id = ? LIMIT 1').get(pid).id;
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content, images_json)
    VALUES ('rv_p22a', ?, 'u_customer_001', 'a', 5, 'x', '["https://x/p.png"]'), ('rv_p22b', ?, 'u_customer_001', 'b', 2, 'y', '[]')`).run(prod, prod);
  g.db.prepare('INSERT INTO review_replies (id, review_id, partner_id, body) VALUES (?, ?, ?, ?)').run('vr_p22', 'rv_p22a', pid, '감사합니다');
  const r = await g.call('/api/v1/partner/reviews', { token: pt });
  assert.equal(r.status, 200, r.text);
  const mine = r.json.data.filter((x) => x.product_id === prod);
  assert.ok(mine.length >= 2, 'own reviews listed');
  assert.equal(mine.find((x) => x.id === 'rv_p22a').reply.body, '감사합니다', 'reply joined');
  assert.equal(mine.find((x) => x.id === 'rv_p22b').reply, null, 'unreplied stays null');
  const low = await g.call('/api/v1/partner/reviews?max_rating=3', { token: pt });
  assert.ok(low.json.data.some((x) => x.id === 'rv_p22b') && !low.json.data.some((x) => x.id === 'rv_p22a'), 'rating filter applies');
  const un = await g.call('/api/v1/partner/reviews?answered=false', { token: pt });
  assert.ok(un.json.data.some((x) => x.id === 'rv_p22b') && !un.json.data.some((x) => x.id === 'rv_p22a'), 'answered filter applies');
  const photo = await g.call('/api/v1/partner/reviews?has_photo=true', { token: pt });
  assert.ok(photo.json.data.some((x) => x.id === 'rv_p22a') && !photo.json.data.some((x) => x.id === 'rv_p22b'), 'photo filter applies');
  const badPhoto = await g.call('/api/v1/partner/reviews?has_photo=maybe', { token: pt });
  assert.equal(badPhoto.status, 400, 'photo filter validated');
});

await t.test('P23. store coupon issue, buyer use and settlement deduction', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  // pt_002 is the MARKETPLACE seller in the dev seed, so checkout writes a settlement row.
  const pt = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const { skuId } = pt2Product(g, { id: 'prod_pt2_p23', sku: 'sku_pt2_p23' });
  const c = await g.call('/api/v1/partner/coupons', {
    method: 'POST', token: pt,
    body: { code: 'P23STORE', title: 'P23 스토어쿠폰', discount_type: 'FIXED_AMOUNT', discount_value: 1000 }
  });
  assert.equal(c.status, 201, c.text);
  const couponId = c.json.data.id;
  const claim = await g.call('/api/v1/coupons/claim', {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'p23-claim-1' }, body: { code: 'P23STORE' }
  });
  assert.equal(claim.status, 200, claim.text);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items: [{ sku_id: skuId, quantity: 1 }], store_coupon_ids: [claim.json.user_coupon_id] }
  })).json;
  assert.ok(o.order_id, `checkout with store coupon ok: ${JSON.stringify(o)}`);
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust,
    body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount }
  });
  assert.equal(pay.status, 200, pay.text);
  const sub = g.db.prepare('SELECT id, applied_store_coupon_id FROM sub_orders WHERE parent_order_id = ?').get(o.order_id);
  assert.equal(sub.applied_store_coupon_id, claim.json.user_coupon_id, 'store coupon recorded on the sub-order');
  const stl = g.db.prepare('SELECT seller_coupon_burden FROM settlements WHERE sub_order_id = ?').get(sub.id);
  assert.equal(stl.seller_coupon_burden, 1000, 'settlement deducts the seller burden');
  const list = await g.call('/api/v1/partner/coupons', { token: pt });
  const row = list.json.data.find((x) => x.id === couponId);
  assert.equal(row.used_count, 1, 'use counted');
  assert.equal(row.discount_total, 1000, 'discount total aggregates the allocation');
});

t.finish();
