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
  // Without NTS_API_KEY only the check digit is known; the business status must not be invented.
  assert.equal(resValid.json.verification, 'CHECKSUM_ONLY');
  assert.equal(resValid.json.business_status, null);
  assert.equal(resValid.json.tax_type, null);

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

  const { signJwt } = await import('../apps/cloudflare-gateway/src/utils/crypto-auth.js');
  const tokenFor = async (userId) => {
    const u = await g.env.DB.prepare('SELECT id, role, token_version FROM users WHERE id = ?').bind(userId).first();
    return signJwt({ sub: u.id, role: u.role, tv: u.token_version || 0, ...(u.role === 'ROLE_ADMIN' ? { mfa: 1 } : {}) }, g.env.JWT_SECRET, 3600);
  };
  const buyer = await tokenFor('u_customer_001');
  const other = await g.env.DB.prepare("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' AND id != 'u_customer_001' LIMIT 1").first();
  const otherBuyer = await tokenFor(other.id);
  const adminRow = await g.env.DB.prepare("SELECT id FROM users WHERE role = 'ROLE_ADMIN' LIMIT 1").first();
  const admin = await tokenFor(adminRow.id);
  const body = { order_id: orderId, buyer_identifier: '010-1234-5678', identifier_type: 'PHONE' };

  // Unauthenticated / other customer: no receipt can be requested or read (previously anyone could, for any order)
  assert.equal((await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', body })).status, 401);
  assert.equal((await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', token: otherBuyer, body })).status, 404);
  assert.equal((await g.call(`/api/v1/finance/cash-receipts/${orderId}`)).status, 401);
  assert.equal((await g.call('/api/v1/finance/tax-invoices')).status, 401);

  // Card payment: a cash receipt is not the right evidence
  await g.env.DB.prepare("INSERT INTO payment_transactions (id, order_id, payment_key, provider, method, amount, status) VALUES ('ptx_cr_card', ?, 'pk_cr_card', 'TOSS', '카드', 33000, 'DONE')").bind(orderId).run();
  const resCard = await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', token: buyer, body });
  assert.equal(resCard.status, 400);
  assert.equal(resCard.json.code, 'NOT_CASH_PAYMENT');
  await g.env.DB.prepare("UPDATE payment_transactions SET method = '가상계좌' WHERE id = 'ptx_cr_card'").run();

  // Owner request: recorded as REQUESTED, no approval number is invented
  const resCr = await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', token: buyer, body });
  assert.equal(resCr.status, 201);
  assert.equal(resCr.json.data.issue_status, 'REQUESTED');
  assert.equal(resCr.json.data.hometax_approval_no, null);
  assert.equal(resCr.json.data.total_amount, 33000);
  assert.equal(resCr.json.data.supply_amount, 30000);
  assert.equal(resCr.json.data.vat_amount, 3000);
  assert.equal(resCr.json.data.buyer_identifier, '*******5678', 'identifier is masked in responses');
  assert.ok(!/국세청에 정상 승인/.test(resCr.json.message));
  const again = await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', token: buyer, body });
  assert.equal(again.json.already_requested, true);

  // Storefront field names (identity_number / receipt_type) are accepted too
  assert.equal((await g.call('/api/v1/finance/cash-receipts/request', { method: 'POST', token: buyer, body: { order_id: orderId, identity_number: '01012345678', receipt_type: 'PERSONAL' } })).json.already_requested, true);

  // Operator records the real issuance
  const rid = resCr.json.data.id;
  assert.equal((await g.call(`/api/v1/admin/finance/cash-receipts/${rid}/issue`, { method: 'POST', token: admin, body: {} })).status, 400);
  const issued = await g.call(`/api/v1/admin/finance/cash-receipts/${rid}/issue`, { method: 'POST', token: admin, body: { hometax_approval_no: '123456789' } });
  assert.equal(issued.status, 200);
  assert.equal((await g.call(`/api/v1/admin/finance/cash-receipts/${rid}/issue`, { method: 'POST', token: admin, body: { hometax_approval_no: '123456789' } })).status, 409);

  const resGet = await g.call(`/api/v1/finance/cash-receipts/${orderId}`, { token: buyer });
  assert.equal(resGet.status, 200);
  assert.equal(resGet.json.data.issue_status, 'ISSUED');
  assert.equal(resGet.json.data.hometax_approval_no, '123456789');
  assert.equal((await g.call(`/api/v1/finance/cash-receipts/${orderId}`, { token: otherBuyer })).status, 404);
  const list = await g.call('/api/v1/finance/tax-invoices', { token: admin });
  assert.equal(list.status, 200);
  assert.ok(list.json.data.every((r) => r.buyer_identifier.startsWith('*')));
  console.log('[PASS] 2. Cash receipt: owner-only request, no invented NTS approval, operator records issuance, PII masked');
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
  // The fabricated feed (fake "claimed %" gauges, timer resetting at midnight) is retired; the real campaign feed remains.
  const resDeals = await g.call('/api/v1/deals/lightning');
  assert.equal(resDeals.status, 410);
  const resCampaign = await g.call('/api/v1/campaigns/lightning');
  assert.equal(resCampaign.status, 200);
  for (const d of resCampaign.json.data.deals) {
    assert.ok(!('claimed_pct' in d));
    assert.ok(d.sold_percent >= 0 && d.sold_percent <= 100);
  }

  // No image model is integrated, so nothing is presented as a visual match.
  const resVisual = await g.call('/api/v1/search/visual-similarity', { method: 'POST', body: { tag: '헤드폰' } });
  assert.equal(resVisual.status, 501);
  assert.equal(resVisual.json.code, 'VISUAL_SEARCH_NOT_AVAILABLE');
  console.log('[PASS] 5. Lightning deals come only from real campaigns; image search refuses instead of inventing similarity scores');
}

// 6. Real-time Product Live Activity Stream
{
  const prod = await g.env.DB.prepare("SELECT id FROM products WHERE status = 'ACTIVE' LIMIT 1").first();
  const resAct = await g.call(`/api/v1/products/${prod.id}/live-activity`);
  assert.equal(resAct.status, 200);
  assert.equal(resAct.json.product_id, prod.id);
  assert.ok('recent_24h_purchases' in resAct.json.data);
  assert.ok('total_remaining_stock' in resAct.json.data);
  assert.ok(!('active_viewers' in resAct.json.data), 'no viewer counts are reported (none are measured)');

  // Only paid, non-refunded units count: an unpaid (READY) order must not inflate the number.
  const before = resAct.json.data.recent_24h_purchases;
  const sku = await g.env.DB.prepare('SELECT id FROM product_skus WHERE product_id = ? LIMIT 1').bind(prod.id).first();
  await g.env.DB.prepare(`INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code)
    VALUES ('ord_la_ready', 'OLM-LA-READY', 'u_customer_001', 1000, 0, 0, 1000, 'READY', 'x', '010-0000-0000', 'x', 'x', '00000')`).run();
  const pt = await g.env.DB.prepare('SELECT partner_id FROM products WHERE id = ?').bind(prod.id).first();
  await g.env.DB.prepare(`INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status)
    VALUES ('sub_la_ready', 'ord_la_ready', 'SUB-LA-READY', ?, 0, 1000, 0, 1000, 'PAYMENT_PENDING')`).bind(pt.partner_id).run();
  await g.env.DB.prepare(`INSERT INTO order_items (id, sub_order_id, sku_id, product_id, product_title, option_summary, quantity, unit_price, total_price)
    VALUES ('itm_la_ready', 'sub_la_ready', ?, ?, 'x', '기본', 5, 200, 1000)`).bind(sku.id, prod.id).run();
  const after = await g.call(`/api/v1/products/${prod.id}/live-activity`);
  assert.equal(after.json.data.recent_24h_purchases, before);
  console.log('[PASS] 6. Product activity reports measured paid sales only');
}

console.log('=== ALL COMMERCIAL EXPANSION TESTS PASSED 100% ===');
