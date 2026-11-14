// tests/api_checkout_options_test.mjs
// Work order 3-6: scheduled delivery date + memo screen on checkout.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Checkout options (3-6)');

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
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

await t.test('O1. scheduled date persists inside its window', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'customer@example.com', password: PW, role: 'CUSTOMER' }
  });
  const cust = login.json.token;
  const body = {
    recipient_name: '홍길동', recipient_phone: '010-1234-5678',
    shipping_address_line1: '서울 강남구', shipping_postal_code: '06236',
    items: [{ sku_id: 'sku_001_w', quantity: 1 }],
    requested_delivery_date: day(7)
  };
  const r = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.data.requested_delivery_date, day(7), 'date echoed');
  assert.equal(g.db.prepare('SELECT requested_delivery_date d FROM orders WHERE id = ?').get(r.json.data.order_id).d, day(7), 'date stored');
  for (const [label, date] of [['today', day(0)], ['past', day(-1)], ['too far', day(31)], ['garbage', 'next-friday']]) {
    const bad = await g.call('/api/v1/orders/checkout', {
      method: 'POST', token: cust, body: { ...body, requested_delivery_date: date }
    });
    assert.equal(bad.status, 400, `${label} refused`);
  }
  const plain = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...body, requested_delivery_date: undefined }
  });
  assert.equal(plain.status, 201, plain.text);
  assert.equal(plain.json.data.requested_delivery_date, null, 'omitted stays null');
});

await t.test('O2. abusive memos are refused without touching stock', async () => {
  const g = await newGateway();
  const login = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'customer@example.com', password: PW, role: 'CUSTOMER' }
  });
  const cust = login.json.token;
  const stockBefore = g.db.prepare("SELECT stock_quantity FROM product_skus WHERE id = 'sku_001_w'").get().stock_quantity;
  const r = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: {
      recipient_name: '홍길동', recipient_phone: '010-1234-5678',
      shipping_address_line1: '서울 강남구', shipping_postal_code: '06236',
      items: [{ sku_id: 'sku_001_w', quantity: 1 }],
      shipping_memo: '문 앞에 시발 놔주세요'
    }
  });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'MEMO_FORBIDDEN', 'memo code named');
  assert.equal(g.db.prepare("SELECT stock_quantity FROM product_skus WHERE id = 'sku_001_w'").get().stock_quantity, stockBefore, 'no stock moved');
  const ok = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: {
      recipient_name: '홍길동', recipient_phone: '010-1234-5678',
      shipping_address_line1: '서울 강남구', shipping_postal_code: '06236',
      items: [{ sku_id: 'sku_001_w', quantity: 1 }],
      shipping_memo: '문 앞에 놓아 주세요. 010-9999-8888로 연락주세요'
    }
  });
  assert.equal(ok.status, 201, ok.text);
});

t.finish();
