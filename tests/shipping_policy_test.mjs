// tests/shipping_policy_test.mjs
// Work order 2-2: seller shipping templates, bundle groups, remote combos.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Shipping policies (2-2)');

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

function pickSellerSkus(g, partnerId, n) {
  const rows = g.db.prepare(
    `SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id
     WHERE p.partner_id = ? AND p.status = 'ACTIVE' AND s.stock_quantity > 0 LIMIT 60`
  ).all(partnerId);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.product_id)) continue;
    seen.add(r.product_id);
    out.push(r.id);
    if (out.length >= n) break;
  }
  assert.ok(out.length >= n, `need ${n} distinct-product skus, found ${out.length}`);
  return out;
}

function mkPolicy(g, partnerId, over = {}) {
  const id = `sp_${Math.random().toString(36).slice(2, 10)}`;
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

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

await t.test('1. shipping tables and columns exist', async () => {
  const g = await newGateway();
  for (const c of ['id', 'partner_id', 'name', 'method', 'carrier_code', 'fee_type', 'base_fee',
    'free_threshold', 'qty_unit', 'remote_surcharge', 'return_fee', 'exchange_fee',
    'processing_days', 'today_cutoff', 'origin_address', 'return_address',
    'is_default', 'status', 'created_at', 'updated_at']) {
    assert.ok(columns(g.db, 'shipping_policies').includes(c), `shipping_policies has ${c}`);
  }
  for (const c of ['shipping_policy_id', 'bundle_group_key']) {
    assert.ok(columns(g.db, 'products').includes(c), `products has ${c}`);
  }
  for (const c of ['confirmed_at', 'ship_by_deadline', 'shipping_breakdown_json']) {
    assert.ok(columns(g.db, 'sub_orders').includes(c), `sub_orders has ${c}`);
  }
  assert.ok(columns(g.db, 'order_items').includes('shipping_group_key'), 'order_items has shipping_group_key');
  for (const c of ['collection_requested_at', 'collection_carrier', 'collection_tracking_number',
    'collection_completed_at', 'inspected_at', 'inspection_result', 'inspection_memo', 'inspection_photos_json']) {
    assert.ok(columns(g.db, 'returns').includes(c), `returns has ${c}`);
  }
});

await t.test('2. one default template per seller', async () => {
  const g = await newGateway();
  const pid = g.db.prepare('SELECT id FROM partners LIMIT 1').get().id;
  // 6-11: the seed owns the default; clear it so the uniqueness rule itself is tested.
  g.db.prepare('UPDATE shipping_policies SET is_default = 0 WHERE partner_id = ?').run(pid);
  mkPolicy(g, pid, { is_default: 1 });
  assert.throws(() => mkPolicy(g, pid, { is_default: 1 }), 'second default is rejected');
  mkPolicy(g, pid, { is_default: 0 });
});

await t.test('3. free and paid templates price the group', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const [s1, s2] = pickSellerSkus(g, pid, 2);
  const free = mkPolicy(g, pid, { fee_type: 'FREE', base_fee: 9999 });
  g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = (SELECT product_id FROM product_skus WHERE id = ?)').run(free, s1);
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1, quantity: 1 }] }
  });
  assert.equal(q.status, 200, q.text);
  assert.equal(q.json.data.sub_orders[0].shipping_fee, 0, 'free template ships free on the mainland');
  const paid = mkPolicy(g, pid, { fee_type: 'PAID', base_fee: 2500 });
  g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = (SELECT product_id FROM product_skus WHERE id = ?)').run(paid, s2);
  const q2 = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s2, quantity: 1 }] }
  });
  assert.equal(q2.json.data.sub_orders[0].shipping_fee, 2500, 'paid template charges its base fee');
});

await t.test('4. conditional and per-quantity templates', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const [s1] = pickSellerSkus(g, pid, 1);
  const cond = mkPolicy(g, pid, { fee_type: 'CONDITIONAL', base_fee: 3000, free_threshold: 50000 });
  g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = (SELECT product_id FROM product_skus WHERE id = ?)').run(cond, s1);
  const price = g.db.prepare('SELECT sale_price FROM product_skus WHERE id = ?').get(s1).sale_price;
  const smallQty = 1;
  const bigQty = Math.ceil(60000 / price) + 1;
  const qSmall = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1, quantity: smallQty }] }
  });
  const expectSmall = price * smallQty >= 50000 ? 0 : 3000;
  assert.equal(qSmall.json.data.sub_orders[0].shipping_fee, expectSmall, 'conditional below threshold charges base');
  const qBig = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1, quantity: bigQty }] }
  });
  assert.equal(qBig.json.data.sub_orders[0].shipping_fee, 0, 'conditional above threshold ships free');
  const perQty = mkPolicy(g, pid, { fee_type: 'PER_QTY', base_fee: 1000, qty_unit: 2 });
  g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = (SELECT product_id FROM product_skus WHERE id = ?)').run(perQty, s1);
  const qQty = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1, quantity: 5 }] }
  });
  assert.equal(qQty.json.data.sub_orders[0].shipping_fee, 3000, 'per-quantity charges ceil(5/2) units');
});

await t.test('5. bundle keys ship as one group', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const [s1, s2] = pickSellerSkus(g, pid, 2);
  const paid = mkPolicy(g, pid, { fee_type: 'PAID', base_fee: 2500 });
  for (const s of [s1, s2]) {
    g.db.prepare('UPDATE products SET shipping_policy_id = ?, bundle_group_key = ? WHERE id = (SELECT product_id FROM product_skus WHERE id = ?)').run(paid, 'BND1', s);
  }
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('06236'), items: [{ sku_id: s1, quantity: 1 }, { sku_id: s2, quantity: 1 }] }
  });
  assert.equal(q.json.data.sub_orders[0].shipping_fee, 2500, 'bundled lines share one fee');
});

// 6-11: the legacy fallback is retired — a policy-less product fails closed.
await t.test('6. policy-less orders are refused with SHIPPING_POLICY_REQUIRED', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const [s1] = pickSellerSkus(g, pid, 1);
  g.db.prepare('UPDATE products SET shipping_policy_id = NULL WHERE id = (SELECT product_id FROM product_skus WHERE id = ?)').run(s1);
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1, quantity: 1 }] }
  });
  assert.equal(q.status, 409);
  assert.equal(q.json.code, 'SHIPPING_POLICY_REQUIRED');
  const c = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    headers: { 'X-Idempotency-Key': `ship611-${Date.now()}` },
    body: { ...addr('06236'), items: [{ sku_id: s1, quantity: 1 }] }
  });
  assert.equal(c.status, 409);
  assert.equal(c.json.code, 'SHIPPING_POLICY_REQUIRED');
});

await t.test('7. remote surcharge applies once per group with template override', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const [s1, s2] = pickSellerSkus(g, pid, 2);
  const zone = g.db.prepare("SELECT surcharge_amount FROM shipping_remote_zones WHERE postal_prefix = '63'").get();
  assert.ok(zone, 'Jeju zone is seeded');
  const t1 = mkPolicy(g, pid, { fee_type: 'FREE' });
  const t2 = mkPolicy(g, pid, { fee_type: 'FREE', remote_surcharge: 1000 });
  g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = (SELECT product_id FROM product_skus WHERE id = ?)').run(t1, s1);
  g.db.prepare('UPDATE products SET shipping_policy_id = ? WHERE id = (SELECT product_id FROM product_skus WHERE id = ?)').run(t2, s2);
  const q = await g.call('/api/v1/orders/quote', {
    method: 'POST', token: cust,
    body: { ...addr('63001'), items: [{ sku_id: s1, quantity: 1 }, { sku_id: s2, quantity: 1 }] }
  });
  assert.equal(q.json.data.sub_orders[0].shipping_fee, zone.surcharge_amount + 1000,
    'zone default on one group, template override on the other');
});

await t.test('8. checkout persists the breakdown, group keys and deadline', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com');
  const pid = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get().id;
  const [s1] = pickSellerSkus(g, pid, 1);
  const tpl = mkPolicy(g, pid, { fee_type: 'PAID', base_fee: 2500, processing_days: 3 });
  g.db.prepare('UPDATE products SET shipping_policy_id = ?, bundle_group_key = ? WHERE id = (SELECT product_id FROM product_skus WHERE id = ?)').run(tpl, 'BND9', s1);
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr('06236'), items: [{ sku_id: s1, quantity: 1 }] }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const sub = g.db.prepare('SELECT * FROM sub_orders WHERE parent_order_id = ?').get(o.order_id);
  const breakdown = JSON.parse(sub.shipping_breakdown_json);
  assert.equal(breakdown.length, 1, 'one group recorded');
  assert.equal(breakdown[0].template_id, tpl, 'group names its template');
  assert.equal(breakdown[0].shipping, 2500, 'group fee recorded');
  const item = g.db.prepare('SELECT shipping_group_key FROM order_items WHERE sub_order_id = ?').get(sub.id);
  assert.equal(item.shipping_group_key, 'BND9', 'item carries its group key');
  assert.ok(sub.ship_by_deadline, 'deadline is set from the template lead time');
  assert.equal(sub.confirmed_at, null, 'confirmation stays empty until the seller confirms');
});

await t.test('9. schema version pin tracks the new migration', async () => {
  const { pathToFileURL } = await import('node:url');
  const { ROOT } = await import('./lib/harness.mjs');
  const { default: path } = await import('node:path');
  const modPath = path.join(ROOT, 'apps/cloudflare-gateway/src/services/orders.js');
  const { REQUIRED_SCHEMA_VERSION } = await import(pathToFileURL(modPath).href);
  assert.equal(REQUIRED_SCHEMA_VERSION, 'd1_79_backfill_partner_shipping_policies.sql', 'pin names d1_79');
});

await t.test('10. d1_79 backfill registers each seller\'s own policy and makes legacy products sellable', async () => {
  const fs = await import('node:fs');
  const { default: path } = await import('node:path');
  const { ROOT } = await import('./lib/harness.mjs');
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/d1_79_backfill_partner_shipping_policies.sql'), 'utf8');
  const g = await newGateway();
  // Recreate the production state: pre-6-11 products with no policy, sellers with
  // only partner-level fee settings (pt_002 differs from the old 3000 default).
  g.db.exec(`
    UPDATE products SET shipping_policy_id = NULL;
    DELETE FROM shipping_policies;
    UPDATE partners SET base_shipping_fee = 3000, free_shipping_threshold = 30000, return_shipping_fee = NULL,
      return_shipping_address = '서울 반품센터 1' WHERE id = 'pt_001';
    UPDATE partners SET base_shipping_fee = 2500, free_shipping_threshold = 30000, return_shipping_fee = NULL,
      return_shipping_address = '  ' WHERE id = 'pt_002';
  `);
  const hidden = await g.call('/api/v1/products?limit=100');
  assert.equal(hidden.status, 200, hidden.text);
  assert.equal((hidden.json.data || []).length, 0, 'fail-closed gate hides unassigned products');

  g.db.exec(sql);
  const pol = (pid) => g.db.prepare('SELECT * FROM shipping_policies WHERE partner_id = ?').all(pid);
  const [p1] = pol('pt_001');
  const [p2] = pol('pt_002');
  assert.equal(pol('pt_001').length, 1, 'one policy per seller');
  assert.equal(p1.fee_type, 'CONDITIONAL');
  assert.equal(p1.base_fee, 3000);
  assert.equal(p1.free_threshold, 30000);
  assert.equal(p1.return_fee, 3000, 'return fee = what claims.js withholds (base when unset)');
  assert.equal(p1.exchange_fee, 6000);
  assert.equal(p1.processing_days, 3);
  assert.equal(p1.today_cutoff, null, 'no 오늘출발 claim the seller never made');
  assert.equal(p1.remote_surcharge, null);
  assert.equal(p1.return_address, '서울 반품센터 1');
  assert.equal(p1.is_default, 1);
  assert.equal(p2.base_fee, 2500, "seller's own fee, not a code default");
  assert.equal(p2.exchange_fee, 5000);
  assert.equal(p2.return_address, null, 'blank address stays unregistered');
  const unassigned = g.db.prepare(
    "SELECT COUNT(*) AS c FROM products p WHERE NOT EXISTS (SELECT 1 FROM shipping_policies sp WHERE sp.id = p.shipping_policy_id AND sp.partner_id = p.partner_id AND sp.status = 'ACTIVE')"
  ).get().c;
  assert.equal(unassigned, 0, 'every product names its own seller\'s ACTIVE policy');

  const shown = await g.call('/api/v1/products?limit=100');
  assert.equal(shown.status, 200, shown.text);
  const rows = shown.json.data || [];
  assert.ok(rows.length > 0, 'products are listed again');
  const p2Row = rows.find((r) => r.partner_id === 'pt_002');
  assert.ok(p2Row, 'pt_002 product listed');
  assert.equal(p2Row.shipping_text, '30,000원 이상 구매 시 무료 (미만 2,500원)');

  // Rerun-safe and respects later seller choices.
  g.db.exec("UPDATE shipping_policies SET base_fee = 4000 WHERE partner_id = 'pt_001'");
  const before = g.db.prepare('SELECT COUNT(*) AS c FROM shipping_policies').get().c;
  g.db.exec(sql);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM shipping_policies').get().c, before, 'rerun adds nothing');
  assert.equal(pol('pt_001')[0].base_fee, 4000, 'rerun never overwrites a seller edit');

  // A seller who already has an ACTIVE default keeps it; an inactive default never blocks the insert.
  const pid = g.db.prepare("SELECT id FROM products WHERE partner_id = 'pt_001' LIMIT 1").get().id;
  g.db.exec(`UPDATE products SET shipping_policy_id = NULL WHERE id = '${pid}'`);
  g.db.exec(sql);
  assert.equal(g.db.prepare('SELECT shipping_policy_id AS s FROM products WHERE id = ?').get(pid).s, 'sp_d179_pt_001');
  g.db.exec(`
    UPDATE shipping_policies SET status = 'INACTIVE' WHERE partner_id = 'pt_002';
    UPDATE products SET shipping_policy_id = NULL WHERE partner_id = 'pt_002';
    DELETE FROM shipping_policies WHERE partner_id = 'pt_002';
    INSERT INTO shipping_policies (id, partner_id, name, method, fee_type, base_fee, is_default, status)
      VALUES ('sp_old_inactive', 'pt_002', 'old', 'PARCEL', 'PAID', 9999, 1, 'INACTIVE');
  `);
  g.db.exec(sql);
  const fresh = g.db.prepare("SELECT * FROM shipping_policies WHERE id = 'sp_d179_pt_002'").get();
  assert.ok(fresh, 'inactive default does not block the backfill');
  assert.equal(fresh.is_default, 0, 'unique default index respected');
  assert.equal(g.db.prepare("SELECT COUNT(*) AS c FROM products WHERE partner_id = 'pt_002' AND shipping_policy_id = 'sp_d179_pt_002'").get().c,
    g.db.prepare("SELECT COUNT(*) AS c FROM products WHERE partner_id = 'pt_002'").get().c, 'pt_002 products reassigned');
});

t.finish();
