// tests/p2_wave_e_test.mjs
// P2 Wave E suite: FDS checkout enforcement + high-value protection, cash-receipt
// loop completion, sales reports, supplier purchase journals.
// Run: node tests/p2_wave_e_test.mjs   (requires: node scripts/gen-dev-seed.mjs once)

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = {
  JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox',
  PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef',
  CARRIER_WEBHOOK_SECRET: 'carrier-secret-0123456789ab'
};
const ADDR = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };

async function boot(env = {}) {
  const g = await createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const all = (sql, ...p) => g.db.prepare(sql).all(...p).map((r) => ({ ...r }));
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, one, all, login };
}

const t = createRunner('P2 Wave E (FDS, cash receipts, sales, purchase)');

// ---------- FDS checkout enforcement ----------
await t.test('FDS wash trading: seller CS phone as recipient blocks checkout', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const sku = g.one("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 5 LIMIT 1");
  const r = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust,
    body: { ...ADDR, recipient_phone: '031-900-1234', items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'FDS_BLOCKED');
  assert.ok((r.json.triggered_rules || []).includes('WASH_TRADING_GUARD'));
  assert.equal(g.one('SELECT COUNT(*) c FROM orders').c, 0, 'blocked checkout reserves nothing');
  assert.equal(g.one("SELECT COUNT(*) c FROM admin_audit_log WHERE action = 'FDS_BLOCK'").c, 1, 'block is audit-logged');
});

await t.test('FDS velocity: 3 failed payments in 10 minutes block the next checkout', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const sku = g.one("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 5 LIMIT 1");
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(co.status, 201, co.text);
  for (let i = 0; i < 3; i++) {
    const bad = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust,
      body: { order_id: co.json.order_id, payment_key: `badkey_000${i}`, amount: co.json.total_pay_amount } });
    assert.equal(bad.status, 402, `attempt ${i}: ${bad.text}`);
  }
  assert.equal(g.one("SELECT COUNT(*) c FROM payment_transactions WHERE status = 'FAILED'").c, 3, 'failures are logged');
  const r = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'FDS_BLOCKED');
  assert.ok((r.json.triggered_rules || []).includes('VELOCITY_CARD_TEST'));
});

await t.test('FDS geo: foreign first-time buyer is REVIEW; trusted traveler is ALLOW', async () => {
  const g = await boot();
  const sku = g.one("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 5 LIMIT 1");
  const reg = await g.call('/api/v1/auth/register', { method: 'POST', body: { email: 'traveler@example.com', password: 'TravelPass!2026#', full_name: '여행자', phone: '010-0000-0001', agree_terms: true, agree_privacy: true } });
  assert.equal(reg.status, 201, reg.text);
  const foreign = { 'CF-Connecting-IP': '203.0.113.9', 'CF-IPCountry': 'US' };
  const r1 = await g.call('/api/v1/orders/checkout', { method: 'POST', token: reg.json.token, headers: foreign, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(r1.status, 201, r1.text);
  assert.equal(g.one('SELECT fds_decision d, fds_score s FROM orders WHERE id = ?', r1.json.order_id).d, 'REVIEW');
  assert.ok(g.one('SELECT fds_rules_json j FROM orders WHERE id = ?', r1.json.order_id).j.includes('GEO_IP_MISMATCH'));
  // After one paid order the same foreign IP is trusted.
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: reg.json.token,
    body: { order_id: r1.json.order_id, payment_key: 'sandbox_geo_trusted1', amount: r1.json.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const r2 = await g.call('/api/v1/orders/checkout', { method: 'POST', token: reg.json.token, headers: foreign, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(r2.status, 201, r2.text);
  assert.equal(g.one('SELECT fds_decision d FROM orders WHERE id = ?', r2.json.order_id).d, 'ALLOW');
});

await t.test('FDS high value holds settlements until an operator clears the review', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const sku = g.one('SELECT id, sale_price FROM product_skus ORDER BY sale_price DESC LIMIT 1');
  const qty = Math.ceil(1600000 / (sku.sale_price * 0.85)); // qty>=10 takes 15% volume discount
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: qty }] } });
  assert.equal(co.status, 201, co.text);
  assert.ok(co.json.total_pay_amount >= 1500000, 'order actually crosses the threshold');
  assert.equal(g.one('SELECT fds_decision d FROM orders WHERE id = ?', co.json.order_id).d, 'REVIEW');
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust,
    body: { order_id: co.json.order_id, payment_key: 'sandbox_hv_hold0001', amount: co.json.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  assert.equal(g.one("SELECT COUNT(*) c FROM settlements st JOIN sub_orders s ON s.id = st.sub_order_id WHERE s.parent_order_id = ? AND st.status = 'HOLD'", co.json.order_id).c, 1, 'review order settlements stay HOLD');
  const q = await g.call('/api/v1/admin/fds/reviews', { token: adm });
  assert.equal(q.status, 200, q.text);
  assert.ok(q.json.data.some((x) => x.id === co.json.order_id), 'review queue lists the order');
  const clear = await g.call(`/api/v1/admin/fds/reviews/${co.json.order_id}/clear`, { method: 'POST', token: adm, body: { note: '유선 본인 확인 완료' } });
  assert.equal(clear.status, 200, clear.text);
  assert.equal(g.one("SELECT COUNT(*) c FROM settlements st JOIN sub_orders s ON s.id = st.sub_order_id WHERE s.parent_order_id = ? AND st.status = 'PENDING'", co.json.order_id).c, 1, 'clear releases HOLD to PENDING');
  assert.equal(g.one('SELECT fds_decision d FROM orders WHERE id = ?', co.json.order_id).d, 'CLEARED');
});

await t.test('FDS prohibited HS blocklist blocks and releases honestly', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const sku = g.one("SELECT s.id, p.hs_code FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 5 LIMIT 1");
  assert.ok(sku.hs_code, 'seed sku carries an HS code');
  const add = await g.call('/api/v1/admin/fds/prohibited-hs', { method: 'POST', token: adm, body: { code: sku.hs_code, reason: '수입금지 품목 지정' } });
  assert.equal(add.status, 201, add.text);
  const blocked = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(blocked.status, 403, blocked.text);
  assert.ok((blocked.json.triggered_rules || []).includes('PROHIBITED_HS_SCANNER'));
  const list = await g.call('/api/v1/admin/fds/prohibited-hs', { token: adm });
  assert.ok(list.json.data.some((x) => x.code === sku.hs_code));
  const del = await g.call(`/api/v1/admin/fds/prohibited-hs/${encodeURIComponent(sku.hs_code)}`, { method: 'DELETE', token: adm });
  assert.equal(del.status, 200, del.text);
  const ok = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(ok.status, 201, ok.text);
});

await t.test('FDS overview reports real counts and enforced status; buyers never see rules', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const sku = g.one("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 5 LIMIT 1");
  await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, recipient_phone: '031-900-1234', items: [{ sku_id: sku.id, quantity: 1 }] } });
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust,
    headers: { 'CF-IPCountry': 'JP' }, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(co.status, 201, co.text);
  const ov = await g.call('/api/v1/admin/fds/overview', { token: adm });
  assert.equal(ov.status, 200, ov.text);
  assert.equal(ov.json.data.status, 'ENFORCED_AT_CHECKOUT');
  assert.ok(ov.json.data.blocked_attempts_24h >= 1, 'block count is measured');
  assert.ok(ov.json.data.open_reviews >= 1, 'open review count is measured');
  assert.ok(ov.json.data.active_rules.every((r) => r.enforcement === 'ENFORCED_AT_CHECKOUT'));
  const detail = await g.call(`/api/v1/orders/${co.json.order_id}`, { token: cust });
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.data.fds_rules_json, undefined, 'rule detail never leaks to buyers');
  const adminDetail = await g.call('/api/v1/admin/orders?per_page=5', { token: adm });
  assert.ok(adminDetail.json.data.some((x) => x.id === co.json.order_id && (x.fds_rules_json || '').includes('GEO_IP_MISMATCH')), 'operators see the rules');
});

// ---------- Cash-receipt loop completion ----------
async function cashOrder(g, custId, total = 33000) {
  const id = `ord_cash_${Math.random().toString(36).slice(2, 9)}`;
  g.db.prepare(
    `INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code)
     VALUES (?, ?, ?, ?, 0, 0, ?, 'PAID', '홍길동', '010-1234-5678', '서울시 강남구 테헤란로 1', '101호', '06234')`
  ).run(id, `OLM-${id}`, custId, total, total);
  g.db.prepare("INSERT INTO payment_transactions (id, order_id, payment_key, provider, method, amount, status) VALUES (?, ?, ?, 'TOSS', '가상계좌', ?, 'DONE')")
    .run(`ptx_${id}`, id, `pk_${id}`, total);
  return id;
}

await t.test('Cash receipts: buyer lists own receipts and cancels a REQUESTED one', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const regOther = await g.call('/api/v1/auth/register', { method: 'POST', body: { email: 'other.buyer@example.com', password: 'OtherPass!2026#', full_name: '다른이', phone: '010-0000-0002', agree_terms: true, agree_privacy: true } });
  assert.equal(regOther.status, 201, regOther.text);
  const other = regOther.json.token;
  const custId = g.one("SELECT id FROM users WHERE email = 'customer@example.com'").id;
  const orderId = await cashOrder(g, custId);
  const body = { order_id: orderId, buyer_identifier: '010-1234-5678', identifier_type: 'PHONE' };
  const req = await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', token: cust, body });
  assert.equal(req.status, 201, req.text);
  const list = await g.call('/api/v1/finance/cash-receipts', { token: cust });
  assert.equal(list.status, 200, list.text);
  assert.equal(list.json.count, 1);
  assert.equal(list.json.data[0].buyer_identifier, '*******5678', 'identifier masked in list');
  const otherList = await g.call('/api/v1/finance/cash-receipts', { token: other });
  assert.equal(otherList.json.count, 0, 'no cross-account visibility');
  const cancel = await g.call(`/api/v1/finance/cash-receipts/${req.json.data.id}/cancel`, { method: 'POST', token: cust });
  assert.equal(cancel.status, 200, cancel.text);
  assert.equal(g.one('SELECT issue_status s FROM tax_invoices WHERE id = ?', req.json.data.id).s, 'CANCELLED');
  assert.equal((await g.call(`/api/v1/finance/cash-receipts/${req.json.data.id}/cancel`, { method: 'POST', token: cust })).status, 409);
});

await t.test('Cash receipts: refund voids receipts; issued ones need operator cancel-record', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const custId = g.one("SELECT id FROM users WHERE email = 'customer@example.com'").id;
  const sku = g.one("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 5 LIMIT 1");
  // Order A: REQUESTED receipt dies silently with the refund (nothing was issued).
  const a = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(a.status, 201, a.text);
  g.db.prepare("UPDATE payment_transactions SET method = '가상계좌' WHERE order_id = ?").run(a.json.order_id);
  const payA = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust,
    body: { order_id: a.json.order_id, payment_key: 'sandbox_cash_voidA01', amount: a.json.total_pay_amount } });
  assert.equal(payA.status, 200, payA.text);
  g.db.prepare("UPDATE payment_transactions SET method = '가상계좌' WHERE order_id = ? AND status = 'DONE'").run(a.json.order_id);
  const reqA = await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', token: cust,
    body: { order_id: a.json.order_id, buyer_identifier: '010-1234-5678', identifier_type: 'PHONE' } });
  assert.equal(reqA.status, 201, reqA.text);
  const cancelA = await g.call(`/api/v1/orders/${a.json.order_id}/cancel`, { method: 'POST', token: cust });
  assert.equal(cancelA.status, 200, cancelA.text);
  assert.equal(g.one('SELECT issue_status s FROM tax_invoices WHERE id = ?', reqA.json.data.id).s, 'CANCELLED');
  // Order B: ISSUED receipt becomes CANCEL_REQUIRED, closed by cancel-record.
  const b = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(b.status, 201, b.text);
  const payB = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust,
    body: { order_id: b.json.order_id, payment_key: 'sandbox_cash_voidB01', amount: b.json.total_pay_amount } });
  assert.equal(payB.status, 200, payB.text);
  g.db.prepare("UPDATE payment_transactions SET method = '가상계좌' WHERE order_id = ? AND status = 'DONE'").run(b.json.order_id);
  const reqB = await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', token: cust,
    body: { order_id: b.json.order_id, buyer_identifier: '010-1234-5678', identifier_type: 'PHONE' } });
  assert.equal(reqB.status, 201, reqB.text);
  const issueB = await g.call(`/api/v1/admin/finance/cash-receipts/${reqB.json.data.id}/issue`, { method: 'POST', token: adm, body: { hometax_approval_no: 'HTX000001' } });
  assert.equal(issueB.status, 200, issueB.text);
  const cancelB = await g.call(`/api/v1/orders/${b.json.order_id}/cancel`, { method: 'POST', token: cust });
  assert.equal(cancelB.status, 200, cancelB.text);
  assert.equal(g.one('SELECT issue_status s FROM tax_invoices WHERE id = ?', reqB.json.data.id).s, 'CANCEL_REQUIRED');
  const close = await g.call(`/api/v1/admin/finance/cash-receipts/${reqB.json.data.id}/cancel-record`, { method: 'POST', token: adm, body: { cancel_ref: 'PG-CANCEL-1' } });
  assert.equal(close.status, 200, close.text);
  assert.equal(g.one('SELECT issue_status s FROM tax_invoices WHERE id = ?', reqB.json.data.id).s, 'CANCELLED');
});

await t.test('Cash receipts: issue refuses refunded orders; re-request uses the net basis', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const custId = g.one("SELECT id FROM users WHERE email = 'customer@example.com'").id;
  const orderId = await cashOrder(g, custId, 33000);
  // A partial refund exists and the earlier request FAILED at the PG console.
  g.db.prepare('UPDATE orders SET payment_status = ?, refunded_pg_amount = 11000 WHERE id = ?').run('PARTIAL_REFUNDED', orderId);
  g.db.prepare("INSERT INTO refunds (id, order_id, operator_entity_id, reason_code, goods_amount, shipping_amount, coupon_reversal_amount, pg_amount, credit_amount, items_json, status, is_sandbox, idempotency_key, requested_by) VALUES ('rfd_cash_1', ?, NULL, 'PARTIAL', 11000, 0, 0, 11000, 0, '[]', 'DONE', 0, 'rfk_cash_1', ?)")
    .run(orderId, custId);
  g.db.prepare("INSERT INTO tax_invoices (id, invoice_type, order_id, buyer_identifier, identifier_type, supply_amount, vat_amount, total_amount, issue_status, item_title) VALUES ('txi_cash_fail', 'CASH_RECEIPT', ?, '01012345678', 'PHONE', 30000, 3000, 33000, 'FAILED', 't')")
    .run(orderId);
  g.db.prepare("INSERT INTO tax_invoices (id, invoice_type, order_id, buyer_identifier, identifier_type, supply_amount, vat_amount, total_amount, issue_status, item_title) VALUES ('txi_cash_req', 'CASH_RECEIPT', ?, '01012345678', 'PHONE', 30000, 3000, 33000, 'REQUESTED', 't')")
    .run(orderId);
  const issue = await g.call('/api/v1/admin/finance/cash-receipts/txi_cash_req/issue', { method: 'POST', token: adm, body: { hometax_approval_no: 'HTX000002' } });
  assert.equal(issue.status, 409, issue.text);
  assert.equal(issue.json.code, 'RECEIPT_NEEDS_REISSUE');
  // The buyer re-requests: the basis is net of the refund (22000), and the stale REQUESTED row is superseded.
  const re = await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', token: cust,
    body: { order_id: orderId, buyer_identifier: '010-1234-5678', identifier_type: 'PHONE' } });
  assert.equal(re.status, 201, re.text);
  assert.equal(re.json.data.total_amount, 22000);
  assert.equal(g.one("SELECT issue_status s FROM tax_invoices WHERE id = 'txi_cash_req'").s, 'CANCELLED');
  // Fully refunded orders cannot request at all.
  g.db.prepare("UPDATE orders SET payment_status = 'REFUNDED', refunded_pg_amount = 33000 WHERE id = ?").run(orderId);
  const gone = await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', token: cust,
    body: { order_id: orderId, buyer_identifier: '010-1234-5678', identifier_type: 'PHONE' } });
  assert.equal(gone.status, 400, gone.text);
  assert.equal(gone.json.code, 'ORDER_REFUNDED');
});

// ---------- Sales report ----------
async function paidOrder(g, token, skuId, qty, keySuffix) {
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token, body: { ...ADDR, items: [{ sku_id: skuId, quantity: qty }] } });
  assert.equal(co.status, 201, co.text);
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token,
    body: { order_id: co.json.order_id, payment_key: `sandbox_rep_${keySuffix}`, amount: co.json.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  return co.json;
}

await t.test('Sales report totals match journal truth; params validated', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const mp = g.one("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 5 LIMIT 1");
  const dr = g.one("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1");
  const o1 = await paidOrder(g, cust, mp.id, 1, '0000001');
  const o2 = await paidOrder(g, cust, dr.id, 2, '0000002');
  const today = new Date().toISOString().slice(0, 10);
  const r = await g.call(`/api/v1/admin/finance/sales-report?from=2026-01-01&to=${today}&group_by=day`, { token: adm });
  assert.equal(r.status, 200, r.text);
  // Independent oracle: aggregate the journals and orders directly.
  const jSum = (acct, col) => g.one(`SELECT COALESCE(SUM(${col}),0) v FROM journal_entries WHERE account_code = ? AND txn_type IN ('PAYMENT_CAPTURE','REFUND')`, acct).v;
  assert.equal(r.json.data.totals.gmv, o1.total_pay_amount + o2.total_pay_amount);
  assert.equal(r.json.data.totals.orders, 2);
  assert.equal(r.json.data.totals.direct_net, jSum('DIRECT_SALES_REVENUE', 'credit') - jSum('DIRECT_SALES_REVENUE', 'debit'));
  assert.equal(r.json.data.totals.commission_net, jSum('COMMISSION_REVENUE', 'credit') - jSum('COMMISSION_REVENUE', 'debit'));
  assert.ok(r.json.data.series.some((s) => s.date === today && s.orders === 2), 'today bucket holds both orders');
  const empty = await g.call('/api/v1/admin/finance/sales-report?from=2099-01-01&to=2099-01-31', { token: adm });
  assert.equal(empty.json.data.totals.orders, 0);
  for (const q of ['from=bad&to=2026-01-02', 'from=2026-02-01&to=2026-01-01', 'from=2020-01-01&to=2026-12-31', 'from=2026-01-01&to=2026-01-31&group_by=hour']) {
    assert.equal((await g.call(`/api/v1/admin/finance/sales-report?${q}`, { token: adm })).status, 400, q);
  }
});

await t.test('Sales report by partner splits marketplace and direct', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const mp = g.one("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 5 LIMIT 1");
  await paidOrder(g, cust, mp.id, 1, '0000003');
  const today = new Date().toISOString().slice(0, 10);
  const r = await g.call(`/api/v1/admin/finance/sales-report?from=2026-01-01&to=${today}&group_by=partner`, { token: adm });
  assert.equal(r.status, 200, r.text);
  const row = r.json.data.series.find((s) => s.partner_id === 'pt_002');
  assert.ok(row, 'marketplace partner row exists');
  const comm = g.one("SELECT COALESCE(SUM(commission_amount),0) v FROM settlements WHERE partner_id = 'pt_002'").v;
  const net = g.one("SELECT COALESCE(SUM(net_payout_amount),0) v FROM settlements WHERE partner_id = 'pt_002'").v;
  assert.equal(row.commission_net, comm);
  assert.equal(row.seller_net, net);
  assert.equal(row.direct_net, 0);
});

// ---------- Supplier purchase journals ----------
await t.test('Dropship PO shipment posts exactly one purchase journal; RECEIVED rejected', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const sku = g.one("SELECT s.id, s.stock_quantity FROM product_skus s WHERE s.id = 'sku_001_w'");
  const o = await paidOrder(g, cust, sku.id, 1, '0000004');
  const po = g.one('SELECT * FROM purchase_orders WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)', o.order_id);
  assert.equal(po.status, 'DRAFT');
  assert.equal(po.fulfillment_mode, 'DROP_SHIP');
  assert.equal((await g.call(`/api/v1/admin/purchase-orders/${po.id}/status`, { method: 'POST', token: adm, body: { status: 'SENT', supplier_order_ref: 'SUP-1' } })).status, 200);
  assert.equal((await g.call(`/api/v1/admin/purchase-orders/${po.id}/status`, { method: 'POST', token: adm, body: { status: 'CONFIRMED' } })).status, 200);
  assert.equal(g.one("SELECT COUNT(*) c FROM journal_entries WHERE txn_type = 'SUPPLIER_PURCHASE'").c, 0, 'nothing posts before shipment');
  const ship = await g.call(`/api/v1/admin/purchase-orders/${po.id}/status`, { method: 'POST', token: adm, body: { status: 'SHIPPED', carrier: 'CJ대한통운', tracking_number: '123456789012' } });
  assert.equal(ship.status, 200, ship.text);
  const lines = g.all("SELECT account_code a, debit dr, credit cr, memo FROM journal_entries WHERE txn_type = 'SUPPLIER_PURCHASE'");
  assert.equal(lines.length, 2, 'one balanced pair');
  assert.deepEqual(lines.map((l) => [l.a, l.dr, l.cr]).sort(), [['PURCHASE_COST', po.total_cost, 0], ['SUPPLIER_PAYABLE', 0, po.total_cost]]);
  assert.ok(lines.every((l) => l.memo === `po:${po.id}`));
  assert.equal(g.one('SELECT stock_quantity q FROM product_skus WHERE id = ?', sku.id).q, sku.stock_quantity - 1, 'dropship shipment adds no stock');
  assert.equal((await g.call(`/api/v1/admin/purchase-orders/${po.id}/status`, { method: 'POST', token: adm, body: { status: 'RECEIVED' } })).status, 409);
});

await t.test('Selfship RECEIVED posts inventory, increments stock, reconciles clean', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const map = await g.call('/api/v1/admin/supplier-mappings', { method: 'POST', token: adm,
    body: { sku_id: 'sku_003_set', supplier_id: 'sup_dev_001', supplier_sku_code: 'SUP-SET-1', unit_cost: 10000, fulfillment_mode: 'SELF_SHIP', resale_authorized: true, authorization_evidence: '계약 2026-SELF-1' } });
  assert.equal(map.status, 201, map.text);
  const before = g.one("SELECT stock_quantity FROM product_skus WHERE id = 'sku_003_set'").stock_quantity;
  const o = await paidOrder(g, cust, 'sku_003_set', 2, '0000005');
  const po = g.one('SELECT * FROM purchase_orders WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)', o.order_id);
  assert.equal(po.fulfillment_mode, 'SELF_SHIP');
  assert.equal(po.total_cost, 20000);
  for (const s of ['SENT', 'CONFIRMED', 'SHIPPED']) {
    assert.equal((await g.call(`/api/v1/admin/purchase-orders/${po.id}/status`, { method: 'POST', token: adm, body: { status: s } })).status, 200, s);
  }
  assert.equal(g.one("SELECT COUNT(*) c FROM journal_entries WHERE txn_type = 'SUPPLIER_PURCHASE'").c, 0, 'in-transit posts nothing');
  const recv = await g.call(`/api/v1/admin/purchase-orders/${po.id}/status`, { method: 'POST', token: adm, body: { status: 'RECEIVED' } });
  assert.equal(recv.status, 200, recv.text);
  const lines = g.all("SELECT account_code a, debit dr, credit cr FROM journal_entries WHERE txn_type = 'SUPPLIER_PURCHASE'");
  assert.deepEqual(lines.map((l) => [l.a, l.dr, l.cr]).sort(), [['INVENTORY_ASSET', 20000, 0], ['SUPPLIER_PAYABLE', 0, 20000]]);
  // Stock went down 2 at checkout, back up 2 at receipt.
  assert.equal(g.one("SELECT stock_quantity FROM product_skus WHERE id = 'sku_003_set'").stock_quantity, before);
  assert.equal(g.one("SELECT quantity_delta FROM inventory_ledger WHERE change_type = 'PURCHASE_RECEIVE'").quantity_delta, 2);
  const recon = await g.call('/api/v1/admin/reconciliation', { token: adm });
  assert.equal(recon.status, 200, recon.text);
  assert.equal(recon.json.data.ok, true, `reconcile clean: ${JSON.stringify((recon.json.data.checks || []).filter((c) => !c.ok))}`);
});

await t.test('Reconciliation flags orphan purchase journals', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  g.db.prepare("INSERT INTO journal_entries (id, txn_id, txn_type, account_code, debit, credit, memo) VALUES ('jrn_orph_dr', 'txn_orph', 'SUPPLIER_PURCHASE', 'PURCHASE_COST', 1000, 0, 'po:po_ghost')").run();
  g.db.prepare("INSERT INTO journal_entries (id, txn_id, txn_type, account_code, debit, credit, memo) VALUES ('jrn_orph_cr', 'txn_orph', 'SUPPLIER_PURCHASE', 'SUPPLIER_PAYABLE', 0, 1000, 'po:po_ghost')").run();
  const recon = await g.call('/api/v1/admin/reconciliation', { token: adm });
  assert.equal(recon.json.data.ok, false);
  assert.ok((recon.json.data.checks || []).some((c) => c.id === 'R24' && !c.ok), 'purchase-journal check fires');
});

t.finish();
