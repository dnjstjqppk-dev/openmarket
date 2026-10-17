// tests/commerce_engine_e2e.js
// OLMOA Commerce Engine End-to-End Automated Test Suite

const API_BASE = 'https://olmoa-api.dnjstjqppk.workers.dev';
const STOREFRONT_URL = 'https://openmarket.dnjstjqppk.workers.dev';

async function runTests() {
  console.log('====================================================');
  console.log('  OLMOA COMMERCE ENGINE E2E VERIFICATION SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`[TEST] ${name} ... `);
      await fn();
      console.log('✅ PASSED');
      passed++;
    } catch (err) {
      console.log(`❌ FAILED: ${err.message}`);
      failed++;
    }
  }

  // 1. Storefront Live Check
  await test('Storefront Live Availability (HTTP 200)', async () => {
    const res = await fetch(STOREFRONT_URL);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const html = await res.text();
    if (!html.includes('OLMOA') && !html.includes('올모아')) throw new Error('Missing brand OLMOA in HTML');
  });

  // 2. Gateway Health Check
  await test('API Gateway Health & D1 Connection', async () => {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    if (data.status !== 'UP' || data.databaseStatus !== 'CONNECTED_D1') {
      throw new Error(`Unhealthy gateway: ${JSON.stringify(data)}`);
    }
    if (data.activeRootCategories < 33) {
      throw new Error(`Expected >= 33 categories, got ${data.activeRootCategories}`);
    }
  });

  // 3. Multi-Attribute SKU & Attributes API
  await test('PDP Multi-Attribute Option Schema (prod_004)', async () => {
    const res = await fetch(`${API_BASE}/api/v1/products/prod_004`);
    const data = await res.json();
    if (!data.success || !data.data) throw new Error('Failed to fetch prod_004');
    const p = data.data;
    if (!p.attributes || p.attributes.length < 2) throw new Error('Attributes not generated');
    const colorAttr = p.attributes.find(a => a.name === '색상');
    const sizeAttr = p.attributes.find(a => a.name === '사이즈');
    if (!colorAttr || !sizeAttr) throw new Error('Missing 색상 or 사이즈 attributes');
    if (!p.skus || p.skus.length < 5) throw new Error(`Insufficient SKUs: ${p.skus?.length}`);
    const oosSku = p.skus.find(s => s.stock_quantity === 0);
    if (!oosSku) throw new Error('Expected at least one OUT_OF_STOCK SKU for boundary check');
  });

  // 4. Zero Fallback Enforcement
  await test('Zero Fallback Policy: Reject Fake SKU with 400', async () => {
    const res = await fetch(`${API_BASE}/api/v1/orders/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: 'u_customer_001',
        items: [{ sku_id: 'sku_fake_phantom_999', quantity: 1 }]
      })
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    const data = await res.json();
    if (!data.error || !data.error.includes('Zero fallback enforced')) {
      throw new Error(`Unexpected error message: ${JSON.stringify(data)}`);
    }
  });

  // 5. Server-Side Price Authority (Reject Client Tampering)
  let createdOrderId = null;
  await test('Server-Side Price Integrity (Client price ignored)', async () => {
    const res = await fetch(`${API_BASE}/api/v1/orders/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_customer_001' },
      body: JSON.stringify({
        customer_id: 'u_customer_001',
        items: [{
          sku_id: 'sku_004_blk_l',
          product_id: 'prod_004',
          quantity: 1,
          price: 50 // Malicious client attempt to buy 28,900 KRW hoodie for 50 KRW
        }]
      })
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    const data = await res.json();
    // Server must charge real DB price 28,900 + 3,000 shipping = 31,900
    if (data.total_goods_amount !== 28900) {
      throw new Error(`Price tampering succeeded! Expected 28900, got ${data.total_goods_amount}`);
    }
    if (data.total_pay_amount !== 31900) {
      throw new Error(`Expected total pay 31900, got ${data.total_pay_amount}`);
    }
    createdOrderId = data.order_id;
  });

  // 6. Idempotency Key Handling
  await test('Idempotency Key Protection against Double Charge', async () => {
    const key = `idemp_test_${Date.now()}`;
    const payload = {
      customer_id: 'u_customer_001',
      items: [{ sku_id: 'sku_004_blk_l', product_id: 'prod_004', quantity: 1 }]
    };
    const res1 = await fetch(`${API_BASE}/api/v1/orders/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_customer_001', 'X-Idempotency-Key': key },
      body: JSON.stringify(payload)
    });
    const d1 = await res1.json();
    if (!d1.success) throw new Error('First checkout failed');

    // Replay with exact same idempotency key
    const res2 = await fetch(`${API_BASE}/api/v1/orders/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Id': 'u_customer_001', 'X-Idempotency-Key': key },
      body: JSON.stringify(payload)
    });
    const d2 = await res2.json();
    if (!d2.idempotent_replay && d2.order_id !== d1.order_id) {
      throw new Error('Idempotency duplicate check failed!');
    }
  });

  // 7. Stock Insufficient & Out-of-Stock Protection (HTTP 409)
  await test('Stock Limit Ceiling: Reject Out of Stock with 409', async () => {
    const res = await fetch(`${API_BASE}/api/v1/orders/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: 'u_customer_001',
        items: [{ sku_id: 'sku_004_gry_xl', quantity: 1 }] // Stock is 0
      })
    });
    if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
    const data = await res.json();
    if (!data.error || !data.error.includes('Stock insufficient')) {
      throw new Error(`Expected stock insufficient message, got ${JSON.stringify(data)}`);
    }
  });

  // 8. IDOR Protection on Order Queries
  await test('IDOR Protection on Order History & Details', async () => {
    // A: List without auth header -> 401
    const unauthRes = await fetch(`${API_BASE}/api/v1/orders`);
    if (unauthRes.status !== 401) throw new Error(`Expected 401 on missing header, got ${unauthRes.status}`);

    // B: Access order with unauthorized customer header -> 403
    if (createdOrderId) {
      const forbiddenRes = await fetch(`${API_BASE}/api/v1/orders/${createdOrderId}`, {
        headers: { 'X-Customer-Id': 'u_customer_999' }
      });
      if (forbiddenRes.status !== 403) throw new Error(`Expected 403 for unauthorized viewer, got ${forbiddenRes.status}`);

      // C: Access with authorized customer header -> 200
      const okRes = await fetch(`${API_BASE}/api/v1/orders/${createdOrderId}`, {
        headers: { 'X-Customer-Id': 'u_customer_001' }
      });
      if (okRes.status !== 200) throw new Error(`Expected 200 for owner, got ${okRes.status}`);
      const ordData = await okRes.json();
      if (!ordData.data || ordData.data.id !== createdOrderId) {
        throw new Error('Mismatched order returned');
      }

      // Check sum integrity between parent order and sub-orders
      const ord = ordData.data;
      const subGoodsTotal = ord.sub_orders.reduce((sum, s) => sum + s.goods_amount, 0);
      const subShippingTotal = ord.sub_orders.reduce((sum, s) => sum + s.shipping_fee, 0);
      const subTotal = ord.sub_orders.reduce((sum, s) => sum + s.total_amount, 0);

      if (ord.total_goods_amount !== subGoodsTotal) {
        throw new Error(`Parent goods ${ord.total_goods_amount} != sum of sub_orders ${subGoodsTotal}`);
      }
      if (ord.total_shipping_amount !== subShippingTotal) {
        throw new Error(`Parent shipping ${ord.total_shipping_amount} != sum of sub_orders ${subShippingTotal}`);
      }
      if (ord.total_pay_amount !== subTotal) {
        throw new Error(`Parent pay ${ord.total_pay_amount} != sum of sub_orders ${subTotal}`);
      }
    }
  });

  console.log('\n====================================================');
  console.log(`  E2E TEST SUMMARY: ${passed} PASSED / ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
}

runTests();

