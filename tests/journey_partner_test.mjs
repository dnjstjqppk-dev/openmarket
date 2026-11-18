// tests/journey_partner_test.mjs
// Seller journey: shipping templates, product registration (options/SKUs),
// review flow, bulk edits — the partner side of the selling journey.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Seller journey (register -> review -> manage)');

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

const prodBody = (over = {}) => ({
  title: 'Journey Backpack 20L Black',
  description_html: '<p>A durable 20 liter backpack for the daily commute.</p>',
  category_id: 'cat_e_audio',
  brand: 'JBrand',
  thumbnail_url: 'https://example.com/jb.png',
  options: [
    { name: '색상', values: ['블랙', '네이비'] },
    { name: '사이즈', values: ['M', 'L'] }
  ],
  skus: [
    { option_combination: { 색상: '블랙', 사이즈: 'M' }, original_price: 50000, sale_price: 39000, stock_quantity: 10 },
    { option_combination: { 색상: '블랙', 사이즈: 'L' }, original_price: 50000, sale_price: 39000, stock_quantity: 5 },
    { option_combination: { 색상: '네이비', 사이즈: 'M' }, original_price: 52000, sale_price: 41000, stock_quantity: 8 },
    { option_combination: { 색상: '네이비', 사이즈: 'L' }, original_price: 52000, sale_price: 41000, stock_quantity: 0 }
  ],
  ...over
});

async function makeTemplate(g, pt, over = {}) {
  const r = await g.call('/api/v1/partner/shipping-policies', {
    method: 'POST', token: pt,
    body: { name: 'std', method: 'PARCEL', fee_type: 'CONDITIONAL', base_fee: 3000, free_threshold: 30000, today_cutoff: '15:00', is_default: true, ...over }
  });
  assert.equal(r.status, 201, `template create: ${r.text}`);
  return r.json.data;
}

await t.test('PJ1. shipping template lifecycle with ownership and in-use guard', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const tpl = await makeTemplate(g, pt);
  assert.equal(tpl.today_cutoff, '15:00', 'cutoff stored');
  const list = await g.call('/api/v1/partner/shipping-policies', { token: pt });
  assert.ok(list.json.data.find((x) => x.id === tpl.id), 'listed back');
  const upd = await g.call(`/api/v1/partner/shipping-policies/${tpl.id}`, {
    method: 'PUT', token: pt, body: { base_fee: 2500, today_cutoff: '14:00' }
  });
  assert.equal(upd.status, 200, upd.text);
  assert.equal(upd.json.data.base_fee, 2500, 'fee updated');
  const other = await g.call(`/api/v1/partner/shipping-policies/${tpl.id}`, {
    method: 'PUT', token: pt2, body: { base_fee: 1 }
  });
  assert.equal(other.status, 404, 'other seller cannot touch it');
  const bad = await g.call('/api/v1/partner/shipping-policies', {
    method: 'POST', token: pt, body: { name: 'x', method: 'PARCEL', fee_type: 'BOGUS' }
  });
  assert.equal(bad.status, 400, 'bad fee type rejected');
  const prod = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt, body: prodBody({ shipping_policy_id: tpl.id })
  });
  assert.equal(prod.status, 201, prod.text);
  const delUsed = await g.call(`/api/v1/partner/shipping-policies/${tpl.id}`, { method: 'DELETE', token: pt });
  assert.equal(delUsed.status, 409, 'in-use template kept');
  const spare = await makeTemplate(g, pt, { name: 'spare', is_default: false });
  const delSpare = await g.call(`/api/v1/partner/shipping-policies/${spare.id}`, { method: 'DELETE', token: pt });
  assert.equal(delSpare.status, 200, 'unused template deleted');
});

await t.test('PJ2. option-matrix registration stores SKUs, floors and ledger', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const r = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: prodBody() });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.status, 'DRAFT', 'starts as draft');
  assert.equal(r.json.review_status, 'PENDING', 'awaits review');
  const skus = g.db.prepare('SELECT * FROM product_skus WHERE product_id = ?').all(r.json.product_id);
  assert.equal(skus.length, 4, 'four combinations stored');
  assert.equal(new Set(skus.map((s) => s.sku_code)).size, 4, 'codes unique');
  assert.equal(new Set(skus.map((s) => s.option_combination_json)).size, 4, 'combos unique');
  const prod = g.db.prepare('SELECT lowest_sale_price, lowest_original_price FROM products WHERE id = ?').get(r.json.product_id);
  assert.equal(prod.lowest_sale_price, 39000, 'floor sale price');
  assert.equal(prod.lowest_original_price, 50000, 'floor original price');
  const led = g.db.prepare("SELECT COUNT(*) AS c FROM inventory_ledger WHERE change_type = 'RESTOCK' AND sku_id IN (SELECT id FROM product_skus WHERE product_id = ?)").get(r.json.product_id);
  assert.equal(led.c, 3, 'in-stock skus seeded the ledger');
  const zero = skus.find((s) => s.stock_quantity === 0);
  assert.equal(zero.status, 'OUT_OF_STOCK', 'zero stock flagged');
});

await t.test('PJ3. single-SKU legacy shape still registers', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const r = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: { title: 'Simple Mug', description_html: '<p>white mug</p>', category_id: 'cat_e_audio', thumbnail_url: 'https://example.com/m.png', sale_price: 9000, original_price: 12000, stock_quantity: 3 }
  });
  assert.equal(r.status, 201, r.text);
  const skus = g.db.prepare('SELECT * FROM product_skus WHERE product_id = ?').all(r.json.product_id);
  assert.equal(skus.length, 1, 'one default sku');
});

await t.test('PJ4. product list searches, tabs and ranges', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const r = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: prodBody({ title: 'Journey Backpack ZZ9' }) });
  const pid = r.json.product_id;
  const byTitle = await g.call('/api/v1/partner/products?q=ZZ9', { token: pt });
  assert.ok(byTitle.json.data.find((x) => x.id === pid), 'title search hits');
  const skuCode = g.db.prepare('SELECT sku_code FROM product_skus WHERE product_id = ? LIMIT 1').get(pid).sku_code;
  const bySku = await g.call(`/api/v1/partner/products?q=${encodeURIComponent(skuCode)}`, { token: pt });
  assert.ok(bySku.json.data.find((x) => x.id === pid), 'sku search hits');
  const pend = await g.call('/api/v1/partner/products?status=PENDING', { token: pt });
  assert.ok(pend.json.data.find((x) => x.id === pid), 'pending tab hits');
  const stock = await g.call('/api/v1/partner/products?stock_min=20&stock_max=30', { token: pt });
  assert.ok(stock.json.data.find((x) => x.id === pid), 'stock range hits (23 units)');
  const badTab = await g.call('/api/v1/partner/products?status=BOGUS', { token: pt });
  assert.equal(badTab.status, 400, 'bad tab rejected');
  const badRange = await g.call('/api/v1/partner/products?stock_min=-1', { token: pt });
  assert.equal(badRange.status, 400, 'bad range rejected');
  const detail = await g.call(`/api/v1/partner/products/${pid}`, { token: pt });
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.data.skus.length, 4, 'detail carries skus');
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const other = await g.call(`/api/v1/partner/products/${pid}`, { token: pt2 });
  assert.equal(other.status, 404, 'other seller detail hidden');
});

await t.test('PJ5. review approve publishes, reject needs a reason', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const r = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: prodBody() });
  const pid = r.json.product_id;
  const queue = await g.call('/api/v1/admin/products/review-queue', { token: adm });
  assert.ok(queue.json.data.find((x) => x.id === pid), 'pending queued');
  const ap = await g.call(`/api/v1/admin/products/${pid}/review`, { method: 'POST', token: adm, body: { decision: 'APPROVE' } });
  assert.equal(ap.status, 200, ap.text);
  const cat = await g.call(`/api/v1/products/${pid}`);
  assert.equal(cat.status, 200, 'catalog serves it');
  const r2 = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: prodBody({ title: 'Reject Me' }) });
  const noReason = await g.call(`/api/v1/admin/products/${r2.json.product_id}/review`, { method: 'POST', token: adm, body: { decision: 'REJECT' } });
  assert.equal(noReason.status, 400, 'reject needs a reason');
  const rej = await g.call(`/api/v1/admin/products/${r2.json.product_id}/review`, { method: 'POST', token: adm, body: { decision: 'REJECT', note: 'blurry thumbnail' } });
  assert.equal(rej.status, 200, rej.text);
  assert.equal(rej.json.review_status, 'REJECTED', 'rejected');
  const listed = await g.call('/api/v1/products?q=Reject%20Me&per_page=50');
  assert.ok(!listed.json.data.find((x) => x.id === r2.json.product_id), 'list hides it');
  const sku = g.db.prepare('SELECT id FROM product_skus WHERE product_id = ? LIMIT 1').get(r2.json.product_id).id;
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const blocked = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236', items: [{ sku_id: sku, quantity: 1 }] }
  });
  assert.equal(blocked.status, 409, 'checkout blocked');
  assert.equal(blocked.json.code, 'PRODUCT_NOT_ON_SALE', 'code');
  // F-J1-01 (display gap, money-safe): the public detail row still serves
  // unapproved products by direct id. Pinned as current behavior.
  const gone = await g.call(`/api/v1/products/${r2.json.product_id}`);
  assert.equal(gone.status, 200, 'detail still serves (known gap F-J1-01)');
  assert.equal(gone.json.data.status, 'DRAFT', 'row shows its real status');
});

await t.test('PJ6. bulk edits price, stock and status with per-item failures', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const r = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: prodBody() });
  const pid = r.json.product_id;
  await g.call(`/api/v1/admin/products/${pid}/review`, { method: 'POST', token: adm, body: { decision: 'APPROVE' } });
  const sku = g.db.prepare('SELECT id FROM product_skus WHERE product_id = ? LIMIT 1').get(pid).id;
  const u = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt,
    body: { updates: [{ product_id: pid, price: { mode: 'set', value: 35000 }, stock_quantity: 7, sku_id: sku }] }
  });
  assert.equal(u.status, 200, u.text);
  assert.equal(u.json.failed_count, 0, 'all applied');
  const row = g.db.prepare('SELECT sale_price, stock_quantity FROM product_skus WHERE id = ?').get(sku);
  assert.equal(row.sale_price, 35000, 'price set');
  assert.equal(row.stock_quantity, 7, 'stock set');
  const hide = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt, body: { updates: [{ product_id: pid, status: 'HIDDEN' }] }
  });
  assert.equal(hide.json.failed_count, 0, 'hidden');
  const resume = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt, body: { updates: [{ product_id: pid, status: 'ACTIVE' }] }
  });
  assert.equal(resume.json.failed_count, 0, 'approved product resumes');
  const r2 = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: prodBody({ title: 'Unapproved One' }) });
  const resume2 = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt, body: { updates: [{ product_id: r2.json.product_id, status: 'ACTIVE' }] }
  });
  assert.equal(resume2.json.failed_count, 1, 'unapproved resume fails per-item');
  assert.match(resume2.json.failed[0].error, /심사/, 'reason mentions review');
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const other = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt2, body: { updates: [{ product_id: pid, status: 'HIDDEN' }] }
  });
  assert.equal(other.json.failed_count, 1, 'other seller fails per-item');
  const prod = g.db.prepare('SELECT status FROM products WHERE id = ?').get(pid);
  assert.equal(prod.status, 'ACTIVE', 'untouched by the stranger');
});

const badReg = async (g, pt, over, code, note) => {
  const r = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: prodBody(over) });
  assert.equal(r.status, 400, `${note}: status`);
  assert.equal(r.json.code, code, `${note}: code`);
};

await t.test('PJ7. registration rejects bad basics', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  await badReg(g, pt, { title: '' }, 'REQUIRED', 'empty title');
  await badReg(g, pt, { description_html: '<p>[판매자 작성] 채우세요</p>' }, 'TEMPLATE_TEXT_LEFT', 'guide text left');
  const noCat = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: (() => { const b = prodBody(); delete b.category_id; return b; })() });
  assert.equal(noCat.json.code, 'CATEGORY_REQUIRED', 'category required');
  await badReg(g, pt, { category_id: 'cat_missing' }, 'INVALID_CATEGORY', 'unknown category');
  await badReg(g, pt, { kc_certified: true }, 'KC_NUMBER_REQUIRED', 'kc without number');
});

await t.test('PJ8. registration rejects bad option shapes', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  await badReg(g, pt, { options: [{ name: 'a', values: ['1'] }, { name: 'b', values: ['1'] }, { name: 'c', values: ['1'] }, { name: 'd', values: ['1'] }] }, 'TOO_MANY_OPTION_KINDS', 'four kinds');
  await badReg(g, pt, { options: [{ name: '색상', values: ['블랙'] }, { name: '색상', values: ['네이비'] }] }, 'DUPLICATE_OPTION', 'dup name');
  await badReg(g, pt, { options: [{ name: '색상', values: [] }] }, 'INVALID_OPTIONS', 'empty values');
  await badReg(g, pt, { skus: [{ option_combination: { 색상: '레드', 사이즈: 'M' }, sale_price: 10000, stock_quantity: 1 }] }, 'INVALID_OPTIONS', 'undeclared combo');
  await badReg(g, pt, {
    skus: [
      { option_combination: { 색상: '블랙', 사이즈: 'M' }, sale_price: 10000, stock_quantity: 1 },
      { option_combination: { 사이즈: 'M', 색상: '블랙' }, sale_price: 10000, stock_quantity: 1 }
    ]
  }, 'DUPLICATE_COMBINATION', 'dup combo regardless of key order');
});

await t.test('PJ9. registration rejects bad prices, stock and images', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  await badReg(g, pt, { skus: [{ option_combination: { 색상: '블랙', 사이즈: 'M' }, sale_price: 99, stock_quantity: 1 }] }, 'INVALID_INTEGER', 'sale under 100');
  await badReg(g, pt, { skus: [{ option_combination: { 색상: '블랙', 사이즈: 'M' }, original_price: 5000, sale_price: 9000, stock_quantity: 1 }] }, 'INVALID_INTEGER', 'original under sale');
  await badReg(g, pt, { skus: [{ option_combination: { 색상: '블랙', 사이즈: 'M' }, sale_price: 9000, stock_quantity: -1 }] }, 'INVALID_INTEGER', 'negative stock');
  await badReg(g, pt, { images: Array.from({ length: 11 }, (_, i) => ({ image_url: `https://cdn.example.com/${i}.png` })) }, 'TOO_MANY_IMAGES', 'eleven images');
  await badReg(g, pt, { images: [{ image_url: 'https://evil.example.com/x.png' }] }, 'INVALID_IMAGE_URL', 'off-storage gallery');
  await badReg(g, pt, { thumbnail_url: 'http://plain.example.com/x.png' }, 'INVALID_IMAGE_URL', 'non-https thumbnail');
});

await t.test('PJ10. registration rejects oversize SKU lists and foreign keys', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const many = Array.from({ length: 201 }, (_, i) => ({ option_combination: { 색상: `c${i}` }, sale_price: 1000 + i, stock_quantity: 1 }));
  const over = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: { title: 'Too Many', description_html: '<p>x</p>', category_id: 'cat_e_audio', thumbnail_url: 'https://example.com/t.png', skus: many } });
  assert.equal(over.status, 400, 'over-200 rejected');
  assert.equal(over.json.code, 'TOO_MANY_SKUS', 'code');
  const foreign = await makeTemplate(g, pt2, { name: 'theirs' });
  await badReg(g, pt, { shipping_policy_id: foreign.id }, 'INVALID_SHIPPING_POLICY', 'foreign template');
  await badReg(g, pt, { notice_template_id: 'nt_missing' }, 'INVALID_NOTICE_TEMPLATE', 'unknown notice template');
});

await t.test('PJ11. duplicate SKU codes conflict across products', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const one = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: prodBody({ skus: [{ option_combination: { 색상: '블랙', 사이즈: 'M' }, sku_code: 'DUP-001', sale_price: 10000, stock_quantity: 1 }] })
  });
  assert.equal(one.status, 201, one.text);
  const two = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: prodBody({ title: 'Second', skus: [{ option_combination: { 색상: '블랙', 사이즈: 'M' }, sku_code: 'DUP-001', sale_price: 10000, stock_quantity: 1 }] })
  });
  assert.equal(two.status, 409, 'dup code conflicts');
  assert.equal(two.json.code, 'SKU_CODE_TAKEN', 'code');
});

await t.test('PJ12. notice template values enforced when attached', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const tpl = await g.call('/api/v1/admin/notice-templates', {
    method: 'POST', token: adm, body: { name: '가전', items: [{ key: '모델명', label: '모델명', required: 1 }] }
  });
  assert.equal(tpl.status, 201, tpl.text);
  const miss = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt, body: prodBody({ notice_template_id: tpl.json.data.id, notice_values: {} })
  });
  assert.equal(miss.status, 400, 'missing required value rejected');
  assert.equal(miss.json.code, 'NOTICE_REQUIRED_MISSING', 'code');
  const ok = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt, body: prodBody({ title: 'Noticed Goods', notice_template_id: tpl.json.data.id, notice_values: { 모델명: 'J-1000' } })
  });
  assert.equal(ok.status, 201, ok.text);
});

t.finish();
