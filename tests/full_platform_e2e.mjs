// tests/full_platform_e2e.mjs
// Functional (happy-path) regression suite for the whole gateway on the V3 contract:
// JWT login for every role, READY -> payment confirm -> PAID, seller fulfilment, operator payout.
// The previous version of this file exercised the legacy header-identity contract (X-Customer-Id etc.),
// which was itself the vulnerability; see git history and reports/v3/evidence/01_exploit_baseline_before_fix.txt.
// Run: node tests/full_platform_e2e.mjs   (after: node scripts/gen-dev-seed.mjs)

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const PW = 'DevPass!2026#';
const env = { JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu', ENVIRONMENT: 'development', PAYMENT_MODE: 'sandbox', CARRIER_WEBHOOK_SECRET: 'carrier-secret-0123456789ab' };
const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env });
const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
const login = async (email, role = 'CUSTOMER') => {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, r.text);
  return r.json.token;
};
const ADDR = { recipient_name: '김올모', recipient_phone: '010-2222-3333', shipping_address_line1: '서울특별시 중구 세종대로 110', shipping_postal_code: '04524' };
const t = createRunner('OLMOA Functional E2E (V3 contract)');

const cust = await login('customer@example.com');
const pt1 = await login('seller@temu-supply.com', 'PARTNER');
const pt2 = await login('partner2@olmoa-tech.com', 'PARTNER');
const adm = await login('admin@openmarket.com', 'ADMIN');
const mpSku = one("SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_002' AND s.stock_quantity > 50 ORDER BY s.id LIMIT 1");
const dSku = one("SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 50 ORDER BY s.id LIMIT 1");
let order;

await t.test('01 health, readiness flags and security headers', async () => {
  const r = await g.call('/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.readiness.operator_entity_active, true);
  assert.equal(r.json.readiness.payment, 'LOCAL_SIMULATOR');
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(r.headers.get('X-Frame-Options'), 'DENY');
});
await t.test('02 sitemap lists approved products only', async () => {
  const r = await g.call('/sitemap.xml');
  assert.ok(r.text.includes('<urlset') && r.text.includes('/category/'));
});
await t.test('03 42 root categories, each GNB slug has products', async () => {
  const r = await g.call('/api/v1/categories');
  assert.equal(r.json.data.filter((c) => c.depth === 0).length, 42);
  for (const slug of ['home-kitchen', 'beauty-health', 'electronics', 'womens-clothing']) {
    assert.ok((await g.call(`/api/v1/products?category=${slug}`)).json.data.length > 0, slug);
  }
});
await t.test('04 search autocomplete', async () => {
  const r = await g.call('/api/v1/search/autocomplete?q=이어폰');
  assert.equal(r.status, 200);
});
await t.test('05 product detail + customer Q&A + seller answer', async () => {
  const p = await g.call(`/api/v1/products/${mpSku.product_id}`);
  assert.equal(p.status, 200);
  const q = await g.call(`/api/v1/products/${mpSku.product_id}/qna`, { method: 'POST', token: cust, body: { question: '배송은 언제 되나요?' } });
  assert.equal(q.status, 201, q.text);
  const a = await g.call(`/api/v1/partner/qna/${q.json.qna_id}/answer`, { method: 'POST', token: pt2, body: { answer: '영업일 기준 1~2일 내 출고됩니다.' } });
  assert.equal(a.status, 200, a.text);
  assert.equal((await g.call(`/api/v1/partner/qna/${q.json.qna_id}/answer`, { method: 'POST', token: pt1, body: { answer: 'x' } })).status, 404, 'other seller cannot answer');
});
await t.test('06 seller mini-shop', async () => {
  const r = await g.call('/api/v1/partners/pt_002/store');
  assert.equal(r.status, 200);
});
await t.test('07 wishlist toggle + coupon claim', async () => {
  assert.equal((await g.call('/api/v1/wishlist', { method: 'POST', token: cust, body: { product_id: mpSku.product_id } })).json.wished, true);
  assert.equal((await g.call('/api/v1/coupons/claim', { method: 'POST', token: cust, body: { code: 'VIP20' } })).status, 200);
  const list = await g.call('/api/v1/coupons', { token: cust });
  assert.ok(list.json.data.find((c) => c.code === 'VIP20').is_claimed);
  assert.equal((await g.call('/api/v1/coupons/claim', { method: 'POST', token: cust, body: { code: 'NOPE' } })).status, 404);
});
await t.test('08 registration with consents grants a journaled welcome credit', async () => {
  const bad = await g.call('/api/v1/auth/register', { method: 'POST', body: { email: 'new1@example.com', password: 'weak', full_name: '신규', phone: '010-1111-2222', agree_terms: true, agree_privacy: true } });
  assert.equal(bad.status, 400);
  const r = await g.call('/api/v1/auth/register', { method: 'POST', body: { email: 'new1@example.com', password: 'Strong!Pass2026', full_name: '신규고객', phone: '010-1111-2222', agree_terms: true, agree_privacy: true } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.welcome_credit, 10000);
  const me = await g.call('/api/v1/auth/me', { token: r.json.token });
  assert.equal(me.json.data.credit_balance, 10000);
  assert.equal((await g.call('/api/v1/auth/register', { method: 'POST', body: { email: 'new1@example.com', password: 'Strong!Pass2026', full_name: 'x', phone: '010-1111-2222', agree_terms: true, agree_privacy: true } })).status, 409);
});
await t.test('09 address book CRUD and default switching', async () => {
  const c = await g.call('/api/v1/addresses', { method: 'POST', token: cust, body: { recipient_name: '집', phone: '010-0000-1111', postal_code: '04524', address_line1: '서울 중구', is_default: true } });
  assert.equal(c.status, 201, c.text);
  const list = await g.call('/api/v1/addresses', { token: cust });
  assert.equal(list.json.data.filter((a) => Number(a.is_default) === 1).length, 1);
  assert.equal((await g.call(`/api/v1/addresses/${c.json.data.id}/default`, { method: 'PUT', token: cust })).status, 200);
  assert.equal((await g.call(`/api/v1/addresses/${c.json.data.id}`, { method: 'DELETE', token: cust })).status, 200);
});
await t.test('10 notifications inbox', async () => {
  assert.equal((await g.call('/api/v1/notifications', { token: cust })).status, 200);
});
await t.test('11 mixed checkout -> sandbox payment -> order detail & tracking', async () => {
  const c = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, headers: { 'X-Idempotency-Key': 'e2e-checkout-0001' }, body: { ...ADDR, items: [{ sku_id: mpSku.id, quantity: 2 }, { sku_id: dSku.id, quantity: 1 }] } });
  assert.equal(c.status, 201, c.text);
  order = c.json;
  assert.equal(order.payment_status, 'READY');
  const p = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: order.order_id, payment_key: 'sandbox_e2e_0000001', amount: order.total_pay_amount } });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json.data.is_sandbox, true);
  const d = await g.call(`/api/v1/orders/${order.order_id}`, { token: cust });
  assert.equal(d.json.data.sub_orders.length, 2);
  assert.equal(d.json.data.items.length, 2);
  assert.equal((await g.call(`/api/v1/orders/${order.order_id}/tracking`, { token: cust })).status, 200);
});
await t.test('12 sellers ship, delivery, purchase confirmation, operator payout', async () => {
  for (const [tok, model] of [[pt2, 'MARKETPLACE'], [pt1, 'DIRECT']]) {
    const sub = one('SELECT id FROM sub_orders WHERE parent_order_id = ? AND sales_model = ?', order.order_id, model);
    const list = await g.call('/api/v1/partner/orders', { token: tok });
    assert.ok(list.json.data.some((s) => s.id === sub.id));
    assert.equal((await g.call(`/api/v1/partner/orders/${sub.id}/prepare`, { method: 'POST', token: tok })).status, 200);
    assert.equal((await g.call(`/api/v1/partner/orders/${sub.id}/shipment`, { method: 'PUT', token: tok, body: { carrier: 'CJ대한통운', tracking_number: `68920194${model.length}210` } })).status, 200);
  }
  await g.call(`/api/v1/orders/${order.order_id}/advance-tracking`, { method: 'POST', token: adm });
  await g.call(`/api/v1/orders/${order.order_id}/advance-tracking`, { method: 'POST', token: adm });
  const cf = await g.call(`/api/v1/orders/${order.order_id}/confirm`, { method: 'POST', token: cust });
  assert.equal(cf.status, 200, cf.text);
  assert.ok(cf.json.reward_credit > 0);
  const pv = await g.call('/api/v1/admin/finance/payouts', { token: adm });
  assert.ok(pv.json.data.pending.find((x) => x.partner_id === 'pt_002'));
  const po = await g.call('/api/v1/admin/finance/payouts', { method: 'POST', token: adm, body: { partner_id: 'pt_002' } });
  assert.equal(po.status, 201, po.text);
  assert.equal((await g.call(`/api/v1/admin/finance/payouts/${po.json.data.payout_id}/transferred`, { method: 'POST', token: adm, body: { bank_transfer_ref: 'KB-20261105-0001' } })).status, 200);
  const st = await g.call('/api/v1/partner/settlements', { token: pt2 });
  assert.ok(st.json.settlements.some((s) => s.status === 'PAID_OUT'));
  const pos = await g.call('/api/v1/admin/purchase-orders', { token: adm });
  assert.ok(pos.json.data.some((x) => x.order_no === order.order_no));
});
await t.test('13 seller bulk upload goes to review; operator approves', async () => {
  const b = await g.call('/api/v1/partner/products/bulk', { method: 'POST', token: pt2, body: { items: [{ title: 'E2E 대량등록 상품 A', sale_price: 12900, stock_quantity: 5, category_slug: 'electronics' }] } });
  assert.equal(b.status, 201, b.text);
  const pid = b.json.products[0].product_id;
  assert.equal(one('SELECT review_status FROM products WHERE id = ?', pid).review_status, 'PENDING');
  assert.equal((await g.call(`/api/v1/admin/products/${pid}/review`, { method: 'POST', token: adm, body: { decision: 'APPROVE' } })).status, 200);
});
await t.test('14 banners and broadcast notifications (admin)', async () => {
  const c = await g.call('/api/v1/admin/banners', { method: 'POST', token: adm, body: { title: 'E2E 배너', link_url: '/deals' } });
  assert.equal(c.status, 201);
  assert.equal((await g.call(`/api/v1/admin/banners/${c.json.data.id}`, { method: 'PUT', token: adm, body: { is_active: false } })).status, 200);
  assert.equal((await g.call(`/api/v1/admin/banners/${c.json.data.id}`, { method: 'DELETE', token: adm })).status, 200);
  const n = await g.call('/api/v1/admin/notifications', { method: 'POST', token: adm, body: { title: '공지', message: '테스트' } });
  assert.equal(n.status, 201);
  assert.ok(n.json.broadcast_count >= 1);
});
await t.test('15 customs: PCCC format, FX, duty estimate, cross-border order invoice', async () => {
  assert.equal((await g.call('/api/v1/customs/validate-pccc', { method: 'POST', body: { pccc: 'P123456789012', name: '김올모', phone: '010-2222-3333' } })).status, 200);
  assert.equal((await g.call('/api/v1/fx/rates')).status, 200);
  assert.equal((await g.call('/api/v1/customs/estimate-duty', { method: 'POST', body: { goods_amount_krw: 300000, shipping_fee_krw: 5000, hs_code: '8518.30' } })).status, 200);
  const c = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, pccc: 'P123456789012', items: [{ sku_id: mpSku.id, quantity: 1 }] } });
  assert.equal(c.status, 201, c.text);
  assert.equal((await g.call(`/api/v1/orders/${c.json.order_id}/commercial-invoice`, { token: cust })).status, 200);
});
await t.test('16 carriers list, owner tracking, signed carrier milestone webhook', async () => {
  assert.equal((await g.call('/api/v1/logistics/carriers')).status, 200);
  const c = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: mpSku.id, quantity: 1 }] } });
  await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: c.json.order_id, payment_key: 'sandbox_e2e_trk00001', amount: c.json.total_pay_amount } });
  const sub = one('SELECT id FROM sub_orders WHERE parent_order_id = ?', c.json.order_id);
  await g.call(`/api/v1/partner/orders/${sub.id}/shipment`, { method: 'PUT', token: pt2, body: { tracking_number: 'TRK55556666' } });
  assert.equal((await g.call(`/api/v1/logistics/tracking/${sub.id}`, { token: cust })).status, 200);
  const done = one("SELECT id FROM sub_orders WHERE parent_order_id = ? AND sales_model = 'MARKETPLACE'", order.order_id);
  const late = await g.call('/api/v1/logistics/milestone-webhook', { method: 'POST', headers: { 'X-Carrier-Webhook-Secret': env.CARRIER_WEBHOOK_SECRET }, body: { sub_order_id: done.id, milestone: 'IN_TRANSIT_AIR' } });
  assert.equal(late.status, 409, 'confirmed sub-order cannot be regressed by a late carrier event');
  const w = await g.call('/api/v1/logistics/milestone-webhook', { method: 'POST', headers: { 'X-Carrier-Webhook-Secret': env.CARRIER_WEBHOOK_SECRET }, body: { sub_order_id: sub.id, milestone: 'IN_TRANSIT_AIR' } });
  assert.equal(w.status, 200, w.text);
  assert.equal(one('SELECT status FROM sub_orders WHERE id = ?', sub.id).status, 'IN_TRANSIT');
});
await t.test('17 partner KYB verification, control tower, FDS evaluation', async () => {
  assert.equal((await g.call('/api/v1/admin/partners/pt_002/verify', { method: 'PUT', token: adm, body: { status: 'APPROVED', risk_tier: 'TIER_1_NORMAL' } })).status, 200);
  assert.equal((await g.call('/api/v1/admin/control-tower', { token: adm })).status, 200);
  assert.equal((await g.call('/api/v1/admin/fds/evaluate', { method: 'POST', token: adm, body: { amount_krw: 2000000 } })).status, 200);
  assert.ok(one("SELECT COUNT(*) c FROM admin_audit_log WHERE action = 'PARTNER_VERIFY'").c >= 1);
});
await t.test('18 payment configuration reports the simulator honestly', async () => {
  const r = await g.call('/api/v1/payments/config');
  assert.equal(r.json.mode, 'SANDBOX_SIMULATOR');
  assert.equal(r.json.client_key, null);
});
await t.test('19 media upload (seller) and download', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const u = await g.call('/api/v1/storage/upload', { method: 'POST', token: pt2, body: { file_data: `data:image/png;base64,${png}`, file_name: 'a.png' } });
  assert.equal(u.status, 201, u.text);
  const f = await g.call(`/api/v1/storage/file/${u.json.data.file_id}`);
  assert.equal(f.status, 200);
});
await t.test('20 SMS/AlimTalk dispatch logs honest status without provider', async () => {
  const r = await g.call('/api/v1/notifications/dispatch', { method: 'POST', token: adm, body: { recipient: '01012345678', content: '테스트' } });
  assert.equal(r.json.data.status, 'NOT_SENT_PROVIDER_NOT_CONFIGURED');
});
await t.test('21 late-delivery compensation only when actually late, once', async () => {
  const c = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...ADDR, items: [{ sku_id: mpSku.id, quantity: 1 }] } });
  await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: c.json.order_id, payment_key: 'sandbox_e2e_late0001', amount: c.json.total_pay_amount } });
  assert.equal((await g.call(`/api/v1/orders/${c.json.order_id}/late-delivery-claim`, { method: 'POST', token: cust })).status, 409);
  g.db.prepare("UPDATE sub_orders SET estimated_delivery_date = '2000-01-01' WHERE parent_order_id = ?").run(c.json.order_id);
  const ok = await g.call(`/api/v1/orders/${c.json.order_id}/late-delivery-claim`, { method: 'POST', token: cust });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.data.compensation_amount, 5300);
  assert.equal((await g.call(`/api/v1/orders/${c.json.order_id}/late-delivery-claim`, { method: 'POST', token: cust })).status, 409);
});
await t.test('22 verified-purchase review with body metrics; measured sales stats', async () => {
  const other = await login('alex.kim@olmoa.com');
  assert.equal((await g.call(`/api/v1/products/${mpSku.product_id}/reviews`, { method: 'POST', token: other, body: { rating: 5, content: '좋아요' } })).status, 403);
  const r = await g.call(`/api/v1/products/${mpSku.product_id}/reviews`, { method: 'POST', token: cust, body: { rating: 5, content: '사이즈가 딱 맞습니다', user_height_cm: 172, user_weight_kg: 65, fit_type: 'TRUE_TO_SIZE' } });
  assert.equal(r.status, 201, r.text);
  const list = await g.call(`/api/v1/products/${mpSku.product_id}/reviews`);
  assert.ok(list.json.reviews.some((x) => x.id === r.json.review_id));
  const s = await g.call(`/api/v1/products/${mpSku.product_id}/urgency-stats`);
  assert.ok(s.json.data.recent_24h_sales >= 2);
  assert.equal(s.json.data.viewers_now, undefined, 'no fabricated viewer counts');
});
await t.test('23 sample QC request (seller) and inspection (operator)', async () => {
  const q = await g.call('/api/v1/partner/sample-qc', { method: 'POST', token: pt2, body: { product_title: '샘플', sample_tracking_no: 'QC12345678' } });
  assert.equal(q.status, 201, q.text);
  assert.equal((await g.call(`/api/v1/admin/sample-qc/${q.json.data.id}/inspect`, { method: 'POST', token: adm, body: { decision: 'APPROVED', inspector_notes: '합격' } })).status, 200);
});
await t.test('24 IPR report recorded for review (product not auto-hidden)', async () => {
  const r = await g.call('/api/v1/ipr/report', { method: 'POST', token: cust, body: { target_product_id: mpSku.product_id, reporter_name: '권리자', brand_name: 'Brand', evidence_url: 'https://evidence.example/1.pdf' } });
  assert.equal(r.status, 201, r.text);
  assert.equal(one('SELECT status FROM products WHERE id = ?', mpSku.product_id).status, 'ACTIVE');
});
await t.test('25 public business disclosure (전자상거래법 사업자 정보 표시)', async () => {
  const r = await g.call('/api/v1/business-info');
  assert.equal(r.json.configured, true);
  assert.ok(r.json.data.business_reg_number && r.json.data.mail_order_reg_number);
});
await t.test('26 reconciliation is clean after the full journey', async () => {
  const r = await g.call('/api/v1/admin/reconciliation', { token: adm });
  const bad = r.json.data.checks.filter((c) => !c.ok);
  assert.deepEqual(bad.map((c) => c.id), []);
});

const res = t.finish();
if (res.failed) process.exit(1);
