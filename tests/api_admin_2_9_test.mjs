// tests/api_admin_2_9_test.mjs
// Work order 2-9 admin APIs.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Admin APIs (2-9)');

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

await t.test('A1. dashboard carries waiting queues', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  g.db.prepare("INSERT INTO users (id, email, password_hash, full_name, phone, role) VALUES ('u_pa1', 'pa1@example.com', 'x', 'P', '010', 'ROLE_PARTNER')").run();
  g.db.prepare("INSERT INTO partners (id, owner_user_id, business_name, business_reg_number, bank_code, bank_account_number, bank_account_holder, status, applied_at) VALUES ('pt_pa1', 'u_pa1', 't', '111-11-11111', '004', '123', '예금주', 'PENDING', CURRENT_TIMESTAMP)").run();
  const r = await g.call('/api/v1/admin/dashboard', { token: adm });
  assert.equal(r.status, 200, r.text);
  const w = r.json.waiting;
  assert.ok(w, 'waiting block present');
  assert.equal(w.partner_applications, 1, 'pending partner counted');
  assert.ok(Number.isInteger(w.product_reviews), 'product queue counted');
  assert.ok(Number.isInteger(w.disputes), 'disputes counted');
  assert.ok(Number.isInteger(w.payout_requests), 'payout queue counted');
  assert.ok(Number.isInteger(w.fds_reviews), 'fds queue counted');
});

await t.test('A2. notice templates version up, products keep theirs', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const bad = await g.call('/api/v1/admin/notice-templates', {
    method: 'POST', token: adm, body: { name: 'x', items: [{ label: 'no key' }] }
  });
  assert.equal(bad.status, 400, 'items need keys');
  const c = await g.call('/api/v1/admin/notice-templates', {
    method: 'POST', token: adm, body: { name: '가전', items: [{ key: '모델명', label: '모델명', required: 1 }] }
  });
  assert.equal(c.status, 201, c.text);
  assert.equal(c.json.data.version, 1, 'starts at version 1');
  g.db.prepare('UPDATE products SET notice_template_id = ?, notice_template_version = 1 WHERE id = ?').run(c.json.data.id, 'prod_001');
  const u = await g.call(`/api/v1/admin/notice-templates/${c.json.data.id}`, {
    method: 'PUT', token: adm, body: { items: [{ key: '모델명', label: '모델명', required: 1 }, { key: '제조사', label: '제조사' }] }
  });
  assert.equal(u.status, 200, u.text);
  assert.equal(u.json.data.version, 2, 'edit bumps the version');
  assert.equal(g.db.prepare('SELECT notice_template_version FROM products WHERE id = ?').get('prod_001').notice_template_version, 1, 'product keeps its version');
  const list = await g.call('/api/v1/admin/notice-templates', { token: adm });
  assert.ok(list.json.data.find((x) => x.id === c.json.data.id), 'template listed');
});

await t.test('A3. category commission bounds and forward-only rates', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const over = await g.call('/api/v1/admin/categories/cat_e_audio', {
    method: 'PUT', token: adm, body: { commission_rate_bps: 3001 }
  });
  assert.equal(over.status, 400, 'commission capped at 3000bps');
  const neg = await g.call('/api/v1/admin/categories/cat_e_audio', {
    method: 'PUT', token: adm, body: { commission_rate_bps: -1 }
  });
  assert.equal(neg.status, 400, 'commission is non-negative');
  const missing = await g.call('/api/v1/admin/categories/cat_missing', {
    method: 'PUT', token: adm, body: { commission_rate_bps: 100 }
  });
  assert.equal(missing.status, 404, 'unknown category rejected');
  g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status)
    VALUES ('prod_a3', 'pt_002', 'cat_e_audio', 't', 'https://x/y.png', '<p>t</p>', 20000, 15000, 'ACTIVE', 'APPROVED')`).run();
  g.db.prepare(`INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, status)
    VALUES ('sku_a3', 'prod_a3', 'C-A3', '{}', 20000, 15000, 100, 'IN_STOCK')`).run();
  const co1 = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울 강남구', shipping_postal_code: '06236', items: [{ sku_id: 'sku_a3', quantity: 1 }] }
  });
  assert.equal(co1.status, 201, co1.text);
  const oldAmt = g.db.prepare('SELECT commission_amount AS a FROM settlements WHERE sub_order_id = (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(co1.json.order_id).a;
  const ok = await g.call('/api/v1/admin/categories/cat_e_audio', {
    method: 'PUT', token: adm, body: { commission_rate_bps: 2500, icon_key: 'audio' }
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(g.db.prepare('SELECT icon_key FROM categories WHERE id = ?').get('cat_e_audio').icon_key, 'audio', 'icon stored');
  const co2 = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울 강남구', shipping_postal_code: '06236', items: [{ sku_id: 'sku_a3', quantity: 1 }] }
  });
  assert.equal(co2.status, 201, co2.text);
  const fresh = g.db.prepare('SELECT commission_amount AS a, fee_source AS f FROM settlements WHERE sub_order_id = (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(co2.json.order_id);
  assert.equal(fresh.a, 3750, 'new orders price the new rate');
  assert.equal(fresh.f, 'CATEGORY', 'category source recorded');
  assert.equal(g.db.prepare('SELECT commission_amount AS a FROM settlements WHERE sub_order_id = (SELECT id FROM sub_orders WHERE parent_order_id = ?)').get(co1.json.order_id).a, oldAmt, 'old settlements untouched');
});

await t.test('A4. platform policies record history, future only', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const past = await g.call('/api/v1/admin/platform-policies', {
    method: 'PUT', token: adm, body: { key: 'credit.earn_bps', value: '100', effective_from: '2001-01-01' }
  });
  assert.equal(past.status, 400, 'backdates refused');
  const nokey = await g.call('/api/v1/admin/platform-policies', {
    method: 'PUT', token: adm, body: { value: '100', effective_from: '2999-01-01' }
  });
  assert.equal(nokey.status, 400, 'key required');
  const c = await g.call('/api/v1/admin/platform-policies', {
    method: 'PUT', token: adm, body: { key: 'credit.earn_bps', value: '100', effective_from: '2999-01-01' }
  });
  assert.equal(c.status, 200, c.text);
  // 5-8: same key + same day overwrites (history kept); same key + another
  // day coexists as a separate scheduled row.
  const u = await g.call('/api/v1/admin/platform-policies', {
    method: 'PUT', token: adm, body: { key: 'credit.earn_bps', value: '200', effective_from: '2999-01-01' }
  });
  assert.equal(u.status, 200, u.text);
  const hist = g.db.prepare('SELECT old_value, new_value FROM platform_policy_history WHERE policy_key = ? ORDER BY created_at DESC').get('credit.earn_bps');
  assert.deepEqual([hist.old_value, hist.new_value], ['100', '200'], 'history recorded');
  const f = await g.call('/api/v1/admin/platform-policies', {
    method: 'PUT', token: adm, body: { key: 'credit.earn_bps', value: '300', effective_from: '2999-06-01' }
  });
  assert.equal(f.status, 200, f.text);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM platform_policies WHERE key = ?').get('credit.earn_bps').n, 2, 'future row coexists');
  const list = await g.call('/api/v1/admin/platform-policies', { token: adm });
  assert.ok(list.json.data.find((x) => x.key === 'credit.earn_bps'), 'policy listed');
});

await t.test('A5. flash campaigns, direct picks and application review', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const bad = await g.call('/api/v1/admin/flash-sales', {
    method: 'POST', token: adm, body: { title: 'x', starts_at: '2999-02-01 00:00:00', ends_at: '2999-01-01 00:00:00' }
  });
  assert.equal(bad.status, 400, 'campaign window ordered');
  const hourAgo = new Date(Date.now() - 3600000).toISOString().replace('T', ' ').slice(0, 19);
  const hourLater = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').slice(0, 19);
  const c = await g.call('/api/v1/admin/flash-sales', {
    method: 'POST', token: adm, body: { title: '설 특가', starts_at: hourAgo, ends_at: hourLater, status: 'ACTIVE' }
  });
  assert.equal(c.status, 201, c.text);
  const camp = c.json.data.id;
  const direct = await g.call(`/api/v1/admin/flash-sales/${camp}/items`, {
    method: 'POST', token: adm, body: { sku_id: 'sku_001_w', deal_price: 39900, allocated_stock: 5 }
  });
  assert.equal(direct.status, 201, direct.text);
  assert.equal(g.db.prepare('SELECT status FROM flash_sale_items WHERE id = ?').get(direct.json.data.id).status, 'APPROVED', 'direct picks skip review');
  const pricey = await g.call(`/api/v1/admin/flash-sales/${camp}/items`, {
    method: 'POST', token: adm, body: { sku_id: 'sku_001_b', deal_price: 49900, allocated_stock: 5 }
  });
  assert.equal(pricey.status, 400, 'deal below sale enforced');
  g.db.prepare(`INSERT INTO flash_sale_items (id, campaign_id, product_id, sku_id, deal_price, discount_rate, allocated_stock, sold_stock, sort_order, status, applicant_partner_id)
    VALUES ('fsi_a5', ?, 'prod_001', 'sku_001_b', 39900, 20, 5, 0, 9, 'REQUESTED', 'pt_001')`).run(camp);
  const rej = await g.call(`/api/v1/admin/flash-sales/${camp}/items/fsi_a5`, {
    method: 'PUT', token: adm, body: { decision: 'REJECT' }
  });
  assert.equal(rej.status, 200, rej.text);
  assert.equal(g.db.prepare('SELECT status FROM flash_sale_items WHERE id = ?').get('fsi_a5').status, 'REJECTED', 'application rejected');
  g.db.prepare("UPDATE flash_sale_items SET status = 'REQUESTED' WHERE id = 'fsi_a5'").run();
  const ok = await g.call(`/api/v1/admin/flash-sales/${camp}/items/fsi_a5`, {
    method: 'PUT', token: adm, body: { decision: 'APPROVE' }
  });
  assert.equal(ok.status, 200, ok.text);
  const live = await g.call(`/api/v1/admin/flash-sales/${camp}/items/fsi_a5`, {
    method: 'PUT', token: adm, body: { deal_price: 35000 }
  });
  assert.equal(live.status, 409, 'live deal prices stay put');
  const list = await g.call('/api/v1/admin/flash-sales', { token: adm });
  assert.ok(list.json.data.find((x) => x.id === camp), 'campaign listed');
});

await t.test('A6. exhibitions manage windows and products', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const bad = await g.call('/api/v1/admin/exhibitions', {
    method: 'POST', token: adm, body: { title: 'x', starts_at: '2999-02-01 00:00:00', ends_at: '2999-01-01 00:00:00' }
  });
  assert.equal(bad.status, 400, 'window ordered');
  const ghost = await g.call('/api/v1/admin/exhibitions', {
    method: 'POST', token: adm, body: { title: 'x', starts_at: '2999-01-01 00:00:00', ends_at: '2999-02-01 00:00:00', product_ids: ['prod_missing'] }
  });
  assert.equal(ghost.status, 400, 'products must exist');
  const c = await g.call('/api/v1/admin/exhibitions', {
    method: 'POST', token: adm, body: { title: '봄 기획전', starts_at: '2999-01-01 00:00:00', ends_at: '2999-02-01 00:00:00', product_ids: ['prod_001', 'prod_002'] }
  });
  assert.equal(c.status, 201, c.text);
  const id = c.json.data.id;
  const u = await g.call(`/api/v1/admin/exhibitions/${id}`, {
    method: 'PUT', token: adm, body: { status: 'ACTIVE', product_ids: ['prod_003'] }
  });
  assert.equal(u.status, 200, u.text);
  assert.deepEqual(g.db.prepare('SELECT product_id AS p FROM exhibition_products WHERE exhibition_id = ? ORDER BY sort_order').all(id).map((r) => r.p), ['prod_003'], 'products replaced');
  const list = await g.call('/api/v1/admin/exhibitions', { token: adm });
  assert.ok(list.json.data.find((x) => x.id === id), 'exhibition listed');
});

await t.test('A7. platform coupons split burden and suspend sellers too', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const noseller = await g.call('/api/v1/admin/coupons', {
    method: 'POST', token: adm,
    body: { code: 'PLAT5K', title: 't', discount_type: 'FIXED_AMOUNT', discount_value: 5000, scope: 'SELLER', platform_share_bps: 8000 }
  });
  assert.equal(noseller.status, 400, 'seller burden needs target sellers');
  const c = await g.call('/api/v1/admin/coupons', {
    method: 'POST', token: adm,
    body: { code: 'PLAT5K', title: 't', discount_type: 'FIXED_AMOUNT', discount_value: 5000, scope: 'SELLER', platform_share_bps: 8000, seller_ids: ['pt_002'] }
  });
  assert.equal(c.status, 201, c.text);
  const row = g.db.prepare('SELECT issuer, dup_group, scope, platform_share_bps FROM coupons WHERE id = ?').get(c.json.data.id);
  assert.deepEqual([row.issuer, row.dup_group, row.scope, row.platform_share_bps], ['PLATFORM', 'PLATFORM', 'SELLER', 8000], 'platform split stored');
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM coupon_targets WHERE coupon_id = ? AND target_id = ?').get(c.json.data.id, 'pt_002').n, 1, 'target sellers stored');
  const u = await g.call(`/api/v1/admin/coupons/${c.json.data.id}`, {
    method: 'PUT', token: adm, body: { title: '바뀐 제목' }
  });
  assert.equal(u.status, 200, u.text);
  g.db.prepare("INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, expires_at, is_active, issuer, seller_id, scope, platform_share_bps, dup_group, issue_method, issued_count) VALUES ('cp_a7s', 'SELLERA7', 't', 'FIXED_AMOUNT', 500, 0, '2099-01-01 00:00:00', 1, 'SELLER', 'pt_001', 'SELLER', 0, 'STORE', 'DOWNLOAD', 0)").run();
  const susp = await g.call('/api/v1/admin/coupons/cp_a7s/suspend', { method: 'PUT', token: adm });
  assert.equal(susp.status, 200, susp.text);
  assert.equal(g.db.prepare('SELECT is_active FROM coupons WHERE id = ?').get('cp_a7s').is_active, 0, 'seller coupon suspended by the operator');
});

await t.test('A8. payout requests approve, reject and complete', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt2 = await login(g, 'partner2@olmoa-tech.com', 'PARTNER');
  g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status)
    VALUES ('prod_a8', 'pt_002', 'cat_e_audio', 't', 'https://x/y.png', '<p>t</p>', 20000, 15000, 'ACTIVE', 'APPROVED')`).run();
  g.db.prepare(`INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, status)
    VALUES ('sku_a8', 'prod_a8', 'C-A8', '{}', 20000, 15000, 100, 'IN_STOCK')`).run();
  const co = await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울 강남구', shipping_postal_code: '06236', items: [{ sku_id: 'sku_a8', quantity: 1 }] }
  });
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust, body: { order_id: co.json.order_id, payment_key: `sandbox_${co.json.order_id.slice(-8)}xx`, amount: co.json.total_pay_amount }
  });
  assert.equal(pay.status, 200, pay.text);
  g.db.prepare("UPDATE settlements SET status = 'ELIGIBLE_FOR_PAYOUT' WHERE sub_order_id = (SELECT id FROM sub_orders WHERE parent_order_id = ?)").run(co.json.order_id);
  g.db.prepare('UPDATE partners SET payout_account_verified = 1 WHERE id = ?').run('pt_002');
  const avail = g.db.prepare("SELECT net_payout_amount FROM settlements WHERE sub_order_id = (SELECT id FROM sub_orders WHERE parent_order_id = ?)").get(co.json.order_id).net_payout_amount;
  const req1 = await g.call('/api/v1/partner/payout-requests', {
    method: 'POST', token: pt2, headers: { 'X-Idempotency-Key': 'a8-req-1' }, body: {}
  });
  assert.equal(req1.status, 201, req1.text);
  const list = await g.call('/api/v1/admin/payout-requests', { token: adm });
  assert.ok(list.json.data.find((x) => x.id === req1.json.data.id), 'request queued');
  const noReason = await g.call(`/api/v1/admin/payout-requests/${req1.json.data.id}`, {
    method: 'PUT', token: adm, body: { decision: 'REJECT', idempotency_key: 'a8-rej-0' }
  });
  assert.equal(noReason.status, 400, 'reject needs a reason');
  const rej = await g.call(`/api/v1/admin/payout-requests/${req1.json.data.id}`, {
    method: 'PUT', token: adm, body: { decision: 'REJECT', reason: '계좌 확인 중', idempotency_key: 'a8-rej-1' }
  });
  assert.equal(rej.status, 200, rej.text);
  const req = await g.call('/api/v1/partner/payout-requests', {
    method: 'POST', token: pt2, headers: { 'X-Idempotency-Key': 'a8-req-2' }, body: { amount: avail }
  });
  assert.equal(req.status, 201, req.text);
  const nokey = await g.call(`/api/v1/admin/payout-requests/${req.json.data.id}`, {
    method: 'PUT', token: adm, body: { decision: 'APPROVE' }
  });
  assert.equal(nokey.status, 400, 'idempotency key required');
  const approve = await g.call(`/api/v1/admin/payout-requests/${req.json.data.id}`, {
    method: 'PUT', token: adm, body: { decision: 'APPROVE', idempotency_key: 'a8-pay-1' }
  });
  assert.equal(approve.status, 200, approve.text);
  assert.equal(g.db.prepare('SELECT status FROM payout_requests WHERE id = ?').get(req.json.data.id).status, 'APPROVED', 'request approved');
  const done = await g.call(`/api/v1/admin/payout-requests/${req.json.data.id}`, {
    method: 'PUT', token: adm, body: { decision: 'TRANSFER', bank_transfer_ref: 'KB-A8-1', idempotency_key: 'a8-trn-1' }
  });
  assert.equal(done.status, 200, done.text);
  assert.equal(g.db.prepare('SELECT status FROM payout_requests WHERE id = ?').get(req.json.data.id).status, 'TRANSFERRED', 'transfer mirrored');
});

await t.test('A9. penalty rules gate imposition, appeals get decided', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const put = await g.call('/api/v1/admin/penalty-rules', {
    method: 'PUT', token: adm, body: { code: 'LATE_DISPATCH', name: '늦은 출고', points: 10, amount: 5000, is_enabled: 0 }
  });
  assert.equal(put.status, 200, put.text);
  const off = await g.call('/api/v1/admin/partners/pt_001/penalties', {
    method: 'POST', token: adm, body: { rule_code: 'LATE_DISPATCH', reason: '늦음' }
  });
  assert.equal(off.status, 409, 'disabled rules cannot impose');
  const ghost = await g.call('/api/v1/admin/partners/pt_001/penalties', {
    method: 'POST', token: adm, body: { rule_code: 'NOPE', reason: 'x' }
  });
  assert.equal(ghost.status, 404, 'unknown rules rejected');
  await g.call('/api/v1/admin/penalty-rules', {
    method: 'PUT', token: adm, body: { code: 'LATE_DISPATCH', name: '늦은 출고', points: 10, amount: 5000, is_enabled: 1 }
  });
  const imp = await g.call('/api/v1/admin/partners/pt_001/penalties', {
    method: 'POST', token: adm, body: { rule_code: 'LATE_DISPATCH', reason: '늦음' }
  });
  assert.equal(imp.status, 201, imp.text);
  const row = g.db.prepare('SELECT rule_code, points, penalty_amount, status FROM partner_penalties WHERE id = ?').get(imp.json.data.id);
  assert.deepEqual([row.rule_code, row.points, row.penalty_amount, row.status], ['LATE_DISPATCH', 10, 5000, 'IMPOSED'], 'rule values applied');
  g.db.prepare("UPDATE partner_penalties SET appeal_body = '택배 파업' WHERE id = ?").run(imp.json.data.id);
  const dec = await g.call(`/api/v1/admin/penalties/${imp.json.data.id}`, {
    method: 'PUT', token: adm, body: { decision: 'REVOKE', note: '소명 인정' }
  });
  assert.equal(dec.status, 200, dec.text);
  assert.equal(g.db.prepare('SELECT status FROM partner_penalties WHERE id = ?').get(imp.json.data.id).status, 'REVOKED', 'appeal upheld');
  const rules = await g.call('/api/v1/admin/penalty-rules', { token: adm });
  assert.ok(rules.json.data.find((x) => x.code === 'LATE_DISPATCH'), 'rules listed');
});

await t.test('A10. grade policies drive the monthly recompute', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const put = await g.call('/api/v1/admin/grade-policies', {
    method: 'PUT', token: adm, body: { grade_code: 'GOLD', name: '골드', sort_order: 10, min_sales: 0, is_enabled: 1 }
  });
  assert.equal(put.status, 200, put.text);
  const badMonth = await g.call('/api/v1/admin/grades/compute', { method: 'POST', token: adm, body: { month: '2026-13' } });
  assert.equal(badMonth.status, 400, 'month validated');
  const run = await g.call('/api/v1/admin/grades/compute', { method: 'POST', token: adm, body: { month: '2026-10' } });
  assert.equal(run.status, 200, run.text);
  assert.ok(run.json.data.computed >= 2, 'every seller graded');
  assert.equal(g.db.prepare("SELECT grade_code FROM partner_grades WHERE partner_id = 'pt_001' AND month = '2026-10'").get().grade_code, 'GOLD', 'top policy assigned');
  const list = await g.call('/api/v1/admin/grade-policies', { token: adm });
  assert.ok(list.json.data.find((x) => x.grade_code === 'GOLD'), 'policies listed');
});

await t.test('A11. reported reviews queue and blind out of aggregates', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content)
    VALUES ('rv_a11', 'prod_001', 'u_customer_001', 't', 5, 'x')`).run();
  g.db.prepare(`INSERT INTO review_reports (id, review_id, reporter_user_id, reason) VALUES ('rr_a11', 'rv_a11', 'u_customer_001', 'AD')`).run();
  const before = g.db.prepare('SELECT review_count FROM products WHERE id = ?').get('prod_001').review_count;
  const queue = await g.call('/api/v1/admin/review-reports', { token: adm });
  assert.equal(queue.status, 200, queue.text);
  assert.ok(queue.json.data.find((x) => x.review_id === 'rv_a11'), 'report queued');
  const bad = await g.call('/api/v1/admin/reviews/rv_a11/visibility', {
    method: 'PUT', token: adm, body: { visibility: 'HIDDEN' }
  });
  assert.equal(bad.status, 400, 'visibility validated');
  const blind = await g.call('/api/v1/admin/reviews/rv_a11/visibility', {
    method: 'PUT', token: adm, body: { visibility: 'BLIND', blind_reason: '광고' }
  });
  assert.equal(blind.status, 200, blind.text);
  assert.equal(g.db.prepare('SELECT visibility FROM product_reviews WHERE id = ?').get('rv_a11').visibility, 'BLIND', 'review blinded');
  assert.equal(g.db.prepare('SELECT review_count FROM products WHERE id = ?').get('prod_001').review_count, before - 1, 'aggregates drop the blind review');
});

await t.test('A12. admin lists paginate, filter by period and export csv', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content, created_at)
    VALUES ('rv_a12n', 'prod_001', 'u_customer_001', 't', 4, 'x', CURRENT_TIMESTAMP)`).run();
  g.db.prepare(`INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content, created_at)
    VALUES ('rv_a12o', 'prod_001', 'u_customer_001', 't', 4, 'x', '2001-01-01 00:00:00')`).run();
  const page = await g.call('/api/v1/admin/reviews?per_page=1', { token: adm });
  assert.equal(page.json.data.length, 1, 'pagination applies');
  assert.equal(page.json.pagination.total, 2, 'total counts all');
  const today = new Date().toISOString().slice(0, 10);
  const fresh = await g.call(`/api/v1/admin/reviews?from=${today}&to=${today}`, { token: adm });
  assert.equal(fresh.json.pagination.total, 1, 'period excludes the old row');
  const users = await g.call('/api/v1/admin/users?per_page=1', { token: adm });
  assert.equal(users.json.data.length, 1, 'users paginate');
  assert.ok(users.json.pagination.total >= 1, 'users total present');
  const products = await g.call('/api/v1/admin/products?per_page=1', { token: adm });
  assert.equal(products.json.data.length, 1, 'products paginate');
  const log = await g.call('/api/v1/admin/privacy/access-log?per_page=1', { token: adm });
  assert.ok(log.json.pagination, 'access log paginates');
  const csv = await g.call('/api/v1/admin/reviews?format=csv', { token: adm });
  assert.equal(csv.status, 200, csv.text);
  assert.match(csv.headers.get('content-type') || '', /text\/csv/, 'csv content type');
  assert.ok(csv.text.includes('rv_a12n'), 'csv carries review rows');
});

await t.test('A13. dashboard compares today with yesterday and lists queues', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: {
      recipient_name: '홍길동', recipient_phone: '010-1234-5678',
      shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236',
      items: [{ sku_id: 'sku_001_w', quantity: 1 }]
    }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o)}`);
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust,
    body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount }
  });
  assert.equal(pay.status, 200, pay.text);
  // Sandbox payments flag is_sandbox=1; the dashboard counts live GMV only,
  // so flip the row to model a live payment.
  g.db.prepare('UPDATE orders SET is_sandbox = 0 WHERE id = ?').run(o.order_id);
  const r = await g.call('/api/v1/admin/dashboard', { token: adm });
  assert.equal(r.status, 200, r.text);
  const c = r.json.compare;
  assert.ok(c.gmv.today > 0 && c.orders.today >= 1, 'today reflects the paid order');
  assert.ok(Number.isInteger(c.gmv.yesterday) && Number.isInteger(c.orders.yesterday), 'yesterday present');
  assert.ok(Number.isInteger(c.users.today) && Number.isInteger(c.applications.today), 'user and application compares present');
  for (const k of ['review_queue', 'open_claims', 'open_disputes', 'payout_pending_amount', 'fds_reviews']) {
    assert.ok(Number.isInteger(c[k]), `snapshot ${k} present`);
  }
  const q = r.json.queues;
  assert.ok(q.partner_applications.length <= 5 && q.product_reviews.length <= 5 && q.disputes.length <= 5, 'queues capped at 5');
  const kstToday = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const row = r.json.series30.find((s) => s.day === kstToday);
  assert.ok(row && row.orders >= 1 && row.gmv > 0, '30-day series carries today (KST)');
  assert.ok(Array.isArray(r.json.category_sales), 'category sales present');
  assert.ok(r.json.category_sales.every((s) => typeof s.category === 'string' && Number.isInteger(s.gmv)), 'category rows shaped');
});

function seedApplication(g, tag, brn) {
  g.db.prepare(`INSERT INTO users (id, email, password_hash, full_name, phone, role)
    VALUES (?, ?, 'x', '담당', '010', 'ROLE_PARTNER')`).run(`u_a14_${tag}`, `a14_${tag}@example.com`);
  g.db.prepare(`INSERT INTO partners (id, owner_user_id, business_name, business_reg_number, bank_code, bank_account_number,
      bank_account_holder, status, kyc_status, applied_at, submitted_at, representative_name, mail_order_reg_number)
    VALUES (?, ?, ?, ?, '004', '123456', '예금주', 'PENDING', 'SUBMITTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '대표', '제2026-1호')`)
    .run(`pt_a14_${tag}`, `u_a14_${tag}`, `상호${tag}`, brn);
  for (const dt of ['BUSINESS_REGISTRATION', 'MAIL_ORDER_REGISTRATION', 'BANK_ACCOUNT_COPY']) {
    g.db.prepare(`INSERT INTO storage_objects (id, original_name, content_type, byte_size, folder, public_url)
      VALUES (?, 'd.pdf', 'application/pdf', 10, 'kyb', 'https://x/y')`).run(`so_a14_${tag}_${dt}`);
    g.db.prepare(`INSERT INTO partner_kyb_documents (id, partner_id, doc_type, storage_object_id, status)
      VALUES (?, ?, ?, ?, 'SUBMITTED')`).run(`kyb_a14_${tag}_${dt}`, `pt_a14_${tag}`, dt, `so_a14_${tag}_${dt}`);
  }
  return `pt_a14_${tag}`;
}

await t.test('A14. application approve, resubmit and reject end to end', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pApprove = seedApplication(g, 'ok', '111-11-11111');
  const pResub = seedApplication(g, 're', '222-22-22222');
  const pReject = seedApplication(g, 'no', '333-33-33333');
  const list = await g.call('/api/v1/admin/partner-applications?kyc_status=SUBMITTED', { token: adm });
  assert.ok(list.json.data.some((x) => x.partner_id === pApprove), 'applicant queued');
  const brn = await g.call('/api/v1/admin/partner-applications?kyc_status=SUBMITTED&brn=2222222222', { token: adm });
  assert.ok(brn.json.data.some((x) => x.partner_id === pResub) && !brn.json.data.some((x) => x.partner_id === pApprove), 'brn narrows');
  const badPeriod = await g.call('/api/v1/admin/partner-applications?from=nope', { token: adm });
  assert.equal(badPeriod.status, 400, 'period validated');
  const detail = await g.call(`/api/v1/admin/partner-applications/${pApprove}`, { token: adm });
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.data.documents.length, 3, 'detail carries documents');
  const noNote = await g.call(`/api/v1/admin/partner-applications/${pReject}/review`, { method: 'POST', token: adm, body: { decision: 'REJECT' } });
  assert.equal(noNote.status, 400, 'reject needs a reason');
  const noDocs = await g.call(`/api/v1/admin/partner-applications/${pApprove}/review`, {
    method: 'POST', token: adm, body: { decision: 'APPROVE', commission_rate: 8, business_status_evidence: '국세청 계속사업자', confirm_documents_checked: false }
  });
  assert.equal(noDocs.status, 400, 'approve needs the document-match confirmation');
  const ok = await g.call(`/api/v1/admin/partner-applications/${pApprove}/review`, {
    method: 'POST', token: adm, body: { decision: 'APPROVE', commission_rate: 8, business_status_evidence: '국세청 계속사업자', confirm_documents_checked: true }
  });
  assert.equal(ok.status, 200, ok.text);
  const approved = g.db.prepare('SELECT status, kyc_status, commission_rate_bps FROM partners WHERE id = ?').get(pApprove);
  assert.deepEqual([approved.status, approved.kyc_status, approved.commission_rate_bps], ['APPROVED', 'APPROVED', 800], 'approved with commission');
  const resub = await g.call(`/api/v1/admin/partner-applications/${pResub}/review`, {
    method: 'POST', token: adm, body: { decision: 'REQUEST_RESUBMIT', note: '통장 사본이 흐립니다', rejected_document_ids: [`kyb_a14_re_BANK_ACCOUNT_COPY`] }
  });
  assert.equal(resub.status, 200, resub.text);
  assert.equal(g.db.prepare('SELECT kyc_status FROM partners WHERE id = ?').get(pResub).kyc_status, 'RESUBMIT_REQUIRED', 'resubmit queued');
  assert.equal(g.db.prepare('SELECT status FROM partner_kyb_documents WHERE id = ?').get('kyb_a14_re_BANK_ACCOUNT_COPY').status, 'REJECTED', 'doc flagged');
  const rej = await g.call(`/api/v1/admin/partner-applications/${pReject}/review`, {
    method: 'POST', token: adm, body: { decision: 'REJECT', note: '서류 불일치' }
  });
  assert.equal(rej.status, 200, rej.text);
  assert.equal(g.db.prepare('SELECT status FROM partners WHERE id = ?').get(pReject).status, 'REJECTED', 'rejected');
  const again = await g.call(`/api/v1/admin/partner-applications/${pReject}/review`, {
    method: 'POST', token: adm, body: { decision: 'REJECT', note: 'x' }
  });
  assert.equal(again.status, 409, 'second ruling refused');
});

await t.test('A15. seller detail bundles account, penalties, grade and stats', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const d = await g.call('/api/v1/admin/partners/pt_001', { token: adm });
  assert.equal(d.status, 200, d.text);
  assert.ok(d.json.data.partner && d.json.data.stats && Array.isArray(d.json.data.penalties), 'detail shaped');
  assert.ok(d.json.data.partner.bank_account_number.startsWith('****'), 'account masked');
  const missing = await g.call('/api/v1/admin/partners/pt_missing', { token: adm });
  assert.equal(missing.status, 404, 'unknown seller 404s');
  const badRate = await g.call('/api/v1/admin/partners/pt_001/commission', { method: 'PUT', token: adm, body: { commission_rate: 99 } });
  assert.equal(badRate.status, 400, 'commission range enforced');
  const set = await g.call('/api/v1/admin/partners/pt_001/commission', { method: 'PUT', token: adm, body: { commission_rate: 7.5 } });
  assert.equal(set.status, 200, set.text);
  assert.equal(g.db.prepare('SELECT commission_rate_bps FROM partners WHERE id = ?').get('pt_001').commission_rate_bps, 750, 'base rate stored');
});

await t.test('A16. product filters narrow the list', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status)
    VALUES ('prod_a16', 'pt_001', 'cat_e_audio', 'a16', 'https://x/y.png', '<p>t</p>', 20000, 15000, 'ACTIVE', 'APPROVED')`).run();
  const byPartner = await g.call('/api/v1/admin/products?partner_id=pt_001&per_page=200', { token: adm });
  assert.ok(byPartner.json.data.some((x) => x.id === 'prod_a16'), 'partner narrows');
  assert.ok(byPartner.json.data.every((x) => x.partner_id === 'pt_001'), 'partner excludes others');
  const byCat = await g.call('/api/v1/admin/products?category=cat_e_audio&per_page=200', { token: adm });
  assert.ok(byCat.json.data.some((x) => x.id === 'prod_a16'), 'category narrows');
  const byStatus = await g.call('/api/v1/admin/products?status=ACTIVE', { token: adm });
  assert.ok(byStatus.json.data.every((x) => x.status === 'ACTIVE'), 'status narrows');
  const badStatus = await g.call('/api/v1/admin/products?status=BOGUS', { token: adm });
  assert.equal(badStatus.status, 400, 'status validated');
  const byPrice = await g.call('/api/v1/admin/products?min_price=15000&max_price=15000', { token: adm });
  assert.ok(byPrice.json.data.some((x) => x.id === 'prod_a16'), 'price window hits');
  const outPrice = await g.call('/api/v1/admin/products?min_price=99999999', { token: adm });
  assert.ok(!outPrice.json.data.some((x) => x.id === 'prod_a16'), 'price window excludes');
  const byReview = await g.call('/api/v1/admin/products?review_status=APPROVED', { token: adm });
  assert.ok(byReview.json.data.every((x) => x.review_status === 'APPROVED'), 'review status narrows');
});

await t.test('A17. review queue flags images, notice, banned, hype and hikes', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price,
      lowest_sale_price, status, review_status, notice_template_id, notice_info_json)
    VALUES ('prod_a17', 'pt_001', 'cat_e_audio', '최저가 보장 불법복제 음반', 'https://x/y.png', '<p>본문</p>', 15000, 7000,
      'DRAFT', 'PENDING', 'nt_a17', '{"제조국": "한국"}')`).run();
  g.db.prepare(`INSERT INTO notice_templates (id, name, items_json) VALUES ('nt_a17', 't',
    '[{"key": "제조국", "required": true}, {"key": "AS책임자", "required": true}]')`).run();
  g.db.prepare(`INSERT INTO category_banned_words (id, category_id, word) VALUES ('cbw_a17', 'cat_e_audio', '불법복제')`).run();
  g.db.prepare(`INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, status)
    VALUES ('sku_a17', 'prod_a17', 'C-A17', '{}', 15000, 7000, 10, 'IN_STOCK')`).run();
  g.db.prepare(`INSERT INTO sku_price_history (id, sku_id, original_price, sale_price, changed_at) VALUES
    ('sph1', 'sku_a17', 10000, 9000, datetime('now', '-10 days')),
    ('sph2', 'sku_a17', 15000, 9000, datetime('now', '-5 days')),
    ('sph3', 'sku_a17', 15000, 7000, datetime('now', '-1 day'))`).run();
  const q = await g.call('/api/v1/admin/products/review-queue', { token: adm });
  assert.equal(q.status, 200, q.text);
  const row = q.json.data.find((x) => x.id === 'prod_a17');
  assert.ok(row, 'pending product queued');
  assert.equal(row.checks.images.ok, false, 'missing gallery flagged');
  assert.deepEqual(row.checks.notice.missing, ['AS책임자'], 'missing notice item flagged');
  assert.ok(row.checks.banned_words.includes('불법복제'), 'banned word flagged');
  assert.ok(row.checks.exaggeration.includes('최저가 보장'), 'hype flagged');
  assert.ok(row.checks.price_hike && row.checks.price_hike.original_raised === 15000, 'pre-discount hike flagged');
  g.db.prepare(`INSERT INTO product_images (id, product_id, image_url) VALUES ('pi_a17', 'prod_a17', 'https://x/i.png')`).run();
  const q2 = await g.call('/api/v1/admin/products/review-queue', { token: adm });
  assert.equal(q2.json.data.find((x) => x.id === 'prod_a17').checks.images.ok, true, 'gallery clears the flag');
});

await t.test('A18. category banned words save; fee changes price new orders only', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const badWords = await g.call('/api/v1/admin/categories/cat_e_audio', { method: 'PUT', token: adm, body: { banned_words: 'nope' } });
  assert.equal(badWords.status, 400, 'banned words need an array');
  const setWords = await g.call('/api/v1/admin/categories/cat_e_audio', { method: 'PUT', token: adm, body: { banned_words: ['불법복제', '불법복제', ''] } });
  assert.equal(setWords.status, 200, setWords.text);
  assert.deepEqual(setWords.json.data.banned_words, ['불법복제'], 'words deduped and trimmed');
  const list = await g.call('/api/v1/admin/categories', { token: adm });
  assert.ok(list.json.data.find((c) => c.id === 'cat_e_audio').banned_words.includes('불법복제'), 'list carries words');
  g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status)
    VALUES ('prod_a18', 'pt_002', 'cat_e_audio', 'a18', 'https://x/y.png', '<p>t</p>', 20000, 15000, 'ACTIVE', 'APPROVED')`).run();
  g.db.prepare(`INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, status)
    VALUES ('sku_a18', 'prod_a18', 'C-A18', '{}', 20000, 15000, 100, 'IN_STOCK')`).run();
  const addr = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };
  const buy = async () => (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust, body: { ...addr, items: [{ sku_id: 'sku_a18', quantity: 1 }] }
  })).json.order_id;
  const setFee = async (bps) => {
    const r = await g.call('/api/v1/admin/categories/cat_e_audio', { method: 'PUT', token: adm, body: { commission_rate_bps: bps } });
    assert.equal(r.status, 200, r.text);
  };
  await setFee(500);
  const o1 = await buy();
  await setFee(1200);
  const o2 = await buy();
  const bpsOf = (orderId) => g.db.prepare(
    'SELECT st.commission_rate_bps AS bps FROM settlements st JOIN sub_orders s ON s.id = st.sub_order_id WHERE s.parent_order_id = ?'
  ).get(orderId).bps;
  assert.equal(bpsOf(o1), 500, 'first order keeps the old rate');
  assert.equal(bpsOf(o2), 1200, 'second order takes the new rate');
  await setFee(null);
  const cleared = await g.call('/api/v1/admin/categories/cat_e_audio', { method: 'PUT', token: adm, body: { banned_words: [] } });
  assert.deepEqual(cleared.json.data.banned_words, [], 'words cleared');
});

await t.test('A19. split ruling refunds a line subset of the claim', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: {
      recipient_name: '홍길동', recipient_phone: '010-1234-5678',
      shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236',
      items: [{ sku_id: 'sku_001_w', quantity: 2 }]
    }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o)}`);
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust,
    body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount }
  });
  assert.equal(pay.status, 200, pay.text);
  const sub = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(o.order_id).id;
  g.db.prepare("UPDATE sub_orders SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP WHERE id = ?").run(sub);
  const item = g.db.prepare('SELECT id, quantity FROM order_items WHERE sub_order_id = ?').get(sub);
  const claim = await g.call(`/api/v1/orders/${o.order_id}/claims`, {
    method: 'POST', token: cust, body: { claim_type: 'RETURN', reason: '변심', items: [{ order_item_id: item.id, quantity: 2 }] }
  });
  assert.equal(claim.status, 201, claim.text);
  const badLine = await g.call(`/api/v1/admin/claims/${claim.json.claim_id}`, {
    method: 'PUT', token: adm, body: { decision: 'APPROVE', lines: [{ order_item_id: 'oi_missing', quantity: 1 }] }
  });
  assert.equal(badLine.status, 400, 'foreign lines refused');
  const split = await g.call(`/api/v1/admin/claims/${claim.json.claim_id}`, {
    method: 'PUT', token: adm, body: { decision: 'APPROVE', lines: [{ order_item_id: item.id, quantity: 1 }] }
  });
  assert.equal(split.status, 200, split.text);
  assert.equal(split.json.split, true, 'partial subset flagged as split');
  const left = g.db.prepare('SELECT quantity, refunded_quantity FROM order_items WHERE id = ?').get(item.id);
  assert.equal(left.refunded_quantity, 1, 'one unit refunded');
  assert.equal(left.quantity - left.refunded_quantity, 1, 'one unit left with the buyer');
  const queued = await g.call('/api/v1/admin/claims?status=REFUNDED', { token: adm });
  assert.ok(queued.json.data.some((x) => x.id === claim.json.claim_id), 'status filter finds the ruling');
});

await t.test('A20. order list pages across ten thousand rows', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  g.db.exec('BEGIN');
  const ins = g.db.prepare(`INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount,
    total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1,
    shipping_address_line2, shipping_postal_code) VALUES (?, ?, 'u_customer_001', 1000, 0, 0, 1000, 'PAID', 'n', 'p', 'a', '', '06236')`);
  for (let i = 0; i < 10000; i++) ins.run(`o_a20_${i}`, `A20-${i}`);
  g.db.exec('COMMIT');
  const p2 = await g.call('/api/v1/admin/orders?per_page=50&page=2', { token: adm });
  assert.equal(p2.status, 200, p2.text);
  assert.equal(p2.json.data.length, 50, 'full page returned');
  assert.ok(p2.json.pagination.total >= 10000, 'total counts all rows');
  assert.equal(p2.json.pagination.total_pages, Math.ceil(p2.json.pagination.total / 50), 'page math consistent');
  const byNo = await g.call('/api/v1/admin/orders?q=A20-4242', { token: adm });
  assert.ok(byNo.json.data.some((o) => o.order_no === 'A20-4242'), 'order-no search hits');
  const csv = await g.call('/api/v1/admin/orders?format=csv&q=A20-4242', { token: adm });
  assert.equal(csv.status, 200, csv.text);
  assert.match(csv.headers.get('content-type') || '', /text\/csv/, 'csv content type');
  assert.ok(csv.text.includes('A20-4242'), 'csv carries the row');
  const bad = await g.call('/api/v1/admin/orders?status=BOGUS', { token: adm });
  assert.equal(bad.status, 400, 'status validated');
});

await t.test('A21. policy history lists changes and backdates are refused', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const past = await g.call('/api/v1/admin/platform-policies', {
    method: 'PUT', token: adm, body: { key: 'pg.fee_bps', value: '300', effective_from: '2001-01-01' }
  });
  assert.equal(past.status, 400, 'backdate refused');
  const set = await g.call('/api/v1/admin/platform-policies', {
    method: 'PUT', token: adm, body: { key: 'pg.fee_bps', value: '300', effective_from: today }
  });
  assert.equal(set.status, 200, set.text);
  const set2 = await g.call('/api/v1/admin/platform-policies', {
    method: 'PUT', token: adm, body: { key: 'pg.fee_bps', value: '350', effective_from: today }
  });
  assert.equal(set2.status, 200, set2.text);
  const hist = await g.call('/api/v1/admin/platform-policies/history?key=pg.fee_bps', { token: adm });
  assert.equal(hist.status, 200, hist.text);
  assert.ok(hist.json.data.some((h) => h.old_value === '300' && h.new_value === '350'), 'change recorded');
  const payouts = await g.call('/api/v1/admin/finance/payouts', { token: adm });
  assert.equal(payouts.status, 200, payouts.text);
  assert.ok(Array.isArray(payouts.json.data.pending), 'pending shaped');
  assert.ok(payouts.json.data.pending.every((p) => 'settlement_cycle' in p), 'cycle carried for batching');
});

await t.test('A22. banner placement and windows gate storefront exposure', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const badPos = await g.call('/api/v1/admin/banners', {
    method: 'POST', token: adm, body: { title: 'x', image_url: 'https://x/i.png', position: 'SIDEBAR' }
  });
  assert.equal(badPos.status, 400, 'position validated');
  const badWin = await g.call('/api/v1/admin/banners', {
    method: 'POST', token: adm, body: { title: 'x', image_url: 'https://x/i.png', starts_at: '2030-01-02', ends_at: '2030-01-01' }
  });
  assert.equal(badWin.status, 400, 'window ordered');
  const hero = await g.call('/api/v1/admin/banners', {
    method: 'POST', token: adm, body: { title: 'A22 hero', image_url: 'https://x/hero.png', position: 'HOME_HERO' }
  });
  assert.equal(hero.status, 201, hero.text);
  const strip = await g.call('/api/v1/admin/banners', {
    method: 'POST', token: adm, body: { title: 'A22 strip', image_url: 'https://x/strip.png', position: 'HOME_STRIP' }
  });
  assert.equal(strip.status, 201, strip.text);
  const old = await g.call('/api/v1/admin/banners', {
    method: 'POST', token: adm, body: { title: 'A22 old', image_url: 'https://x/old.png', starts_at: '2001-01-01', ends_at: '2001-01-02' }
  });
  assert.equal(old.status, 201, old.text);
  const pub = await g.call('/api/v1/banners');
  assert.ok(pub.json.data.some((b) => b.id === hero.json.data.id), 'hero exposed by default');
  assert.ok(!pub.json.data.some((b) => b.id === strip.json.data.id), 'strip hidden by default');
  assert.ok(!pub.json.data.some((b) => b.id === old.json.data.id), 'expired window hidden');
  const all = await g.call('/api/v1/banners?position=ALL');
  assert.ok(all.json.data.some((b) => b.id === strip.json.data.id), 'strip selectable');
});

await t.test('A23. flash campaign, seller apply, approve, home exposure', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  g.db.prepare("UPDATE flash_sale_campaigns SET status = 'ENDED'").run();
  const now = new Date();
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const camp = await g.call('/api/v1/admin/flash-sales', {
    method: 'POST', token: adm,
    body: { title: 'A23 특가', starts_at: fmt(new Date(now.getTime() - 3600000)), ends_at: fmt(new Date(now.getTime() + 3600000)), status: 'ACTIVE' }
  });
  assert.equal(camp.status, 201, camp.text);
  const campId = camp.json.data.id;
  const deal = 10000;
  const sale = g.db.prepare('SELECT sale_price, stock_quantity FROM product_skus WHERE id = ?').get('sku_001_w');
  assert.ok(deal < sale.sale_price && sale.stock_quantity >= 5, 'seed sku fits the deal');
  const apply = await g.call(`/api/v1/partner/flash-sales/${campId}/apply`, {
    method: 'POST', token: pt, body: { sku_id: 'sku_001_w', deal_price: deal, allocated_stock: 5 }
  });
  assert.equal(apply.status, 201, apply.text);
  const itemId = apply.json.data.id;
  const decide = await g.call(`/api/v1/admin/flash-sales/${campId}/items/${itemId}`, {
    method: 'PUT', token: adm, body: { decision: 'APPROVE' }
  });
  assert.equal(decide.status, 200, decide.text);
  const feed = await g.call('/api/v1/campaigns/lightning');
  assert.equal(feed.json.campaign.id, campId, 'campaign live on home');
  const row = feed.json.items.find((it) => it.id === itemId);
  assert.ok(row, 'approved item exposed');
  assert.equal(row.charged_price, deal, 'feed charges the deal price');
  assert.equal(row.sold_percent, 0, 'sell-through starts at zero');
});

await t.test('A24. platform coupon stats split platform and seller shares', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const c = await g.call('/api/v1/admin/coupons', {
    method: 'POST', token: adm,
    body: { code: 'A24PLAT', title: 'A24 플랫폼', discount_type: 'FIXED_AMOUNT', discount_value: 2000, platform_share_bps: 5000 }
  });
  assert.equal(c.status, 201, c.text);
  const couponId = c.json.data.id;
  const claim = await g.call('/api/v1/coupons/claim', {
    method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'a24-claim-1' }, body: { code: 'A24PLAT' }
  });
  assert.equal(claim.status, 200, claim.text);
  // Seller burden exists only on MARKETPLACE lines (pt_002 in the dev seed).
  g.db.prepare(`INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status, review_status)
    VALUES ('prod_a24', 'pt_002', 'cat_e_audio', 'a24', 'https://x/y.png', '<p>t</p>', 20000, 15000, 'ACTIVE', 'APPROVED')`).run();
  g.db.prepare(`INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, status)
    VALUES ('sku_a24', 'prod_a24', 'C-A24', '{}', 20000, 15000, 100, 'IN_STOCK')`).run();
  const o = (await g.call('/api/v1/orders/checkout', {
    method: 'POST', token: cust,
    body: {
      recipient_name: '홍길동', recipient_phone: '010-1234-5678',
      shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236',
      items: [{ sku_id: 'sku_a24', quantity: 1 }], platform_coupon_id: claim.json.user_coupon_id
    }
  })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o)}`);
  const list = await g.call('/api/v1/admin/coupons', { token: adm });
  const row2 = list.json.data.find((x) => x.id === couponId);
  assert.equal(row2.used_count, 1, 'use counted');
  assert.equal(row2.platform_discount_total, 2000, 'discount totalled');
  assert.equal(row2.platform_seller_share, 1000, 'seller half split out');
  const stop = await g.call(`/api/v1/admin/coupons/${couponId}/suspend`, { method: 'PUT', token: adm });
  assert.equal(stop.status, 200, stop.text);
  assert.equal(g.db.prepare('SELECT is_active FROM coupons WHERE id = ?').get(couponId).is_active, 0, 'suspended');
});

await t.test('A25. member search, withdrawal filter and reasoned export', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const byName = await g.call(`/api/v1/admin/users?q=${encodeURIComponent('Jane')}`, { token: adm });
  assert.ok(byName.json.data.some((u) => u.id === 'u_customer_001'), 'name search hits');
  const byPhone = await g.call('/api/v1/admin/users?q=5555', { token: adm });
  assert.ok(byPhone.json.data.some((u) => u.id === 'u_customer_001'), 'phone search hits');
  g.db.prepare("UPDATE users SET withdrawn_at = CURRENT_TIMESTAMP, is_active = 0 WHERE id = 'u_customer_001'").run();
  const gone = await g.call('/api/v1/admin/users?status=WITHDRAWN', { token: adm });
  assert.ok(gone.json.data.some((u) => u.id === 'u_customer_001'), 'withdrawal filter hits');
  const live = await g.call('/api/v1/admin/users?status=ACTIVE', { token: adm });
  assert.ok(!live.json.data.some((u) => u.id === 'u_customer_001'), 'withdrawn excluded from active');
  const noReason = await g.call('/api/v1/admin/users?format=csv', { token: adm });
  assert.equal(noReason.status, 400, 'export needs a reason');
  const csv = await g.call(`/api/v1/admin/users?format=csv&reason=${encodeURIComponent('CS 처리')}`, { token: adm });
  assert.equal(csv.status, 200, csv.text);
  const logged = g.db.prepare("SELECT reason FROM pii_access_log WHERE action = 'EXPORT' AND resource = 'admin.users' ORDER BY created_at DESC LIMIT 1").get();
  assert.equal(logged.reason, 'CS 처리', 'export reason recorded');
});

await t.test('A26. inquiries take an operator assignee', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  g.db.prepare(`INSERT INTO support_inquiries (id, user_id, category, subject, content, status) VALUES ('inq_a26', 'u_customer_001', 'OTHER', 's', 'c', 'OPEN')`).run();
  const opId = g.db.prepare("SELECT id FROM users WHERE email = 'admin@openmarket.com'").get().id;
  const bad = await g.call('/api/v1/admin/inquiries/inq_a26', { method: 'PUT', token: adm, body: { assignee_admin_id: 'u_customer_001' } });
  assert.equal(bad.status, 400, 'non-operators refused');
  const set = await g.call('/api/v1/admin/inquiries/inq_a26', { method: 'PUT', token: adm, body: { assignee_admin_id: opId } });
  assert.equal(set.status, 200, set.text);
  assert.equal(g.db.prepare('SELECT assignee_admin_id FROM support_inquiries WHERE id = ?').get('inq_a26').assignee_admin_id, opId, 'assignee stored');
  const clear = await g.call('/api/v1/admin/inquiries/inq_a26', { method: 'PUT', token: adm, body: { assignee_admin_id: null } });
  assert.equal(clear.status, 200, clear.text);
  g.db.prepare("UPDATE support_inquiries SET status = 'CLOSED' WHERE id = 'inq_a26'").run();
  const shut = await g.call('/api/v1/admin/inquiries/inq_a26', { method: 'PUT', token: adm, body: { assignee_admin_id: opId } });
  assert.equal(shut.status, 409, 'closed inquiries frozen');
});

await t.test('A27. disabled rules block imposition; history and grades list', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  const rule = await g.call('/api/v1/admin/penalty-rules', {
    method: 'PUT', token: adm, body: { code: 'A27_LATE', name: 'A27 지각', points: 5, amount: 10000, is_enabled: false }
  });
  assert.equal(rule.status, 200, rule.text);
  const blocked = await g.call('/api/v1/admin/partners/pt_001/penalties', {
    method: 'POST', token: adm, body: { rule_code: 'A27_LATE', reason: '발송 지연' }
  });
  assert.equal(blocked.status, 409, 'disabled rule blocks imposition');
  await g.call('/api/v1/admin/penalty-rules', {
    method: 'PUT', token: adm, body: { code: 'A27_LATE', name: 'A27 지각', points: 5, amount: 10000, is_enabled: true }
  });
  const imp = await g.call('/api/v1/admin/partners/pt_001/penalties', {
    method: 'POST', token: adm, body: { rule_code: 'A27_LATE', reason: '발송 지연' }
  });
  assert.equal(imp.status, 201, imp.text);
  const penId = imp.json.data.id;
  const appeal = await g.call(`/api/v1/partner/penalties/${penId}/appeal`, {
    method: 'POST', token: pt, body: { body: '택배사 파업으로 불가피했습니다' }
  });
  assert.equal(appeal.status, 200, appeal.text);
  const hist = await g.call('/api/v1/admin/penalties?partner_id=pt_001', { token: adm });
  assert.ok(hist.json.data.some((x) => x.id === penId && x.appeal_body), 'history carries the appeal');
  const queue = await g.call('/api/v1/admin/penalties?appealed=true', { token: adm });
  assert.ok(queue.json.data.some((x) => x.id === penId), 'appeal queue finds it');
  const uphold = await g.call(`/api/v1/admin/penalties/${penId}`, { method: 'PUT', token: adm, body: { decision: 'UPHOLD', note: '기각' } });
  assert.equal(uphold.status, 200, uphold.text);
  const comp = await g.call('/api/v1/admin/grades/compute', { method: 'POST', token: adm, body: { month: '2026-10' } });
  assert.equal(comp.status, 200, comp.text);
  const grades = await g.call('/api/v1/admin/grades?month=2026-10', { token: adm });
  assert.equal(grades.status, 200, grades.text);
  assert.ok(grades.json.data.length > 0, 'monthly results listed');
  const badMonth = await g.call('/api/v1/admin/grades?month=tomorrow', { token: adm });
  assert.equal(badMonth.status, 400, 'month validated');
});

t.finish();
