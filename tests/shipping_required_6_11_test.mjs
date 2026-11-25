// tests/shipping_required_6_11_test.mjs
// Phase 6 task 6-11 (decision-19): the seller-chosen shipping policy is the
// only shipping truth — required at registration, fail-closed at order time,
// one display string on every surface.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, createRunner } from './lib/harness.mjs';
import { productGraph } from '../apps/cloudflare-gateway/src/lib/seo-jsonld.js';

const t = createRunner('Shipping required (6-11)');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function seedPolicy(g, partnerId) {
  return g.db.prepare("SELECT * FROM shipping_policies WHERE partner_id = ? AND is_default = 1 AND status = 'ACTIVE'").get(partnerId);
}

function mkProductBody(over = {}) {
  return {
    title: '배송정책 테스트 상품', brand: 'T', category_slug: 'womens-clothing',
    thumbnail_url: 'https://cdn.example/t.png', description_html: '<p>d</p>',
    skus: [{ option_combination_json: { 옵션: '기본' }, original_price: 20000, sale_price: 15000, stock_quantity: 10, gtin: '5901234123457' }],
    ...over
  };
}

function mkPolicyRow(g, partnerId, over = {}) {
  const id = `sp611_${Math.random().toString(36).slice(2, 10)}`;
  const row = {
    id, partner_id: partnerId, name: 't', method: 'PARCEL', carrier_code: null,
    fee_type: 'PAID', base_fee: 3000, free_threshold: null, qty_unit: null,
    remote_surcharge: null, return_fee: 3000, exchange_fee: 6000, processing_days: 1,
    today_cutoff: null, origin_address: null, return_address: null,
    is_default: 0, status: 'ACTIVE', ...over, id, partner_id: partnerId
  };
  const keys = Object.keys(row);
  g.db.prepare(`INSERT INTO shipping_policies (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => row[k]));
  return id;
}

// 1. Single registration requires the policy.
await t.test('1. product registration requires a usable policy', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pid = g.db.prepare("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'").get().id;
  const own = seedPolicy(g, pid);

  const missing = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkProductBody() });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.code, 'SHIPPING_POLICY_REQUIRED');

  const bogus = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkProductBody({ shipping_policy_id: 'sp_nope' }) });
  assert.equal(bogus.status, 400);
  assert.equal(bogus.json.code, 'INVALID_SHIPPING_POLICY');

  const foreign = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkProductBody({ shipping_policy_id: 'sp_dev_pt_002' }) });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.json.code, 'INVALID_SHIPPING_POLICY');

  const ok = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkProductBody({ shipping_policy_id: own.id }) });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(g.db.prepare('SELECT shipping_policy_id FROM products WHERE id = ?').get(ok.json.product_id).shipping_policy_id, own.id);

  // A seller with zero policies gets the guided message (same code).
  const g2 = await newGateway();
  const pt2 = await login(g2, 'seller@temu-supply.com', 'PARTNER');
  g2.db.prepare('UPDATE products SET shipping_policy_id = NULL WHERE partner_id = ?').run(pid);
  g2.db.prepare('DELETE FROM shipping_policies WHERE partner_id = ?').run(pid);
  const none = await g2.call('/api/v1/partner/products', { method: 'POST', token: pt2, body: mkProductBody() });
  assert.equal(none.status, 400);
  assert.equal(none.json.code, 'SHIPPING_POLICY_REQUIRED');
  assert.ok(none.json.error.includes('먼저 등록'), 'guides to the policy screen first');
});

// 2. Edits keep, change, but never clear the policy.
await t.test('2. product edits require an effective policy', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pid = g.db.prepare("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'").get().id;
  const own = seedPolicy(g, pid);
  const other = mkPolicyRow(g, pid, { fee_type: 'FREE', base_fee: 0 });

  const created = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkProductBody({ shipping_policy_id: own.id }) });
  const id = created.json.product_id;

  const clear = await g.call(`/api/v1/partner/products/${id}`, { method: 'PUT', token: pt, body: { shipping_policy_id: null } });
  assert.equal(clear.status, 400);
  assert.equal(clear.json.code, 'SHIPPING_POLICY_REQUIRED');

  const change = await g.call(`/api/v1/partner/products/${id}`, { method: 'PUT', token: pt, body: { shipping_policy_id: other } });
  assert.equal(change.status, 200, change.text);
  assert.equal(g.db.prepare('SELECT shipping_policy_id FROM products WHERE id = ?').get(id).shipping_policy_id, other);

  const keep = await g.call(`/api/v1/partner/products/${id}`, { method: 'PUT', token: pt, body: { title: '배송정책 테스트 상품 v2' } });
  assert.equal(keep.status, 200, keep.text);
  assert.equal(g.db.prepare('SELECT shipping_policy_id FROM products WHERE id = ?').get(id).shipping_policy_id, other);

  g.db.prepare('UPDATE products SET shipping_policy_id = NULL WHERE id = ?').run(id);
  const noPolicyEdit = await g.call(`/api/v1/partner/products/${id}`, { method: 'PUT', token: pt, body: { title: 'v3' } });
  assert.equal(noPolicyEdit.status, 400);
  assert.equal(noPolicyEdit.json.code, 'SHIPPING_POLICY_REQUIRED');
  const rescue = await g.call(`/api/v1/partner/products/${id}`, { method: 'PUT', token: pt, body: { shipping_policy_id: own.id } });
  assert.equal(rescue.status, 200, rescue.text);
});

// 3. Bulk registration: top-level or per-row policy, missing rows named.
await t.test('3. bulk registration assigns policies per row', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pid = g.db.prepare("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'").get().id;
  const own = seedPolicy(g, pid);
  const other = mkPolicyRow(g, pid, { fee_type: 'FREE', base_fee: 0 });
  const row = (over = {}) => ({ title: '일괄', brand: 'B611', category_slug: 'womens-clothing', thumbnail_url: 'https://cdn.example/t.png', sale_price: 10000, original_price: 12000, stock_quantity: 3, gtin: '5901234123457', ...over });

  const missing = await g.call('/api/v1/partner/products/bulk', { method: 'POST', token: pt, body: { items: [row(), row()] } });
  assert.equal(missing.status, 400);
  assert.ok(missing.json.errors.some((e) => String(e.error).includes('1행')), 'names the offending row');

  const top = await g.call('/api/v1/partner/products/bulk', { method: 'POST', token: pt, body: { shipping_policy_id: own.id, items: [row(), row()] } });
  assert.equal(top.status, 201, top.text);
  for (const p of top.json.products) {
    assert.equal(g.db.prepare('SELECT shipping_policy_id FROM products WHERE id = ?').get(p.product_id).shipping_policy_id, own.id);
  }

  const mixed = await g.call('/api/v1/partner/products/bulk', {
    method: 'POST', token: pt,
    body: { shipping_policy_id: own.id, items: [row(), row({ shipping_policy_id: other })] }
  });
  assert.equal(mixed.status, 201, mixed.text);
  assert.equal(g.db.prepare('SELECT shipping_policy_id FROM products WHERE id = ?').get(mixed.json.products[1].product_id).shipping_policy_id, other);
});

// 4. URL-import publish requires the policy.
await t.test('4. import publish requires the policy', async () => {
  const g = await newGateway();
  const loginRes = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'seller@temu-supply.com', password: PW, role: 'PARTNER' } });
  const token = loginRes.json.token;
  const pid = g.db.prepare("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'").get().id;
  const own = seedPolicy(g, pid);
  const preview = {
    product: { title: '수집', brand: 'T', thumbnail_url: 'https://cdn.example/t.png', description_html: '<p>d</p>' },
    pricing: { calculated_sale_price: 19900, calculated_original_price: 29900, wholesale_cost_krw: 12000 },
    variants: [{ variant_code: 'V1', price: 19900, original_price: 29900, stock_quantity: 5, option_values: { 색상: '블랙' } }]
  };
  const job = (n) => {
    const id = `imp611_${n}`;
    g.db.prepare('INSERT INTO product_import_jobs (id, partner_id, source_url, domain, status, preview_data_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, pid, 'https://supply.example/p/1', 'supply.example', 'ANALYZED', JSON.stringify(preview));
    return id;
  };
  const body = { title: '수집', category_slug: 'womens-clothing', thumbnail_url: 'https://cdn.example/t.png', sale_price: 19900, original_price: 29900, gtin: '5901234123457' };

  const missing = await g.call(`/api/v1/imports/${job(1)}/publish`, { method: 'POST', token, body });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.code, 'SHIPPING_POLICY_REQUIRED');

  const ok = await g.call(`/api/v1/imports/${job(2)}/publish`, { method: 'POST', token, body: { ...body, shipping_policy_id: own.id } });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(g.db.prepare('SELECT shipping_policy_id FROM products WHERE id = ?').get(ok.json.product_id).shipping_policy_id, own.id);
});

// 5. Orders fail closed: unassigned and inactive-policy products.
await t.test('5. quote and checkout refuse unsellable products', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const sku = g.db.prepare(
    `SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.partner_id = 'pt_002' AND p.status = 'ACTIVE' AND s.stock_quantity > 0 LIMIT 1`).get();
  const before = g.db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;

  g.db.prepare('UPDATE products SET shipping_policy_id = NULL WHERE id = ?').run(sku.product_id);
  const q = await g.call('/api/v1/orders/quote', { method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(q.status, 409);
  assert.equal(q.json.code, 'SHIPPING_POLICY_REQUIRED');
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM orders').get().c, before);

  const pol = mkPolicyRow(g, 'pt_002', { status: 'INACTIVE' });
  g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = ?').run(pol, sku.product_id);
  const q2 = await g.call('/api/v1/orders/quote', { method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(q2.status, 409);
  assert.equal(q2.json.code, 'SHIPPING_POLICY_REQUIRED');
});

// 6. No shipping-fee defaults remain in code.
await t.test('6. no shipping-fee defaults in code', async () => {
  const hits = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'dist', 'dist-local', '.git', 'build', '.dart_tool'].includes(e.name)) continue;
        scan(full);
      } else if (/\.(js|mjs|ts|vue|dart)$/.test(e.name)) {
        const src = fs.readFileSync(full, 'utf8');
        for (const [i, line] of src.split('\n').entries()) {
          if (line.includes('?? 3000') || line.includes('??3000')) {
            if (/min_margin|CREDIT_MIN|credit/i.test(line)) continue;
            hits.push(`${path.relative(ROOT, full)}:${i + 1}: ${line.trim().slice(0, 100)}`);
          }
        }
      }
    }
  };
  scan(path.join(ROOT, 'apps'));
  scan(path.join(ROOT, 'mobile', 'customer_app', 'lib'));
  scan(path.join(ROOT, 'mobile', 'partner_app', 'lib'));
  assert.deepEqual(hits, [], 'shipping-fee nullish defaults must be gone');
  const pricing = fs.readFileSync(path.join(ROOT, 'apps/storefront/src/lib/pricing.ts'), 'utf8');
  assert.ok(!pricing.includes('DEFAULT_SHIPPING_FEE') && !pricing.includes('DEFAULT_FREE_THRESHOLD'), 'client estimate uses policies, not defaults');
});

// 7. One display string per policy type, matching the charged amount.
await t.test('7. shipping text matches the charged amount per type', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pid = 'pt_002';
  const sku = g.db.prepare(
    `SELECT s.id, s.product_id, s.sale_price FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.partner_id = ? AND p.status = 'ACTIVE' AND s.stock_quantity > 5 LIMIT 1`).get(pid);
  const cases = [
    [{ fee_type: 'FREE', base_fee: 0 }, '무료배송', 0],
    [{ fee_type: 'PAID', base_fee: 2500 }, '배송비 2,500원', 2500],
    [{ fee_type: 'CONDITIONAL', base_fee: 3000, free_threshold: 50000 }, '50,000원 이상 구매 시 무료 (미만 3,000원)', 3000],
    [{ fee_type: 'PER_QTY', base_fee: 1000, qty_unit: 2 }, '2개당 1,000원', 3000]
  ];
  for (const [over, text, fee] of cases) {
    const id = mkPolicyRow(g, pid, over);
    g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = ?').run(id, sku.product_id);
    const d = await g.call(`/api/v1/products/${sku.product_id}`);
    assert.equal(d.status, 200, d.text);
    assert.equal(d.json.data.shipping_text, text);
    const qty = over.fee_type === 'PER_QTY' ? 5 : 1;
    const q = await g.call('/api/v1/orders/quote', { method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: sku.id, quantity: qty }] } });
    assert.equal(q.status, 200, q.text);
    const grp = q.json.data.sub_orders[0];
    assert.equal(grp.shipping_fee, fee, `${text} charges ${fee}`);
    assert.equal(grp.shipping_groups[0].shipping_text, text, 'quote text matches the detail text');
  }
  const remote = mkPolicyRow(g, pid, { fee_type: 'FREE', base_fee: 0, remote_surcharge: 4000 });
  g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = ?').run(remote, sku.product_id);
  const d = await g.call(`/api/v1/products/${sku.product_id}`);
  assert.equal(d.json.data.shipping_text, '무료배송 (도서산간 +4,000원)');
});

// 8. JSON-LD shipping rates per type, omitted without a policy.
await t.test('8. product JSON-LD carries the policy rate', async () => {
  const p = { id: 'prod_001', title: 't', lowest_sale_price: 10000 };
  const rate = (shipping) => productGraph('https://olmoa.com', p, { shipping })[0].offers.shippingDetails;
  assert.equal(rate({ fee_type: 'FREE', base_fee: 0 }).shippingRate.value, 0);
  assert.equal(rate({ fee_type: 'PAID', base_fee: 2500 }).shippingRate.value, 2500);
  assert.equal(rate({ fee_type: 'CONDITIONAL', base_fee: 3000, free_threshold: 50000 }).shippingRate.value, 3000);
  assert.equal(rate({ fee_type: 'PER_QTY', base_fee: 1000, qty_unit: 2 }).shippingRate.value, 1000);
  assert.equal(rate({ fee_type: 'FREE', base_fee: 0 }).shippingDestination.addressCountry, 'KR');
  assert.equal(productGraph('https://olmoa.com', p, {})[0].offers.shippingDetails, undefined);
  assert.equal(productGraph('https://olmoa.com', p, { shipping: null })[0].offers.shippingDetails, undefined);
});

// 9. Policy-less products are not exposed anywhere buyers look.
await t.test('9. unassigned products stay off buyer surfaces', async () => {
  const g = await newGateway();
  const prod = g.db.prepare("SELECT id, category_id FROM products WHERE partner_id = 'pt_002' AND status = 'ACTIVE' LIMIT 1").get();
  g.db.prepare('UPDATE products SET shipping_policy_id = NULL WHERE id = ?').run(prod.id);

  const list = await g.call('/api/v1/products?limit=200');
  assert.ok(list.json.data.every((r) => r.id !== prod.id), 'absent from the list');
  const detail = await g.call(`/api/v1/products/${prod.id}`);
  assert.equal(detail.status, 404);
  const search = await g.call(`/api/v1/products?limit=200&search=${encodeURIComponent('테스트')}`);
  assert.equal(search.status, 200);
  assert.ok((search.json.data || []).every((r) => r.id !== prod.id), 'absent from search');
  const store = await g.call('/api/v1/partners/pt_002/store');
  assert.ok(store.json.data.products.every((r) => r.id !== prod.id), 'absent from the store');
});

// 10. Seller unassigned list + bulk assignment end to end.
await t.test('10. sellers bulk-assign policies to unassigned products', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pid = g.db.prepare("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'").get().id;
  const own = seedPolicy(g, pid);
  const ids = g.db.prepare('SELECT id FROM products WHERE partner_id = ? LIMIT 3').all(pid).map((r) => r.id);
  g.db.prepare(`UPDATE products SET shipping_policy_id = NULL WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);

  const un = await g.call('/api/v1/partner/products?shipping=unassigned&limit=200', { token: pt });
  assert.equal(un.status, 200, un.text);
  const found = un.json.data.map((r) => r.id);
  for (const id of ids) assert.ok(found.includes(id), 'unassigned list names the product');

  const badBulk = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt, body: { updates: [{ product_id: ids[0], shipping_policy_id: 'sp_dev_pt_002' }] }
  });
  assert.equal(badBulk.json.failed_count, 1, 'foreign policies are refused per item');

  const bulk = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: pt, body: { updates: ids.map((product_id) => ({ product_id, shipping_policy_id: own.id })) }
  });
  assert.equal(bulk.status, 200, bulk.text);
  assert.equal(bulk.json.failed_count, 0);
  for (const id of ids) {
    assert.equal(g.db.prepare('SELECT shipping_policy_id FROM products WHERE id = ?').get(id).shipping_policy_id, own.id);
  }
  const unAfter = await g.call('/api/v1/partner/products?shipping=unassigned&limit=200', { token: pt });
  assert.ok(unAfter.json.data.every((r) => !ids.includes(r.id)), 'assigned rows leave the list');
});

// 11. Operators see unassigned rows and cannot approve them.
await t.test('11. admin review requires the policy', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pid = g.db.prepare("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'").get().id;
  const own = seedPolicy(g, pid);
  const created = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: mkProductBody({ shipping_policy_id: own.id }) });
  const id = created.json.product_id;
  g.db.prepare('UPDATE products SET shipping_policy_id = NULL WHERE id = ?').run(id);

  const blocked = await g.call(`/api/v1/admin/products/${id}/review`, { method: 'POST', token: adm, body: { decision: 'APPROVE' } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'SHIPPING_POLICY_REQUIRED');

  const queue = await g.call('/api/v1/admin/products/review-queue?limit=200', { token: adm });
  const row = queue.json.data.find((r) => r.id === id);
  assert.ok(row, 'still queued');
  assert.equal(row.shipping_missing, true);

  const list = await g.call('/api/v1/admin/products?shipping=unassigned&limit=200', { token: adm });
  assert.ok(list.json.data.some((r) => r.id === id), 'admin unassigned filter names it');

  g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = ?').run(own.id, id);
  const ok = await g.call(`/api/v1/admin/products/${id}/review`, { method: 'POST', token: adm, body: { decision: 'APPROVE' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.review_status, 'APPROVED');
});

// 12. The seller default stays first for the new-product form prefill.
await t.test('12. default policy leads the template list', async () => {
  const g = await newGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const pid = g.db.prepare("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'").get().id;
  const other = mkPolicyRow(g, pid, { fee_type: 'FREE', base_fee: 0 });
  const list = await g.call('/api/v1/partner/shipping-policies', { token: pt });
  assert.equal(list.status, 200);
  assert.ok(list.json.data.length >= 2);
  assert.equal(Number(list.json.data[0].is_default), 1, 'default first for form preselect');
  assert.ok(list.json.data.some((r) => r.id === other));
});

t.finish();
