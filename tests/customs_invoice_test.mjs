// tests/customs_invoice_test.mjs
// Work order 5-7: the cross-border commercial invoice must not invent exporter
// data. The exporter block is read from the order-time operating business
// (business_entities via orders.operator_entity_id); when the order carries
// none, generation fails closed with EXPORTER_NOT_CONFIGURED (409). Weight /
// seller / carrier fallbacks are gone: absent values stay empty (null) and the
// invoice header reports how many line items lack a weight.
// Run: node tests/customs_invoice_test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, createRunner } from './lib/harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = {
  JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox',
  PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef',
  CARRIER_WEBHOOK_SECRET: 'carrier-secret-0123456789ab'
};
const ADDR = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };
const PCCC = 'P123456789012';

async function boot(env = {}) {
  const g = await createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, one, login };
}

async function checkoutWithPccc(g, token, items) {
  const r = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token, body: { ...ADDR, pccc: PCCC, items }
  });
  assert.equal(r.status, 201, `checkout: ${r.text}`);
  return r.json.order_id;
}

const t = createRunner('Customs invoice exporter (5-7)');

function gatewaySourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && p.endsWith('.js')) out.push(p);
    }
  };
  walk(path.join(ROOT, 'apps/cloudflare-gateway/src'));
  return out;
}

await t.test('5-7 gate: gateway code carries zero business-number fixed strings', async () => {
  const hits = [];
  for (const f of gatewaySourceFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    const m = src.match(/[0-9]{3}-[0-9]{2}-[0-9]{5}/g);
    if (m) hits.push(`${path.relative(ROOT, f)}: ${m.join(',')}`);
  }
  assert.deepEqual(hits, [], `business-number literals must not exist in gateway code: ${hits.join('; ')}`);
});

await t.test('5-7 gate: invoice route carries no invented exporter/weight/seller/carrier defaults', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/cloudflare-gateway/src/routes/global-customs-fx.js'), 'utf8');
  for (const banned of [
    '120-88-01928', 'Incheon Free Trade', 'customs-ops@olmoa.com',
    'OLMOA Official Partner', 'CUSTOMS_EXPRESS', '|| 0.5',
    'Global Cross-Border Fulfillment Hub'
  ]) {
    assert.ok(!src.includes(banned), `invoice source must not contain: ${banned}`);
  }
});

await t.test('5-7 order without an operator is rejected with EXPORTER_NOT_CONFIGURED 409', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const custId = g.one("SELECT id FROM users WHERE email = 'customer@example.com'").id;
  g.db.prepare(`INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount,
      total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone,
      shipping_address_line1, shipping_address_line2, shipping_postal_code, pccc)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('ord_57noent', 'ORD-57NOENT', custId, 10000, 0, 0, 10000, 'READY',
      ADDR.recipient_name, ADDR.recipient_phone, ADDR.shipping_address_line1, '', ADDR.shipping_postal_code, PCCC);
  g.db.prepare(`INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee,
      goods_amount, discount_amount, total_amount, status) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run('sub_57noent', 'ord_57noent', 'SUB-57NOENT', 'pt_001', 0, 10000, 0, 10000, 'PAYMENT_CONFIRMED');
  const r = await g.call('/api/v1/orders/ord_57noent/commercial-invoice', { token: cust });
  assert.equal(r.status, 409, `expected 409, got: ${r.text}`);
  assert.equal(r.json.success, false);
  assert.equal(r.json.code, 'EXPORTER_NOT_CONFIGURED', `code: ${r.text}`);
  assert.ok(typeof r.json.error === 'string' && r.json.error.length > 0);
});

await t.test('5-7 configured operator: invoice exporter shows the entity values, nothing invented', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const sku = g.db.prepare("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get();
  const orderId = await checkoutWithPccc(g, cust, [{ sku_id: sku.id, quantity: 1 }]);
  const entity = g.one("SELECT * FROM business_entities WHERE id = 'be_dev_sole'");
  const r = await g.call(`/api/v1/orders/${orderId}/commercial-invoice`, { token: cust });
  assert.equal(r.status, 200, r.text);
  const exporter = r.json.data.exporter;
  assert.equal(exporter.company_name, entity.legal_name);
  assert.equal(exporter.business_number, entity.business_reg_number);
  assert.equal(exporter.address, entity.address);
  assert.equal(exporter.contact, entity.cs_email);
  const blob = JSON.stringify(r.json.data);
  for (const banned of ['120-88-01928', 'Incheon Free Trade', 'customs-ops@olmoa.com', 'Official Partner', 'CUSTOMS_EXPRESS']) {
    assert.ok(!blob.includes(banned), `invoice payload must not contain: ${banned}`);
  }
});

await t.test('5-7 operator switch: old order invoices the old entity, new order the new one', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const sku = g.db.prepare("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get();
  const oldOrderId = await checkoutWithPccc(g, cust, [{ sku_id: sku.id, quantity: 1 }]);
  const create = await g.call('/api/v1/admin/business-entities', {
    method: 'POST', token: adm,
    body: {
      entity_type: 'CORPORATION', legal_name: '주식회사 올모아(개발)', representative_name: '개발 대표',
      business_reg_number: '2208100016', corporate_reg_number: '110111-1234567',
      mail_order_reg_number: '제0000-법인-0001호', address: '서울특별시 (법인 개발 주소)',
      cs_phone: '02-1111-1111', cs_email: 'cs@corp.invalid',
      privacy_officer_name: '법인 책임자', privacy_officer_email: 'p@corp.invalid'
    }
  });
  assert.equal(create.status, 201, create.text);
  const corpId = create.json.data.id;
  const act = await g.call(`/api/v1/admin/business-entities/${corpId}/activate`, {
    method: 'POST', token: adm, body: { confirm_legal_review: true, note: '5-7 test switch' }
  });
  assert.equal(act.status, 200, act.text);
  const oldInv = await g.call(`/api/v1/orders/${oldOrderId}/commercial-invoice`, { token: cust });
  assert.equal(oldInv.status, 200, oldInv.text);
  assert.equal(oldInv.json.data.exporter.business_number, '220-81-00001', 'old order keeps the old operator');
  assert.equal(oldInv.json.data.exporter.company_name, '올모아 (개발용 가상 개인사업자)');
  const newOrderId = await checkoutWithPccc(g, cust, [{ sku_id: sku.id, quantity: 1 }]);
  const newInv = await g.call(`/api/v1/orders/${newOrderId}/commercial-invoice`, { token: cust });
  assert.equal(newInv.status, 200, newInv.text);
  assert.equal(newInv.json.data.exporter.business_number, '220-81-00016', 'new order uses the new operator');
  assert.equal(newInv.json.data.exporter.company_name, '주식회사 올모아(개발)');
});

await t.test('5-7 absent weight/seller/carrier stay empty; header counts weightless items', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const skuA = g.db.prepare("SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.id = 'prod_001' AND s.stock_quantity > 5 LIMIT 1").get();
  const skuB = g.db.prepare("SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.id = 'prod_003' AND s.stock_quantity > 5 LIMIT 1").get();
  g.db.prepare('UPDATE products SET package_weight_kg = NULL WHERE id = ?').run(skuB.product_id);
  const weighed = g.one('SELECT package_weight_kg w FROM products WHERE id = ?', skuA.product_id).w;
  assert.ok(Number(weighed) > 0, 'fixture: prod_001 keeps a real weight');
  const orderId = await checkoutWithPccc(g, cust, [{ sku_id: skuA.id, quantity: 1 }, { sku_id: skuB.id, quantity: 1 }]);
  const r = await g.call(`/api/v1/orders/${orderId}/commercial-invoice`, { token: cust });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.line_items.length, 2);
  const bySku = Object.fromEntries(r.json.data.line_items.map((it) => [it.sku_id, it]));
  assert.equal(bySku[skuA.id].net_weight_kg, weighed, 'entered weight is shown as entered');
  assert.equal(bySku[skuB.id].net_weight_kg, null, 'missing weight stays empty, not 0.5');
  assert.equal(r.json.data.summary.missing_weight_count, 1);
  assert.equal(r.json.data.summary.missing_weight_note, '중량 미입력 품목 1개');
  for (const it of r.json.data.line_items) {
    assert.equal(it.carrier_code, null, 'no carrier before shipment: empty, not CUSTOMS_EXPRESS');
    assert.ok(it.seller_name && !String(it.seller_name).includes('Official Partner'), `real seller name: ${it.seller_name}`);
  }
});

t.finish();
