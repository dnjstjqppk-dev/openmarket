// tests/p1_phase3_test.mjs
// Phase 3 (NEW-06/07/08/09/10/11/12/15/16): backend/infra/legal must-haves.
// Run: node tests/p1_phase3_test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGateway, createRunner } from './lib/harness.mjs';

const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = { JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox', PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef' };
const ADDR = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };

async function boot(env = {}) {
  const g = await createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, one, login };
}

const t = createRunner('P1 backend/infra/legal (NEW-06/07/08/09/10/11/12/15/16)');

const brnOf = (nine) => {
  const d = String(nine).split('').map(Number); const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let s = d.reduce((a, x, i) => a + x * w[i], 0) + Math.floor((d[8] * 5) / 10);
  return `${nine}${(10 - (s % 10)) % 10}`;
};

// ---------- NEW-06: R2 binding + D1 size honesty + KYB privacy ----------
const r2Stub = () => {
  const m = new Map();
  return {
    async put(k, bytes, opts) { m.set(k, { bytes, opts }); },
    async get(k) {
      const e = m.get(k);
      if (!e) return null;
      return {
        body: e.bytes,
        httpEtag: '"stub"',
        writeHttpMetadata(h) { h.set('Content-Type', e.opts?.httpMetadata?.contentType || 'application/octet-stream'); }
      };
    }
  };
};

await t.test('NEW-06 uploads over 1MB fail closed without R2, honestly', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const big = Buffer.alloc(2 * 1024 * 1024, 7).toString('base64');
  const r = await g.call('/api/v1/storage/upload', {
    method: 'POST', token: pt,
    body: { file_name: 'big.png', content_type: 'image/png', folder: 'products', file_data: big }
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'FILE_TOO_LARGE');
  assert.ok(String(r.json.error).includes('R2'));
});

await t.test('NEW-06 small uploads embed in D1 and report D1_EMBEDDED', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const r = await g.call('/api/v1/storage/upload', {
    method: 'POST', token: pt,
    body: { file_name: 'a.png', content_type: 'image/png', folder: 'products', file_data: Buffer.from('png-bytes').toString('base64') }
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.data.storage_backend, 'D1_EMBEDDED');
});

await t.test('NEW-06 with STORAGE_BUCKET binding, bytes land in R2 (incl. over 1MB)', async () => {
  const g = await boot({ STORAGE_BUCKET: r2Stub() });
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const big = Buffer.alloc(2 * 1024 * 1024, 9).toString('base64');
  const r = await g.call('/api/v1/storage/upload', {
    method: 'POST', token: pt,
    body: { file_name: 'big.png', content_type: 'image/png', folder: 'products', file_data: big }
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.data.storage_backend, 'R2_BUCKET');
  const row = g.one('SELECT data_base64 FROM storage_objects WHERE id = ?', r.json.data.file_id);
  assert.equal(row.data_base64, null, 'R2 path must not duplicate bytes into D1');
});

await t.test('NEW-06 KYB documents stay uploader-or-admin only (no oracle)', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const cust = await g.login('customer@example.com');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const up = await g.call('/api/v1/storage/upload', {
    method: 'POST', token: pt,
    body: { file_name: 'brn.pdf', content_type: 'application/pdf', folder: 'kyb', file_data: Buffer.from('%PDF-1.4 private').toString('base64') }
  });
  assert.equal(up.status, 201, up.text);
  assert.equal(up.json.data.visibility, 'PRIVATE');
  const key = new URL(up.json.data.public_url).pathname.replace('/api/v1/storage/file/', '');
  assert.equal((await g.call(`/api/v1/storage/file/${key}`, { token: cust })).status, 404);
  assert.equal((await g.call(`/api/v1/storage/file/${key}`)).status, 404);
  assert.equal((await g.call(`/api/v1/storage/file/${key}`, { token: pt })).status, 200);
  assert.equal((await g.call(`/api/v1/storage/file/${key}`, { token: adm })).status, 200);
  const log = g.one("SELECT COUNT(*) AS c FROM pii_access_log WHERE action = 'VIEW' AND resource = 'admin.kyb-document'");
  assert.ok(log.c >= 1);
});

await t.test('NEW-06 wrangler declares the STORAGE_BUCKET R2 binding', async () => {
  const raw = fs.readFileSync('apps/cloudflare-gateway/wrangler.jsonc', 'utf8');
  assert.ok(raw.includes('"r2_buckets"'));
  assert.ok(raw.includes('"binding": "STORAGE_BUCKET"'));
  assert.ok(raw.includes('"bucket_name": "olmoa-media"'));
});

// ---------- NEW-07/08: payment methods + split keys ----------
await t.test('NEW-07/08 order detail exposes the real PG method', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const sku = g.one("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE s.stock_quantity > 5 LIMIT 1");
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(co.status, 201, co.text);
  const pay = await g.call('/api/v1/payments/confirm', {
    method: 'POST', token: cust,
    body: { order_id: co.json.order_id, payment_key: `sandbox_${'z'.repeat(10)}`, amount: co.json.total_pay_amount }
  });
  assert.equal(pay.status, 200, pay.text);
  const d = await g.call(`/api/v1/orders/${co.json.order_id}`, { token: cust });
  assert.equal(d.status, 200, d.text);
  assert.equal(d.json.data.payment_method, 'SANDBOX');
});

await t.test('NEW-08 TOSS mode serves distinct web and widget keys', async () => {
  const g = await boot({ PAYMENT_MODE: 'live', TOSS_SECRET_KEY: 'test_sk', TOSS_CLIENT_KEY: 'test_api_key', TOSS_WIDGET_CLIENT_KEY: 'test_widget_key' });
  const r = await g.call('/api/v1/payments/config');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.mode, 'TOSS');
  assert.equal(r.json.api_client_key, 'test_api_key');
  assert.equal(r.json.widget_client_key, 'test_widget_key');
  assert.equal(r.json.client_key, 'test_api_key', 'legacy alias still tracks the API key');
});

await t.test('NEW-07/08 web and mobile each reference their own key and no hardcoded card call', async () => {
  for (const f of ['apps/storefront/src/views/CheckoutView.vue', 'apps/storefront/src/views/OrderDetailView.vue', 'apps/storefront/src/views/PaymentResultView.vue']) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!src.includes("requestPayment('카드'"), `${f} must not hardcode the card method`);
    assert.ok(src.includes('api_client_key'), `${f} must use the web API key`);
  }
  const co = fs.readFileSync('apps/storefront/src/views/CheckoutView.vue', 'utf8');
  assert.ok(co.includes('payMethod') && co.includes('가상계좌'));
  const od = fs.readFileSync('apps/storefront/src/views/OrderDetailView.vue', 'utf8');
  assert.ok(od.includes('resumeMethod') && od.includes('payment_method'));
  const pr = fs.readFileSync('apps/storefront/src/views/PaymentResultView.vue', 'utf8');
  assert.ok(pr.includes('retryMethod'));
  const mob = fs.readFileSync('mobile/customer_app/lib/views/payment_view.dart', 'utf8');
  assert.ok(mob.includes("cfg['widget_client_key']"), 'mobile widget must use the widget key');
});

// ---------- NEW-09: admin inquiry console ----------
await t.test('NEW-09 admin lists inquiries and the reply flow closes the loop', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const q = await g.call('/api/v1/support/inquiries', {
    method: 'POST', token: cust, body: { category: 'DELIVERY', subject: 'phase3 loop', content: 'where is my parcel' }
  });
  assert.equal(q.status, 201, q.text);
  const id = q.json.data?.id || q.json.id;
  const list = await g.call('/api/v1/admin/inquiries?status=OPEN', { token: adm });
  assert.equal(list.status, 200, list.text);
  assert.ok(list.json.data.some((r) => r.id === id));
  assert.ok(Number.isInteger(list.json.pagination.total));
  const rp = await g.call(`/api/v1/admin/inquiries/${id}/reply`, { method: 'POST', token: adm, body: { answer: 'we found it' } });
  assert.equal(rp.status, 200, rp.text);
  assert.equal(rp.json.status, 'ANSWERED');
  assert.equal(g.one('SELECT status, answer FROM support_inquiries WHERE id = ?', id).answer, 'we found it');
  assert.ok(g.one("SELECT COUNT(*) AS c FROM admin_audit_log WHERE action = 'INQUIRY_REPLY'").c >= 1);
  const mine = await g.call('/api/v1/support/inquiries', { token: cust });
  assert.equal(mine.status, 200, mine.text);
  assert.ok(mine.json.data.some((r) => r.id === id && r.status === 'ANSWERED' && r.answer === 'we found it'));
});

await t.test('NEW-09 reply validates: unknown id, empty answer, closed, and least privilege', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  assert.equal((await g.call('/api/v1/admin/inquiries/nope/reply', { method: 'POST', token: adm, body: { answer: 'x' } })).status, 404);
  assert.equal((await g.call('/api/v1/admin/inquiries/inq_001/reply', { method: 'POST', token: adm, body: {} })).json.code, 'REQUIRED');
  const cl = await g.call('/api/v1/admin/inquiries/inq_001/reply', { method: 'POST', token: adm, body: { answer: 'closing', close: true } });
  assert.equal(cl.status, 200, cl.text);
  assert.equal(cl.json.status, 'CLOSED');
  assert.equal((await g.call('/api/v1/admin/inquiries/inq_001/reply', { method: 'POST', token: adm, body: { answer: 'again' } })).json.code, 'INQUIRY_CLOSED');
  assert.equal((await g.call('/api/v1/admin/inquiries', { token: cust })).status, 403);
  const dpo = await g.call('/api/v1/admin/admin-users', { method: 'POST', token: adm, body: { email: 'dpo9@olmoa.test', full_name: 'dpo9', admin_role: 'PRIVACY_OFFICER', password: 'Dpo!2026#pw' } });
  assert.equal(dpo.status, 201, dpo.text);
  const dpoTok = (await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'dpo9@olmoa.test', password: 'Dpo!2026#pw', role: 'ADMIN' } })).json.token;
  assert.equal((await g.call('/api/v1/admin/inquiries', { token: dpoTok })).status, 403);
});

await t.test('NEW-09 inquiries console view, route, and nav are wired', async () => {
  assert.ok(fs.existsSync('apps/admin/src/views/InquiriesView.vue'));
  const vw = fs.readFileSync('apps/admin/src/views/InquiriesView.vue', 'utf8');
  assert.ok(vw.includes('/api/v1/admin/inquiries') && vw.includes('/reply'));
  assert.ok(fs.readFileSync('apps/admin/src/router/index.ts', 'utf8').includes("path: '/inquiries'"));
  assert.ok(fs.readFileSync('apps/admin/src/App.vue', 'utf8').includes('고객 문의'));
});

// ---------- NEW-10: seller identity ----------
await t.test('NEW-10 public store discloses seller identity fields honestly', async () => {
  const g = await boot();
  const r = await g.call('/api/v1/partners/pt_001/store');
  assert.equal(r.status, 200, r.text);
  for (const k of ['representative_name', 'business_address', 'customer_service_phone', 'cs_email', 'mail_order_reg_number']) {
    assert.ok(k in r.json.data.partner, `store exposes ${k}`);
  }
  assert.ok(!JSON.stringify(r.json).includes('1588-0000'), 'invented contact defaults must be gone');
  const vw = fs.readFileSync('apps/storefront/src/views/SellerStoreView.vue', 'utf8');
  for (const label of ['대표자명', '사업장 주소', '고객센터 전화', '고객센터 이메일', '통신판매업 신고번호']) {
    assert.ok(vw.includes(label), `store view shows ${label}`);
  }
});

await t.test('NEW-10 seller application requires a real address and CS email', async () => {
  const g = await boot();
  const base = {
    email: 'legal10@example.com', password: 'Seller!2026#pw', contact_name: '담당', phone: '010-3333-4444',
    business_name: '법정상회', representative_name: '김대표', business_reg_number: brnOf('987654321'),
    mail_order_reg_number: '제2026-서울-0002호', bank_code: '004', bank_account_number: '111-222-333', bank_account_holder: '법정상회',
    customer_service_phone: '02-111-2222', return_shipping_address: '서울 반품로 3',
    agree_seller_terms: true, agree_privacy: true
  };
  assert.equal((await g.call('/api/v1/partner-applications', { method: 'POST', body: base })).json.code, 'REQUIRED');
  const badMail = await g.call('/api/v1/partner-applications', { method: 'POST', body: { ...base, business_address: '서울 사업로 4', cs_email: 'not-an-email' } });
  assert.equal(badMail.json.code, 'INVALID_EMAIL');
  const ok = await g.call('/api/v1/partner-applications', { method: 'POST', body: { ...base, business_address: '서울 사업로 4', cs_email: 'cs@legal10.example.com' } });
  assert.equal(ok.status, 201, ok.text);
  const row = g.one('SELECT business_address, cs_email FROM partners WHERE id = ?', ok.json.data.partner.id);
  assert.equal(row.business_address, '서울 사업로 4');
  assert.equal(row.cs_email, 'cs@legal10.example.com');
});

await t.test('NEW-10 profile updates identity; representative and mail-order stay locked', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const up = await g.call('/api/v1/partner/profile', { method: 'PUT', token: pt, body: { business_address: '부산 사업로 5', cs_email: 'CS@Example.COM' } });
  assert.equal(up.status, 200, up.text);
  const me = await g.call('/api/v1/partner/profile', { token: pt });
  assert.equal(me.json.data.business_address, '부산 사업로 5');
  assert.equal(me.json.data.cs_email, 'cs@example.com');
  assert.equal((await g.call('/api/v1/partner/profile', { method: 'PUT', token: pt, body: { representative_name: '바꾼대표' } })).json.code, 'REPRESENTATIVE_LOCKED');
  assert.equal((await g.call('/api/v1/partner/profile', { method: 'PUT', token: pt, body: { mail_order_reg_number: '제9-9-9호' } })).json.code, 'MAIL_ORDER_LOCKED');
});

// ---------- NEW-11/12: notice + KC ----------
await t.test('NEW-11/12 product create stores notice JSON and KC fields', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const cat = g.one('SELECT id FROM categories WHERE is_active = 1 LIMIT 1');
  const r = await g.call('/api/v1/partner/products', {
    method: 'POST', token: pt,
    body: {
      title: 'phase3 legal product', category_id: cat.id, sale_price: 10000, original_price: 12000, stock_quantity: 5,
      thumbnail_url: 'https://example.com/t.png', notice_info_json: { '제조국': '대한민국', 'A/S': '02-111-2222' },
      kc_certified: true, kc_cert_number: 'KC-2026-0001'
    }
  });
  assert.equal(r.status, 201, r.text);
  const row = g.one('SELECT notice_info_json, kc_certified, kc_cert_number FROM products WHERE id = ?', r.json.product_id);
  assert.deepEqual(JSON.parse(row.notice_info_json), { '제조국': '대한민국', 'A/S': '02-111-2222' });
  assert.equal(row.kc_certified, 1);
  assert.equal(row.kc_cert_number, 'KC-2026-0001');
  const detail = await g.call(`/api/v1/products/${r.json.product_id}`);
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.data.notice_info_json, row.notice_info_json);
  assert.equal(Number(detail.json.data.kc_certified), 1);
});

await t.test('NEW-11/12 notice and KC inputs are validated', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const cat = g.one('SELECT id FROM categories WHERE is_active = 1 LIMIT 1');
  const base = { title: 'phase3 invalid', category_id: cat.id, sale_price: 10000, stock_quantity: 5, thumbnail_url: 'https://example.com/t.png' };
  assert.equal((await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: { ...base, notice_info_json: [['x']] } })).json.code, 'INVALID_NOTICE_INFO');
  assert.equal((await g.call('/api/v1/partner/products', { method: 'POST', token: pt, body: { ...base, kc_certified: true } })).json.code, 'KC_NUMBER_REQUIRED');
});

await t.test('NEW-11/12 editing legal display re-triggers operator review', async () => {
  const g = await boot();
  const owner = g.one("SELECT u.email FROM users u JOIN partners p ON p.owner_user_id = u.id JOIN products pr ON pr.partner_id = p.id WHERE pr.id = 'prod_001'");
  const pt = await g.login(owner.email, 'PARTNER');
  g.db.prepare("UPDATE products SET status = 'ACTIVE', review_status = 'APPROVED' WHERE id = 'prod_001'").run();
  const r = await g.call('/api/v1/partner/products/prod_001', { method: 'PUT', token: pt, body: { notice_info_json: { '제조국': '대한민국' } } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data.review_status, 'PENDING');
  const row = g.one("SELECT review_status, status FROM products WHERE id = 'prod_001'");
  assert.equal(row.review_status, 'PENDING');
  assert.equal(row.status, 'DRAFT');
});

await t.test('NEW-11/12 notice table, fallback copy, and KC row render on the detail view', async () => {
  const vw = fs.readFileSync('apps/storefront/src/views/ProductDetailView.vue', 'utf8');
  assert.ok(vw.includes('상품정보제공고시') && vw.includes('상세페이지 참조'));
  assert.ok(vw.includes('KC 인증') && vw.includes('kc_cert_number'));
  const pm = fs.readFileSync('apps/partner/src/views/ProductManageView.vue', 'utf8');
  assert.ok(pm.includes('notice_rows') && pm.includes('kc_cert_number'));
  assert.ok(!pm.includes('HS:{{ p.hs_code || \'6109.10\' }}'));
});

// ---------- NEW-15: commission tax invoices ----------
await t.test('NEW-15 commission invoice is server-computed, unique per period, and partner-visible', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const partner = g.one("SELECT p.id FROM partners p JOIN users u ON u.id = p.owner_user_id WHERE u.email = 'seller@temu-supply.com'");
  const custId = g.one("SELECT id FROM users WHERE email = 'customer@example.com'").id;
  g.db.prepare(`INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status,
      recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code, created_at)
    VALUES ('ord_tax_1', 'TAX-1', ?, 100000, 0, 0, 100000, 'PAID', '홍길동', '010-1234-5678', '서울특별시', '101동', '06236', '2026-10-15 12:00:00')`).run(custId);
  g.db.prepare(`INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, status, goods_amount, shipping_fee, discount_amount, total_amount)
    VALUES ('sub_tax_1', 'ord_tax_1', 'TAX-1-1', ?, 'DELIVERED', 100000, 0, 0, 100000)`).run(partner.id);
  g.db.prepare(`INSERT INTO settlements (id, sub_order_id, partner_id, gross_amount, shipping_fee, commission_rate, commission_amount, net_payout_amount, status, created_at)
    VALUES ('stl_tax_1', 'sub_tax_1', ?, 100000, 0, 10, 11000, 89000, 'SETTLED', '2026-10-15 12:00:00')`).run(partner.id);
  const c = await g.call('/api/v1/admin/finance/tax-invoices', {
    method: 'POST', token: adm, body: { partner_id: partner.id, period_start: '2026-10-01', period_end: '2026-10-31' }
  });
  assert.equal(c.status, 201, c.text);
  assert.equal(c.json.data.total_amount, 11000);
  assert.equal(c.json.data.supply_amount, 10000);
  assert.equal(c.json.data.vat_amount, 1000);
  assert.equal((await g.call('/api/v1/admin/finance/tax-invoices', { method: 'POST', token: adm, body: { partner_id: partner.id, period_start: '2026-10-01', period_end: '2026-10-31' } })).json.code, 'DUPLICATE_PERIOD');
  const iss = await g.call(`/api/v1/admin/finance/tax-invoices/${c.json.data.id}/issue`, { method: 'POST', token: adm, body: { hometax_approval_no: 'TAX2026-000001' } });
  assert.equal(iss.status, 200, iss.text);
  assert.equal(iss.json.issue_status, 'ISSUED');
  const mine = await g.call('/api/v1/partner/tax-invoices', { token: pt });
  assert.equal(mine.status, 200, mine.text);
  assert.ok(mine.json.data.some((r) => r.id === c.json.data.id && r.hometax_approval_no === 'TAX2026-000001'));
  const other = g.one("SELECT id FROM partners WHERE id != ? LIMIT 1", partner.id);
  g.db.prepare('INSERT INTO users (id, email, password_hash, full_name, phone, role, is_active) VALUES (?,?,?,?,?,?,?)')
    .run('u_tax_other', 'taxother@example.com', 'x', 'Other', '010-0000-0000', 'ROLE_PARTNER', 1);
  g.db.prepare('UPDATE partners SET owner_user_id = ? WHERE id = ?').run('u_tax_other', other.id);
  const row = g.one('SELECT COUNT(*) AS c FROM tax_invoices WHERE partner_id = ? AND invoice_type = ?', other.id, 'TAX_INVOICE_SALES');
  assert.equal(row.c, 0, 'no cross-partner rows exist for the fixture check below');
});

await t.test('NEW-15 empty periods and bad input are rejected with reasons', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const partner = g.one('SELECT id FROM partners LIMIT 1');
  assert.equal((await g.call('/api/v1/admin/finance/tax-invoices', { method: 'POST', token: adm, body: { partner_id: partner.id, period_start: '1999-01-01', period_end: '1999-01-31' } })).json.code, 'NO_COMMISSION');
  assert.equal((await g.call('/api/v1/admin/finance/tax-invoices', { method: 'POST', token: adm, body: { partner_id: partner.id, period_start: '2026-13-99', period_end: '2026-10-31' } })).status, 400);
  assert.equal((await g.call('/api/v1/admin/finance/tax-invoices/ti_nope/issue', { method: 'POST', token: adm, body: { hometax_approval_no: 'X' } })).status, 404);
});

// ---------- NEW-16: schema tracking ----------
await t.test('NEW-16 /health exposes the applied schema version', async () => {
  const g = await boot();
  const r = await g.call('/health');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.schemaVersion, 'd1_63_payment_card_summary.sql');
  assert.ok(Number(r.json.migrationsApplied) >= 50);
  assert.equal(g.one("SELECT COUNT(*) AS c FROM schema_migrations WHERE version = 'd1_42_legal_compliance_fields.sql'").c, 1);
});

// ---------- Phase-1 policy alignment ----------
await t.test('stale instant-refund copy is gone from FAQ and seeds', async () => {
  const g = await boot();
  const src = fs.readFileSync('apps/cloudflare-gateway/src/routes/features.js', 'utf8');
  assert.ok(!src.includes('실제 인하 차액이 적립금으로 지급됩니다'));
  const faq = await g.call('/api/v1/support/faq');
  assert.ok(!JSON.stringify(faq.json).includes('실제 인하 차액이 적립금으로 지급됩니다'));
  assert.ok(!String(g.one("SELECT answer FROM support_inquiries WHERE id = 'inq_001'").answer).includes('차액 100%'));
});

t.finish();
