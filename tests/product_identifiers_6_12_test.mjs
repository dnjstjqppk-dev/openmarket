// tests/product_identifiers_6_12_test.mjs
// Phase 6 task 6-12 (decision-20): brand/manufacturer/model on the product,
// a GS1-valid barcode or an explicit exemption reason per SKU.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { isValidGtin, validateSkuIdentifiers, gtinPropName } from '../apps/cloudflare-gateway/src/lib/product-identifiers.js';
import { productGraph } from '../apps/cloudflare-gateway/src/lib/seo-jsonld.js';
import { buildNaverListingPayload } from '../apps/cloudflare-gateway/src/services/connectors/naver-connector.js';

const t = createRunner('Product identifiers (6-12)');

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

const G13 = '5901234123457';
const G8 = '96385074';

function mkBody(over = {}) {
  return {
    title: '식별정보 테스트 상품', brand: 'Acme', manufacturer: 'Acme Works', model_name: 'AW-1',
    category_slug: 'womens-clothing', thumbnail_url: 'https://cdn.example/i.png',
    description_html: '<p>d</p>', shipping_policy_id: 'sp_dev_pt_001',
    skus: [
      { option_combination: { 색상: '블랙' }, original_price: 20000, sale_price: 15000, stock_quantity: 5, gtin: G13 },
      { option_combination: { 색상: '네이비' }, original_price: 20000, sale_price: 15000, stock_quantity: 5, gtin_exempt_reason: 'SELF_MADE' }
    ],
    ...over
  };
}

// 1. GTIN digits + GS1 check digit.
await t.test('1. barcode validation accepts 8/12/13/14 digits with a valid check', async () => {
  assert.equal(isValidGtin('5901234123457'), true);
  assert.equal(isValidGtin('96385074'), true);
  assert.equal(isValidGtin('123456789012'), true);
  assert.equal(isValidGtin('12345678901231'), true);
  assert.equal(isValidGtin('5901 2341 2345 7'), true, 'spaces tolerated');
  assert.equal(isValidGtin('5901234123456'), false, 'bad check digit');
  assert.equal(isValidGtin('12345'), false, 'bad length');
  assert.equal(isValidGtin('590123412345A'), false, 'digits only');
  assert.equal(isValidGtin(''), false);
  assert.equal(gtinPropName('5901234123457'), 'gtin13');
  assert.equal(gtinPropName('96385074'), 'gtin8');
  assert.equal(gtinPropName('123456789012'), 'gtin12');
  assert.equal(gtinPropName('12345678901231'), 'gtin14');
  assert.equal(gtinPropName('nope'), null);
  const v = validateSkuIdentifiers({ gtin: '5901234123457' });
  assert.deepEqual(v, { gtin: '5901234123457', exempt: null });
  assert.deepEqual(validateSkuIdentifiers({ gtin_exempt_reason: 'OTHER:직접수입 병행' }), { gtin: null, exempt: 'OTHER:직접수입 병행' });
  const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return 'NO_THROW'; };
  assert.equal(codeOf(() => validateSkuIdentifiers({})), 'GTIN_REQUIRED');
  assert.equal(codeOf(() => validateSkuIdentifiers({ gtin_exempt_reason: 'BOGUS' })), 'INVALID_EXEMPT_REASON');
  assert.equal(codeOf(() => validateSkuIdentifiers({ gtin_exempt_reason: 'OTHER' })), 'INVALID_EXEMPT_REASON');
  assert.equal(codeOf(() => validateSkuIdentifiers({ gtin: '123' })), 'INVALID_GTIN');
});

// 2. New registrations require brand + per-SKU barcode-or-reason.
await t.test('2. registration requires identifiers and stores them', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const noBrand = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkBody({ brand: '' }) });
  assert.equal(noBrand.status, 400);
  assert.equal(noBrand.json.code, 'BRAND_REQUIRED');
  const noGtin = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: mkBody({ skus: [{ option_combination: { 색상: '블랙' }, original_price: 20000, sale_price: 15000, stock_quantity: 5 }] })
  });
  assert.equal(noGtin.status, 400);
  assert.equal(noGtin.json.code, 'GTIN_REQUIRED');
  const badGtin = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: mkBody({ skus: [{ option_combination: { 색상: '블랙' }, original_price: 20000, sale_price: 15000, stock_quantity: 5, gtin: '123' }] })
  });
  assert.equal(badGtin.status, 400);
  assert.equal(badGtin.json.code, 'INVALID_GTIN');
  const ok = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkBody() });
  assert.equal(ok.status, 201, ok.text);
  const prod = g.db.prepare('SELECT brand, manufacturer, model_name FROM products WHERE id = ?').get(ok.json.product_id);
  assert.deepEqual([prod.brand, prod.manufacturer, prod.model_name], ['Acme', 'Acme Works', 'AW-1']);
  const skus = g.db.prepare('SELECT gtin, gtin_exempt_reason FROM product_skus WHERE product_id = ? ORDER BY option_combination_json').all(ok.json.product_id);
  assert.equal(skus.length, 2);
  assert.ok(skus.some((s) => s.gtin === G13 && s.gtin_exempt_reason === null));
  assert.ok(skus.some((s) => s.gtin === null && s.gtin_exempt_reason === 'SELF_MADE'));
  // Legacy single-SKU shape takes the top-level pair.
  const legacy = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: {
      title: '레거시 단품', brand: 'Acme', category_slug: 'womens-clothing', thumbnail_url: 'https://cdn.example/i.png',
      sale_price: 15000, original_price: 20000, stock_quantity: 3, shipping_policy_id: 'sp_dev_pt_001', gtin: G8
    }
  });
  assert.equal(legacy.status, 201, legacy.text);
  assert.equal(g.db.prepare('SELECT gtin FROM product_skus WHERE product_id = ?').get(legacy.json.product_id).gtin, G8);
});

// 3. Legacy edits stay unblocked; provided identifiers validate + persist.
await t.test('3. existing products edit freely, identifiers validate when sent', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const legacy = g.db.prepare("SELECT id FROM products WHERE partner_id = 'pt_001' AND brand IS NULL LIMIT 1").get();
  assert.ok(legacy, 'seed keeps a brand-less product');
  const edit = await g.call(`/api/v1/partner/products/${legacy.id}`, { method: 'PUT', token: pt, body: { title: '레거시 수정 제목' } });
  assert.equal(edit.status, 200, edit.text);
  assert.equal(g.db.prepare('SELECT brand FROM products WHERE id = ?').get(legacy.id).brand, null, 'brand stays null');
  const bad = await g.call(`/api/v1/partner/products/${legacy.id}`, { method: 'PUT', token: pt, body: { brand: '' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'BRAND_REQUIRED');
  const fill = await g.call(`/api/v1/partner/products/${legacy.id}`, {
    method: 'PUT', token: pt, body: { brand: 'Backfill', manufacturer: 'BW', model_name: 'M-9' }
  });
  assert.equal(fill.status, 200, fill.text);
  const row = g.db.prepare('SELECT brand, manufacturer, model_name FROM products WHERE id = ?').get(legacy.id);
  assert.deepEqual([row.brand, row.manufacturer, row.model_name], ['Backfill', 'BW', 'M-9']);
  const sku = g.db.prepare('SELECT id FROM product_skus WHERE product_id = ? LIMIT 1').get(legacy.id);
  const badSku = await g.call(`/api/v1/partner/products/${legacy.id}`, {
    method: 'PUT', token: pt, body: { skus: [{ id: sku.id, gtin: '999' }] }
  });
  assert.equal(badSku.status, 400);
  assert.equal(badSku.json.code, 'INVALID_GTIN');
  const skuOk = await g.call(`/api/v1/partner/products/${legacy.id}`, {
    method: 'PUT', token: pt, body: { skus: [{ id: sku.id, gtin: G13 }] }
  });
  assert.equal(skuOk.status, 200, skuOk.text);
  assert.equal(g.db.prepare('SELECT gtin FROM product_skus WHERE id = ?').get(sku.id).gtin, G13);
});

// 4. Duplicate barcodes warn and surface on the admin conflict list.
await t.test('4. same barcode on two products warns + lists for review', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const first = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkBody({ title: '충돌 A' }) });
  assert.equal(first.status, 201, first.text);
  assert.deepEqual(first.json.warnings, [], 'first use is quiet');
  const second = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkBody({ title: '충돌 B' }) });
  assert.equal(second.status, 201, 'duplicate still registers');
  assert.ok((second.json.warnings || []).some((w) => w.code === 'GTIN_DUPLICATE' && w.message.includes(G13)), 'duplicate warned');
  const list = await g.call('/api/v1/admin/products?identifiers=conflict&limit=200', { token: adm });
  assert.equal(list.status, 200, list.text);
  const ids = list.json.data.map((r) => r.id);
  assert.ok(ids.includes(first.json.product_id) && ids.includes(second.json.product_id), 'both rows listed');
  assert.equal(list.json.data.find((r) => r.id === first.json.product_id).gtin_conflict, 1, 'conflict flag set');
});

// 5. Bulk rows require brand + barcode-or-reason.
await t.test('5. bulk rows carry identifiers', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const row = (over = {}) => ({
    title: '일괄 식별', category_slug: 'womens-clothing', thumbnail_url: 'https://cdn.example/i.png',
    sale_price: 10000, original_price: 12000, stock_quantity: 2, ...over
  });
  const noBrand = await g.call('/api/v1/partner/products/bulk', {
    method: 'POST', token: pt, body: { shipping_policy_id: 'sp_dev_pt_001', items: [row({ gtin: G13 })] }
  });
  assert.equal(noBrand.status, 400);
  assert.ok(noBrand.json.errors[0].error.includes('브랜드'), 'row names the missing brand');
  const ok = await g.call('/api/v1/partner/products/bulk', {
    method: 'POST', token: pt,
    body: {
      shipping_policy_id: 'sp_dev_pt_001',
      items: [row({ brand: 'B1', gtin: G13 }), row({ brand: 'B2', gtin_exempt_reason: 'HANDMADE', title: '일괄 식별 2' })]
    }
  });
  assert.equal(ok.status, 201, ok.text);
  const p1 = g.db.prepare('SELECT brand FROM products WHERE id = ?').get(ok.json.products[0].product_id);
  assert.equal(p1.brand, 'B1');
  assert.equal(g.db.prepare('SELECT gtin_exempt_reason FROM product_skus WHERE product_id = ?').get(ok.json.products[1].product_id).gtin_exempt_reason, 'HANDMADE');
});

// 6. URL-import publish requires brand + variant identifiers.
await t.test('6. import publish requires identifiers', async () => {
  const g = await newGateway();
  const loginRes = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'seller@temu-supply.com', password: PW, role: 'PARTNER' } });
  const token = loginRes.json.token;
  const pid = g.db.prepare("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'").get().id;
  const preview = {
    product: { title: '수집 식별', thumbnail_url: 'https://cdn.example/t.png', description_html: '<p>d</p>' },
    pricing: { calculated_sale_price: 19900, calculated_original_price: 29900, wholesale_cost_krw: 12000 },
    variants: [{ variant_code: 'V1', price: 19900, original_price: 29900, stock_quantity: 5, option_values: { 색상: '블랙' } }]
  };
  const job = (n) => {
    const id = `imp612_${n}`;
    g.db.prepare('INSERT INTO product_import_jobs (id, partner_id, source_url, domain, status, preview_data_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, pid, 'https://supply.example/p/1', 'supply.example', 'ANALYZED', JSON.stringify(preview));
    return id;
  };
  const body = { title: '수집 식별', category_slug: 'womens-clothing', thumbnail_url: 'https://cdn.example/t.png', sale_price: 19900, original_price: 29900, shipping_policy_id: 'sp_dev_pt_001' };
  const noBrand = await g.call(`/api/v1/imports/${job(1)}/publish`, { method: 'POST', token, body: { ...body, gtin: G13 } });
  assert.equal(noBrand.status, 400);
  assert.equal(noBrand.json.code, 'BRAND_REQUIRED');
  const noGtin = await g.call(`/api/v1/imports/${job(2)}/publish`, { method: 'POST', token, body: { ...body, brand: 'Imp' } });
  assert.equal(noGtin.status, 400);
  assert.equal(noGtin.json.code, 'GTIN_REQUIRED');
  const ok = await g.call(`/api/v1/imports/${job(3)}/publish`, { method: 'POST', token, body: { ...body, brand: 'Imp', manufacturer: 'IM', model_name: 'IM-1', gtin: G8 } });
  assert.equal(ok.status, 201, ok.text);
  const row = g.db.prepare('SELECT brand, manufacturer, model_name FROM products WHERE id = ?').get(ok.json.product_id);
  assert.deepEqual([row.brand, row.manufacturer, row.model_name], ['Imp', 'IM', 'IM-1']);
  assert.equal(g.db.prepare('SELECT gtin FROM product_skus WHERE product_id = ?').get(ok.json.product_id).gtin, G8);
});

// 7. Backfill endpoint applies per row, failures apart.
await t.test('7. identifier backfill applies per row', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const a = g.db.prepare("SELECT id FROM products WHERE partner_id = 'pt_001' AND brand IS NULL LIMIT 1").get();
  const bProd = g.db.prepare("SELECT id FROM products WHERE partner_id = 'pt_001' AND brand IS NULL AND id != ? LIMIT 1").get(a.id);
  const skuA = g.db.prepare('SELECT id FROM product_skus WHERE product_id = ? LIMIT 1').get(a.id);
  const r = await g.call('/api/v1/partner/products/identifiers', {
    method: 'POST', token: pt,
    body: {
      items: [
        { product_id: a.id, brand: 'Fill', manufacturer: 'FW', model_name: 'F-1', skus: [{ sku_id: skuA.id, gtin: G13 }] },
        { product_id: bProd.id, brand: 'Fill2' },
        { product_id: 'prod_missing', brand: 'X' },
        { product_id: bProd.id, skus: [{ sku_id: 'sku_missing', gtin: G8 }] }
      ]
    }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.applied_count, 2);
  assert.equal(r.json.failed_count, 2);
  assert.equal(g.db.prepare('SELECT brand FROM products WHERE id = ?').get(a.id).brand, 'Fill');
  assert.equal(g.db.prepare('SELECT gtin FROM product_skus WHERE id = ?').get(skuA.id).gtin, G13);
  assert.equal(g.db.prepare('SELECT brand FROM products WHERE id = ?').get(bProd.id).brand, 'Fill2');
  // Foreign products are refused, never written.
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const foreign = await g.call('/api/v1/partner/products/identifiers', {
    method: 'POST', token: pt2, body: { items: [{ product_id: a.id, brand: 'Hijack' }] }
  });
  assert.equal(foreign.json.failed_count, 1);
  assert.equal(g.db.prepare('SELECT brand FROM products WHERE id = ?').get(a.id).brand, 'Fill');
});

// 8. Missing filters on both consoles.
await t.test('8. missing filters name incomplete rows', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const created = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkBody({ title: '완성 상품' }) });
  assert.equal(created.status, 201, created.text);
  const sell = await g.call('/api/v1/partner/products?identifiers=missing&limit=200', { token: pt });
  assert.equal(sell.status, 200, sell.text);
  assert.ok(sell.json.data.length > 0, 'seed rows are missing');
  assert.ok(sell.json.data.every((r) => r.id !== created.json.product_id), 'complete row excluded');
  const done = await g.call('/api/v1/partner/products?identifiers=complete&limit=200', { token: pt });
  assert.ok(done.json.data.some((r) => r.id === created.json.product_id), 'complete row listed');
  const admList = await g.call('/api/v1/admin/products?identifiers=missing&limit=200', { token: adm });
  assert.ok(admList.json.data.length > 0);
  assert.ok(admList.json.data.every((r) => r.id !== created.json.product_id));
  const bad = await g.call('/api/v1/partner/products?identifiers=bogus', { token: pt });
  assert.equal(bad.status, 400);
});

// 9. JSON-LD picks the gtin type and omits empties.
await t.test('9. product JSON-LD carries identifiers', async () => {
  const p = { id: 'prod_001', title: 't', lowest_sale_price: 10000, brand: 'Acme', manufacturer: 'AW', model_name: 'AW-1' };
  const full = productGraph('https://olmoa.com', p, { gtin: '5901234123457' })[0];
  assert.equal(full.brand.name, 'Acme');
  assert.equal(full.manufacturer.name, 'AW');
  assert.equal(full.mpn, 'AW-1');
  assert.equal(full.gtin13, '5901234123457');
  assert.equal(full.gtin14, undefined);
  assert.equal(productGraph('https://olmoa.com', p, { gtin: '96385074' })[0].gtin8, '96385074');
  assert.equal(productGraph('https://olmoa.com', p, { gtin: '123456789012' })[0].gtin12, '123456789012');
  assert.equal(productGraph('https://olmoa.com', p, { gtin: '12345678901231' })[0].gtin14, '12345678901231');
  const bare = productGraph('https://olmoa.com', { id: 'x', title: 't' }, {})[0];
  assert.equal(bare.brand, undefined);
  assert.equal(bare.manufacturer, undefined);
  assert.equal(bare.mpn, undefined);
  assert.equal(bare.gtin13, undefined);
});

// 11. d1_75 columns exist, legacy rows stay NULL.
await t.test('11. migration adds identifier columns, existing rows untouched', async () => {
  const g = await newGateway();
  const cols = (t) => g.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.ok(cols('products').includes('manufacturer'));
  assert.ok(cols('products').includes('model_name'));
  assert.ok(cols('product_skus').includes('gtin'));
  assert.ok(cols('product_skus').includes('gtin_exempt_reason'));
  assert.ok(g.db.prepare("SELECT version FROM schema_migrations WHERE version = 'd1_75_product_identifiers.sql'").get());
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM products WHERE manufacturer IS NOT NULL OR model_name IS NOT NULL').get().c, 0);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM product_skus WHERE gtin IS NOT NULL OR gtin_exempt_reason IS NOT NULL').get().c, 0);
});

// 10. Naver payload prefers the seller manufacturer, else the brand.
await t.test('10. market payloads take seller identifiers', async () => {
  const base = {
    title: 't', description_html: '<p>d</p>', sale_price: 10000, stock_quantity: 3,
    brand: 'Acme', as_phone: '01012345678', delivery_company: 'CJGLS',
    external_category_id: '50000803', delivery_fee_type: 'CHARGE', delivery_fee: 3000
  };
  const withMfr = buildNaverListingPayload({ ...base, manufacturer: 'Acme Works' });
  assert.equal(withMfr.ok, true);
  assert.equal(withMfr.payload.originProduct.detailAttribute.naverShoppingSearchInfo.manufacturerName, 'Acme Works');
  assert.equal(withMfr.payload.originProduct.detailAttribute.naverShoppingSearchInfo.brandName, 'Acme');
  const fallback = buildNaverListingPayload(base);
  assert.equal(fallback.payload.originProduct.detailAttribute.naverShoppingSearchInfo.manufacturerName, 'Acme');
});

t.finish();
