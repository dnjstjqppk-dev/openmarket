// tests/ship_badge_test.mjs
// Ship badges: tomorrow-shipment filter + admin badge console APIs.
// Contract: tomorrow = today-ship honesty bar (rate policy + cutoff +
// 30d same-day rate) with the cutoff already passed, plus the enable flag.
// Without policies everything stays off (fail-closed).
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Ship badges (tomorrow filter + admin console)');

async function newGateway({ testNowKst } = {}) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      ...(testNowKst ? { TODAY_SHIP_TEST_NOW_KST: testNowKst } : {})
    }
  });
}

const PW = 'DevPass!2026#';
async function login(g, email, role) {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

const tsOf = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
// N days ago at 03:00 UTC == 12:00 KST: pairs around noon never straddle
// a KST date boundary, whatever time the suite runs.
const kstNoon = (daysAgo, plusHours = 0) => {
  const d = new Date(Date.now() - daysAgo * 86400000);
  d.setUTCHours(3 + plusHours, 0, 0, 0);
  return tsOf(d);
};

// [suffix, cutoff, hits, misses] — suite time pinned to KST 10:00 via env.
const SELLERS = [
  ['a', '15:00', 9, 1], // pre-cutoff, rate 9000
  ['b', '09:00', 9, 1], // post-cutoff, rate 9000
  ['c', '15:00', 1, 9], // pre-cutoff, rate 1000
  ['d', null, 10, 0], // no cutoff template at all
  ['e', '15:00', 0, 0], // cutoff but zero shipment history
  ['f', '09:00', 4, 1] // post-cutoff, rate exactly 8000 (boundary)
];

function seedSellers(g, { rateBps = null, tomorrowOn = null } = {}) {
  const cust = g.db.prepare("SELECT id FROM users WHERE email = 'customer@example.com'").get();
  assert.ok(cust, 'seed customer exists');
  for (const [s, cutoff, hits, misses] of SELLERS) {
    g.db.prepare('INSERT INTO users (id, email, password_hash, full_name, phone, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`u_sb_${s}`, `sb_${s}@example.com`, 'x', 'SB', '010', 'ROLE_PARTNER');
    g.db.prepare(`INSERT INTO partners (id, owner_user_id, business_name, business_reg_number, bank_code, bank_account_number, bank_account_holder, status, country_code, sales_model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`pt_sb_${s}`, `u_sb_${s}`, `SB ${s}`, `800-80-8000${s}`, '004', '1', 'H', 'APPROVED', 'KR', 'MARKETPLACE');
    g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`prod_sb_${s}`, `pt_sb_${s}`, 'cat_e_audio', `SB thing ${s}`, 'https://x/y.png', '<p>t</p>', 10000, 9000, 'ACTIVE', 'APPROVED');
    if (cutoff) {
      g.db.prepare(`INSERT INTO shipping_policies (id, partner_id, name, method, fee_type, today_cutoff, processing_days, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`sp_sb_${s}`, `pt_sb_${s}`, 'std', 'PARCEL', 'PAID', cutoff, 1, 1);
    }
    const total = hits + misses;
    for (let i = 0; i < total; i++) {
      const hit = i < hits;
      const paidAt = kstNoon(6 + i, 0);
      const shippedAt = hit ? kstNoon(6 + i, 3) : kstNoon(4 + i, 3);
      g.db.prepare(`INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount,
          payment_status, paid_at, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`o_sb_${s}${i}`, `SB-${s}-${i}`, cust.id, 10000, 0, 0, 10000, 'PAID', paidAt, 'R', '010', 'a1', 'a2', '12345');
      g.db.prepare(`INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, total_amount, status, shipped_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`so_sb_${s}${i}`, `o_sb_${s}${i}`, `SBS-${s}-${i}`, `pt_sb_${s}`, 0, 10000, 10000, 'SHIPPED', shippedAt);
    }
  }
  if (rateBps !== null) {
    g.db.prepare("INSERT INTO platform_policies (key, value, effective_from) VALUES ('badge.today_ship_min_rate_bps', ?, date('now', '+9 hours'))").run(String(rateBps));
  }
  if (tomorrowOn !== null) {
    g.db.prepare("INSERT INTO platform_policies (key, value, effective_from) VALUES ('badge.tomorrow_ship_enabled', ?, date('now', '+9 hours'))").run(String(tomorrowOn));
  }
}

const byId = (rows, id) => rows.find((p) => p.id === id);

// ---- tomorrow_shipment catalog filter ---------------------------------------

await t.test('T1. no policies: tomorrow_shipment ignored, chip hidden, rows carry 0', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedSellers(g);
  const plain = await g.call('/api/v1/products?per_page=200');
  const filt = await g.call('/api/v1/products?tomorrow_shipment=1&per_page=200');
  assert.equal(filt.status, 200, filt.text);
  assert.equal(filt.json.pagination.total, plain.json.pagination.total, 'param ignored without policies');
  assert.ok(!filt.json.available_filters.includes('tomorrow_shipment'), 'chip hidden');
  assert.ok(!filt.json.available_filters.includes('today_shipment'), 'today chip hidden too');
  for (const s of ['a', 'b', 'c', 'e', 'f']) {
    assert.equal(byId(filt.json.data, `prod_sb_${s}`).has_tomorrow, 0, `${s} badge off without policies`);
  }
});

await t.test('T2. rate policy alone: today works, tomorrow stays off', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedSellers(g, { rateBps: '8000' });
  const today = await g.call('/api/v1/products?today_shipment=1&per_page=200');
  assert.ok(today.json.data.map((p) => p.id).includes('prod_sb_a'), 'today filter live');
  const tm = await g.call('/api/v1/products?tomorrow_shipment=1&per_page=200');
  const plain = await g.call('/api/v1/products?per_page=200');
  assert.equal(tm.json.pagination.total, plain.json.pagination.total, 'tomorrow ignored without enable flag');
  assert.ok(tm.json.available_filters.includes('today_shipment'), 'today chip on');
  assert.ok(!tm.json.available_filters.includes('tomorrow_shipment'), 'tomorrow chip off');
  assert.equal(byId(tm.json.data, 'prod_sb_b').has_tomorrow, 0, 'row flag off');
});

await t.test('T3. both policies: only post-cutoff + rate-ok sellers pass tomorrow', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedSellers(g, { rateBps: '8000', tomorrowOn: '1' });
  const filt = await g.call('/api/v1/products?tomorrow_shipment=1&per_page=200');
  assert.equal(filt.status, 200, filt.text);
  const ids = filt.json.data.map((p) => p.id);
  assert.ok(ids.includes('prod_sb_b'), 'post-cutoff + rate-ok included');
  assert.ok(ids.includes('prod_sb_f'), 'exact-boundary 8000 included');
  assert.ok(!ids.includes('prod_sb_a'), 'pre-cutoff excluded');
  assert.ok(!ids.includes('prod_sb_c'), 'low-rate excluded');
  assert.ok(!ids.includes('prod_sb_d'), 'no-template excluded');
  assert.ok(!ids.includes('prod_sb_e'), 'zero-history excluded');
  assert.ok(filt.json.available_filters.includes('tomorrow_shipment'), 'filter advertised');
});

await t.test('T4. today + tomorrow together match nothing (mutually exclusive)', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedSellers(g, { rateBps: '8000', tomorrowOn: '1' });
  const filt = await g.call('/api/v1/products?today_shipment=1&tomorrow_shipment=1&per_page=200');
  const ids = filt.json.data.map((p) => p.id);
  assert.ok(!ids.includes('prod_sb_a'), 'today seller dropped by tomorrow clause');
  assert.ok(!ids.includes('prod_sb_b'), 'tomorrow seller dropped by today clause');
});

await t.test('T5. enable flag off (0) behaves like missing', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedSellers(g, { rateBps: '8000', tomorrowOn: '0' });
  const plain = await g.call('/api/v1/products?per_page=200');
  const filt = await g.call('/api/v1/products?tomorrow_shipment=1&per_page=200');
  assert.equal(filt.json.pagination.total, plain.json.pagination.total, 'param ignored when disabled');
  assert.ok(!filt.json.available_filters.includes('tomorrow_shipment'), 'chip hidden when disabled');
});

await t.test('T6. has_tomorrow mirrors has_today gating (clock check lives in the card)', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedSellers(g, { rateBps: '8000', tomorrowOn: '1' });
  const r = await g.call('/api/v1/products?per_page=200');
  for (const s of ['a', 'b', 'c', 'e', 'f']) {
    assert.equal(byId(r.json.data, `prod_sb_${s}`).has_tomorrow, 1, `${s} flag on with policies`);
  }
  assert.equal(byId(r.json.data, 'prod_sb_d').has_tomorrow, 0, 'no template, no flag');
});

await t.test('T7. garbage policy values fail closed', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedSellers(g, { rateBps: '8000', tomorrowOn: 'maybe' });
  const plain = await g.call('/api/v1/products?per_page=200');
  const filt = await g.call('/api/v1/products?tomorrow_shipment=1&per_page=200');
  assert.equal(filt.json.pagination.total, plain.json.pagination.total, 'garbage enable flag ignored');
  assert.ok(!filt.json.available_filters.includes('tomorrow_shipment'), 'chip hidden on garbage');
});

// ---- admin ship-badge console APIs ------------------------------------------

async function adminGateway() {
  const g = await newGateway({ testNowKst: '10:00' });
  seedSellers(g, { rateBps: '8000', tomorrowOn: '1' });
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  return { g, adm };
}

await t.test('B1. sellers status needs an operator token', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedSellers(g, { rateBps: '8000', tomorrowOn: '1' });
  const anon = await g.call('/api/v1/admin/ship-badges/sellers');
  assert.equal(anon.status, 401, 'anonymous refused');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const wrong = await g.call('/api/v1/admin/ship-badges/sellers', { token: pt });
  assert.equal(wrong.status, 403, 'partner refused');
});

await t.test('B2. sellers status rows carry badge facts and reasons', async () => {
  const { g, adm } = await adminGateway();
  const r = await g.call('/api/v1/admin/ship-badges/sellers?q=SB&per_page=50', { token: adm });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.policies.today_ship_min_rate_bps, '8000', 'rate policy echoed');
  assert.equal(r.json.policies.tomorrow_ship_enabled, true, 'enable flag echoed');
  assert.equal(r.json.now_kst, '10:00', 'pinned clock echoed');
  const byPid = (id) => r.json.data.find((s) => s.partner_id === id);
  const a = byPid('pt_sb_a');
  assert.equal(a.business_name, 'SB a', 'seller named');
  assert.equal(a.today_cutoff, '15:00', 'cutoff surfaced');
  assert.equal(a.processing_days, 1, 'processing days surfaced');
  assert.equal(a.shipped_30d, 10, 'history counted');
  assert.equal(a.same_day_rate_bps, 9000, 'rate computed');
  assert.equal(a.badge_now, 'TODAY', 'pre-cutoff + rate-ok = TODAY');
  assert.equal(a.badge_reason, 'ELIGIBLE', 'reason eligible');
  assert.equal(byPid('pt_sb_b').badge_now, 'TOMORROW', 'post-cutoff + rate-ok = TOMORROW');
  assert.equal(byPid('pt_sb_f').badge_now, 'TOMORROW', 'boundary 8000 = TOMORROW');
  assert.equal(byPid('pt_sb_c').badge_now, 'NONE', 'low rate = NONE');
  assert.equal(byPid('pt_sb_c').badge_reason, 'RATE_BELOW', 'reason rate');
  assert.equal(byPid('pt_sb_d').badge_reason, 'NO_TEMPLATE', 'reason no template');
  assert.equal(byPid('pt_sb_e').badge_reason, 'NO_HISTORY', 'reason no history');
  assert.equal(byPid('pt_sb_e').same_day_rate_bps, null, 'no rate without history');
});

await t.test('B3. sellers status search and pagination', async () => {
  const { g, adm } = await adminGateway();
  const one = await g.call('/api/v1/admin/ship-badges/sellers?q=SB%20b', { token: adm });
  assert.equal(one.status, 200, one.text);
  assert.equal(one.json.pagination.total, 1, 'search narrows to one');
  assert.equal(one.json.data[0].partner_id, 'pt_sb_b', 'right seller');
  const p1 = await g.call('/api/v1/admin/ship-badges/sellers?q=SB&per_page=2&page=1', { token: adm });
  const p2 = await g.call('/api/v1/admin/ship-badges/sellers?q=SB&per_page=2&page=2', { token: adm });
  assert.equal(p1.json.pagination.total, 6, 'six seeded sellers');
  assert.equal(p1.json.data.length, 2, 'page size honored');
  assert.ok(!p2.json.data.find((s) => s.partner_id === p1.json.data[0].partner_id), 'pages do not overlap');
});

await t.test('B4. cutoff edit validates, applies, clears, and 404s cleanly', async () => {
  const { g, adm } = await adminGateway();
  const bad = await g.call('/api/v1/admin/partners/pt_sb_a/shipping-cutoff', {
    method: 'PUT', token: adm, body: { today_cutoff: '25:00' }
  });
  assert.equal(bad.status, 400, 'bad clock rejected');
  assert.equal(bad.json.code || bad.json.error, 'INVALID_CUTOFF', 'error code');
  const bad2 = await g.call('/api/v1/admin/partners/pt_sb_a/shipping-cutoff', {
    method: 'PUT', token: adm, body: { today_cutoff: 'nope' }
  });
  assert.equal(bad2.status, 400, 'garbage rejected');
  const miss = await g.call('/api/v1/admin/partners/pt_missing/shipping-cutoff', {
    method: 'PUT', token: adm, body: { today_cutoff: '17:00' }
  });
  assert.equal(miss.status, 404, 'unknown partner 404');
  const noTpl = await g.call('/api/v1/admin/partners/pt_sb_d/shipping-cutoff', {
    method: 'PUT', token: adm, body: { today_cutoff: '17:00' }
  });
  assert.equal(noTpl.status, 404, 'template-less seller 404, never invented');
  const ok = await g.call('/api/v1/admin/partners/pt_sb_a/shipping-cutoff', {
    method: 'PUT', token: adm, body: { today_cutoff: '08:00' }
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.today_cutoff, '08:00', 'new cutoff echoed');
  const st = await g.call('/api/v1/admin/ship-badges/sellers?q=SB%20a', { token: adm });
  assert.equal(st.json.data[0].today_cutoff, '08:00', 'status reflects edit');
  assert.equal(st.json.data[0].badge_now, 'TOMORROW', 'badge flips after cutoff passes');
  const clear = await g.call('/api/v1/admin/partners/pt_sb_a/shipping-cutoff', {
    method: 'PUT', token: adm, body: { today_cutoff: null }
  });
  assert.equal(clear.status, 200, clear.text);
  const st2 = await g.call('/api/v1/admin/ship-badges/sellers?q=SB%20a', { token: adm });
  assert.equal(st2.json.data[0].today_cutoff, null, 'cutoff cleared');
  assert.equal(st2.json.data[0].badge_reason, 'NO_CUTOFF', 'reason no cutoff');
});

await t.test('B5. cutoff edit is audit-logged and role-guarded', async () => {
  const { g, adm } = await adminGateway();
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const wrong = await g.call('/api/v1/admin/partners/pt_sb_a/shipping-cutoff', {
    method: 'PUT', token: pt, body: { today_cutoff: '17:00' }
  });
  assert.equal(wrong.status, 403, 'partner cannot edit');
  await g.call('/api/v1/admin/partners/pt_sb_a/shipping-cutoff', {
    method: 'PUT', token: adm, body: { today_cutoff: '16:00' }
  });
  const row = g.db.prepare("SELECT * FROM admin_audit_log WHERE action = 'SHIP_CUTOFF_UPSERT' AND target_id = 'pt_sb_a'").get();
  assert.ok(row, 'audit row written');
  assert.match(String(row.after_json || row.after || ''), /16:00/, 'new value in audit');
});

await t.test('B6. disabled flag turns TOMORROW rows to NONE with reason', async () => {
  const g = await newGateway({ testNowKst: '10:00' });
  seedSellers(g, { rateBps: '8000', tomorrowOn: '0' });
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const r = await g.call('/api/v1/admin/ship-badges/sellers?q=SB%20b', { token: adm });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.policies.tomorrow_ship_enabled, false, 'flag echoed off');
  assert.equal(r.json.data[0].badge_now, 'NONE', 'tomorrow suppressed');
  assert.equal(r.json.data[0].badge_reason, 'TOMORROW_DISABLED', 'reason disabled');
});

t.finish();
