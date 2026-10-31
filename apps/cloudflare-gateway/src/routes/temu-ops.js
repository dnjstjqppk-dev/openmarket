// apps/cloudflare-gateway/src/routes/temu-ops.js
// OLMOA Temu-Grade Core Supply Chain & Customer Care Engine:
// Returnless Refunds, Late Delivery Guarantee, Body Metric Reviews, Factory Sample QC & Fast-Track IPR Takedown

export async function handleTemuOpsRoutes(request, url, env, corsHeaders) {
  // 1. Late Delivery Guarantee Compensation (POST /api/v1/orders/:id/late-delivery-claim)
  if (url.pathname.match(/^\/api\/v1\/orders\/[^\/]+\/late-delivery-claim$/) && request.method === 'POST') {
    const orderId = url.pathname.split('/')[4];
    const customerId = request.headers.get('X-Customer-Id') || 'u_customer_001';

    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? OR order_no = ?').bind(orderId, orderId).first();
    if (!order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: corsHeaders });
    }

    const { results: subOrders } = await env.DB.prepare(
      'SELECT * FROM sub_orders WHERE parent_order_id = ?'
    ).bind(order.id).all();

    if (!subOrders || subOrders.length === 0) {
      return new Response(JSON.stringify({ error: 'Sub-orders not found for this order' }), { status: 404, headers: corsHeaders });
    }

    const uncompensated = subOrders.find(s => Number(s.is_late_compensated) === 0);
    if (!uncompensated) {
      return new Response(JSON.stringify({
        error: '이미 해당 주문에 대한 배송 지연 보상 크레딧(₩5,300)이 지급되었습니다.',
        code: 'ALREADY_COMPENSATED'
      }), { status: 400, headers: corsHeaders });
    }

    const compensationAmount = 5300; // ~$5.00 USD Temu standard late delivery compensation
    const creditId = `crd_late_${Date.now()}`;

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE sub_orders
         SET is_late_compensated = 1, late_compensation_amount = ?
         WHERE parent_order_id = ?`
      ).bind(compensationAmount, order.id),
      env.DB.prepare(
        `INSERT INTO user_credits (id, user_id, amount_delta, balance_after, reason, reference_id)
         VALUES (?, ?, ?, COALESCE((SELECT SUM(amount_delta) FROM user_credits WHERE user_id = ?), 0) + ?, '테무형 안심 배송 약속 지연 보상 크레딧', ?)`
      ).bind(creditId, customerId, compensationAmount, customerId, compensationAmount, order.id),
      env.DB.prepare(
        `INSERT INTO notifications (id, user_id, title, message, type, action_url)
         VALUES (?, ?, '⚡ 배송 지연 보상금 ₩5,300 지급 완료', '약속된 배송 예정일보다 늦어져 죄송합니다. 올모아 무조건 배송 보증 정책에 따라 ₩5,300 적립금이 즉시 지급되었습니다.', 'CREDIT_GRANTED', '/profile')`
      ).bind(`notif_${Date.now()}`, customerId)
    ]);

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA Delivery Guarantee',
      message: '배송 지연 보상 정책에 따라 ₩5,300 적립금이 즉시 지급되었습니다.',
      data: {
        order_id: order.id,
        order_no: order.order_no,
        compensation_amount: compensationAmount,
        compensated_at: new Date().toISOString()
      }
    }), { status: 200, headers: corsHeaders });
  }

  // 2. Real-Time Scarcity / Urgency Stats (GET /api/v1/products/:id/urgency-stats)
  if (url.pathname.match(/^\/api\/v1\/products\/[^\/]+\/urgency-stats$/) && request.method === 'GET') {
    const prodId = url.pathname.split('/')[4];
    const product = await env.DB.prepare('SELECT id, total_sold_count FROM products WHERE id = ?').bind(prodId).first();

    const baseSold = product ? (Number(product.total_sold_count) || 120) : 340;
    const dynamic24hSales = Math.max(14, Math.round(baseSold * 0.12) + 18);
    const inCartViewers = Math.max(3, Math.round(dynamic24hSales * 0.15) + 4);

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA Urgency Engine',
      data: {
        product_id: prodId,
        recent_24h_sales: dynamic24hSales,
        viewers_now: inCartViewers * 2 + 5,
        in_cart_now: inCartViewers,
        flash_deal_remaining_seconds: 14400 - (Math.floor(Date.now() / 1000) % 14400),
        low_stock_threshold: 5,
        delivery_guarantee: {
          days: '5-7 business days',
          late_compensation_krw: 5300
        }
      }
    }), { headers: corsHeaders });
  }

  // 3. Product Reviews with Body Metric (Height / Weight / Fit)
  if (url.pathname.match(/^\/api\/v1\/products\/[^\/]+\/reviews$/)) {
    const prodId = url.pathname.split('/')[4];

    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT id, product_id, user_id, COALESCE(author_name, reviewer_name) as author_name, reviewer_name, rating, content, user_height_cm, user_weight_kg, fit_type, created_at FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 50`
      ).bind(prodId).all();

      return new Response(JSON.stringify({
        success: true,
        brand: 'OLMOA Fit Reviews',
        count: results.length,
        data: results
      }), { headers: corsHeaders });
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const userId = request.headers.get('X-Customer-Id') || body.user_id || 'u_customer_001';
      const authorName = body.author_name || '익명 고객';
      const rating = Number(body.rating) || 5;
      const content = (body.content || '사이즈 딱 맞고 배송 빠릅니다. 가성비 최고!').trim();
      const heightCm = body.user_height_cm ? Number(body.user_height_cm) : null;
      const weightKg = body.user_weight_kg ? Number(body.user_weight_kg) : null;
      const fitType = ['TRUE_TO_SIZE', 'RUNS_SMALL', 'RUNS_LARGE'].includes(body.fit_type) ? body.fit_type : 'TRUE_TO_SIZE';
      const reviewId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      await env.DB.prepare(
        `INSERT INTO product_reviews (id, product_id, order_id, user_id, reviewer_name, author_name, rating, content, user_height_cm, user_weight_kg, fit_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(reviewId, prodId, body.order_id || null, userId, authorName, authorName, rating, content, heightCm, weightKg, fitType).run();

      return new Response(JSON.stringify({
        success: true,
        brand: 'OLMOA',
        message: '실측 체형 정보가 포함된 리뷰가 성공적으로 등록되었습니다.',
        data: {
          review_id: reviewId,
          product_id: prodId,
          fit_type: fitType,
          rating
        }
      }), { status: 201, headers: corsHeaders });
    }
  }

  // 4. Factory Sample QC Verification (Partner & Admin)
  if (url.pathname === '/api/v1/partner/sample-qc') {
    const partnerId = request.headers.get('X-Partner-Id') || 'pt_001';

    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM sample_qc_requests WHERE partner_id = ? ORDER BY created_at DESC'
      ).bind(partnerId).all();
      return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const title = (body.product_title || '신규 M2C 공장 직결 샘플').trim();
      const trackingNo = (body.sample_tracking_no || `TRK-QC-${Date.now()}`).trim();
      const carrier = body.carrier || 'CJ대한통운';
      const reqId = `qc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      await env.DB.prepare(
        `INSERT INTO sample_qc_requests (id, partner_id, product_id, product_title, sample_tracking_no, carrier, status)
         VALUES (?, ?, ?, ?, ?, ?, 'IN_INSPECTION')`
      ).bind(reqId, partnerId, body.product_id || null, title, trackingNo, carrier).run();

      return new Response(JSON.stringify({
        success: true,
        brand: 'OLMOA Sample QC',
        message: '물류센터 실물 샘플 검수 신청이 접수되었습니다. 검수팀 도착 후 24시간 내 판정됩니다.',
        data: { id: reqId, status: 'IN_INSPECTION', tracking_no: trackingNo }
      }), { status: 201, headers: corsHeaders });
    }
  }

  // Admin Sample QC Inspection Desk
  if (url.pathname === '/api/v1/admin/sample-qc' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT q.*, p.business_name FROM sample_qc_requests q LEFT JOIN partners p ON q.partner_id = p.id ORDER BY q.created_at DESC`
    ).all();
    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname.match(/^\/api\/v1\/admin\/sample-qc\/[^\/]+\/inspect$/) && request.method === 'POST') {
    const reqId = url.pathname.split('/')[5];
    const body = await request.json().catch(() => ({}));
    const decision = ['APPROVED', 'REJECTED', 'CONDITIONAL'].includes(body.decision) ? body.decision : 'APPROVED';
    const notes = body.inspector_notes || '원단 내구성 및 무독성 패키지 규격 합격';

    await env.DB.prepare(
      `UPDATE sample_qc_requests SET status = ?, inspector_notes = ?, inspected_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(decision, notes, reqId).run();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA QC Inspection Desk',
      data: { id: reqId, status: decision, inspector_notes: notes }
    }), { status: 200, headers: corsHeaders });
  }

  // 5. IPR (Notice & Fast-Track Takedown)
  if (url.pathname === '/api/v1/ipr/report' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const reporter = (body.reporter_name || '권리자 대리인').trim();
    const brandName = (body.brand_name || 'Global Brand Inc.').trim();
    const targetProdId = body.target_product_id;
    const infringementType = body.infringement_type || 'COUNTERFEIT';
    const evidenceUrl = body.evidence_url || 'https://evidence.olmoa.com/cert.pdf';
    const reportId = `ipr_${Date.now()}`;

    if (!targetProdId) {
      return new Response(JSON.stringify({ error: 'target_product_id is required' }), { status: 400, headers: corsHeaders });
    }

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ipr_takedown_reports (id, reporter_name, brand_name, target_product_id, infringement_type, evidence_url, status)
         VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED')`
      ).bind(reportId, reporter, brandName, targetProdId, infringementType, evidenceUrl),
      // Fast-track auto-hide suspicious product immediately to prevent legal liability
      env.DB.prepare("UPDATE products SET status = 'HIDDEN', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(targetProdId)
    ]);

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA IPR Protection Center',
      message: '지식재산권 침해 신고가 접수되어 해당 상품이 즉시 긴급 블라인드(판매 중단) 처리되었습니다.',
      data: { report_id: reportId, product_id: targetProdId, action: 'IMMEDIATE_HIDDEN' }
    }), { status: 201, headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/admin/ipr-reports' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT r.*, p.title as product_title, p.partner_id FROM ipr_takedown_reports r LEFT JOIN products p ON r.target_product_id = p.id ORDER BY r.created_at DESC`
    ).all();
    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
  }

  return null;
}
