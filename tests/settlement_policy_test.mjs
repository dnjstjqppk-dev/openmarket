// tests/settlement_policy_test.mjs
// Work order 2-4: settlement formula policies and payout requests.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Settlement policy and payouts (2-4)');

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
const today = () => new Date().toISOString().slice(0, 10);

async function login(g, email, role = 'CUSTOMER') {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

function sellerSkus(g, partnerId, n) {
  const rows = g.db.prepare(
    `SELECT s.id, s.product_id, s.sale_price FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.partner_id = ? AND p.status = 'ACTIVE' AND s.stock_quantity > 0 LIMIT 60`
  ).all(partnerId);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.product_id)) continue;
    seen.add(r.product_id);
    out.push(r);
    if (out.length >= n) break;
  }
  assert.ok(out.length >= n, `need ${n} distinct-product skus`);
  return out;
}

async function mkSeller() {
  const g = await newGateway();
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' AND sales_model = 'MARKETPLACE' LIMIT 1").get().id;
  g.db.prepare('UPDATE partners SET payout_account_verified = 1 WHERE id = ?').run(pid);
  return { g, pid };
}

// 2-6 deal layer: an approved flash item in a live campaign replaces the
// ticket price (services/orders.js). Absolute expectations price the charged
// amount, not the shelf price.
function chargedPrice(g, sku) {
  const deal = g.db.prepare(`SELECT f.deal_price AS d FROM flash_sale_items f
    JOIN flash_sale_campaigns c ON c.id = f.campaign_id
    WHERE f.status = 'APPROVED' AND c.status = 'ACTIVE' AND c.starts_at <= CURRENT_TIMESTAMP AND c.ends_at > CURRENT_TIMESTAMP
      AND f.deal_price > 0 AND ((f.sku_id IS NOT NULL AND f.sku_id = ?) OR (f.sku_id IS NULL AND f.product_id = ?))
    ORDER BY (f.sku_id IS NULL) ASC, f.deal_price ASC LIMIT 1`).get(sku.id, sku.product_id);
  return deal ? deal.d : sku.sale_price;
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

await t.test('1. policy, settlement and payout tables exist', async () => {
  const g = await newGateway();
  for (const c of ['key', 'value', 'effective_from', 'updated_by', 'updated_at']) {
    assert.ok(columns(g.db, 'platform_policies').includes(c), `platform_policies has ${c}`);
  }
  for (const c of ['id', 'policy_key', 'old_value', 'new_value', 'changed_by', 'created_at']) {
    assert.ok(columns(g.db, 'platform_policy_history').includes(c), `platform_policy_history has ${c}`);
  }
  for (const c of ['pg_fee_bps', 'pg_fee_amount', 'fee_source']) {
    assert.ok(columns(g.db, 'settlements').includes(c), `settlements has ${c}`);
  }
  for (const c of ['id', 'partner_id', 'amount', 'status', 'account_hash', 'idempotency_key',
    'payout_id', 'reject_reason', 'decided_by', 'decided_at']) {
    assert.ok(columns(g.db, 'payout_requests').includes(c), `payout_requests has ${c}`);
  }
});

await t.test('2. without policies the legacy formula holds', async () => {
  const { g, pid } = await mkSeller();
  const cust = await login(g, 'customer@example.com');
  const [s1] = sellerSkus(g, pid, 1);
  const pt = g.db.prepare('SELECT commission_rate_bps, commission_rate FROM partners WHERE id = ?').get(pid);
  const bps = pt.commission_rate_bps ?? Math.round(Number(pt.commission_rate || 10) * 100);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const st = g.db.prepare('SELECT * FROM settlements WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(o.order_id);
  const expectComm = Math.floor((chargedPrice(g, s1) * bps + 5000) / 10000);
  assert.equal(st.commission_amount, expectComm, 'seller rate on the full line total');
  assert.equal(st.fee_source, 'SELLER', 'source names the seller default');
  assert.equal(st.pg_fee_amount, 0, 'no policy means no PG fee');
  assert.equal(st.net_payout_amount, st.gross_amount - st.commission_amount + st.shipping_fee, 'legacy net untouched');
});

await t.test('3. category rates price per item and win over the seller rate', async () => {
  const { g, pid } = await mkSeller();
  const cust = await login(g, 'customer@example.com');
  const [s1, s2] = sellerSkus(g, pid, 2);
  const cat = g.db.prepare('SELECT category_id FROM products WHERE id = ?').get(s1.product_id).category_id;
  g.db.prepare('UPDATE categories SET commission_rate_bps = 500 WHERE id = ?').run(cat);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }, { sku_id: s2.id, quantity: 1 }] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const st = g.db.prepare('SELECT * FROM settlements WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(o.order_id);
  const pt = g.db.prepare('SELECT commission_rate_bps, commission_rate FROM partners WHERE id = ?').get(pid);
  const sellerBps = pt.commission_rate_bps ?? Math.round(Number(pt.commission_rate || 10) * 100);
  const s2cat = g.db.prepare('SELECT category_id FROM products WHERE id = ?').get(s2.product_id).category_id;
  const c1 = Math.floor((chargedPrice(g, s1) * 500 + 5000) / 10000);
  const c2 = Math.floor((chargedPrice(g, s2) * (s2cat === cat ? 500 : sellerBps) + 5000) / 10000);
  assert.equal(st.commission_amount, c1 + c2, 'per-item category and seller rates summed');
  assert.equal(st.fee_source, s2cat === cat ? 'CATEGORY' : 'SELLER', 'source reflects the mix');
});

await t.test('4. NET base policy excludes the store discount', async () => {
  const { g, pid } = await mkSeller();
  const cust = await login(g, 'customer@example.com');
  const me = g.db.prepare('SELECT id FROM users WHERE email = ?').get('customer@example.com').id;
  const [s1] = sellerSkus(g, pid, 1);
  g.db.prepare("INSERT INTO platform_policies (key, value, effective_from) VALUES ('commission.base', 'NET', ?)").run(today());
  const cp = `cp_${Math.random().toString(36).slice(2, 10)}`;
  g.db.prepare(`INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, expires_at, is_active,
    issuer, seller_id, scope, platform_share_bps, dup_group, issue_method, issued_count)
    VALUES (?, ?, 't', 'FIXED_AMOUNT', 1000, 0, '2099-01-01 00:00:00', 1, 'SELLER', ?, 'SELLER', 0, 'STORE', 'DOWNLOAD', 0)`)
    .run(cp, `C_${cp}`, pid);
  const uc = `uc_${Math.random().toString(36).slice(2, 10)}`;
  g.db.prepare('INSERT INTO user_coupons (id, user_id, coupon_id, is_used) VALUES (?, ?, ?, 0)').run(uc, me, cp);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }], store_coupon_ids: [uc] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const st = g.db.prepare('SELECT * FROM settlements WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(o.order_id);
  const pt = g.db.prepare('SELECT commission_rate_bps, commission_rate FROM partners WHERE id = ?').get(pid);
  const bps = pt.commission_rate_bps ?? Math.round(Number(pt.commission_rate || 10) * 100);
  assert.equal(st.commission_amount, Math.floor(((chargedPrice(g, s1) - 1000) * bps + 5000) / 10000), 'base excludes the store discount');
});

await t.test('5. PG fee policy deducts, stores and journals the fee', async () => {
  const { g, pid } = await mkSeller();
  const cust = await login(g, 'customer@example.com');
  const [s1] = sellerSkus(g, pid, 1);
  g.db.prepare("INSERT INTO platform_policies (key, value, effective_from) VALUES ('pg.fee_bps', '100', ?)").run(today());
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const st = g.db.prepare('SELECT * FROM settlements WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(o.order_id);
  assert.equal(st.pg_fee_bps, 100, 'rate stored');
  assert.ok(st.pg_fee_amount > 0, 'fee computed');
  assert.equal(st.net_payout_amount, st.gross_amount - st.commission_amount + st.shipping_fee - st.pg_fee_amount, 'net deducts the fee');
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const bal = g.db.prepare('SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) AS b FROM journal_entries WHERE order_id = ?').get(o.order_id).b;
  assert.equal(bal, 0, 'capture journal balances with the fee leg');
});

await t.test('6. backdated policies are rejected', async () => {
  const g = await newGateway();
  assert.throws(() => {
    g.db.prepare("INSERT INTO platform_policies (key, value, effective_from) VALUES ('pg.fee_bps', '100', '2020-01-01')").run();
  }, 'past effective dates cannot be inserted');
});

await t.test('7. payout requests approve into payouts and replay keys', async () => {
  const { g, pid } = await mkSeller();
  const cust = await login(g, 'customer@example.com');
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const adminId = g.db.prepare('SELECT id FROM users WHERE email = ?').get('admin@openmarket.com').id;
  const [s1] = sellerSkus(g, pid, 1);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  g.db.prepare("UPDATE settlements SET status = 'ELIGIBLE_FOR_PAYOUT' WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)").run(o.order_id);
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  const svc = await import(pathToFileURL(path.join(ROOT, 'apps/cloudflare-gateway/src/services/payouts.js')).href);
  const avail = await svc.withdrawableAmount(g.env, pid);
  assert.ok(avail > 0, `positive withdrawable, got ${avail}`);
  const req1 = await svc.requestPayout(g.env, { partnerId: pid, amount: avail, idemKey: 'wd-key-1' });
  assert.equal(req1.status, 'REQUESTED', 'request opens');
  const replay = await svc.requestPayout(g.env, { partnerId: pid, amount: avail, idemKey: 'wd-key-1' });
  assert.equal(replay.id, req1.id, 'same key replays the same request');
  assert.equal(replay.idempotent_replay, true, 'replay is flagged');
  const approved = await svc.decidePayoutRequest(g.env, { requestId: req1.id, approve: true, adminId, idemKey: 'wd-pay-1' });
  assert.equal(approved.status, 'APPROVED', 'request approves');
  assert.ok(approved.payout_id, 'payout is created');
  const payout = g.db.prepare('SELECT * FROM payouts WHERE id = ?').get(approved.payout_id);
  assert.equal(payout.amount, avail, 'payout pays the requested amount');
  const audit = g.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'PAYOUT_REQUEST_APPROVE'").get().n;
  assert.equal(audit, 1, 'approval is audited');
  void adm;
});

await t.test('8. concurrent requests leave exactly one in flight', async () => {
  const { g, pid } = await mkSeller();
  const cust = await login(g, 'customer@example.com');
  const [s1] = sellerSkus(g, pid, 1);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }] }
  })).json;
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  g.db.prepare("UPDATE settlements SET status = 'ELIGIBLE_FOR_PAYOUT' WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)").run(o.order_id);
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  const svc = await import(pathToFileURL(path.join(ROOT, 'apps/cloudflare-gateway/src/services/payouts.js')).href);
  const avail = await svc.withdrawableAmount(g.env, pid);
  const attempts = await Promise.all([0, 1].map((i) =>
    svc.requestPayout(g.env, { partnerId: pid, amount: avail, idemKey: `wd-race-${i}` })
      .then(() => 'ok').catch((e) => e.code || 'ERR')
  ));
  assert.equal(attempts.filter((r) => r === 'ok').length, 1, `one winner, got ${JSON.stringify(attempts)}`);
  const n = g.db.prepare("SELECT COUNT(*) AS n FROM payout_requests WHERE partner_id = ? AND status = 'REQUESTED'").get(pid).n;
  assert.equal(n, 1, 'exactly one request stays in flight');
});

await t.test('9. cancel, reject and account changes behave', async () => {
  const { g, pid } = await mkSeller();
  const cust = await login(g, 'customer@example.com');
  const adminId = g.db.prepare('SELECT id FROM users WHERE email = ?').get('admin@openmarket.com').id;
  const [s1] = sellerSkus(g, pid, 1);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1.id, quantity: 1 }] }
  })).json;
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  g.db.prepare("UPDATE settlements SET status = 'ELIGIBLE_FOR_PAYOUT' WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)").run(o.order_id);
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  const svc = await import(pathToFileURL(path.join(ROOT, 'apps/cloudflare-gateway/src/services/payouts.js')).href);
  const avail = await svc.withdrawableAmount(g.env, pid);
  const r1 = await svc.requestPayout(g.env, { partnerId: pid, amount: avail, idemKey: 'wd-cancel-1' });
  const cancelled = await svc.cancelPayoutRequest(g.env, { requestId: r1.id, partnerId: pid });
  assert.equal(cancelled.status, 'CANCELLED', 'seller cancels the open request');
  const r2 = await svc.requestPayout(g.env, { partnerId: pid, amount: avail, idemKey: 'wd-cancel-2' });
  const rejected = await svc.decidePayoutRequest(g.env, { requestId: r2.id, approve: false, reason: '서류 보완', adminId, idemKey: 'wd-reject-2' });
  assert.equal(rejected.status, 'REJECTED', 'admin rejects with a reason');
  const stored = g.db.prepare('SELECT reject_reason FROM payout_requests WHERE id = ?').get(r2.id);
  assert.equal(stored.reject_reason, '서류 보완', 'reason is kept');
  const r3 = await svc.requestPayout(g.env, { partnerId: pid, amount: avail, idemKey: 'wd-cancel-3' });
  g.db.prepare("UPDATE partners SET bank_account_number = '999-99-999999' WHERE id = ?").run(pid);
  const changed = await svc.decidePayoutRequest(g.env, { requestId: r3.id, approve: true, adminId, idemKey: 'wd-decide-3' }).then(() => 'ok').catch((e) => e.code);
  assert.equal(changed, 'PAYOUT_ACCOUNT_CHANGED', 'changed accounts block approval');
});

await t.test('10. schema version pin tracks the new migration', async () => {
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  const modPath = path.join(ROOT, 'apps/cloudflare-gateway/src/services/orders.js');
  const { REQUIRED_SCHEMA_VERSION } = await import(pathToFileURL(modPath).href);
  assert.equal(REQUIRED_SCHEMA_VERSION, 'd1_65_category_banned_words.sql', 'pin names d1_65');
});

t.finish();
