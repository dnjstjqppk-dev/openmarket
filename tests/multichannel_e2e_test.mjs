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
  // No OAuth exchange is performed, so typed-in keys are not "verified"
  assert.equal(naverValid.verified, false);
  assert.equal(naverValid.status, 'NOT_INTEGRATED');
  assert.equal(naver.isLive, false);
  const naverStub = await naver.verifyConnection({ isSandbox: true });
  assert.equal(naverStub.status, 'SANDBOX_STUB');
  assert.equal(naverStub.simulated, true);

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
  assert.equal(elevenValid.verified, false);
  assert.equal(elevenValid.status, 'NOT_INTEGRATED');

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
  assert.equal(amzValid.verified, false);
  assert.equal(amzValid.status, 'NOT_INTEGRATED');

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
  assert.equal(b2bOrder.success, false, 'a real (non-sandbox) PO is never reported as placed');
  const b2bStub = await domeggook.createSupplierOrder({ sub_order_id: 'sub_ord_123', idempotency_key: 'idemp_key_123', total_cost_krw: 48000 }, { isSandbox: true });
  assert.equal(b2bStub.success, true);

  // F. Global 3PL Logistics Connector
  const logistics = new Global3plLogisticsConnector();
  const fulfillment = await logistics.createFulfillmentOrder({
    carrier_code: 'CJ_LOGISTICS',
    customs_id_pccc: 'P123456789012'
  });
  assert.equal(fulfillment.success, true);
  assert.equal(fulfillment.carrier_code, 'CJ_LOGISTICS');
  assert.ok(fulfillment.tracking_number);
  assert.equal(logistics.isLive, false);
  assert.equal(logistics.carrierInfo('cj_logistics').name, 'CJ대한통운');

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
    CONNECTOR_SIMULATION: 'true',
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
    CONNECTOR_SIMULATION: 'true',
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
  // No connector calls the platform yet: the credential is stored (sealed) but never reported as VERIFIED
  assert.equal(credVerify.json.verified, false);
  assert.equal(credVerify.json.status, 'CONFIGURED');
  const sealedRow = g.db.prepare('SELECT secret_key_enc FROM platform_credentials WHERE id = ?').get(coupangCred.id);
  assert.ok(sealedRow.secret_key_enc.startsWith('v1:'), 'secret stored encrypted');
  assert.ok(!sealedRow.secret_key_enc.includes('cp-super-secret'));

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
  assert.equal(pubSuccess.json.simulated, true);
  assert.equal(pubSuccess.json.status, 'DRAFT', 'a simulated publish never claims the listing is live');
  const lst = g.db.prepare('SELECT stock_allocated, external_product_id FROM channel_listings WHERE id = ?').get(pubSuccess.json.listing_id);
  const realStock = g.db.prepare('SELECT COALESCE(SUM(stock_quantity),0) AS s FROM product_skus WHERE product_id = ?').get('prod_001').s;
  assert.equal(lst.stock_allocated, realStock, 'allocated stock is the real stock, not a constant 100');
  assert.equal(lst.external_product_id, null);

  // Another seller's product cannot be pushed to an external channel
  const foreign = g.db.prepare("SELECT id FROM products WHERE partner_id != (SELECT id FROM partners WHERE owner_user_id = (SELECT id FROM users WHERE email = 'seller@temu-supply.com')) LIMIT 1").get();
  if (foreign) {
    const r = await g.call('/api/v1/channels/listings/publish', { method: 'POST', token: ptToken, body: { sales_channel_id: 'sc_coupang_wing', product_id: foreign.id } });
    assert.equal(r.status, 404);
  }

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
    CONNECTOR_SIMULATION: 'true',
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
  assert.equal(poRes.status, 400, 'supply cost must be entered, never estimated');
  const poOk = await g.call(`/api/v1/channels/orders/${targetOrder.id}/dispatch-po`, { method: 'POST', token: ptToken, body: { supplier_id: 'domeggook_domeme', total_cost_krw: 12000 } });
  assert.equal(poOk.status, 200);
  assert.equal(poOk.json.success, true);
  assert.equal(poOk.json.simulated, true);
  assert.equal(poOk.json.b2b_order_id, null);
  assert.equal(poOk.json.total_cost_krw, 12000);
  const poRes2 = poOk;
  assert.equal(poRes2.json.status, 'PO_DISPATCHED');

  // F. Register the carrier waybill (flag fulfillment_3pl is OFF by default; the system never invents a waybill)
  const fulBlocked = await g.call(`/api/v1/channels/orders/${targetOrder.id}/fulfill`, { method: 'POST', token: ptToken, body: { carrier_code: 'CJ_LOGISTICS', tracking_number: '682910482012' } });
  assert.equal(fulBlocked.status, 403);
  await g.call('/api/v1/admin/feature-flags/fulfillment_3pl/toggle', { method: 'POST', token: admToken, body: { is_enabled: true } });
  const noWaybill = await g.call(`/api/v1/channels/orders/${targetOrder.id}/fulfill`, { method: 'POST', token: ptToken, body: { carrier_code: 'CJ_LOGISTICS' } });
  assert.equal(noWaybill.status, 400);
  const fulfillRes = await g.call(`/api/v1/channels/orders/${targetOrder.id}/fulfill`, { method: 'POST', token: ptToken, body: { carrier_code: 'CJ_LOGISTICS', tracking_number: '682910482012' } });
  assert.equal(fulfillRes.status, 200);
  assert.equal(fulfillRes.json.status, 'SHIPPED');
  assert.equal(fulfillRes.json.tracking_number, '682910482012');
  assert.equal(fulfillRes.json.simulated, true);
  assert.equal((await g.call(`/api/v1/channels/orders/${targetOrder.id}/fulfill`, { method: 'POST', token: ptToken, body: { carrier_code: 'CJ_LOGISTICS', tracking_number: '682910482012' } })).status, 409);

  // G. Unsigned webhooks are refused and nothing is written
  const before = g.db.prepare('SELECT COUNT(*) AS c FROM integration_webhook_events').get().c;
  const webhookRes = await g.call('/api/v1/channels/webhooks/coupang_wing', {
    method: 'POST', headers: { 'x-signature': 'mock-hmac-sha256-signature' },
    body: { event_type: 'ORDER_STATUS_CHANGED', order_id: targetOrder.external_order_id, status: 'DELIVERED' }
  });
  assert.equal(webhookRes.status, 501);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM integration_webhook_events').get().c, before);
});

// Test 6: production never runs canned connectors
await t.test('6. Production: connector actions answer 501 and persist nothing', async () => {
  const env = { JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu', ENVIRONMENT: 'production', CONNECTOR_SIMULATION: 'true', ADMIN_2FA_REQUIRED: 'false', RATE_LIMIT_REQUIRED: 'false', PAYMENT_MODE: 'sandbox' };
  const g = await createGateway({ seedFiles: ['migrations/dev/seed_local_dev.sql'], env });
  const { signJwt } = await import('../apps/cloudflare-gateway/src/utils/crypto-auth.js');
  const u = g.db.prepare("SELECT u.id, u.token_version, p.id AS pid FROM users u JOIN partners p ON p.owner_user_id = u.id WHERE u.email = 'seller@temu-supply.com'").get();
  const pt = await signJwt({ sub: u.id, role: 'ROLE_PARTNER', tv: u.token_version || 0, pid: u.pid }, env.JWT_SECRET, 3600);
  for (const k of ['marketplace_order_sync', 'marketplace_listing_publish']) g.db.prepare('UPDATE feature_flags SET is_enabled = 1 WHERE key = ?').run(k);
  const sync = await g.call('/api/v1/channels/orders/sync', { method: 'POST', token: pt, body: { sales_channel_id: 'sc_coupang_wing' } });
  assert.equal(sync.status, 501);
  assert.equal(sync.json.code, 'CONNECTOR_NOT_INTEGRATED');
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM channel_orders').get().c, 0);
  const pub = await g.call('/api/v1/channels/listings/publish', { method: 'POST', token: pt, body: { sales_channel_id: 'sc_coupang_wing', product_id: 'prod_001' } });
  assert.equal(pub.status, 501);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM channel_listings').get().c, 0);
});

t.finish();
