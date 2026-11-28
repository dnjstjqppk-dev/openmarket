// tests/penalty_grade_test.mjs
// Work order 2-7: penalty rules, grade policies, monthly grading.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Penalty and grade (2-7)');

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

async function login(g, email, role = 'CUSTOMER') {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

async function grading() {
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  return import(pathToFileURL(path.join(ROOT, 'apps/cloudflare-gateway/src/services/grading.js')).href);
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

await t.test('1. penalty and grade tables exist without seed rows', async () => {
  const g = await newGateway();
  for (const c of ['code', 'name', 'points', 'amount', 'is_enabled']) {
    assert.ok(columns(g.db, 'penalty_rules').includes(c), `penalty_rules has ${c}`);
  }
  for (const c of ['grade_code', 'name', 'sort_order', 'min_sales', 'max_claim_rate',
    'min_ship_on_time_rate', 'max_penalty_points', 'is_enabled']) {
    assert.ok(columns(g.db, 'grade_policies').includes(c), `grade_policies has ${c}`);
  }
  for (const c of ['partner_id', 'month', 'grade_code', 'metrics_json', 'computed_at']) {
    assert.ok(columns(g.db, 'partner_grades').includes(c), `partner_grades has ${c}`);
  }
  for (const c of ['rule_code', 'points', 'appeal_body', 'decided_by']) {
    assert.ok(columns(g.db, 'partner_penalties').includes(c), `partner_penalties has ${c}`);
  }
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM penalty_rules').get().n, 0, 'no invented rules');
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM grade_policies').get().n, 0, 'no invented thresholds');
});

await t.test('2. disabled criteria leave the grade empty', async () => {
  const g = await newGateway();
  const { computeMonthlyGrades } = await grading();
  g.db.prepare(`INSERT INTO grade_policies (grade_code, name, sort_order, min_sales, is_enabled)
    VALUES ('GOLD', 'g', 1, 0, 0)`).run();
  const n = await computeMonthlyGrades(g.env, '2026-10');
  assert.ok(n >= 0, 'job runs');
  const rows = g.db.prepare("SELECT * FROM partner_grades WHERE month = '2026-10'").all();
  assert.ok(rows.length > 0, 'sellers are graded');
  for (const r of rows) assert.equal(r.grade_code, null, 'no grade while criteria are off');
});

await t.test('3. thresholds assign the highest passing grade at the boundaries', async () => {
  const g = await newGateway();
  const { computeMonthlyGrades } = await grading();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' AND sales_model = 'MARKETPLACE' LIMIT 1").get().id;
  const s = g.db.prepare(
    `SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.partner_id = ? AND p.status = 'ACTIVE' AND s.stock_quantity > 0 LIMIT 1`).get(pid);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s.id, quantity: 1 }] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: 'sandbox_grade0001', amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const sub = g.db.prepare('SELECT * FROM sub_orders WHERE parent_order_id = ?').get(o.order_id);
  const ym = sub.created_at.slice(0, 7);
  g.db.prepare("UPDATE sub_orders SET shipped_at = created_at, ship_by_deadline = date(created_at, '+3 days') WHERE id = ?").run(sub.id);
  g.db.prepare(`INSERT INTO returns (id, order_id, user_id, claim_type, reason, status)
    VALUES ('ret_g1', ?, (SELECT customer_id FROM orders WHERE id = ?), 'RETURN', 't', 'REQUESTED')`).run(o.order_id, o.order_id);
  g.db.prepare(`INSERT INTO partner_penalties (id, partner_id, penalty_amount, reason, rule_code, points)
    VALUES ('pen_g1', ?, 0, 't', 'LATE', 3)`).run(pid);
  const sales = sub.goods_amount;
  g.db.prepare(`INSERT INTO grade_policies (grade_code, name, sort_order, is_enabled) VALUES ('BRONZE', 'b', 1, 1)`).run();
  g.db.prepare(`INSERT INTO grade_policies (grade_code, name, sort_order, min_sales, max_claim_rate, min_ship_on_time_rate, max_penalty_points, is_enabled)
    VALUES ('SILVER', 's', 2, ?, 1.0, 1.0, 3, 1)`).run(sales);
  const n = await computeMonthlyGrades(g.env, ym);
  assert.ok(n >= 1, 'job grades sellers');
  const row = g.db.prepare('SELECT * FROM partner_grades WHERE partner_id = ? AND month = ?').get(pid, ym);
  assert.equal(row.grade_code, 'SILVER', 'exact boundaries pass toward the higher grade');
  const m = JSON.parse(row.metrics_json);
  assert.equal(m.sales, sales, 'sales measured');
  assert.equal(m.claim_rate, 1, 'claim rate measured');
  assert.equal(m.ship_on_time_rate, 1, 'ship rate measured');
  assert.equal(m.penalty_points, 3, 'points measured');
  g.db.prepare('UPDATE grade_policies SET min_sales = ? WHERE grade_code = ?').run(sales + 1, 'SILVER');
  await computeMonthlyGrades(g.env, ym);
  const row2 = g.db.prepare('SELECT * FROM partner_grades WHERE partner_id = ? AND month = ?').get(pid, ym);
  assert.equal(row2.grade_code, 'BRONZE', 'missed floor drops to the lower grade');
  const count = g.db.prepare('SELECT COUNT(*) AS n FROM partner_grades WHERE partner_id = ? AND month = ?').get(pid, ym).n;
  assert.equal(count, 1, 'recompute overwrites instead of duplicating');
});

await t.test('4. schema version pin tracks the new migration', async () => {
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  const modPath = path.join(ROOT, 'apps/cloudflare-gateway/src/services/orders.js');
  const { REQUIRED_SCHEMA_VERSION } = await import(pathToFileURL(modPath).href);
  assert.equal(REQUIRED_SCHEMA_VERSION, 'd1_79_backfill_partner_shipping_policies.sql', 'pin names d1_79');
});

t.finish();
