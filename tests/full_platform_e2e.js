/**
 * OLMOA End-to-End Comprehensive Platform Verification Test Suite
 * Validates Live Production Cloudflare Endpoints, Security, Isolation & E-Commerce Flow
 */

const API_BASE = 'https://olmoa-api.dnjstjqppk.workers.dev';
const ADMIN_SEC = 'olmoa_admin_sec_2026';
const PS_KEY = 'ps_live_feed_key_2026';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function safeFetch(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1200));
    }
  }
}

async function testCategories() {
  console.log('\n--- 1. Testing Category Engine (33 Roots) & Dynamic Catalog ---');
  const res = await safeFetch(`${API_BASE}/api/v1/categories`);
  const json = await res.json();
  assert(res.status === 200, 'Categories endpoint returns 200 OK');
  assert(Array.isArray(json.data) && json.data.length >= 33, `Categories count is ${json.data?.length} (>= 33 roots)`);
  
  const prodRes = await safeFetch(`${API_BASE}/api/v1/products?limit=10`);
  const prodJson = await prodRes.json();
  assert(prodRes.status === 200, 'Products catalog returns 200 OK');
  const hasOnlyFixedRatings = prodJson.data?.items?.every(p => p.rating === 4.9 && p.review_count === 1200);
  assert(!hasOnlyFixedRatings, 'Catalog does NOT have fake hardcoded 4.9 ratings');
}

async function testSecurityAndAdmin() {
  console.log('\n--- 2. Testing Security & Admin Privilege Escalation Defense ---');
  // Attempt unauthorized access
  const unauthRes = await safeFetch(`${API_BASE}/api/v1/admin/dashboard`);
  assert(unauthRes.status === 401, 'Admin dashboard rejects requests without secret (401)');

  const fakeHeaderRes = await safeFetch(`${API_BASE}/api/v1/admin/dashboard`, {
    headers: { 'X-Customer-Id': 'ADMIN' }
  });
  assert(fakeHeaderRes.status === 401, 'Rejects fake X-Customer-Id: ADMIN privilege escalation (401)');

  // Authorized Admin access
  const authRes = await safeFetch(`${API_BASE}/api/v1/admin/dashboard`, {
    headers: { 'X-Admin-Secret': ADMIN_SEC }
  });
  const authJson = await authRes.json();
  assert(authRes.status === 200 && authJson.success, 'Authorized Admin returns 200 OK with real metrics');
}

async function testPartnerTenantIsolation() {
  console.log('\n--- 3. Testing Partner Multi-Tenant Isolation ---');
  const noPartnerRes = await safeFetch(`${API_BASE}/api/v1/partner/products`);
  assert(noPartnerRes.status === 401, 'Partner products reject missing X-Partner-Id (401)');

  const validPartnerRes = await safeFetch(`${API_BASE}/api/v1/partner/products`, {
    headers: { 'X-Partner-Id': 'pt_001' }
  });
  const validJson = await validPartnerRes.json();
  assert(validPartnerRes.status === 200 && validJson.success, 'Valid Partner returns 200 OK');

  // Cross-tenant tampering attempt
  const crossTamperRes = await safeFetch(`${API_BASE}/api/v1/partner/products/prod_other_999/stock`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Partner-Id': 'pt_001' },
    body: JSON.stringify({ stock_quantity: 50 })
  });
  assert(crossTamperRes.status === 403, 'Cross-tenant product stock modification is forbidden (403)');
}

async function testOrderRestockingFlow() {
  console.log('\n--- 4. Testing Order Creation, Stock Deduction & Cancellation Restocking ---');
  // 1. Get initial stock
  const pRes = await safeFetch(`${API_BASE}/api/v1/products/prod_001`);
  const pJson = await pRes.json();
  const sku = pJson.data?.skus?.[0];
  const initialStock = sku.stock_quantity;
  const skuId = sku.id;

  // 2. Create order for 1 item
  const custId = 'u_customer_001';
  const orderRes = await safeFetch(`${API_BASE}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': custId },
    body: JSON.stringify({
      recipient_name: '테스터',
      recipient_phone: '010-9876-5432',
      shipping_address_line1: '서울특별시 강남구 테헤란로 123',
      payment_method: 'TOSS_PAY',
      items: [{ product_id: 'prod_001', sku_id: skuId, quantity: 1 }]
    })
  });
  const orderJson = await orderRes.json();
  const orderNo = orderJson.data?.order_no || orderJson.order_no;
  const orderId = orderJson.data?.order_id || orderJson.order_id;
  assert(orderRes.status === 201 && orderJson.success, `Order created: ${orderNo}`);

  // 3. Verify stock decreased
  const afterOrderRes = await safeFetch(`${API_BASE}/api/v1/products/prod_001`);
  const afterOrderJson = await afterOrderRes.json();
  const stockAfterOrder = afterOrderJson.data?.skus?.[0]?.stock_quantity;
  assert(stockAfterOrder === initialStock - 1, `Stock properly deducted: ${initialStock} -> ${stockAfterOrder}`);

  // 4. Cancel order
  const cancelRes = await safeFetch(`${API_BASE}/api/v1/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': custId },
    body: JSON.stringify({ reason: 'Customer test cancellation' })
  });
  const cancelJson = await cancelRes.json();
  assert(cancelRes.status === 200 && cancelJson.success, 'Order cancelled successfully (200)');

  // 5. Verify stock restocked
  const afterCancelRes = await safeFetch(`${API_BASE}/api/v1/products/prod_001`);
  const afterCancelJson = await afterCancelRes.json();
  const stockAfterCancel = afterCancelJson.data?.skus?.[0]?.stock_quantity;
  assert(stockAfterCancel === initialStock, `Stock properly restocked: ${stockAfterOrder} -> ${stockAfterCancel}`);
}

async function testIntegrations() {
  console.log('\n--- 5. Testing PriceScanner Feed & Selbym Boundary ---');
  // PriceScanner unauth
  const psNoKey = await safeFetch(`${API_BASE}/api/v1/integrations/pricescanner/feed`);
  assert(psNoKey.status === 401, 'PriceScanner rejects missing key (401)');

  // PriceScanner auth
  const psAuth = await safeFetch(`${API_BASE}/api/v1/integrations/pricescanner/feed?page=1&page_size=10`, {
    headers: { 'X-Integration-Key': PS_KEY }
  });
  const psJson = await psAuth.json();
  assert(psAuth.status === 200 && psJson.success, `PriceScanner feed returns 200 OK with ${psJson.data?.items?.length} items`);
  assert(psAuth.headers.get('cache-control')?.includes('max-age'), 'PriceScanner includes edge cache header');

  // Selbym Status
  const selRes = await safeFetch(`${API_BASE}/api/v1/integrations/selbym/status`);
  const selJson = await selRes.json();
  assert(selRes.status === 200, 'Selbym status returns 200 OK');
  assert(selJson.data?.status === 'AWAITING_COMMERCIAL_AGREEMENT', 'Selbym status is AWAITING_COMMERCIAL_AGREEMENT');
  assert(selJson.data?.direct_crawling_allowed === false, 'Selbym direct crawling is prohibited (false)');
}

async function runAll() {
  console.log('====================================================');
  console.log(' OLMOA E2E PRODUCTION VERIFICATION SUITE');
  console.log(' Target:', API_BASE);
  console.log('====================================================');

  await testCategories();
  await testSecurityAndAdmin();
  await testPartnerTenantIsolation();
  await testOrderRestockingFlow();
  await testIntegrations();

  console.log('\n====================================================');
  console.log(` RESULTS: Passed: ${passed}, Failed: ${failed}`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
