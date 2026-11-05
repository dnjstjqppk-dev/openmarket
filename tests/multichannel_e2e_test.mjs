// tests/multichannel_e2e_test.mjs
// Exhaustive test suite for OLMOA Global Multi-Channel & Supply Chain Platform
// MODEL A (External Supply -> OLMOA)
// MODEL B (OLMOA -> External OpenMarkets)
// MODEL C (Integrated 3PL & Dropship Operations)

import assert from 'node:assert/strict';
import { FX_RATES_TO_KRW, CHANNEL_COMMISSIONS_BPS, calculateGlobalPrice } from '../apps/cloudflare-gateway/src/services/pricing/global-pricing-engine.js';
import { NaverCommerceConnector } from '../apps/cloudflare-gateway/src/services/connectors/naver-connector.js';
import { CoupangWingConnector } from '../apps/cloudflare-gateway/src/services/connectors/coupang-connector.js';
import { ElevenStreetConnector } from '../apps/cloudflare-gateway/src/services/connectors/eleven-street-connector.js';
import { AmazonSpApiConnector } from '../apps/cloudflare-gateway/src/services/connectors/amazon-sp-connector.js';
import { DomesticB2BSupplierConnector } from '../apps/cloudflare-gateway/src/services/connectors/domestic-b2b-connector.js';
import { Global3plLogisticsConnector } from '../apps/cloudflare-gateway/src/services/connectors/logistics-3pl-connector.js';
import { registry } from '../apps/cloudflare-gateway/src/services/connectors/connector-registry.js';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('OLMOA Global Multi-Channel & Supply Chain Suite');

// Test 1: Global Pricing & Margin Calculation Engine
await t.test('1. Global Pricing & Margin Engine (FX, Logistics, Customs, Anti-Negative Lock)', async () => {
  // A. FX Rates
  assert.ok(FX_RATES_TO_KRW.USD >= 1350);
  assert.ok(FX_RATES_TO_KRW.JPY >= 8.5);
  assert.ok(FX_RATES_TO_KRW.CNY >= 180);
  assert.ok(FX_RATES_TO_KRW.EUR >= 1450);

  // B. Standard Pricing Calculation (USD $30 product, Coupang 10.8% fee, 20% margin, 0.8kg crossborder)
  const calc1 = calculateGlobalPrice({
    wholesaleCost: 30,
    currency: 'USD',
    weightKg: 0.8,
    isCrossborder: true,
    originCountry: 'CN',
    channelCode: 'COUPANG_MARKETPLACE',
    targetMarginRateBps: 2000,
    minMarginKrw: 5000
  });

  assert.equal(calc1.input.currency, 'USD');
  assert.ok(calc1.cost_breakdown.supply_cost_krw > 40000);
  assert.ok(calc1.cost_breakdown.international_shipping_krw >= 5000);
  assert.equal(calc1.cost_breakdown.customs_duty_krw, 0); // Under $150 de minimis
  assert.ok(calc1.pricing_result.sale_price_krw > calc1.cost_breakdown.total_landed_cost_krw);
  assert.ok(calc1.pricing_result.net_profit_krw > 0);
  assert.equal(calc1.pricing_result.is_loss_risk, false);

  // C. De Minimis Threshold Exceeded (USD $250 product -> Duty 8% + VAT 10%)
  const calcHighValue = calculateGlobalPrice({
    wholesaleCost: 250,
    currency: 'USD',
    weightKg: 2.0,
    isCrossborder: true,
    originCountry: 'US',
    channelCode: 'AMAZON_US_FBA_MFN',
    targetMarginRateBps: 1500
  });
  assert.ok(calcHighValue.cost_breakdown.customs_duty_krw > 0);
  assert.ok(calcHighValue.cost_breakdown.vat_krw > 0);
  assert.ok(calcHighValue.cost_breakdown.total_landed_cost_krw > 350000);
});

// Test 2: Platform Connectors (Naver, Coupang, 11st, Amazon, B2B, 3PL)
await t.test('2. Multi-Channel & Supply Chain Platform Connectors', async () => {
  // A. Naver Commerce Connector
  const naver = new NaverCommerceConnector();
  assert.equal(naver.platformId, 'naver_smartstore');
  const naverBlocked = await naver.verifyConnection({});
  assert.equal(naverBlocked.status, 'BLOCKED_NO_CREDENTIAL');

  const naverValid = await naver.verifyConnection({ clientId: 'naver-cid', clientSecret: 'naver-csec' });
  assert.equal(naverValid.verified, true);
  assert.equal(naverValid.token_type, 'Bearer');

  // B. Coupang Wing Connector (HMAC SHA-256 Signature)
  const coupang = new CoupangWingConnector();
  assert.equal(coupang.platformId, 'coupang_wing');
  const coupangBlocked = await coupang.verifyConnection({});
  assert.equal(coupangBlocked.status, 'BLOCKED_NO_CREDENTIAL');

  const authHeader = await coupang.generateAuthorizationHeader(
    'POST',
    '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products',
    '',
    'coupang-access-key',
    'coupang-secret-key-1234'
  );
  assert.ok(authHeader.startsWith('CEA algorithm=HmacSHA256'));
  assert.ok(authHeader.includes('access-key=coupang-access-key'));
  assert.ok(authHeader.includes('signature='));

  // C. 11st Connector
  const eleven = new ElevenStreetConnector();
  assert.equal(eleven.platformId, 'eleven_street');
  const elevenBlocked = await eleven.verifyConnection({});
  assert.equal(elevenBlocked.status, 'BLOCKED_NO_CREDENTIAL');

  const elevenValid = await eleven.verifyConnection({ openApiKey: 'eleven-valid-key' });
  assert.equal(elevenValid.verified, true);

  // D. Amazon SP-API Connector
  const amazon = new AmazonSpApiConnector();
  assert.equal(amazon.platformId, 'amazon_sp_api');
  const amzBlocked = await amazon.verifyConnection({});
  assert.equal(amzBlocked.status, 'BLOCKED_NO_CREDENTIAL');

  const amzValid = await amazon.verifyConnection({
    lwaClientId: 'amzn-client-id',
    lwaClientSecret: 'amzn-secret',
    refreshToken: 'amzn-refresh'
  });
  assert.equal(amzValid.verified, true);

  // E. Domestic B2B Supplier Connector (Domeggook, Domeme)
  const domeggook = new DomesticB2BSupplierConnector('domeggook_domeme', '도매꾹/도매매 B2B');
  const b2bDetail = await domeggook.getProductDetail('DOME-9988');
  assert.equal(b2bDetail.success, true);
  assert.equal(b2bDetail.data.dropship_available, true);
  assert.equal(b2bDetail.data.stock_status, 'IN_STOCK');

  const b2bOrder = await domeggook.createSupplierOrder({
    sub_order_id: 'sub_ord_123',
    idempotency_key: 'idemp_key_123',
    total_cost_krw: 48000,
    recipient_name: '홍길동',
    recipient_phone: '010-1234-5678',
    shipping_address: '서울특별시 강남구 테헤란로 152'
  }, { apiKey: 'b2b-test-key' });
  assert.equal(b2bOrder.success, true);
  assert.ok(b2bOrder.b2b_order_id.startsWith('DOME_PO_'));

  // F. Global 3PL Logistics Connector
  const logistics = new Global3plLogisticsConnector();
  const fulfillment = await logistics.createFulfillmentOrder({
    carrier_code: 'CJ_LOGISTICS',
    customs_id_pccc: 'P123456789012'
  });
  assert.equal(fulfillment.success, true);
  assert.equal(fulfillment.carrier_code, 'CJ_LOGISTICS');
  assert.ok(fulfillment.tracking_number);
  assert.equal(fulfillment.customs_cleared, true);

  const milestones = await logistics.getTrackingMilestones(fulfillment.tracking_number, 'CJ_LOGISTICS');
  assert.equal(milestones.success, true);
  assert.equal(milestones.milestones.length, 3);

  // G. Connector Registry Lookup
  assert.ok(registry.get('coupang_wing'));
  assert.ok(registry.get('naver_smartstore'));
  assert.ok(registry.get('3pl_logistics'));
});

// Test 3: Gateway Integration & Catalog Endpoints
await t.test('3. Multi-Channel Gateway Endpoints & Platform Seed Verification', async () => {
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

  // A. Public platforms list (18 platforms seeded in d1_29)
  const platRes = await g.call('/api/v1/channels/platforms');
  assert.equal(platRes.status, 200);
  assert.equal(platRes.json.success, true);
  assert.equal(platRes.json.count, 18);
  assert.equal(platRes.json.data.length, 18);

  // B. Sales channels list (7 seeded active channels)
  const chanRes = await g.call('/api/v1/channels/sales-channels');
  assert.equal(chanRes.status, 200);
  assert.equal(chanRes.json.success, true);
  assert.equal(chanRes.json.count, 7);
  assert.equal(chanRes.json.data.length, 7);

  // C. Global pricing calculator endpoint
  const priceRes = await g.call('/api/v1/channels/pricing/calculate', {
    method: 'POST',
    body: {
      wholesale_cost: 25000,
      currency: 'KRW',
      weight_kg: 1.2,
      is_crossborder: false,
      channel_code: 'COUPANG_MARKETPLACE',
      target_margin_bps: 2000
    }
  });
  assert.equal(priceRes.status, 200);
  assert.equal(priceRes.json.success, true);
  assert.ok(priceRes.json.data.pricing_result.sale_price_krw > 25000);
});

// Test 4: Partner Credentials, Listing Lifecycle & Feature Flag Guard
await t.test('4. Partner Credentials, Listing Lifecycle & Feature Flag Guard', async () => {
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

  // Partner & Admin login
  const ptLogin = await g.call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'seller@temu-supply.com', password: 'DevPass!2026#', role: 'PARTNER' }
  });
  assert.equal(ptLogin.status, 200);
  const ptToken = ptLogin.json.token;

  const admLogin = await g.call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' }
  });
  assert.equal(admLogin.status, 200);
  const admToken = admLogin.json.token;

  // A. Save Partner Credentials for Coupang
  const credSave = await g.call('/api/v1/channels/credentials', {
    method: 'POST',
    token: ptToken,
    body: {
      platform_id: 'coupang_wing',
      credential_name: '쿠팡 윙 메인 계정',
      api_key: 'cp-access-test-key-99',
      secret_key: 'cp-super-secret-key-12345678',
      seller_account_id: 'A00999999',
      is_sandbox: true
    }
  });
  assert.equal(credSave.status, 201);
  assert.equal(credSave.json.success, true);

  // B. Verify credentials listing masks the secret
  const credList = await g.call('/api/v1/channels/credentials', { token: ptToken });
  assert.equal(credList.status, 200);
  assert.ok(credList.json.data.length >= 1);
  const coupangCred = credList.json.data.find(c => c.platform_id === 'coupang_wing');
  assert.ok(coupangCred);
  assert.ok(coupangCred.api_key_masked.includes('...'));

  // C. Verify credential connection
  const credVerify = await g.call(`/api/v1/channels/credentials/${coupangCred.id}/verify`, {
    method: 'POST',
    token: ptToken
  });
  assert.equal(credVerify.status, 200);
  assert.equal(credVerify.json.success, true);
  assert.equal(credVerify.json.verified, true);
  assert.equal(credVerify.json.status, 'VERIFIED');

  // D. Feature Flag Guard: marketplace_listing_publish is OFF (0) by default
  const pubBlocked = await g.call('/api/v1/channels/listings/publish', {
    method: 'POST',
    token: ptToken,
    body: {
      sales_channel_id: 'sc_coupang_wing',
      product_id: 'prod_001',
      sale_price: 29000
    }
  });
  assert.equal(pubBlocked.status, 403);
  assert.equal(pubBlocked.json.code, 'FEATURE_DISABLED');

  // E. Admin enables marketplace_listing_publish flag
  const toggleRes = await g.call('/api/v1/admin/feature-flags/marketplace_listing_publish/toggle', {
    method: 'POST',
    token: admToken,
    body: { is_enabled: true, reason: 'E2E Test activation' }
  });
  assert.equal(toggleRes.status, 200);

  // F. Publish listing again -> Expect 200 OK
  const pubSuccess = await g.call('/api/v1/channels/listings/publish', {
    method: 'POST',
    token: ptToken,
    body: {
      sales_channel_id: 'sc_coupang_wing',
      product_id: 'prod_001',
      sale_price: 18900
    }
  });
  assert.equal(pubSuccess.status, 200);
  assert.equal(pubSuccess.json.success, true);
  assert.ok(pubSuccess.json.listing_id);
  assert.ok(['ACTIVE', 'PENDING_REVIEW'].includes(pubSuccess.json.status));

  // G. Get listings
  const listRes = await g.call('/api/v1/channels/listings', { token: ptToken });
  assert.equal(listRes.status, 200);
  assert.ok(listRes.json.data.length >= 1);
});

// Test 5: External Channel Orders, PO Dispatch & 3PL Fulfillment
await t.test('5. Multi-Channel Orders, B2B PO Dispatch & 3PL Carrier Fulfillment', async () => {
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

  const ptLogin = await g.call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'seller@temu-supply.com', password: 'DevPass!2026#', role: 'PARTNER' }
  });
  const ptToken = ptLogin.json.token;

  const admLogin = await g.call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' }
  });
  const admToken = admLogin.json.token;

  // A. Feature Flag Guard: marketplace_order_sync is OFF (0) by default
  const syncBlocked = await g.call('/api/v1/channels/orders/sync', {
    method: 'POST',
    token: ptToken,
    body: { sales_channel_id: 'sc_coupang_wing' }
  });
  assert.equal(syncBlocked.status, 403);
  assert.equal(syncBlocked.json.code, 'FEATURE_DISABLED');

  // B. Admin enables marketplace_order_sync flag
  await g.call('/api/v1/admin/feature-flags/marketplace_order_sync/toggle', {
    method: 'POST',
    token: admToken,
    body: { is_enabled: true, reason: 'E2E Test activation' }
  });

  // C. Sync external channel orders
  const syncSuccess = await g.call('/api/v1/channels/orders/sync', {
    method: 'POST',
    token: ptToken,
    body: { sales_channel_id: 'sc_coupang_wing' }
  });
  assert.equal(syncSuccess.status, 200);
  assert.equal(syncSuccess.json.success, true);
  assert.ok(syncSuccess.json.imported_orders_count >= 1);

  // D. Query collected channel orders
  const ordersRes = await g.call('/api/v1/channels/orders', { token: ptToken });
  assert.equal(ordersRes.status, 200);
  assert.ok(ordersRes.json.data.length >= 1);
  const targetOrder = ordersRes.json.data[0];
  assert.ok(targetOrder.id);
  assert.equal(targetOrder.order_status, 'COLLECTED');

  // E. Convert Channel Order to Supplier B2B PO (Model A/B Integration)
  const poRes = await g.call(`/api/v1/channels/orders/${targetOrder.id}/dispatch-po`, {
    method: 'POST',
    token: ptToken,
    body: {
      supplier_id: 'domeggook_domeme'
    }
  });
  assert.equal(poRes.status, 200);
  assert.equal(poRes.json.success, true);
  assert.ok(poRes.json.b2b_order_id);
  assert.equal(poRes.json.status, 'PO_DISPATCHED');

  // F. 3PL Fulfillment and Tracking Number Assignment (Model C)
  const fulfillRes = await g.call(`/api/v1/channels/orders/${targetOrder.id}/fulfill`, {
    method: 'POST',
    token: ptToken,
    body: {
      carrier_code: 'CJ_LOGISTICS'
    }
  });
  assert.equal(fulfillRes.status, 200);
  assert.equal(fulfillRes.json.success, true);
  assert.equal(fulfillRes.json.status, 'SHIPPED');
  assert.ok(fulfillRes.json.tracking_number);

  // G. Inbound Webhook Reception & Verification
  const webhookRes = await g.call('/api/v1/channels/webhooks/coupang_wing', {
    method: 'POST',
    headers: {
      'x-signature': 'mock-hmac-sha256-signature'
    },
    body: {
      event_type: 'ORDER_STATUS_CHANGED',
      order_id: targetOrder.external_order_id,
      status: 'DELIVERED',
      timestamp: new Date().toISOString()
    }
  });
  assert.equal(webhookRes.status, 200);
  assert.equal(webhookRes.json.received, true);
  assert.ok(webhookRes.json.event_id);
});

t.finish();
console.log('\n🎉 ALL 5 MULTI-CHANNEL & SUPPLY CHAIN TEST SUITES PASSED 100%!\n');
