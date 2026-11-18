// tests/journey_admin_test.mjs
// Operator journey: confirm -> settlement -> payout -> transfer, manual
// refund/delivery, reconciliation over journey data, permission wiring.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { requiredPermission, hasPermission } from '../apps/cloudflare-gateway/src/lib/admin-policy.js';

const t = createRunner('Operator journey (confirm -> settle -> pay -> audit)');

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

async function setupOrder(g) {
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pid = g.db.prepare('SELECT p.id AS id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = ?').get('seller@temu-supply.com').id;
  g.db.prepare('UPDATE partners SET sales_model = ? WHERE id = ?').run('MARKETPLACE', pid);
  const tpl = (await g.call('/api/v1/partner/shipping-policies', {
    method: 'POST', token: pt, body: { name: 'std', method: 'PARCEL', fee_type: 'PAID', base_fee: 3000, is_default: true }
  })).json.data;
  const reg = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: {
      title: 'Journey Chair', description_html: '<p>oak chair</p>', category_id: 'cat_e_audio',
      thumbnail_url: 'https://example.com/c.png', shipping_policy_id: tpl.id,
      sale_price: 40000, original_price: 50000, stock_quantity: 10
    }
  });
  assert.equal(reg.status, 201, reg.text);
  await g.call(`/api/v1/admin/products/${reg.json.product_id}/review`, { method: 'POST', token: adm, body: { decision: 'APPROVE' } });
  const sku = g.db.prepare('SELECT id FROM product_skus WHERE product_id = ?').get(reg.json.product_id).id;
  return { pt, adm, pid, sku, prod: reg.json.product_id };
}

async function paidOrder(g, cust, sku) {
  const o = (await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: sku, quantity: 1 }] } })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o)}`);
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount }
  });
  assert.equal(pay.status, 200, pay.text);
  return o;
}

async function shipAndDeliver(g, s, orderId) {
  const subId = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(orderId).id;
  await g.call(`/api/v1/partner/orders/${subId}/prepare`, { method: 'POST', token: s.pt });
  const sh = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.pt, body: { carrier: 'CJ대한통운', tracking_number: 'AJ1234567890' } });
  assert.equal(sh.status, 200, sh.text);
  await g.call(`/api/v1/orders/${orderId}/advance-tracking`, { method: 'POST', token: s.adm });
  await g.call(`/api/v1/orders/${orderId}/advance-tracking`, { method: 'POST', token: s.adm });
  return subId;
}

await t.test('AJ1. purchase confirm rewards 1% and frees the settlement', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const me = g.db.prepare("SELECT id FROM users WHERE email = 'customer@example.com'").get().id;
  const o = await paidOrder(g, cust, s.sku);
  const early = await g.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: cust });
  assert.equal(early.json.code, 'NOT_DELIVERED', 'pre-delivery refused');
  const subId = await shipAndDeliver(g, s, o.order_id);
  const c = await g.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: cust });
  assert.equal(c.status, 200, c.text);
  assert.equal(c.json.confirmed_sub_orders, 1, 'one confirmed');
  assert.equal(c.json.reward_credit, 400, '1% of 40000 pg');
  assert.equal(g.db.prepare('SELECT status FROM sub_orders WHERE id = ?').get(subId).status, 'PURCHASE_CONFIRMED', 'sub confirmed');
  assert.equal(g.db.prepare('SELECT status FROM settlements WHERE sub_order_id = ?').get(subId).status, 'ELIGIBLE_FOR_PAYOUT', 'settlement freed');
  const rw = g.db.prepare("SELECT amount_delta FROM user_credits WHERE user_id = ? AND reason = '구매확정 1% 적립'").get(me);
  assert.equal(rw.amount_delta, 400, 'reward ledgered');
});

await t.test('AJ2. auto-confirm cron sweeps week-old deliveries without reward', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await paidOrder(g, cust, s.sku);
  const subId = await shipAndDeliver(g, s, o.order_id);
  g.db.prepare("UPDATE sub_orders SET delivered_at = datetime('now', '-8 days') WHERE id = ?").run(subId);
  const cron = await g.call('/api/v1/orders/cron/auto-confirm', { method: 'POST', token: s.adm });
  assert.equal(cron.status, 200, cron.text);
  assert.ok(cron.json.confirmed_count >= 1, 'swept');
  assert.equal(g.db.prepare('SELECT status FROM sub_orders WHERE id = ?').get(subId).status, 'PURCHASE_CONFIRMED', 'auto confirmed');
});

await t.test('AJ3. payout consumes the pending preview exactly once', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await paidOrder(g, cust, s.sku);
  await shipAndDeliver(g, s, o.order_id);
  await g.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: cust });
  const before = await g.call('/api/v1/admin/finance/payouts', { token: s.adm });
  const row = before.json.data.pending.find((x) => x.partner_id === s.pid);
  assert.ok(row, 'seller pending');
  assert.ok(row.amount > 0, 'positive payout');
  assert.ok(row.settlements >= 1, 'settlement counted');
  const mk = await g.call('/api/v1/admin/finance/payouts', { method: 'POST', token: s.adm, body: { partner_id: s.pid } });
  assert.equal(mk.status, 201, mk.text);
  assert.equal(mk.json.data.amount, row.amount, 'payout equals preview');
  const after = await g.call('/api/v1/admin/finance/payouts', { token: s.adm });
  assert.ok(!after.json.data.pending.find((x) => x.partner_id === s.pid), 'pending consumed');
  assert.ok(after.json.data.payouts.find((x) => x.id === mk.json.data.payout_id), 'payout listed');
});

await t.test('AJ4. transfer records the bank reference once', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await paidOrder(g, cust, s.sku);
  await shipAndDeliver(g, s, o.order_id);
  await g.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: cust });
  const mk = await g.call('/api/v1/admin/finance/payouts', { method: 'POST', token: s.adm, body: { partner_id: s.pid } });
  assert.equal(mk.status, 201, mk.text);
  const pid = mk.json.data.payout_id;
  const noRef = await g.call(`/api/v1/admin/finance/payouts/${pid}/transferred`, { method: 'POST', token: s.adm, body: {} });
  assert.equal(noRef.status, 400, 'reference required');
  const tr = await g.call(`/api/v1/admin/finance/payouts/${pid}/transferred`, { method: 'POST', token: s.adm, body: { bank_transfer_ref: 'WOORI-2026-0001' } });
  assert.equal(tr.status, 200, tr.text);
  assert.equal(g.db.prepare('SELECT status, bank_transfer_ref FROM payouts WHERE id = ?').get(pid).status, 'TRANSFERRED', 'transferred');
  const again = await g.call(`/api/v1/admin/finance/payouts/${pid}/transferred`, { method: 'POST', token: s.adm, body: { bank_transfer_ref: 'WOORI-2026-0002' } });
  assert.equal(again.json.code, 'PAYOUT_NOT_APPROVED', 'single transfer');
});

await t.test('AJ5. manual refund needs lines and a reason, then journals', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await paidOrder(g, cust, s.sku);
  const item = g.db.prepare('SELECT id FROM order_items WHERE sub_order_id = (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(o.order_id).id;
  const empty = await g.call(`/api/v1/admin/orders/${o.order_id}/refund`, { method: 'POST', token: s.adm, body: { reason: 'x' } });
  assert.equal(empty.json.code, 'NOTHING_TO_REFUND', 'lines required');
  const noReason = await g.call(`/api/v1/admin/orders/${o.order_id}/refund`, { method: 'POST', token: s.adm, body: { lines: [{ order_item_id: item, quantity: 1 }] } });
  assert.equal(noReason.status, 400, 'reason required');
  const rf = await g.call(`/api/v1/admin/orders/${o.order_id}/refund`, {
    method: 'POST', token: s.adm, body: { reason: 'seller fault reship', lines: [{ order_item_id: item, quantity: 1 }] }
  });
  assert.equal(rf.status, 200, rf.text);
  const aud = g.db.prepare("SELECT * FROM admin_audit_log WHERE action = 'MANUAL_REFUND' AND target_id = ?").get(o.order_id);
  assert.ok(aud, 'manual refund audited');
});

await t.test('AJ6. manual delivered needs evidence and a shipped sub-order', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await paidOrder(g, cust, s.sku);
  const subId = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o.order_id).id;
  const early = await g.call(`/api/v1/admin/sub-orders/${subId}/delivered`, { method: 'POST', token: s.adm, body: { evidence: 'CJ 123' } });
  assert.equal(early.json.code, 'NOT_IN_TRANSIT', 'pre-ship refused');
  await g.call(`/api/v1/partner/orders/${subId}/prepare`, { method: 'POST', token: s.pt });
  await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.pt, body: { carrier: 'CJ대한통운', tracking_number: 'AJD123456789' } });
  const noEv = await g.call(`/api/v1/admin/sub-orders/${subId}/delivered`, { method: 'POST', token: s.adm, body: {} });
  assert.equal(noEv.status, 400, 'evidence required');
  const ok = await g.call(`/api/v1/admin/sub-orders/${subId}/delivered`, { method: 'POST', token: s.adm, body: { evidence: 'CJ tracking shows delivered 11-18' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(g.db.prepare('SELECT status FROM sub_orders WHERE id = ?').get(subId).status, 'DELIVERED', 'delivered');
});

await t.test('AJ7. reconciliation stays green over the full journey', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const base = await g.call('/api/v1/admin/reconciliation', { token: s.adm });
  assert.equal(base.status, 200, base.text);
  const baseFailed = new Set((base.json.data.checks || []).filter((c) => !c.ok).map((c) => c.id));
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await paidOrder(g, cust, s.sku);
  await shipAndDeliver(g, s, o.order_id);
  await g.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: cust });
  await g.call('/api/v1/admin/finance/payouts', { method: 'POST', token: s.adm, body: { partner_id: s.pid } });
  const after = await g.call('/api/v1/admin/reconciliation', { token: s.adm });
  const afterFailed = (after.json.data.checks || []).filter((c) => !c.ok);
  const fresh = afterFailed.filter((c) => !baseFailed.has(c.id));
  assert.equal(fresh.length, 0, `no new violations (fresh: ${JSON.stringify(fresh).slice(0, 300)})`);
  assert.equal(after.json.data.ok, true, 'reconciliation green');
});

await t.test('AJ8. ship-badge routes map to partner-ops permissions', async () => {
  assert.equal(requiredPermission('GET', '/api/v1/admin/ship-badges/sellers'), 'partners.read', 'board read');
  assert.equal(requiredPermission('PUT', '/api/v1/admin/partners/pt_1/shipping-cutoff'), 'partners.manage', 'cutoff write');
  assert.ok(hasPermission('OPERATIONS', 'partners.manage'), 'ops manages');
  assert.ok(!hasPermission('CS', 'partners.read'), 'cs excluded');
  assert.ok(hasPermission('SUPER_ADMIN', 'super'), 'super passes');
  assert.equal(requiredPermission('GET', '/api/v1/products'), null, 'public stays public');
});

await t.test('AJ9. sales report reflects journey GMV and guards periods', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await paidOrder(g, cust, s.sku);
  const r = await g.call('/api/v1/admin/finance/sales-report?group_by=partner', { token: s.adm });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.data.totals.orders >= 1, 'order counted');
  assert.ok(r.json.data.totals.gmv >= o.total_pay_amount, 'gmv covers pay');
  const mine = r.json.data.series.find((x) => x.partner_id === s.pid);
  assert.ok(mine && mine.gmv >= o.total_pay_amount, 'seller row present');
  const bad = await g.call('/api/v1/admin/finance/sales-report?from=2026-13-40', { token: s.adm });
  assert.equal(bad.json.code, 'INVALID_PERIOD', 'bad period rejected');
  const wide = await g.call('/api/v1/admin/finance/sales-report?from=2020-01-01&to=2026-11-18', { token: s.adm });
  assert.equal(wide.json.code, 'PERIOD_TOO_WIDE', 'wide range rejected');
});

await t.test('AJ10. badge policy writes echo on the board and in history', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const put = await g.call('/api/v1/admin/platform-policies', {
    method: 'PUT', token: s.adm, body: { key: 'badge.today_ship_min_rate_bps', value: '9000', effective_from: todayKst }
  });
  assert.equal(put.status, 200, put.text);
  const board = await g.call('/api/v1/admin/ship-badges/sellers', { token: s.adm });
  assert.equal(board.json.policies.today_ship_min_rate_bps, '9000', 'board echoes');
  const aud = g.db.prepare("SELECT * FROM admin_audit_log WHERE action = 'POLICY_UPSERT' AND target_id = 'badge.today_ship_min_rate_bps'").get();
  assert.ok(aud, 'creation audited');
  // F-J3-01: the history trigger fires on UPDATE only, so first registration
  // has no history row (traceable via audit). A same-day change does.
  const put2 = await g.call('/api/v1/admin/platform-policies', {
    method: 'PUT', token: s.adm, body: { key: 'badge.today_ship_min_rate_bps', value: '9500', effective_from: todayKst }
  });
  assert.equal(put2.status, 200, put2.text);
  const hist = await g.call('/api/v1/admin/platform-policies/history?key=badge.today_ship_min_rate_bps', { token: s.adm });
  const row = hist.json.data.find((h) => h.new_value === '9500');
  assert.ok(row, 'history kept');
  assert.equal(row.old_value, '9000', 'old value kept');
});

await t.test('AJ11. journey leaves a complete audit trail', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await paidOrder(g, cust, s.sku);
  const subId = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o.order_id).id;
  await g.call(`/api/v1/partner/orders/${subId}/prepare`, { method: 'POST', token: s.pt });
  await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'POST', token: s.pt, body: { carrier: 'CJ대한통운', tracking_number: 'AJA123456789' } });
  await g.call(`/api/v1/orders/${o.order_id}/advance-tracking`, { method: 'POST', token: s.adm });
  await g.call(`/api/v1/orders/${o.order_id}/advance-tracking`, { method: 'POST', token: s.adm });
  await g.call(`/api/v1/orders/${o.order_id}/confirm`, { method: 'POST', token: cust });
  const mk = await g.call('/api/v1/admin/finance/payouts', { method: 'POST', token: s.adm, body: { partner_id: s.pid } });
  const tr = await g.call(`/api/v1/admin/finance/payouts/${mk.json.data.payout_id}/transferred`, { method: 'POST', token: s.adm, body: { bank_transfer_ref: 'REF-AJ11' } });
  assert.equal(tr.status, 200, tr.text);
  for (const a of ['PRODUCT_REVIEW', 'PAYOUT_TRANSFERRED']) {
    const row = g.db.prepare('SELECT id FROM admin_audit_log WHERE action = ?').get(a);
    assert.ok(row, `${a} audited`);
  }
});

await t.test('AJ12. operator order list and detail expose the journey', async () => {
  const g = await newGateway();
  const s = await setupOrder(g);
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = await paidOrder(g, cust, s.sku);
  const list = await g.call('/api/v1/admin/orders?per_page=5', { token: s.adm });
  assert.equal(list.status, 200, list.text);
  assert.ok(list.json.data.find((x) => x.id === o.order_id || x.order_no === o.order_no), 'order listed');
  const detail = await g.call(`/api/v1/admin/orders/${o.order_id}`, { token: s.adm });
  assert.equal(detail.status, 200, detail.text);
});

t.finish();
