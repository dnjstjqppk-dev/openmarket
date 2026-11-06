// apps/cloudflare-gateway/src/routes/bidding-m2c.js
// Temu-style M2C Supply Chain: Dynamic Reverse Bidding, MD Price Negotiations, and Package Consolidation

import { requireAdmin, requireApprovedPartner, authenticate } from '../lib/auth.js';
import { json, readJson, bad, notFound, conflict, str, intParam } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { auditStatement } from '../lib/ledger.js';

export async function handleBiddingAndM2cRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;

  // =========================================================================
  // 1. REVERSE BIDDING CAMPAIGNS (역경매 비딩)
  // =========================================================================

  // GET /api/v1/bidding/campaigns (Public/Partner/Admin list)
  if (p === '/api/v1/bidding/campaigns' && request.method === 'GET') {
    const status = url.searchParams.get('status') || 'OPEN';
    const { results } = await env.DB.prepare(
      `SELECT bc.*, c.name AS category_name, p.title AS reference_title,
              (SELECT COUNT(*) FROM supplier_bids sb WHERE sb.campaign_id = bc.id) AS bid_count,
              (SELECT MIN(bid_supply_price) FROM supplier_bids sb WHERE sb.campaign_id = bc.id) AS lowest_bid_price
       FROM bidding_campaigns bc
       JOIN categories c ON c.id = bc.category_id
       LEFT JOIN products p ON p.id = bc.reference_product_id
       WHERE (? = 'ALL' OR bc.status = ?)
       ORDER BY bc.ends_at ASC`
    ).bind(status, status).all();

    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  // GET /api/v1/bidding/my-bids (Approved partner's own bids across campaigns)
  if (p === '/api/v1/bidding/my-bids' && request.method === 'GET') {
    const partner = await requireApprovedPartner(request, env);
    const { results } = await env.DB.prepare(
      `SELECT sb.*, bc.title AS campaign_title, bc.status AS campaign_status
       FROM supplier_bids sb
       JOIN bidding_campaigns bc ON bc.id = sb.campaign_id
       WHERE sb.partner_id = ?
       ORDER BY sb.created_at DESC`
    ).bind(partner.partnerId).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  // POST /api/v1/bidding/campaigns (Admin creates a reverse bidding campaign)
  if (p === '/api/v1/bidding/campaigns' && request.method === 'POST') {
    const admin = await requireAdmin(request, env);
    const b = await readJson(request);
    const title = str(b.title, { field: '비딩 캠페인명', max: 200, required: true });
    const categoryId = str(b.category_id, { field: '카테고리 ID', required: true });
    const ceilingPrice = intParam(b.ceiling_supply_price, { min: 100, field: '상한 공급가' });
    const minMoq = intParam(b.min_moq ?? 100, { min: 1, field: '최소 MOQ' });
    const startsAt = b.starts_at || new Date().toISOString();
    const endsAt = b.ends_at || new Date(Date.now() + 7 * 86400000).toISOString();

    const cat = await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first();
    if (!cat) throw notFound('카테고리를 찾을 수 없습니다.');

    const campaignId = newId('cmp');
    await env.DB.prepare(
      `INSERT INTO bidding_campaigns (id, title, category_id, reference_product_id, target_spec_json, ceiling_supply_price, min_moq, starts_at, ends_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      campaignId, title, categoryId, b.reference_product_id || null,
      JSON.stringify(b.target_spec || {}), ceilingPrice, minMoq, startsAt, endsAt, admin.userId
    ).run();

    return json(corsHeaders, {
      success: true,
      message: '역경매 비딩 캠페인이 생성되었습니다.',
      data: { id: campaignId, title, ceiling_supply_price: ceilingPrice, ends_at: endsAt }
    }, 201);
  }

  // GET /api/v1/bidding/campaigns/:id (Campaign detail with bids)
  const campM = p.match(/^\/api\/v1\/bidding\/campaigns\/([^/]+)$/);
  if (campM && request.method === 'GET') {
    const campId = campM[1];
    const camp = await env.DB.prepare(
      `SELECT bc.*, c.name AS category_name, p.title AS reference_title
       FROM bidding_campaigns bc
       JOIN categories c ON c.id = bc.category_id
       LEFT JOIN products p ON p.id = bc.reference_product_id
       WHERE bc.id = ?`
    ).bind(campId).first();
    if (!camp) throw notFound('비딩 캠페인을 찾을 수 없습니다.');

    const viewer = await authenticate(request, env);
    let bids = [];
    if (viewer && viewer.role === 'ROLE_ADMIN') {
      const r = await env.DB.prepare(
        `SELECT sb.*, pt.business_name AS partner_name
         FROM supplier_bids sb
         JOIN partners pt ON pt.id = sb.partner_id
         WHERE sb.campaign_id = ? ORDER BY sb.bid_supply_price ASC`
      ).bind(campId).all();
      bids = r.results;
    } else if (viewer && viewer.role === 'ROLE_PARTNER') {
      const r = await env.DB.prepare(
        'SELECT * FROM supplier_bids WHERE campaign_id = ? AND partner_id = ? ORDER BY created_at DESC'
      ).bind(campId, viewer.partnerId).all();
      bids = r.results;
    }

    return json(corsHeaders, { success: true, data: { ...camp, bids } });
  }

  // POST /api/v1/bidding/campaigns/:id/bids (Partner submits a competitive wholesale bid)
  const bidSubmitM = p.match(/^\/api\/v1\/bidding\/campaigns\/([^/]+)\/bids$/);
  if (bidSubmitM && request.method === 'POST') {
    const partner = await requireApprovedPartner(request, env);
    const campId = bidSubmitM[1];
    const camp = await env.DB.prepare('SELECT * FROM bidding_campaigns WHERE id = ?').bind(campId).first();
    if (!camp) throw notFound('비딩 캠페인을 찾을 수 없습니다.');
    if (camp.status !== 'OPEN' || new Date(camp.ends_at) < new Date()) {
      throw conflict('BIDDING_CLOSED', '마감된 비딩 캠페인에는 입찰할 수 없습니다.');
    }

    const b = await readJson(request);
    const bidPrice = intParam(b.bid_supply_price, { min: 100, field: '입찰 공급가' });
    if (bidPrice > camp.ceiling_supply_price) {
      throw bad('EXCEEDS_CEILING_PRICE', `상한 공급가(${camp.ceiling_supply_price.toLocaleString()}원) 이하로만 입찰 가능합니다.`);
    }

    const moq = intParam(b.moq ?? camp.min_moq, { min: 1, field: 'MOQ' });
    const leadDays = intParam(b.production_lead_days ?? 7, { min: 1, max: 90, field: '생산 리드타임' });
    const bidId = newId('bid');

    await env.DB.prepare(
      `INSERT INTO supplier_bids (id, campaign_id, partner_id, bid_supply_price, moq, production_lead_days, sample_offered, bid_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      bidId, campId, partner.partnerId, bidPrice, moq, leadDays,
      b.sample_offered === false ? 0 : 1, str(b.bid_notes, { max: 1000 }) || null
    ).run();

    return json(corsHeaders, {
      success: true,
      message: '성공적으로 비딩 입찰이 제출되었습니다.',
      data: { id: bidId, campaign_id: campId, bid_supply_price: bidPrice }
    }, 201);
  }

  // POST /api/v1/admin/bidding/campaigns/:id/award (Admin awards winning bid)
  const awardM = p.match(/^\/api\/v1\/admin\/bidding\/campaigns\/([^/]+)\/award$/);
  if (awardM && request.method === 'POST') {
    const admin = await requireAdmin(request, env);
    const campId = awardM[1];
    const b = await readJson(request);
    const bidId = str(b.winning_bid_id, { field: '낙찰 비드 ID', required: true });

    const bid = await env.DB.prepare('SELECT * FROM supplier_bids WHERE id = ? AND campaign_id = ?').bind(bidId, campId).first();
    if (!bid) throw notFound('해당 입찰 내역을 찾을 수 없습니다.');

    await env.DB.batch([
      env.DB.prepare("UPDATE bidding_campaigns SET status = 'AWARDED', winning_bid_id = ? WHERE id = ?").bind(bidId, campId),
      env.DB.prepare("UPDATE supplier_bids SET status = 'WON' WHERE id = ?").bind(bidId),
      env.DB.prepare("UPDATE supplier_bids SET status = 'LOST' WHERE campaign_id = ? AND id != ?").bind(campId, bidId),
      auditStatement(env, admin, { action: 'BIDDING_AWARD', targetType: 'bidding_campaign', targetId: campId, after: { winning_bid_id: bidId }, request })
    ]);

    return json(corsHeaders, { success: true, message: '낙찰 업체가 선정되고 캠페인이 완료되었습니다.' });
  }

  // =========================================================================
  // 2. MD PRICE COUNTER-OFFER WORKBENCH (공급가 협상 워크벤치)
  // =========================================================================

  // GET /api/v1/pricing/negotiations (Partner or Admin list)
  if (p === '/api/v1/pricing/negotiations' && request.method === 'GET') {
    const viewer = await authenticate(request, env);
    if (!viewer) throw notFound();

    let query = `
      SELECT pn.*, p.title AS product_title, p.thumbnail_url, pt.business_name AS partner_name
      FROM price_negotiations pn
      JOIN products p ON p.id = pn.product_id
      JOIN partners pt ON pt.id = pn.partner_id
    `;
    const binds = [];
    if (viewer.role === 'ROLE_PARTNER') {
      query += ' WHERE pn.partner_id = ?';
      binds.push(viewer.partnerId);
    }
    query += ' ORDER BY pn.created_at DESC';

    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  // POST /api/v1/admin/pricing/negotiations (MD proposes a price reduction counter-offer)
  if (p === '/api/v1/admin/pricing/negotiations' && request.method === 'POST') {
    const admin = await requireAdmin(request, env);
    const b = await readJson(request);
    const productId = str(b.product_id, { field: '상품 ID', required: true });
    const targetPrice = intParam(b.suggested_target_price, { min: 100, field: '제안 목표 판매가' });
    const notes = str(b.md_proposal_notes, { field: 'MD 제안 사유', max: 1000, required: true });

    const prod = await env.DB.prepare('SELECT id, partner_id, lowest_sale_price FROM products WHERE id = ?').bind(productId).first();
    if (!prod) throw notFound('상품을 찾을 수 없습니다.');

    const discountRate = Math.round((1 - targetPrice / prod.lowest_sale_price) * 1000) / 10;
    const negoId = newId('ngo');

    await env.DB.prepare(
      `INSERT INTO price_negotiations (id, product_id, partner_id, sku_id, current_sale_price, suggested_target_price, external_market_benchmark, discount_rate_suggested, md_proposal_notes, proposed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      negoId, prod.id, prod.partner_id, b.sku_id || null, prod.lowest_sale_price, targetPrice,
      str(b.external_market_benchmark, { max: 200 }) || '1688 / Temu 시장 벤치마크 기준',
      discountRate, notes, admin.userId
    ).run();

    return json(corsHeaders, {
      success: true,
      message: '입점사에 가격 인하 카운터오퍼가 발송되었습니다.',
      data: { id: negoId, current_price: prod.lowest_sale_price, target_price: targetPrice, discount_rate: discountRate }
    }, 201);
  }

  // POST /api/v1/partner/pricing/negotiations/:id/respond (Partner accepts or rejects counter-offer)
  const negoRespM = p.match(/^\/api\/v1\/partner\/pricing\/negotiations\/([^/]+)\/respond$/);
  if (negoRespM && request.method === 'POST') {
    const partner = await requireApprovedPartner(request, env);
    const negoId = negoRespM[1];
    const nego = await env.DB.prepare('SELECT * FROM price_negotiations WHERE id = ? AND partner_id = ?').bind(negoId, partner.partnerId).first();
    if (!nego) throw notFound('협상 건을 찾을 수 없습니다.');
    if (nego.status !== 'PROPOSED') throw conflict('ALREADY_RESOLVED', '이미 응답 완료된 협상 건입니다.');

    const b = await readJson(request);
    const accept = b.accept === true;
    const notes = str(b.partner_response_notes, { max: 500 }) || null;
    const newStatus = accept ? 'ACCEPTED' : 'REJECTED';

    const batch = [
      env.DB.prepare(
        `UPDATE price_negotiations SET status = ?, partner_response_notes = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(newStatus, notes, negoId)
    ];

    // If accepted, adjust the product sale price immediately!
    if (accept) {
      batch.push(
        env.DB.prepare(
          `UPDATE product_skus SET sale_price = ? WHERE product_id = ? AND (? IS NULL OR id = ?)`
        ).bind(nego.suggested_target_price, nego.product_id, nego.sku_id, nego.sku_id),
        env.DB.prepare(
          `UPDATE products SET lowest_sale_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(nego.suggested_target_price, nego.product_id)
      );
    }

    await env.DB.batch(batch);
    return json(corsHeaders, {
      success: true,
      message: accept ? '가격 제안을 수락하여 판매가가 인하 조정되었습니다.' : '가격 제안을 거절하였습니다.'
    });
  }

  // =========================================================================
  // 3. PACKAGE CONSOLIDATION LOGISTICS (합배송 허브 관리)
  // =========================================================================

  // POST /api/v1/admin/logistics/consolidate (Consolidate multiple sub-orders into single outbound parcel)
  if (p === '/api/v1/admin/logistics/consolidate' && request.method === 'POST') {
    await requireAdmin(request, env);
    const b = await readJson(request);
    const subOrderIds = Array.isArray(b.sub_order_ids) ? b.sub_order_ids : [];
    const trackingNo = str(b.consolidated_tracking_number, { field: '통합 송장번호', max: 50, required: true });
    const hubId = str(b.hub_id, { max: 50 }) || 'HUB_INCHEON_CROSSBORDER';

    if (subOrderIds.length < 2) {
      throw bad('INSUFFICIENT_SUB_ORDERS', '합배송 처리는 최소 2개 이상의 판매자 주문이 필요합니다.');
    }

    const batch = subOrderIds.map((soId) =>
      env.DB.prepare(
        `UPDATE sub_orders
         SET is_consolidated = 1, consolidation_hub_id = ?, consolidated_tracking_number = ?, consolidation_status = 'CONSOLIDATED'
         WHERE id = ?`
      ).bind(hubId, trackingNo, soId)
    );

    await env.DB.batch(batch);
    return json(corsHeaders, {
      success: true,
      message: `${subOrderIds.length}개 주문이 1개 통합 송장(${trackingNo})으로 합배송 지정되었습니다.`
    });
  }

  return null;
}
