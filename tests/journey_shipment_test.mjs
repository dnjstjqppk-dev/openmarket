// tests/journey_shipment_test.mjs
// Fulfilment journey: prepare -> ship (carrier+tracking) -> customer tracking
// -> delivered -> confirm. Tracking numbers, states and ownership matrixed.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Fulfilment journey (ship -> track -> deliver)');

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
const addr = {
  recipient_name: '홍길동', recipient_phone: '010-1234-5678',
  shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236'
};

async function setupShop(g) {
  const ptA = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const ptB = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pidA = g.db.prepare('SELECT p.id AS id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = ?').get('seller@temu-supply.com').id;
  g.db.prepare('UPDATE partners SET sales_model = ? WHERE id = ?').run('MARKETPLACE', pidA);
  const tpl = (await g.call('/api/v1/partner/shipping-policies', {
    method: 'POST', token: ptA, body: { name: 'std', method: 'PARCEL', fee_type: 'PAID', base_fee: 3000, is_default: true }
  })).json.data;
  const reg = await g.call('/api/v1/partner/products', {
    method: 'POST', token: ptA,
    body: {
      title: 'Journey Desk', description_html: '<p>oak desk</p>', category_id: 'cat_e_audio',
      thumbnail_url: 'https://example.com/d.png', shipping_policy_id: tpl.id,
      sale_price: 60000, original_price: 80000, stock_quantity: 100
    }
  });
  assert.equal(reg.status, 201, reg.text);
  await g.call(`/api/v1/admin/products/${reg.json.product_id}/review`, { method: 'POST', token: adm, body: { decision: 'APPROVE' } });
  const sku = g.db.prepare('SELECT id FROM product_skus WHERE product_id = ?').get(reg.json.product_id).id;
  return { ptA, ptB, adm, pidA, sku, prod: reg.json.product_id };
}

async function paidSub(g, cust, sku) {
  const o = (await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: sku, quantity: 1 }] } })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o)}`);
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount }
  });
  assert.equal(pay.status, 200, pay.text);
  const subId = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o.order_id).id;
  return { orderId: o.order_id, subId };
}

await t.test('SJ1. full path ships, tracks, delivers and opens review', async () => {
  const g = await newGateway();
  const s = await setupShop(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const { orderId, subId } = await paidSub(g, cust, s.sku);
  const pre = await g.call(`/api/v1/orders/${orderId}/tracking`, { token: cust });
  assert.equal(pre.json.tracking[0].tracking_number, null, 'no tracking before ship');
  assert.equal(pre.json.tracking[0].events.length, 0, 'no events before ship');
  assert.equal(pre.json.carrier_api, 'NOT_INTEGRATED', 'no live carrier feed');
  const prep = await g.call(`/api/v1/partner/orders/${subId}/prepare`, { method: 'POST', token: s.ptA });
  assert.equal(prep.json.status, 'PREPARING', 'confirmed');
  const sh = await g.call(`/api/v1/partner/orders/${subId}/shipment`, {
    method: 'POST', token: s.ptA, body: { carrier: '한진택배', tracking_number: 'HJ-9876543210' }
  });
  assert.equal(sh.status, 200, sh.text);
  assert.equal(sh.json.status, 'SHIPPED', 'shipped');
  const row = g.db.prepare('SELECT status, carrier_code, tracking_number, shipped_at FROM sub_orders WHERE id = ?').get(subId);
  assert.equal(row.carrier_code, '한진택배', 'carrier stored');
  assert.equal(row.tracking_number, 'HJ-9876543210', 'tracking stored');
  assert.ok(row.shipped_at, 'shipped_at stamped');
  const tr = await g.call(`/api/v1/orders/${orderId}/tracking`, { token: cust });
  assert.equal(tr.json.tracking[0].tracking_number, 'HJ-9876543210', 'buyer sees tracking');
  assert.ok(tr.json.tracking[0].events.find((e) => e.stage_code === 'SHIPPED' && e.stage_name === '판매자 출고'), 'ship event logged');
  await g.call(`/api/v1/orders/${orderId}/advance-tracking`, { method: 'POST', token: s.adm });
  await g.call(`/api/v1/orders/${orderId}/advance-tracking`, { method: 'POST', token: s.adm });
  const tr2 = await g.call(`/api/v1/orders/${orderId}/tracking`, { token: cust });
  assert.equal(tr2.json.tracking[0].status, 'DELIVERED', 'buyer sees delivery');
  assert.ok(tr2.json.tracking[0].delivered_at, 'delivered_at shown');
  const cf = await g.call(`/api/v1/orders/${orderId}/confirm`, { method: 'POST', token: cust });
  assert.equal(cf.status, 200, cf.text);
  const rv = await g.call('/api/v1/me/reviewable', { token: cust });
  assert.ok(JSON.stringify(rv.json).includes(s.prod), 'confirmed line reviewable');
});

await t.test('SJ2. tracking numbers accept 6-40 alnum-dash only', async () => {
  const g = await newGateway();
  const s = await setupShop(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const good = ['ABC123', 'a-b-c-1-2-3-4', 'x'.repeat(40)];
  for (const tn of good) {
    const { subId } = await paidSub(g, cust, s.sku);
    const r = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.ptA, body: { carrier: 'CJ대한통운', tracking_number: tn } });
    assert.equal(r.status, 200, `accepts ${tn.slice(0, 12)}`);
  }
  const bad = ['short', 'has space', '한글123456', 'a!b@c#d$', 'x'.repeat(41), ''];
  for (const tn of bad) {
    const { subId } = await paidSub(g, cust, s.sku);
    const r = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.ptA, body: { carrier: 'CJ대한통운', tracking_number: tn } });
    assert.equal(r.status, 400, `rejects ${JSON.stringify(tn).slice(0, 16)}`);
    assert.equal(r.json.code, 'INVALID_TRACKING', 'code');
  }
});

await t.test('SJ3. only pre-shipment states ship', async () => {
  const g = await newGateway();
  const s = await setupShop(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const matrix = [
    ['PAYMENT_CONFIRMED', true], ['PREPARING', true],
    ['SHIPPED', false], ['IN_TRANSIT', false], ['DELIVERED', false],
    ['CANCELLED', false], ['RETURN_REQUESTED', false], ['PURCHASE_CONFIRMED', false]
  ];
  for (const [st, ok] of matrix) {
    const { subId } = await paidSub(g, cust, s.sku);
    g.db.prepare('UPDATE sub_orders SET status = ? WHERE id = ?').run(st, subId);
    const r = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.ptA, body: { carrier: 'CJ대한통운', tracking_number: 'ST1234567890' } });
    assert.equal(r.status, ok ? 200 : 409, `${st} -> ${ok ? 'ships' : 'refused'}`);
    if (!ok) assert.equal(r.json.code, 'NOT_SHIPPABLE', 'code');
  }
});

await t.test('SJ4. shipment guards carrier, ownership and existence', async () => {
  const g = await newGateway();
  const s = await setupShop(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const { subId } = await paidSub(g, cust, s.sku);
  const noCarrier = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.ptA, body: { tracking_number: 'CJ1234567890' } });
  assert.equal(noCarrier.status, 400, 'carrier required');
  const stranger = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.ptB, body: { carrier: 'CJ대한통운', tracking_number: 'CJ1234567890' } });
  assert.equal(stranger.status, 409, 'other seller refused');
  assert.equal(stranger.json.code, 'NOT_SHIPPABLE', 'code');
  const ghost = await g.call('/api/v1/partner/orders/so_missing/shipment', { method: 'POST', token: s.ptA, body: { carrier: 'CJ대한통운', tracking_number: 'CJ1234567890' } });
  assert.equal(ghost.status, 409, 'unknown sub refused as unshippable');
});

await t.test('SJ5. bulk shipment reports per-item wins and losses', async () => {
  const g = await newGateway();
  const s = await setupShop(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const a = await paidSub(g, cust, s.sku);
  const b = await paidSub(g, cust, s.sku);
  const r = await g.call('/api/v1/partner/orders/bulk-shipment', {
    method: 'POST', token: s.ptA,
    body: { shipments: [
      { sub_order_id: a.subId, carrier: 'CJ대한통운', tracking_number: 'BULK00000001' },
      { sub_order_id: b.subId, carrier: 'CJ대한통운', tracking_number: 'bad' },
      { sub_order_id: 'so_missing', carrier: 'CJ대한통운', tracking_number: 'BULK00000003' },
      { sub_order_id: a.subId, tracking_number: 'BULK00000004' }
    ] }
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.updated_count, 1, 'one win');
  assert.equal(r.json.failed_count, 3, 'three losses');
  assert.equal(r.json.results[0].ok, true, 'first wins');
  assert.equal(r.json.results[3].error.includes('택배사') || r.json.results[3].ok, true, 'carrier loss explained');
  const empty = await g.call('/api/v1/partner/orders/bulk-shipment', { method: 'POST', token: s.ptA, body: { shipments: [] } });
  assert.equal(empty.json.code, 'EMPTY', 'empty list rejected');
});

await t.test('SJ6. delay notice extends, notifies and bounds dates', async () => {
  const g = await newGateway();
  const s = await setupShop(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const me = g.db.prepare("SELECT id FROM users WHERE email = 'customer@example.com'").get().id;
  const { orderId, subId } = await paidSub(g, cust, s.sku);
  const base = new Date().toISOString().slice(0, 10);
  const plus5 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const ok = await g.call(`/api/v1/partner/orders/${subId}/delay-notice`, {
    method: 'POST', token: s.ptA, body: { reason: '입고 지연', new_ship_by: plus5 }
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.ship_by_deadline, plus5, 'deadline extended');
  const ntf = g.db.prepare("SELECT * FROM notifications WHERE user_id = ? AND title = '발송 지연 안내'").get(me);
  assert.ok(ntf && ntf.message.includes(plus5), 'buyer notified');
  const same = await g.call(`/api/v1/partner/orders/${subId}/delay-notice`, {
    method: 'POST', token: s.ptA, body: { reason: 'x', new_ship_by: base }
  });
  assert.equal(same.json.code, 'DATE_NOT_LATER', 'earlier date refused');
  const far = await g.call(`/api/v1/partner/orders/${subId}/delay-notice`, {
    method: 'POST', token: s.ptA, body: { reason: 'x', new_ship_by: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) }
  });
  assert.equal(far.json.code, 'DATE_TOO_FAR', 'far date refused');
  const fmt = await g.call(`/api/v1/partner/orders/${subId}/delay-notice`, {
    method: 'POST', token: s.ptA, body: { reason: 'x', new_ship_by: '11-30' }
  });
  assert.equal(fmt.json.code, 'INVALID_DATE', 'bad format refused');
  await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.ptA, body: { carrier: 'CJ대한통운', tracking_number: 'DL1234567890' } });
  const late = await g.call(`/api/v1/partner/orders/${subId}/delay-notice`, {
    method: 'POST', token: s.ptA, body: { reason: 'x', new_ship_by: plus5 }
  });
  assert.equal(late.json.code, 'NOT_DELAYABLE', 'post-ship refused');
  void orderId;
});

await t.test('SJ7. recipient text stays masked without a logged reason', async () => {
  const g = await newGateway();
  const s = await setupShop(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const { subId } = await paidSub(g, cust, s.sku);
  const list = await g.call('/api/v1/partner/orders', { token: s.ptA });
  const row = list.json.data.find((x) => x.sub_order_id === subId || x.id === subId);
  assert.ok(row, 'order listed');
  assert.ok(!String(row.recipient_phone || '').includes('1234'), 'phone masked in list');
  const noReason = await g.call(`/api/v1/partner/orders/${subId}/contact`, { token: s.ptA });
  assert.equal(noReason.json.code, 'REASON_REQUIRED', 'reason required');
  const full = await g.call(`/api/v1/partner/orders/${subId}/contact?reason=${encodeURIComponent('송장 출력')}`, { token: s.ptA });
  assert.equal(full.status, 200, full.text);
  assert.ok(String(full.json.data.recipient_phone).includes('1234'), 'full text with reason');
});

await t.test('SJ8. prepare confirms once from payment-confirmed only', async () => {
  const g = await newGateway();
  const s = await setupShop(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const { subId } = await paidSub(g, cust, s.sku);
  const stranger = await g.call(`/api/v1/partner/orders/${subId}/prepare`, { method: 'POST', token: s.ptB });
  assert.equal(stranger.json.code, 'NOT_CONFIRMABLE', 'other seller refused');
  const ok = await g.call(`/api/v1/partner/orders/${subId}/prepare`, { method: 'POST', token: s.ptA });
  assert.equal(ok.json.status, 'PREPARING', 'confirmed');
  const again = await g.call(`/api/v1/partner/orders/${subId}/prepare`, { method: 'POST', token: s.ptA });
  assert.equal(again.json.code, 'NOT_CONFIRMABLE', 'repeat refused');
});

t.finish();
