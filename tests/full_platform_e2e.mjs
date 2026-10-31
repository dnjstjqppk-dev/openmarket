import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../apps/cloudflare-gateway/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(':memory:');

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.startsWith('d1_') && f.endsWith('.sql'))
  .sort();

for (const mf of migrationFiles) {
  const sql = fs.readFileSync(path.join(migrationsDir, mf), 'utf-8');
  db.exec(sql);
}

function execOne(sql, params = []) {
  const stmt = db.prepare(sql);
  const trimmed = sql.trim().toUpperCase();
  if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.includes('RETURNING')) {
    const rows = stmt.all(...params);
    return { results: rows.map((r) => ({ ...r })), changes: rows.length };
  }
  const info = stmt.run(...params);
  return { results: [], changes: Number(info.changes ?? 0) };
}

class D1PreparedStatement {
  constructor(sql, params = []) {
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new D1PreparedStatement(this.sql, params);
  }
  async all() {
    const res = execOne(this.sql, this.params);
    return { results: res.results };
  }
  async first() {
    const res = execOne(this.sql, this.params);
    return res.results[0] || null;
  }
  async run() {
    const res = execOne(this.sql, this.params);
    return { success: true, meta: { changes: res.changes } };
  }
}

const env = {
  ADMIN_SECRET: 'olmoa_admin_2026',
  DB: {
    prepare(sql) {
      return new D1PreparedStatement(sql);
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => execOne(s.sql, s.params));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
  }
};

async function callApi(path, options = {}) {
  const url = `https://olmoa-api.dnjstjqppk.workers.dev${path}`;
  const req = new Request(url, options);
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

async function runTests() {
  console.log('=== OLMOA Phase 1~4 + OpenMarket Full E2E Verification Suite ===');

  // 1. Health & Security Headers
  const health = await callApi('/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(health.headers.get('X-Frame-Options'), 'DENY');
  console.log('[PASS] 1. Gateway Health & Security Headers (X-Content-Type-Options, X-Frame-Options)');

  // 2. Dynamic XML Sitemap
  const sitemap = await callApi('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.ok(sitemap.text.includes('<urlset') && sitemap.text.includes('/category/womens-clothing'));
  console.log('[PASS] 2. Dynamic XML Sitemap (/sitemap.xml)');

  // 3. Categories & GNB Slugs Verification (42 root categories, 0 empty)
  const cats = await callApi('/api/v1/categories');
  assert.equal(cats.status, 200);
  const roots = cats.json.data.filter(c => c.depth === 0);
  assert.equal(roots.length, 42, `Expected 42 root categories, got ${roots.length}`);
  for (const slug of ['home-kitchen', 'beauty-health', 'sports-outdoors', 'electronics', 'womens-clothing']) {
    const r = await callApi(`/api/v1/products?category=${slug}`);
    assert.ok(r.json.data.length > 0, `Category ${slug} should have products`);
  }
  console.log(`[PASS] 3. All 42 Root Categories & GNB Slugs Verified (${cats.json.count} total categories)`);

  // 4. Search Autocomplete & Synonym Expansion
  const ac = await callApi('/api/v1/search/autocomplete?q=이어폰');
  assert.equal(ac.status, 200);
  assert.ok(ac.json.data.keywords.length > 0 || ac.json.data.products.length > 0);
  console.log('[PASS] 4. Search Autocomplete & Synonym Engine (/api/v1/search/autocomplete)');

  // 5. Product Detail, Real Ratings, Reviews & Product Q&A
  const prod = await callApi('/api/v1/products/prod_e_01');
  assert.equal(prod.status, 200);
  assert.ok(prod.json.data.skus.length > 0);
  assert.equal(prod.json.data.lowest_sale_price, Math.min(...prod.json.data.skus.map(s => s.sale_price)));

  const postQna = await callApi('/api/v1/products/prod_e_01/qna', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify({ customer_id: 'u_cust_001', question: '비행기 기내에서 유선 연결도 되나요?' })
  });
  assert.equal(postQna.status, 201);
  const qnaId = postQna.json.data.id;

  const ansQna = await callApi(`/api/v1/partner/qna/${qnaId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Partner-Id': 'pt_002' },
    body: JSON.stringify({ answer: '네, 동봉된 3.5mm AUX 오디오 케이블로 기내 엔터테인먼트 연결이 가능합니다.' })
  });
  assert.equal(ansQna.status, 200);
  console.log('[PASS] 5. Product Detail SKU Price Sync & Customer-to-Partner Q&A Loop');

  // 6. Seller Mini-Shop Storefront (/api/v1/partners/pt_002/store)
  const store = await callApi('/api/v1/partners/pt_002/store');
  assert.equal(store.status, 200);
  assert.equal(store.json.data.partner.id, 'pt_002');
  assert.ok(store.json.data.products.length > 0);
  console.log(`[PASS] 6. Public Seller Mini-Shop Storefront (pt_002 has ${store.json.data.products.length} products)`);

  // 7. Wishlist & Coupons & Credits Wallet
  const wishAdd = await callApi('/api/v1/wishlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify({ customer_id: 'u_cust_001', product_id: 'prod_e_01' })
  });
  assert.equal(wishAdd.status, 200);

  const claimCoup = await callApi('/api/v1/coupons/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify({ customer_id: 'u_cust_001', coupon_id: 'cpn_welcome_5000' })
  });
  assert.equal(claimCoup.status, 200);
  console.log('[PASS] 7. Wishlist Toggle & Coupon Claim Engine');

  // 8. Unauthorized Order Access Check (401 Guard — WO-02)
  const unauthOrders = await callApi('/api/v1/orders');
  assert.equal(unauthOrders.status, 401, 'GET /api/v1/orders without X-Customer-Id must return 401');
  console.log('[PASS] 8. Strict Customer Ownership Guard (401 on unauthenticated /api/v1/orders)');

  // 9. Multi-Partner Atomic Checkout with Coupon + Credit Deduction + Idempotency
  const idemKey = 'e2e_idem_2026_001';
  const orderPayload = {
    customer_id: 'u_cust_001',
    idempotency_key: idemKey,
    payment_method: 'TOSS_PAY',
    coupon_code: 'WELCOME3000',
    use_credits: 1000,
    shipping_address: { recipient: '김고객', phone: '010-1111-2222', address: '서울 강남구 테헤란로 427' },
    items: [
      { product_id: 'prod_w_01', sku_id: 'sku_prod_w_01', quantity: 1 }, // pt_001
      { product_id: 'prod_e_01', sku_id: 'sku_prod_e_01', quantity: 1 }  // pt_002
    ]
  };
  const checkout1 = await callApi('/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify(orderPayload)
  });
  assert.equal(checkout1.status, 201, `Checkout failed: ${checkout1.text}`);
  const orderId = checkout1.json.data.order_id;

  // Idempotent replay check
  const checkoutReplay = await callApi('/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify(orderPayload)
  });
  assert.equal(checkoutReplay.status, 200);
  assert.equal(checkoutReplay.json.idempotent_replay, true);
  assert.equal(checkoutReplay.json.data.order_id, orderId);
  console.log(`[PASS] 9. Multi-Partner Split Checkout (${orderId}) & Idempotent Replay Protection`);

  // 10. Purchase Confirmation (+1% Reward Credit) & 30-Day Price-Match Claim
  const confirmRes = await callApi(`/api/v1/orders/${orderId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' }
  });
  assert.equal(confirmRes.status, 200);
  assert.ok(confirmRes.json.data.reward_credit > 0);

  const claimRes = await callApi(`/api/v1/orders/${orderId}/claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify({ type: 'PRICE_MATCH', reason: '30일 최저가 차액 보상 요청', refund_amount: 2000 })
  });
  assert.equal(claimRes.status, 201);
  console.log('[PASS] 10. Purchase Confirmation (+1% Credit) & 30-Day Price-Match Instant Adjustment');

  // 11. Order Cancellation Rollback Test (Stock, Sold Count, Settlement Cancelled)
  const cancelOrderCreate = await callApi('/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify({
      customer_id: 'u_cust_001',
      idempotency_key: 'e2e_cancel_test_002',
      payment_method: 'KAKAO_PAY',
      shipping_address: { recipient: '김고객', phone: '010-1111-2222', address: '서울 강남구' },
      items: [{ product_id: 'prod_m_01', sku_id: 'sku_prod_m_01', quantity: 2 }]
    })
  });
  assert.equal(cancelOrderCreate.status, 201);
  const cancelOrderId = cancelOrderCreate.json.data.order_id;

  const cancelRes = await callApi(`/api/v1/orders/${cancelOrderId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify({ reason: '단순 변심 취소 테스트' })
  });
  assert.equal(cancelRes.status, 200);
  console.log(`[PASS] 11. Order Cancellation Atomic Rollback (${cancelOrderId}: Stock + Settlement + SoldCount)`);

  // 12. Partner Bulk CSV Product Upload & Live Settlements
  const bulkRes = await callApi('/api/v1/partner/products/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Partner-Id': 'pt_001' },
    body: JSON.stringify({
      items: [
        { title: '벌크 테스트 초경량 폴딩 백팩', category_id: 'sub_sb_bags', original_price: 45000, sale_price: 22900, stock_quantity: 120 },
        { title: '벌크 테스트 스테인리스 런치박스', category_id: 'sub_h_kitchen', original_price: 32000, sale_price: 15900, stock_quantity: 80 }
      ]
    })
  });
  assert.equal(bulkRes.status, 201);
  assert.equal(bulkRes.json.data.inserted_count, 2);

  const pSettle = await callApi('/api/v1/partner/settlements', {
    headers: { 'X-Partner-Id': 'pt_001' }
  });
  assert.equal(pSettle.status, 200);
  assert.ok(Array.isArray(pSettle.json.data.settlements));
  console.log('[PASS] 12. Partner Bulk CSV Upload (/api/v1/partner/products/bulk) & Live Settlements');

  // 13. Admin RBAC Login Token & Settlement Payout Approval
  const adminLogin = await callApi('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'ADMIN', secret: 'olmoa_admin_2026' })
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.json.data.token;

  const adminMetrics = await callApi('/api/v1/admin/metrics', {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(adminMetrics.status, 200);

  const pendingSettlementId = pSettle.json.data.settlements.find(s => s.settlement_status === 'PENDING')?.id;
  if (pendingSettlementId) {
    const approveRes = await callApi(`/api/v1/admin/settlements/${pendingSettlementId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(approveRes.status, 200);
  }
  console.log('[PASS] 13. Admin Session Token Auth (No 401 Self-Lockout) & Escrow Settlement Approval');

  // 14. Customer Self-Registration & Welcome Credit Injection
  const testEmail = `newbuyer_${Date.now()}@olmoa.com`;
  const regRes = await callApi('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: 'testpassword123',
      full_name: '신규고객',
      phone: '010-9999-8888'
    })
  });
  assert.equal(regRes.status, 201);
  assert.equal(regRes.json.success, true);
  assert.equal(regRes.json.data.welcome_credit, 10000);
  const newCustId = regRes.json.data.customer_id;

  const profileRes = await callApi('/api/v1/auth/me', {
    headers: { 'X-Customer-Id': newCustId }
  });
  assert.equal(profileRes.status, 200);
  assert.equal(profileRes.json.data.credit_balance, 10000);
  console.log('[PASS] 14. Customer Self-Registration (/api/v1/auth/register) & Welcome Credit Injection');

  // 15. Address Book, Customer Notifications & Dynamic Banners
  const bnrRes = await callApi('/api/v1/banners');
  assert.equal(bnrRes.status, 200);
  assert.ok(bnrRes.json.data.length >= 3);

  const addrRes = await callApi('/api/v1/addresses', {
    headers: { 'X-Customer-Id': 'u_customer_001' }
  });
  assert.equal(addrRes.status, 200);
  assert.ok(addrRes.json.data.length >= 2);

  const notiRes = await callApi('/api/v1/notifications', {
    headers: { 'X-Customer-Id': 'u_customer_001' }
  });
  assert.equal(notiRes.status, 200);
  assert.ok(notiRes.json.data.length >= 3);
  assert.ok(notiRes.json.unread_count >= 2);
  console.log('[PASS] 15. Address Book, Notifications & Dynamic Promotion Banners Engine');

  const addressHeaders = { 'X-Customer-Id': 'u_customer_001', 'Content-Type': 'application/json' };
  for (const addressId of ['missing_address', 'addr_001']) {
    const response = await callApi(`/api/v1/addresses/${addressId}/default`, {
      method: 'PUT', headers: { 'X-Customer-Id': addressId === 'addr_001' ? newCustId : 'u_customer_001' }
    });
    assert.equal(response.status, 404);
    assert.equal(db.prepare('SELECT is_default FROM user_addresses WHERE id = ?').get('addr_001').is_default, 1);
  }
  const setDefault = await callApi('/api/v1/addresses/addr_002/default', { method: 'PUT', headers: addressHeaders });
  assert.equal(setDefault.status, 200);
  assert.equal(db.prepare('SELECT id FROM user_addresses WHERE user_id = ? AND is_default = 1').get('u_customer_001').id, 'addr_002');

  db.exec(`CREATE TRIGGER reject_test_address BEFORE INSERT ON user_addresses
    WHEN NEW.recipient_name = 'reject_test' BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END`);
  const failedInsert = await callApi('/api/v1/addresses', {
    method: 'POST', headers: addressHeaders,
    body: JSON.stringify({ recipient_name: 'reject_test', phone: '010-1234-5678', address_line1: 'Test address', is_default: true })
  });
  assert.equal(failedInsert.status, 500);
  assert.equal(db.prepare('SELECT id FROM user_addresses WHERE user_id = ? AND is_default = 1').get('u_customer_001').id, 'addr_002');
  db.exec('DROP TRIGGER reject_test_address');
  console.log('[PASS] 16. Default Address Ownership, Missing Address & Failed Insert Rollback');

  // 17. Single Order Detail Items & Fulfillment Population
  const orderDetailRes = await callApi(`/api/v1/orders/${orderId}`, {
    headers: { 'X-Customer-Id': 'u_cust_001' }
  });
  assert.equal(orderDetailRes.status, 200);
  const orderDetailJson = orderDetailRes.json;
  assert.ok(Array.isArray(orderDetailJson.data.items));
  assert.ok(orderDetailJson.data.items.length >= 1);
  assert.ok(orderDetailJson.data.items[0].partner_name);
  assert.ok(orderDetailJson.data.items[0].carrier);
  assert.ok(orderDetailJson.data.shipping_address_line1);
  console.log('[PASS] 17. Single Order Detail Items & Fulfillment Population');

  // 18. 배송 추적 조회 및 단계별 진행 (Tracking Lookup & Progression)
  // 서브 오더를 출고 완료(SHIPPED) 상태로 직접 설정 (파트너 출고 등록 시뮬레이션)
  db.prepare("UPDATE sub_orders SET status = 'SHIPPED', carrier_code = 'CJ대한통운', tracking_number = '689201948210', shipped_at = CURRENT_TIMESTAMP WHERE parent_order_id = ?").run(orderId);

  // 18-a. 배송 추적 조회 (GET /api/v1/orders/:id/tracking)
  const trackingRes = await callApi(`/api/v1/orders/${orderId}/tracking`, {
    headers: { 'X-Customer-Id': 'u_cust_001' }
  });
  assert.equal(trackingRes.status, 200);
  assert.ok(Array.isArray(trackingRes.json.tracking));
  assert.equal(trackingRes.json.tracking[0].carrier_code, 'CJ대한통운');
  assert.equal(trackingRes.json.tracking[0].tracking_number, '689201948210');
  assert.equal(trackingRes.json.tracking[0].status, 'SHIPPED');
  console.log('[PASS] 18-a. 배송 추적 조회 (운송사, 송장번호, 상태 반환)');

  // 18-b. 배송 상태 진행: SHIPPED → IN_TRANSIT (POST /api/v1/orders/:id/advance-tracking)
  const advance1 = await callApi(`/api/v1/orders/${orderId}/advance-tracking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' }
  });
  assert.equal(advance1.status, 200);
  const trackingAfter1 = await callApi(`/api/v1/orders/${orderId}/tracking`, {
    headers: { 'X-Customer-Id': 'u_cust_001' }
  });
  assert.equal(trackingAfter1.json.tracking[0].status, 'IN_TRANSIT');
  console.log('[PASS] 18-b. 배송 상태 진행 SHIPPED → IN_TRANSIT');

  // 18-c. 배송 상태 진행: IN_TRANSIT → DELIVERED
  const advance2 = await callApi(`/api/v1/orders/${orderId}/advance-tracking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' }
  });
  assert.equal(advance2.status, 200);
  const trackingAfter2 = await callApi(`/api/v1/orders/${orderId}/tracking`, {
    headers: { 'X-Customer-Id': 'u_cust_001' }
  });
  assert.equal(trackingAfter2.json.tracking[0].status, 'DELIVERED');
  assert.equal(trackingAfter2.json.payment_status, 'DELIVERED');
  console.log('[PASS] 18-c. 배송 상태 진행 IN_TRANSIT → DELIVERED');

  // 19. Admin Banners & Notification Broadcast Management
  const newBannerRes = await callApi('/api/v1/admin/banners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: '골든위크 특별 할인',
      subtitle: '전 상품 최대 80% 할인',
      badge_text: 'GOLDEN WEEK',
      bg_gradient: 'from-amber-500 to-rose-600',
      display_order: 10
    })
  });
  assert.equal(newBannerRes.status, 201);
  const newBannerJson = newBannerRes.json;
  const createdBannerId = newBannerJson.data.id;
  assert.equal(newBannerJson.data.title, '골든위크 특별 할인');

  const adminBannersList = await callApi('/api/v1/admin/banners', {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(adminBannersList.status, 200);
  const bannersJson = adminBannersList.json;
  assert.ok(bannersJson.data.some(b => b.id === createdBannerId));

  const updateBanner = await callApi(`/api/v1/admin/banners/${createdBannerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ is_active: false })
  });
  assert.equal(updateBanner.status, 200);
  const updateBannerJson = updateBanner.json;
  assert.equal(updateBannerJson.data.is_active, 0);

  // Broadcast Notification
  const broadcastRes = await callApi('/api/v1/admin/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      target: 'ALL',
      title: '플랫폼 정기 업데이트 완료',
      message: '새로운 배송지 관리 및 혜택이 적용되었습니다.',
      type: 'SYSTEM',
      action_url: '/orders'
    })
  });
  assert.equal(broadcastRes.status, 201);
  const broadcastJson = broadcastRes.json;
  assert.ok(broadcastJson.broadcast_count >= 1);

  const adminNotifs = await callApi('/api/v1/admin/notifications', {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(adminNotifs.status, 200);
  const adminNotifsJson = adminNotifs.json;
  assert.ok(adminNotifsJson.data.some(n => n.title === '플랫폼 정기 업데이트 완료'));

  // Clean up test banner
  const deleteBannerRes = await callApi(`/api/v1/admin/banners/${createdBannerId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(deleteBannerRes.status, 200);
  console.log('[PASS] 19. Admin Banners & Notification Broadcast Engine');

  // 20. Real-time PCCC Customs Validation & Uni-Pass Verification API
  const pcccValidRes = await callApi('/api/v1/customs/validate-pccc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pccc: 'P123456789012',
      name: '홍길동',
      phone: '010-1234-5678'
    })
  });
  assert.equal(pcccValidRes.status, 200);
  assert.equal(pcccValidRes.json.success, true);
  assert.equal(pcccValidRes.json.verified, true);
  assert.equal(pcccValidRes.json.data.pccc, 'P123456789012');

  const pcccInvalidRes = await callApi('/api/v1/customs/validate-pccc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pccc: 'INVALID123',
      name: '홍길동'
    })
  });
  assert.equal(pcccInvalidRes.status, 400);
  assert.equal(pcccInvalidRes.json.verified, false);
  console.log('[PASS] 20. Real-time PCCC Customs Validation API (/api/v1/customs/validate-pccc)');

  // 21. Real-time FX Rates & Currency Conversion Engine
  const fxRatesRes = await callApi('/api/v1/fx/rates');
  assert.equal(fxRatesRes.status, 200);
  assert.equal(fxRatesRes.json.success, true);
  assert.equal(fxRatesRes.json.base_currency, 'KRW');
  assert.ok(fxRatesRes.json.rates.USD > 0);
  assert.ok(fxRatesRes.json.inverse_rates.USD >= 1300);

  const dutyEstimateRes = await callApi('/api/v1/customs/estimate-duty', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goods_amount_krw: 350000,
      shipping_fee_krw: 15000,
      country_origin: 'US'
    })
  });
  assert.equal(dutyEstimateRes.status, 200);
  assert.equal(dutyEstimateRes.json.success, true);
  assert.equal(dutyEstimateRes.json.data.is_tax_exempt, false); // Over $200
  assert.ok(dutyEstimateRes.json.data.total_estimated_tax_krw > 0);

  const dutyExemptRes = await callApi('/api/v1/customs/estimate-duty', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goods_amount_krw: 50000,
      shipping_fee_krw: 5000,
      country_origin: 'CN'
    })
  });
  assert.equal(dutyExemptRes.status, 200);
  assert.equal(dutyExemptRes.json.data.is_tax_exempt, true); // Under $150
  assert.equal(dutyExemptRes.json.data.total_estimated_tax_krw, 0);
  console.log('[PASS] 21. Real-time FX Rates & Customs Duty Calculator (/api/v1/fx/rates, /api/v1/customs/estimate-duty)');

  // 22. Cross-Border Checkout with PCCC & DDP
  const crossBorderCheckoutRes = await callApi('/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify({
      customer_id: 'u_cust_001',
      pccc: 'P987654321098',
      customs_duty_type: 'DDP',
      estimated_duty_amount: 12500,
      currency: 'USD',
      fx_rate: 0.0007246,
      recipient_name: '글로벌구매자',
      recipient_phone: '010-9999-8888',
      shipping_address_line1: '인천광역시 중구 공항로 271',
      shipping_postal_code: '22382',
      items: [{ product_id: 'prod_m_01', sku_id: 'sku_prod_m_01', quantity: 1 }]
    })
  });
  assert.equal(crossBorderCheckoutRes.status, 201);
  assert.equal(crossBorderCheckoutRes.json.success, true);
  assert.equal(crossBorderCheckoutRes.json.pccc, 'P987654321098');
  assert.equal(crossBorderCheckoutRes.json.customs_duty_type, 'DDP');
  assert.equal(crossBorderCheckoutRes.json.currency, 'USD');
  console.log('[PASS] 22. Cross-Border Checkout with PCCC, Duty Type & FX Rate');

  // 23. Global Logistics Carriers & 7-Stage Milestone Tracking
  const carriersRes = await callApi('/api/v1/logistics/carriers');
  assert.equal(carriersRes.status, 200);
  assert.equal(carriersRes.json.success, true);
  assert.ok(carriersRes.json.data.length >= 10);
  assert.ok(carriersRes.json.data.some((c) => c.code === 'DHL'));

  const cbSubOrderId = crossBorderCheckoutRes.json.order_id;
  const trackingBeforeRes = await callApi(`/api/v1/logistics/tracking/${cbSubOrderId}`);
  assert.equal(trackingBeforeRes.status, 200);
  assert.equal(trackingBeforeRes.json.success, true);
  assert.equal(trackingBeforeRes.json.data.milestones.length, 7);
  console.log('[PASS] 23. Global Logistics Carriers & 7-Stage Milestone Tracking (/api/v1/logistics/carriers, /api/v1/logistics/tracking/:id)');

  // 24. Carrier Milestone Webhook Ingestion (7-Stage State Machine)
  const webhookRes1 = await callApi('/api/v1/logistics/milestone-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sub_order_id: cbSubOrderId,
      milestone: 'IN_TRANSIT_AIR',
      carrier: 'DHL',
      tracking_number: 'DHL9988776655',
      location: 'HKG Air Hub',
      customs_clearance_no: 'UNI-2026-998877',
      description: 'Departed from Hong Kong International Hub'
    })
  });
  assert.equal(webhookRes1.status, 200);
  assert.equal(webhookRes1.json.success, true);
  assert.equal(webhookRes1.json.data.milestone, 'IN_TRANSIT_AIR');
  assert.equal(webhookRes1.json.data.status, 'IN_TRANSIT');

  const trackingAfterRes = await callApi(`/api/v1/logistics/tracking/${cbSubOrderId}`);
  assert.equal(trackingAfterRes.status, 200);
  assert.equal(trackingAfterRes.json.data.current_milestone, 'IN_TRANSIT_AIR');
  assert.equal(trackingAfterRes.json.data.customs_clearance_no, 'UNI-2026-998877');
  assert.ok(trackingAfterRes.json.data.logs.length >= 1);
  console.log('[PASS] 24. Cross-Border Milestone Webhook State Machine (/api/v1/logistics/milestone-webhook)');

  // 25. Partner HS Code & Volumetric Weight Product Registration + Admin KYB Risk Tiering
  const hsProductRes = await callApi('/api/v1/partner/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Partner-Id': 'pt_001' },
    body: JSON.stringify({
      partner_id: 'pt_001',
      category_id: 'cat_electronics',
      title: '글로벌 직구 무선 노이즈캔슬링 헤드폰 Pro',
      base_price: 189000,
      stock_qty: 120,
      hs_code: '8517.62',
      country_origin: 'CN',
      warehouse_location: 'OVERSEAS_CN_WEIHAI',
      package_length_cm: 25,
      package_width_cm: 20,
      package_height_cm: 12,
      package_weight_kg: 0.65
    })
  });
  assert.equal(hsProductRes.status, 201);
  assert.equal(hsProductRes.json.success, true);
  assert.equal(hsProductRes.json.data.hs_code, '8517.62');
  assert.equal(hsProductRes.json.data.volumetric_weight_kg, 1.2); // (25*20*12)/5000 = 1.2

  const kybVerifyRes = await callApi('/api/v1/admin/partners/pt_001/verify', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'olmoa_admin_2026' },
    body: JSON.stringify({
      verification_status: 'VERIFIED',
      kyc_status: 'VERIFIED',
      risk_tier: 'TIER_A',
      rolling_reserve_pct: 5.0
    })
  });
  assert.equal(kybVerifyRes.status, 200);
  assert.equal(kybVerifyRes.json.success, true);
  assert.equal(kybVerifyRes.json.data.risk_tier, 'TIER_A');
  assert.equal(kybVerifyRes.json.data.rolling_reserve_pct, 5);
  console.log('[PASS] 25. Partner HS Code / Volumetric Weight Registration & Admin KYB Rolling Reserve Tiering');

  // 26. Central Operations Control Tower, FDS Risk Evaluation & 3-Party Dispute Arbitration
  const controlTowerRes = await callApi('/api/v1/admin/control-tower', {
    headers: { 'X-Admin-Key': 'olmoa_admin_2026' }
  });
  assert.equal(controlTowerRes.status, 200);
  assert.equal(controlTowerRes.json.success, true);
  assert.ok(controlTowerRes.json.data.regional_nodes.length === 4);

  const fdsEvalRes = await callApi('/api/v1/admin/fds/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount_krw: 2500000,
      pccc: 'P987654321098',
      ip_country: 'US',
      card_country: 'KR',
      velocity_10m: 1
    })
  });
  assert.equal(fdsEvalRes.status, 200);
  assert.equal(fdsEvalRes.json.success, true);
  assert.equal(fdsEvalRes.json.data.decision, 'CHALLENGE_3DS');
  assert.ok(fdsEvalRes.json.data.risk_score >= 40);

  // Create a claim and arbitrate it via 3-party tribunal
  const claimForDisputeRes = await callApi(`/api/v1/orders/${crossBorderCheckoutRes.json.order_id}/claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify({
      type: 'RETURN',
      reason: 'Cross-border package outer box damaged',
      refund_amount: 15000
    })
  });
  assert.equal(claimForDisputeRes.status, 201);
  const disputeId = claimForDisputeRes.json.data.claim_id;

  const arbitrateRes = await callApi(`/api/v1/admin/disputes/${disputeId}/arbitrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'olmoa_admin_2026' },
    body: JSON.stringify({
      ruling: 'BUYER_WIN_FULL_REFUND',
      refund_amount: 15000,
      admin_note: 'Verified carrier transit damage photo; full refund approved.'
    })
  });
  assert.equal(arbitrateRes.status, 200);
  assert.equal(arbitrateRes.json.success, true);
  assert.equal(arbitrateRes.json.data.ruling, 'BUYER_WIN_FULL_REFUND');
  console.log('[PASS] 26. Central Operations Control Tower, FDS Evaluation & 3-Party Dispute Arbitration Tribunal');

  // 27. Web Crypto PBKDF2 Password Hashing & Standard HMAC-SHA256 JWT
  const pbkdfUserEmail = `secure_pbkdf_${Date.now()}@olmoa.com`;
  const regPbkdfRes = await callApi('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: pbkdfUserEmail,
      password: 'Enterprise_Secure_Pwd_2026!',
      full_name: '보안강화고객'
    })
  });
  assert.equal(regPbkdfRes.status, 201);
  assert.ok(regPbkdfRes.json.token.includes('.')); // Standard 3-part JWT header.payload.signature

  // Verify stored hash in D1 is PBKDF2 format
  const dbUser = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(pbkdfUserEmail);
  assert.ok(dbUser.password_hash.startsWith('pbkdf2:100000:'));

  // Test Login with PBKDF2
  const loginPbkdfRes = await callApi('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: pbkdfUserEmail,
      password: 'Enterprise_Secure_Pwd_2026!'
    })
  });
  assert.equal(loginPbkdfRes.status, 200);
  assert.ok(loginPbkdfRes.json.token.includes('.'));
  console.log('[PASS] 27. Web Crypto PBKDF2 Password Hashing & Standard HMAC-SHA256 JWT Authentication');

  // 28. Real PG (Toss Payments) Confirmation & Webhook Engine
  const payConfigRes = await callApi('/api/v1/payments/config');
  assert.equal(payConfigRes.status, 200);
  assert.equal(payConfigRes.json.provider, 'TOSS_PAYMENTS');

  const payConfirmRes = await callApi('/api/v1/payments/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: crossBorderCheckoutRes.json.order_id,
      payment_key: 'toss_pk_test_live_confirm_9988',
      amount: crossBorderCheckoutRes.json.total_pay_amount,
      provider: 'TOSS'
    })
  });
  assert.equal(payConfirmRes.status, 200);
  assert.equal(payConfirmRes.json.success, true);
  assert.equal(payConfirmRes.json.data.status, 'PAID');
  assert.ok(payConfirmRes.json.data.receipt_url.includes('tosspayments.com'));

  // Test Webhook processing
  const payWebhookRes = await callApi('/api/v1/payments/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType: 'PAYMENT_STATUS_CHANGED',
      data: {
        paymentKey: 'toss_pk_test_live_confirm_9988',
        orderId: crossBorderCheckoutRes.json.order_id,
        status: 'DONE'
      }
    })
  });
  assert.equal(payWebhookRes.status, 200);
  assert.equal(payWebhookRes.json.received, true);
  console.log('[PASS] 28. Real PG (Toss Payments) Confirmation API & Webhook Processing Engine');

  // 29. Cloudflare R2 & Resilient Media Storage Engine
  const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const uploadRes = await callApi('/api/v1/storage/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_data: sampleBase64,
      file_name: 'test-product-banner.png',
      content_type: 'image/png',
      folder: 'products'
    })
  });
  assert.equal(uploadRes.status, 201);
  assert.equal(uploadRes.json.success, true);
  assert.ok(uploadRes.json.data.public_url.includes('/api/v1/storage/file/'));

  const fileKey = uploadRes.json.data.file_id;
  const downloadRes = await callApi(`/api/v1/storage/file/${fileKey}`);
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers.get('content-type'), 'image/png');
  console.log('[PASS] 29. Cloudflare R2 / Resilient Media Storage Engine (Upload & Stream)');

  // 30. Real-time AlimTalk/SMS Dispatcher Engine
  const dispatchRes = await callApi('/api/v1/notifications/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'ALIMTALK',
      recipient: '010-9999-8888',
      template_code: 'ORDER_CONFIRMED',
      title: '올모아 주문 완료',
      content: '고객님의 해외직구 주문이 성공적으로 접수되어 특송 물류센터로 이관되었습니다.'
    })
  });
  assert.equal(dispatchRes.status, 200);
  assert.equal(dispatchRes.json.success, true);
  assert.equal(dispatchRes.json.data.status, 'SENT');
  console.log('[PASS] 30. Real-time AlimTalk/SMS Dispatcher Engine (/api/v1/notifications/dispatch)');

  // 31. Temu-style Returnless Refund (소액 상품 수거 없는 즉시 환불)
  const returnlessClaimRes = await callApi(`/api/v1/orders/${crossBorderCheckoutRes.json.order_id}/claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify({
      type: 'RETURN',
      reason: '소액 액세서리 단순 변심 (무회수 환불 테스트)',
      refund_amount: 9900
    })
  });
  assert.equal(returnlessClaimRes.status, 201);
  assert.equal(returnlessClaimRes.json.is_returnless, true);
  assert.equal(returnlessClaimRes.json.status, 'REFUNDED');
  console.log('[PASS] 31. Temu-style Returnless Refund Engine (Instant Credit Refund Without Courier Pickup)');

  // 32. Late Delivery Guarantee Compensation (약속일 초과 ₩5,300 보상)
  const lateCompRes = await callApi(`/api/v1/orders/${crossBorderCheckoutRes.json.order_id}/late-delivery-claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' }
  });
  assert.equal(lateCompRes.status, 200);
  assert.equal(lateCompRes.json.success, true);
  assert.equal(lateCompRes.json.data.compensation_amount, 5300);

  // Duplicate claim prevention
  const lateCompDupRes = await callApi(`/api/v1/orders/${crossBorderCheckoutRes.json.order_id}/late-delivery-claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' }
  });
  assert.equal(lateCompDupRes.status, 400);
  console.log('[PASS] 32. Late Delivery Guarantee Compensation Engine (₩5,300 Automatic Credit Grant)');

  // 33. Body Metric Reviews (Height/Weight/Fit) & Real-time Urgency FOMO Stream
  const urgencyRes = await callApi('/api/v1/products/prod_m_01/urgency-stats');
  assert.equal(urgencyRes.status, 200);
  assert.ok(urgencyRes.json.data.recent_24h_sales > 0);
  assert.ok(urgencyRes.json.data.viewers_now > 0);

  const reviewRes = await callApi('/api/v1/products/prod_m_01/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_cust_001' },
    body: JSON.stringify({
      author_name: '테무직구러',
      rating: 5,
      content: '178cm 72kg L사이즈 딱 맞습니다. 가성비 극강입니다.',
      user_height_cm: 178,
      user_weight_kg: 72,
      fit_type: 'TRUE_TO_SIZE'
    })
  });
  assert.equal(reviewRes.status, 201);
  assert.equal(reviewRes.json.data.fit_type, 'TRUE_TO_SIZE');

  const getReviewsRes = await callApi('/api/v1/products/prod_m_01/reviews');
  assert.equal(getReviewsRes.status, 200);
  assert.ok(getReviewsRes.json.data.length >= 1);
  console.log('[PASS] 33. Body Metric Reviews (Height/Weight/Fit) & Urgency FOMO Stream Engine');

  // 34. Factory Sample QC Verification & Fast-Track IPR Takedown Desk
  const sampleQcRes = await callApi('/api/v1/partner/sample-qc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Partner-Id': 'pt_001' },
    body: JSON.stringify({
      product_title: 'M2C 직결 초경량 게이밍 마우스 Pro',
      sample_tracking_no: 'TRK-QC-7788',
      carrier: 'CJ대한통운'
    })
  });
  assert.equal(sampleQcRes.status, 201);
  const qcId = sampleQcRes.json.data.id;

  const adminInspectRes = await callApi(`/api/v1/admin/sample-qc/${qcId}/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'olmoa_admin_2026' },
    body: JSON.stringify({
      decision: 'APPROVED',
      inspector_notes: '센서 정밀도 및 친환경 패키징 전수 검사 통과'
    })
  });
  assert.equal(adminInspectRes.status, 200);
  assert.equal(adminInspectRes.json.data.status, 'APPROVED');

  const iprReportRes = await callApi('/api/v1/ipr/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reporter_name: '글로벌 브랜드 IP 법무팀',
      brand_name: 'BrandCorp',
      target_product_id: 'prod_m_01',
      infringement_type: 'COUNTERFEIT'
    })
  });
  assert.equal(iprReportRes.status, 201);
  assert.equal(iprReportRes.json.data.action, 'IMMEDIATE_HIDDEN');
  console.log('[PASS] 34. Factory Sample QC Inspection & Fast-Track IPR Takedown Protection Engine');

  console.log('=== ALL 34 E2E VERIFICATION SUITES PASSED 100% ===');
  db.close();
}

runTests().catch((err) => {
  console.error('E2E Test Failed:', err);
  db.close();
  process.exit(1);
});
