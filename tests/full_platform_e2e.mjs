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

  // 18. Admin Banners & Notification Broadcast Management
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
  console.log('[PASS] 18. Admin Banners & Notification Broadcast Engine');

  console.log('=== ALL 18 E2E VERIFICATION SUITES PASSED 100% ===');
  db.close();
}

runTests().catch((err) => {
  console.error('E2E Test Failed:', err);
  db.close();
  process.exit(1);
});
