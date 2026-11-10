// tests/p1_sec_test.mjs
// P1 security regression suite: P1-C01..C10 + C-N01 (COMMERCIALIZATION_REMAINING_2026-11-10).
// Run: node tests/p1_sec_test.mjs   (requires: node scripts/gen-dev-seed.mjs once)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGateway, createRunner } from './lib/harness.mjs';
import { validateProductUrl } from '../apps/cloudflare-gateway/src/services/crawler/url-validator.js';
import { crawlAndExtractProduct } from '../apps/cloudflare-gateway/src/services/crawler/crawler-service.js';
import { sanitizeHtml } from '../apps/cloudflare-gateway/src/services/crawler/html-sanitizer.js';
import { classify } from '../apps/cloudflare-gateway/src/lib/ratelimit.js';
import { totpAt, currentStep } from '../apps/cloudflare-gateway/src/lib/totp.js';
import { stripToSafeHtml } from '../apps/partner/src/utils/stripHtml.ts';

const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = { JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox', PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef' };

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

const t = createRunner('P1 Security Regression (C01..C10, C-N01)');

// ---------- P1-C01: SSRF redirect re-validation + IPv6 blocks ----------
await t.test('P1-C01 validator blocks IPv6/private literals, allows public hosts', async () => {
  assert.equal(validateProductUrl('http://[::1]/admin').valid, false);
  assert.equal(validateProductUrl('http://[0:0:0:0:0:ffff:10.0.0.1]/x').valid, false);
  assert.equal(validateProductUrl('http://[fc00::1]/x').valid, false);
  assert.equal(validateProductUrl('http://[fe80::1]/x').valid, false);
  assert.equal(validateProductUrl('http://localhost./x').valid, false);
  assert.equal(validateProductUrl('http://127.0.0.1:8080/x').valid, false);
  const ok = validateProductUrl('https://shop.example.com/items/1');
  assert.equal(ok.valid, true);
  assert.equal(ok.domain, 'shop.example.com');
});

await t.test('P1-C01 crawler follows redirects manually and re-validates every hop', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), redirect: init && init.redirect });
      if (String(url).includes('evil-redirect')) {
        return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
      }
      if (String(url).includes('good-redirect')) {
        return new Response('', { status: 302, headers: { location: 'https://cdn.example.com/p/1' } });
      }
      return new Response(
        '<html><head><meta property="og:title" content="T" /><meta property="og:image" content="https://cdn.example.com/i.jpg" /><meta property="product:price:amount" content="10000" /></head></html>',
        { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const evil = await crawlAndExtractProduct({ url: 'https://evil-redirect.example.com/start' });
    assert.equal(evil.success, false);
    assert.equal(evil.error_code, 'SSRF_OR_INVALID_URL');
    assert.ok(!seen.some((s) => s.url.includes('169.254.169.254')), 'metadata IP must never be fetched');
    assert.ok(seen.every((s) => s.redirect === 'manual'), 'every hop uses redirect:manual');
    const good = await crawlAndExtractProduct({ url: 'https://good-redirect.example.com/start' });
    assert.equal(good.success, true);
    assert.ok(seen.some((s) => s.url.includes('cdn.example.com')), 'safe redirect is followed');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- P1-C02: server allowlist sanitize on save ----------
await t.test('P1-C02 sanitizer kills slash-separated handlers, keeps legit content', async () => {
  assert.ok(!/onerror/i.test(sanitizeHtml('<img/src=x/onerror=alert(document.cookie)>')));
  assert.ok(!/javascript:/i.test(sanitizeHtml('<a href="javascript:alert(1)">x</a>')));
  assert.ok(!/<script/i.test(sanitizeHtml('<p>t</p><script>alert(1)</script>')));
  const clean = sanitizeHtml('<p>안전 설명</p><img src="https://c.example/i.jpg" alt="a">');
  assert.ok(clean.includes('안전 설명') && clean.includes('https://c.example/i.jpg'));
});

await t.test('P1-C02 product create/update stores sanitized HTML only', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const payload = '<p>안전 설명</p><img/src=x/onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">x</a>';
  const c = await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: {
    title: 'XSS 저장 테스트', sale_price: 10000, original_price: 12000, category_id: 'cat_e_audio',
    thumbnail_url: 'https://cdn.example/t.png', stock_quantity: 5, description_html: payload } });
  assert.equal(c.status, 201, c.text);
  let stored = g.one('SELECT description_html d FROM products WHERE id = ?', c.json.product_id).d;
  assert.ok(!/onerror|<script|javascript:/i.test(stored), `stored must be clean: ${stored.slice(0, 120)}`);
  assert.ok(stored.includes('안전 설명'));
  const u = await g.call(`/api/v1/partner/products/${c.json.product_id}`, { method: 'PUT', token: pt, body: { description_html: payload } });
  assert.equal(u.status, 200, u.text);
  stored = g.one('SELECT description_html d FROM products WHERE id = ?', c.json.product_id).d;
  assert.ok(!/onerror|<script|javascript:/i.test(stored));
});

// ---------- P1-C03: negotiation list authz ----------
await t.test('P1-C03 customers get 403, partners scoped, admins full', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const pt1 = await g.login('seller@temu-supply.com', 'PARTNER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const p1 = g.one("SELECT id FROM products WHERE partner_id = 'pt_001' LIMIT 1").id;
  let p2row = g.one("SELECT id FROM products WHERE partner_id = 'pt_002' LIMIT 1");
  if (!p2row) {
    const pt2 = await g.login('partner2@olmoa-tech.com', 'PARTNER');
    const c = await g.call('/api/v1/partner/products', { method: 'POST', token: pt2, body: {
      title: 'nego seed', sale_price: 5000, original_price: 6000, category_id: 'cat_e_audio',
      thumbnail_url: 'https://cdn.example/t.png', stock_quantity: 1 } });
    assert.equal(c.status, 201, c.text);
    p2row = { id: c.json.product_id };
  }
  const adminId = g.one("SELECT id FROM users WHERE email = 'admin@openmarket.com'").id;
  g.db.prepare('INSERT INTO price_negotiations (id, product_id, partner_id, current_sale_price, suggested_target_price, md_proposal_notes, proposed_by) VALUES (?,?,?,?,?,?,?)')
    .run('ngo_c03_a', p1, 'pt_001', 49900, 45900, 'md', adminId);
  g.db.prepare('INSERT INTO price_negotiations (id, product_id, partner_id, current_sale_price, suggested_target_price, md_proposal_notes, proposed_by) VALUES (?,?,?,?,?,?,?)')
    .run('ngo_c03_b', p2row.id, 'pt_002', 9000, 8000, 'md', adminId);
  assert.equal((await g.call('/api/v1/pricing/negotiations', { token: cust })).status, 403);
  const s = await g.call('/api/v1/pricing/negotiations', { token: pt1 });
  assert.equal(s.status, 200, s.text);
  assert.ok(s.json.data.length >= 1 && s.json.data.every((r) => r.partner_id === 'pt_001'));
  const a = await g.call('/api/v1/pricing/negotiations', { token: adm });
  assert.equal(a.status, 200, a.text);
  assert.ok(a.json.data.length >= 2);
});

// ---------- P1-C04: phone masked at collection ----------
await t.test('P1-C04 channel order sync stores masked phone, never raw', async () => {
  const g = await boot({ CONNECTOR_SIMULATION: 'true' });
  g.db.prepare("UPDATE feature_flags SET is_enabled = 1 WHERE key = 'marketplace_order_sync'").run();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const r = await g.call('/api/v1/channels/orders/sync', { method: 'POST', token: pt, body: { sales_channel_id: 'sc_naver_smartstore' } });
  assert.equal(r.status, 200, r.text);
  const rows = g.all('SELECT recipient_phone_masked m FROM channel_orders');
  assert.ok(rows.length >= 1);
  for (const row of rows) {
    assert.ok(row.m.includes('****'), `must be masked: ${row.m}`);
    assert.ok(!row.m.includes('9876'), 'raw middle digits must not be stored');
  }
});

// ---------- P1-C05: webhook oracle closed ----------
await t.test('P1-C05 live webhook hides outcome; garbage keys never burn Toss calls', async () => {
  const g = await boot({ PAYMENT_MODE: 'live', TOSS_SECRET_KEY: 'test_secret_for_p1c05' });
  const realFetch = globalThis.fetch;
  let tossCalls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.tosspayments.com')) {
        tossCalls++;
        return new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 });
      }
      return realFetch(url, init);
    };
    const r = await g.call('/api/v1/payments/webhook', { method: 'POST', body: {
      eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey: 'paym_validkey123', orderId: 'ORD-NONE', status: 'DONE' } } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.success, true);
    assert.ok(!('outcome' in r.json), 'live response must not oracle validity');
    assert.equal(tossCalls, 1);
    const g2 = await g.call('/api/v1/payments/webhook', { method: 'POST', body: {
      eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey: '!!! not a key !!!', orderId: 'ORD-NONE', status: 'DONE' } } });
    assert.equal(g2.status, 200, g2.text);
    assert.equal(tossCalls, 1, 'malformed key must not reach Toss');
    assert.ok(!('outcome' in g2.json));
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- P1-C06: first-enrollment approval ----------
await t.test('P1-C06 setup is audited; enable needs SUPER_ADMIN approval when required', async () => {
  const g = await boot({ ADMIN_MFA_APPROVAL_REQUIRED: 'true' });
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const adminId = g.one("SELECT id FROM users WHERE email = 'admin@openmarket.com'").id;
  const s = await g.call('/api/v1/auth/2fa/setup', { method: 'POST', token: adm });
  assert.equal(s.status, 200, s.text);
  assert.equal(g.one("SELECT COUNT(*) c FROM admin_audit_log WHERE action = 'ADMIN_MFA_SETUP_STARTED' AND target_id = ?", adminId).c, 1);
  const code = await totpAt(s.json.data.secret, currentStep());
  const denied = await g.call('/api/v1/auth/2fa/enable', { method: 'POST', token: adm, body: { code } });
  assert.equal(denied.status, 409);
  assert.equal(denied.json.code, 'MFA_APPROVAL_REQUIRED');
  const ap = await g.call(`/api/v1/admin/admin-users/${adminId}`, { method: 'PUT', token: adm, body: { approve_2fa: true } });
  assert.equal(ap.status, 200, ap.text);
  const adm2 = await g.login('admin@openmarket.com', 'ADMIN'); // approval revokes sessions like any account change
  const ok = await g.call('/api/v1/auth/2fa/enable', { method: 'POST', token: adm2, body: { code: await totpAt(s.json.data.secret, currentStep()) } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.data.recovery_codes.length, 10);
});

// ---------- P1-C07: PII view logging on the 5 residual reads ----------
await t.test('P1-C07 all five PII reads write pii_access_log VIEW rows', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const custId = g.one("SELECT id FROM users WHERE email = 'customer@example.com'").id;
  g.db.prepare('INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, rating, content) VALUES (?,?,?,?,?,?)')
    .run('rev_c07', 'prod_001', custId, 'T', 5, 'c');
  g.db.prepare('INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code, pccc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('ord_c07', 'ORD-C07', custId, 10000, 0, 0, 10000, 'READY', 'R', '010-1111-2222', 'A', '', '06236', 'P123456789012');
  g.db.prepare('INSERT INTO returns (id, order_id, user_id, claim_type, reason) VALUES (?,?,?,?,?)')
    .run('ret_c07', 'ord_c07', custId, 'RETURN', 'r');
  g.db.prepare('INSERT INTO notifications (id, user_id, title, message, type) VALUES (?,?,?,?,?)')
    .run('ntf_c07', custId, 't', 'm', 'SYSTEM');
  g.db.prepare('INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('sub_c07', 'ord_c07', 'SUB-C07', 'pt_001', 0, 10000, 0, 10000, 'PAYMENT_CONFIRMED');
  g.db.prepare('INSERT INTO purchase_orders (id, po_no, supplier_id, sub_order_id, fulfillment_mode, total_cost) VALUES (?,?,?,?,?,?)')
    .run('po_c07', 'PO-C07', 'sup_dev_001', 'sub_c07', 'DROP_SHIP', 1000);
  for (const path of ['/api/v1/admin/reviews', '/api/v1/admin/claims', '/api/v1/admin/notifications', '/api/v1/admin/disputes', '/api/v1/admin/purchase-orders']) {
    const r = await g.call(path, { token: adm });
    assert.equal(r.status, 200, `${path}: ${r.text}`);
  }
  const logged = g.all("SELECT DISTINCT resource r FROM pii_access_log WHERE action = 'VIEW'").map((x) => x.r);
  for (const res of ['admin.reviews', 'admin.claims', 'admin.notifications', 'admin.disputes', 'admin.purchase-orders']) {
    assert.ok(logged.includes(res), `missing VIEW log for ${res} (have: ${logged.join(',')})`);
  }
});

// ---------- P1-C08: audit trail on state changes ----------
await t.test('P1-C08 credential/negotiation/dispatch writes audit rows', async () => {
  const g = await boot({ CONNECTOR_SIMULATION: 'true' });
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const adminId = g.one("SELECT id FROM users WHERE email = 'admin@openmarket.com'").id;
  const cr = await g.call('/api/v1/channels/credentials', { method: 'POST', token: pt, body: {
    platform_id: 'naver_smartstore', api_key: 'test-api-key-1234567890', credential_name: 'c07' } });
  assert.equal(cr.status, 201, cr.text);
  g.db.prepare('INSERT INTO price_negotiations (id, product_id, partner_id, current_sale_price, suggested_target_price, md_proposal_notes, proposed_by) VALUES (?,?,?,?,?,?,?)')
    .run('ngo_c08', 'prod_001', 'pt_001', 49900, 45900, 'md', adminId);
  const nr = await g.call('/api/v1/partner/pricing/negotiations/ngo_c08/respond', { method: 'POST', token: pt, body: { accept: false } });
  assert.equal(nr.status, 200, nr.text);
  const dr = await g.call('/api/v1/notifications/dispatch', { method: 'POST', token: adm, body: { recipient: '01012345678', content: 'x' } });
  assert.equal(dr.status, 200, dr.text);
  const actions = g.all('SELECT DISTINCT action a FROM admin_audit_log').map((x) => x.a);
  for (const a of ['CHANNEL_CREDENTIAL_SAVE', 'NEGOTIATION_RESPOND', 'SMS_DISPATCH']) {
    assert.ok(actions.includes(a), `missing audit ${a} (have: ${actions.join(',')})`);
  }
});

await t.test('P1-C08 supplier PO lifecycle + inventory sync write audit rows', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  g.db.prepare("UPDATE feature_flags SET is_enabled = 1 WHERE key IN ('auto_supplier_po','fulfillment_3pl','stock_sync')").run();
  const sku = g.one("SELECT s.id, s.stock_quantity FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' LIMIT 1");
  g.db.prepare('UPDATE product_skus SET wholesale_supply_price = 3000 WHERE id = ?').run(sku.id);
  g.db.prepare('INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('ord_c08', 'ORD-C08', g.one("SELECT id FROM users WHERE email = 'customer@example.com'").id, 49900, 0, 0, 49900, 'PAID', 'R', '010-1111-2222', 'A', '', '06236');
  g.db.prepare('INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('sub_c08', 'ord_c08', 'SUB-C08', 'pt_001', 0, 49900, 0, 49900, 'PAYMENT_CONFIRMED');
  g.db.prepare('INSERT INTO order_items (id, sub_order_id, sku_id, product_title, option_summary, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?,?,?)')
    .run('itm_c08', 'sub_c08', sku.id, 't', '기본', 1, 49900, 49900);
  const po = await g.call('/api/v1/supplier-orders', { method: 'POST', token: pt, body: { sub_order_id: 'sub_c08', supplier_id: 'sup_dev_001' } });
  assert.equal(po.status, 201, po.text);
  const poId = po.json.data.id;
  assert.equal((await g.call(`/api/v1/supplier-orders/${poId}/respond`, { method: 'POST', token: pt, body: { action: 'ACCEPT' } })).status, 200);
  const dp = await g.call(`/api/v1/supplier-orders/${poId}/dispatch`, { method: 'POST', token: pt, body: { carrier_code: 'CJ대한통운', tracking_number: '682910482012' } });
  assert.equal(dp.status, 200, dp.text);
  const sy = await g.call('/api/v1/sync/supplier-inventory', { method: 'POST', token: pt, body: { sku_id: sku.id, supplier_id: 'sup_dev_001', new_stock: sku.stock_quantity + 1 } });
  assert.equal(sy.status, 200, sy.text);
  const actions = g.all('SELECT DISTINCT action a FROM admin_audit_log').map((x) => x.a);
  for (const a of ['SUPPLIER_PO_CREATE', 'SUPPLIER_PO_RESPOND', 'SUPPLIER_PO_DISPATCH', 'SUPPLIER_INVENTORY_SYNC']) {
    assert.ok(actions.includes(a), `missing audit ${a} (have: ${actions.join(',')})`);
  }
});

// ---------- P1-C09: bank/PCCC masked by default ----------
await t.test('P1-C09 admin APIs mask bank accounts and PCCC (last-4)', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const custId = g.one("SELECT id FROM users WHERE email = 'customer@example.com'").id;
  g.db.prepare("UPDATE partners SET applied_at = CURRENT_TIMESTAMP, kyc_status = 'SUBMITTED' WHERE id = 'pt_001'").run();
  g.db.prepare('INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code, pccc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('ord_c09', 'ORD-C09', custId, 10000, 0, 0, 10000, 'READY', 'R', '010-1111-2222', 'A', '', '06236', 'P123456789012');
  g.db.prepare('INSERT INTO returns (id, order_id, user_id, claim_type, reason) VALUES (?,?,?,?,?)')
    .run('ret_c09', 'ord_c09', custId, 'RETURN', 'r');
  const rawBank = g.one("SELECT bank_account_number b FROM partners WHERE id = 'pt_001'").b;
  const expectMask = `****${String(rawBank).slice(-4)}`;
  const pl = await g.call('/api/v1/admin/partners', { token: adm });
  assert.equal(pl.status, 200, pl.text);
  assert.equal(pl.json.data.find((r) => r.id === 'pt_001').bank_account_number, expectMask);
  const ap = await g.call('/api/v1/admin/partner-applications', { token: adm });
  assert.equal(ap.status, 200, ap.text);
  assert.equal(ap.json.data.find((r) => r.partner_id === 'pt_001' || r.id === 'pt_001').bank_account_number, expectMask);
  const dp = await g.call('/api/v1/admin/disputes', { token: adm });
  assert.equal(dp.status, 200, dp.text);
  assert.equal(dp.json.data.find((r) => r.id === 'ret_c09').pccc, '****9012');
});

// ---------- P1-C10: costly POSTs on the write bucket ----------
await t.test('P1-C10 classify promotes costly POSTs to RL_WRITE', async () => {
  assert.equal(classify('POST', '/api/v1/imports/crawl'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/channels/orders/sync'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/channels/listings/publish'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/bidding/campaigns'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/admin/pricing/negotiations'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/partner/pricing/negotiations/ngo_x/respond'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/admin/bidding/campaigns/c1/award'), 'RL_WRITE');
  assert.equal(classify('GET', '/api/v1/pricing/negotiations'), 'RL_API');
  assert.equal(classify('POST', '/api/v1/auth/social/kakao/exchange'), 'RL_WRITE');
  assert.equal(classify('GET', '/api/v1/channels/platforms'), 'RL_API');
  assert.equal(classify('POST', '/api/v1/orders/checkout'), 'RL_WRITE');
});

// ---------- C-N01: partner preview strip ----------
await t.test('C-N01 shared strip kills event handlers incl. slash-separated', async () => {
  assert.ok(!/onerror/i.test(stripToSafeHtml('<img/src=x/onerror=alert(1)>')));
  assert.ok(!/javascript:/i.test(stripToSafeHtml('<a href="java\tscript:alert(1)">x</a>')));
  assert.ok(stripToSafeHtml('<p>요약</p>').includes('요약'));
  const vue = fs.readFileSync('apps/partner/src/views/UrlImportView.vue', 'utf8');
  assert.ok(vue.includes('v-html="safeDescriptionHtml"'), 'preview must render the stripped value');
  assert.ok(!vue.includes('v-html="result.product.description_html"'), 'raw preview must be gone');
});

t.finish();
