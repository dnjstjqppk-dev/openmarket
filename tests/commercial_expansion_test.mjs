// tests/commercial_expansion_test.mjs
// Verification suite for Phase 1~3 Commercial Expansion Features:
// 1. NTS Business Registration Validation (체크섬 및 유효성)
// 2. Cash Receipt & Tax Invoice Issuance (현금영수증 및 세금계산서)
// 3. Dynamic Reverse Bidding (역경매 비딩 등록 및 입찰)
// 4. MD Price Counter-Offer Negotiations (공급가 협상 및 자동 판매가 인하)
// 5. Dynamic Lightning Deals & AI Visual Similarity Search
// 6. Real-time Product Live Activity Stream

import assert from 'node:assert/strict';
import { createGateway } from './lib/harness.mjs';

const g = await createGateway({
  env: {
    ENVIRONMENT: 'development',
    RATE_LIMIT_REQUIRED: 'false',
    JWT_SECRET: 'test_jwt_secret_must_be_32_characters_or_longer_ok'
  },
  seedFiles: ['migrations/dev/seed_local_dev.sql']
});

console.log('=== Commercial Expansion Verification Suite ===');

// 1. NTS Business Number Checksum Test
{
  const resValid = await g.call('/api/v1/onboarding/validate-business', {
    method: 'POST',
    body: { business_reg_number: '220-81-62517' }
  });
  assert.equal(resValid.status, 200);
  assert.equal(resValid.json.valid, true);
  assert.equal(resValid.json.formatted, '220-81-62517');

  const resInvalid = await g.call('/api/v1/onboarding/validate-business', {
    method: 'POST',
    body: { business_reg_number: '123-45-67890' }
  });
  assert.equal(resInvalid.status, 400);
  assert.equal(resInvalid.json.valid, false);
  console.log('[PASS] 1. NTS Korean BRN Validation & Checksum Engine');
}

// 2. Cash Receipt Request on Paid Order
{
  const orderId = 'ord_cash_receipt_test';
  await g.env.DB.prepare(
    `INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code)
     VALUES (?, 'OLM-CR-001', 'u_customer_001', 33000, 0, 0, 33000, 'PAID', '홍길동', '010-1234-5678', '서울시 강남구 테헤란로 1', '101호', '06234')`
  ).bind(orderId).run();

  const resCr = await g.call('/api/v1/finance/cash-receipts/request', {
    method: 'POST',
    body: { order_id: orderId, buyer_identifier: '010-1234-5678', identifier_type: 'PHONE' }
  });
  assert.equal(resCr.status, 201);
  assert.equal(resCr.json.data.total_amount, 33000);
  assert.equal(resCr.json.data.supply_amount, 30000);
  assert.equal(resCr.json.data.vat_amount, 3000);
  assert.ok(resCr.json.data.hometax_approval_no.startsWith('HTX-'));

  const resGet = await g.call(`/api/v1/finance/cash-receipts/${orderId}`);
  assert.equal(resGet.status, 200);
  assert.equal(resGet.json.data.total_amount, 33000);
  console.log('[PASS] 2. Electronic Cash Receipt (현금영수증) Issuance & Hometax Approval Format');
}

// 3. Dynamic Reverse Bidding Engine (역경매 비딩)
{
  const cat = await g.env.DB.prepare('SELECT id FROM categories LIMIT 1').first();
  assert.ok(cat);

  const adminUser = await g.env.DB.prepare("SELECT id, role, token_version FROM users WHERE role = 'ROLE_ADMIN' LIMIT 1").first();
  const jwt = await (await import('../apps/cloudflare-gateway/src/utils/crypto-auth.js')).signJwt(
    { sub: adminUser.id, role: 'ROLE_ADMIN', tv: adminUser.token_version || 0, mfa: 1 },
    g.env.JWT_SECRET, 3600
  );

  const resCamp = await g.call('/api/v1/bidding/campaigns', {
    method: 'POST',
    token: jwt,
    body: {
      title: '2026 초가성비 노이즈캔슬링 헤드폰 대량 공급 비딩',
      category_id: cat.id,
      ceiling_supply_price: 25000,
      min_moq: 500
    }
  });
  assert.equal(resCamp.status, 201);
  const campId = resCamp.json.data.id;

  const resList = await g.call('/api/v1/bidding/campaigns');
  assert.equal(resList.status, 200);
  assert.ok(resList.json.count >= 1);

  const partnerUser = await g.env.DB.prepare(
    "SELECT u.id, u.role, u.token_version, p.id AS pid FROM users u JOIN partners p ON p.owner_user_id = u.id WHERE p.status = 'APPROVED' LIMIT 1"
  ).first();
  const partnerJwt = await (await import('../apps/cloudflare-gateway/src/utils/crypto-auth.js')).signJwt(
    { sub: partnerUser.id, role: 'ROLE_PARTNER', tv: partnerUser.token_version || 0, pid: partnerUser.pid },
    g.env.JWT_SECRET, 3600
  );

  const resBid = await g.call(`/api/v1/bidding/campaigns/${campId}/bids`, {
    method: 'POST',
    token: partnerJwt,
    body: {
      bid_supply_price: 21500,
      moq: 1000,
      production_lead_days: 5,
      bid_notes: '1차 물량 3일 내 출고 가능'
    }
  });
  assert.equal(resBid.status, 201);
  const bidId = resBid.json.data.id;

  const resAward = await g.call(`/api/v1/admin/bidding/campaigns/${campId}/award`, {
    method: 'POST',
    token: jwt,
    body: { winning_bid_id: bidId }
  });
  assert.equal(resAward.status, 200);
  console.log('[PASS] 3. Dynamic Reverse Bidding Engine (Campaign, Bid Submission, Awarding)');
}

// 4. MD Price Counter-Offer Negotiations
{
  const prod = await g.env.DB.prepare("SELECT id, partner_id, lowest_sale_price FROM products WHERE status = 'ACTIVE' LIMIT 1").first();
  assert.ok(prod);

  const adminUser = await g.env.DB.prepare("SELECT id, role, token_version FROM users WHERE role = 'ROLE_ADMIN' LIMIT 1").first();
  const jwt = await (await import('../apps/cloudflare-gateway/src/utils/crypto-auth.js')).signJwt(
    { sub: adminUser.id, role: 'ROLE_ADMIN', tv: adminUser.token_version || 0, mfa: 1 },
    g.env.JWT_SECRET, 3600
  );

  const targetPrice = Math.round(prod.lowest_sale_price * 0.85);
  const resNego = await g.call('/api/v1/admin/pricing/negotiations', {
    method: 'POST',
    token: jwt,
    body: {
      product_id: prod.id,
      suggested_target_price: targetPrice,
      md_proposal_notes: 'Temu 최저가 대응을 위한 15% 인하 제안. 수락 시 메인 배너 3일 노출 지원',
      external_market_benchmark: '1688 평균가 12% 낮음'
    }
  });
  assert.equal(resNego.status, 201);
  const negoId = resNego.json.data.id;

  const partnerUser = await g.env.DB.prepare(
    'SELECT u.id, u.role, u.token_version, p.id AS pid FROM users u JOIN partners p ON p.owner_user_id = u.id WHERE p.id = ?'
  ).bind(prod.partner_id).first();
  const partnerJwt = await (await import('../apps/cloudflare-gateway/src/utils/crypto-auth.js')).signJwt(
    { sub: partnerUser.id, role: 'ROLE_PARTNER', tv: partnerUser.token_version || 0, pid: partnerUser.pid },
    g.env.JWT_SECRET, 3600
  );

  const resAccept = await g.call(`/api/v1/partner/pricing/negotiations/${negoId}/respond`, {
    method: 'POST',
    token: partnerJwt,
    body: { accept: true, partner_response_notes: '메인 배너 노출 조건으로 15% 인하 수락합니다.' }
  });
  assert.equal(resAccept.status, 200);

  const updatedProd = await g.env.DB.prepare('SELECT lowest_sale_price FROM products WHERE id = ?').bind(prod.id).first();
  assert.equal(updatedProd.lowest_sale_price, targetPrice);
  console.log('[PASS] 4. MD Price Counter-Offer Negotiation & Automatic Price Recalibration');
}

// 5. Dynamic Lightning Deals & AI Visual Similarity Search
{
  const resDeals = await g.call('/api/v1/deals/lightning');
  assert.equal(resDeals.status, 200);
  assert.ok(resDeals.json.data.length > 0);
  assert.ok(typeof resDeals.json.remaining_seconds === 'number');

  const resVisual = await g.call('/api/v1/search/visual-similarity', {
    method: 'POST',
    body: { tag: '헤드폰' }
  });
  assert.equal(resVisual.status, 200);
  assert.equal(resVisual.json.search_mode, 'VISUAL_SIMILARITY_MATCH');
  assert.ok(resVisual.json.data.length > 0);
  console.log('[PASS] 5. Dynamic Lightning Deals Countdown & AI Visual Similarity Search');
}

// 6. Real-time Product Live Activity Stream
{
  const prod = await g.env.DB.prepare("SELECT id FROM products WHERE status = 'ACTIVE' LIMIT 1").first();
  const resAct = await g.call(`/api/v1/products/${prod.id}/live-activity`);
  assert.equal(resAct.status, 200);
  assert.equal(resAct.json.product_id, prod.id);
  assert.ok('recent_24h_purchases' in resAct.json.data);
  assert.ok('total_remaining_stock' in resAct.json.data);
  console.log('[PASS] 6. Real-time Product Live Activity & Verified Social Proof Stream');
}

console.log('=== ALL COMMERCIAL EXPANSION TESTS PASSED 100% ===');
