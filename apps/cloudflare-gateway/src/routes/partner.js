// apps/cloudflare-gateway/src/routes/partner.js
// OLMOA Partner Seller Engine: Multi-Tenant Isolation, Per-SKU Stock, CSV Bulk Upload, Live Settlements & Q&A

async function resolvePartner(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const partnerHeader = request.headers.get('X-Partner-Id') || '';
  const candidateId = partnerHeader || (token.startsWith('pt_') ? token : null);
  if (!candidateId) return null;

  const partner = await env.DB.prepare(
    "SELECT * FROM partners WHERE (id = ? OR owner_user_id = ?) AND status = 'APPROVED'"
  ).bind(candidateId, candidateId).first();

  return partner;
}

export async function handlePartnerRoutes(request, url, env, corsHeaders) {
  if (!url.pathname.startsWith('/api/v1/partner')) return null;

  const partner = await resolvePartner(request, env);
  if (!partner) {
    return new Response(JSON.stringify({
      error: 'Unauthorized: Valid approved partner credentials required. Tenant isolated.'
    }), { status: 401, headers: corsHeaders });
  }

  const partnerId = partner.id;

  // 1. Partner Products & SKUs (Tenant Scoped, Per-SKU Row with Option Summary)
  if (url.pathname === '/api/v1/partner/products' && request.method === 'GET') {
    const { results: products } = await env.DB.prepare(
      `SELECT p.*, c.name as category_name, c.slug as category_slug,
              s.id as sku_id, s.sku_code, s.option_combination_json,
              s.stock_quantity, s.original_price as sku_original_price, s.sale_price, s.status as sku_status
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN product_skus s ON s.product_id = p.id
       WHERE p.partner_id = ?
       ORDER BY p.created_at DESC, s.sku_code ASC`
    ).bind(partnerId).all();

    const formatted = products.map(r => {
      let optSummary = '기본';
      try {
        const opt = JSON.parse(r.option_combination_json || '{}');
        optSummary = Object.entries(opt).map(([k, v]) => `${k}:${v}`).join(' / ') || '기본';
      } catch (_) {}
      return { ...r, option_summary: optSummary };
    });

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', partner_id: partnerId,
      business_name: partner.business_name, count: formatted.length, data: formatted
    }), { headers: corsHeaders });
  }

  // 2. Partner Create Single Product (+ SKUs)
  if (url.pathname === '/api/v1/partner/products' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (!body.title || !body.title.trim()) {
      return new Response(JSON.stringify({ error: '상품명을 입력해 주세요.' }), { status: 400, headers: corsHeaders });
    }
    const prodId = 'prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
    const skuId = 'sku_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
    const skuCode = (body.sku_code || 'SKU-' + Date.now().toString().slice(-6)).trim();
    const salePrice = Math.max(100, parseInt(body.price || body.lowest_sale_price || 19900, 10));
    const origPrice = Math.max(salePrice, parseInt(body.original_price || body.lowest_original_price || Math.round(salePrice * 1.4), 10));
    const stockQty = Math.max(0, parseInt(body.stock_quantity ?? 100, 10));

    let catId = body.category_id || 'sub_w_tops';
    if (body.category_slug) {
      const catRow = await env.DB.prepare('SELECT id FROM categories WHERE slug = ? OR id = ?').bind(body.category_slug, body.category_slug).first();
      if (catRow) catId = catRow.id;
    }

    const optJson = body.option_combination_json
      ? (typeof body.option_combination_json === 'string' ? body.option_combination_json : JSON.stringify(body.option_combination_json))
      : '{"옵션":"기본 표준형"}';

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
      ).bind(
        prodId, partnerId, catId,
        body.title.trim(),
        body.thumbnail_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500',
        body.description_html || `<p>${body.title.trim()}</p>`,
        origPrice, salePrice
      ),
      env.DB.prepare(
        `INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 5, ?)`
      ).bind(skuId, prodId, skuCode, optJson, origPrice, salePrice, stockQty, stockQty > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK')
    ]);

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', product_id: prodId, sku_id: skuId, sku_code: skuCode,
      message: '신규 상품 및 SKU가 D1 카탈로그에 등록되었습니다.'
    }), { status: 201, headers: corsHeaders });
  }

  // 3. Partner CSV/JSON Bulk Product Upload (POST /api/v1/partner/products/bulk)
  if (url.pathname === '/api/v1/partner/products/bulk' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const rows = Array.isArray(body.items) ? body.items : [];
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: '업로드할 상품 데이터 배열(items)이 비어 있습니다.' }), { status: 400, headers: corsHeaders });
    }

    const stmts = [];
    const createdIds = [];
    let idx = 0;

    for (const row of rows.slice(0, 200)) {
      idx++;
      const title = (row.title || '').trim();
      if (!title) continue;

      let catId = 'sub_w_tops';
      const slugOrCat = (row.category_slug || row.category_id || '').trim();
      if (slugOrCat) {
        const catRow = await env.DB.prepare('SELECT id FROM categories WHERE slug = ? OR id = ?').bind(slugOrCat, slugOrCat).first();
        if (catRow) catId = catRow.id;
      }

      const prodId = `prod_blk_${Date.now()}_${idx}`;
      const skuId = `sku_blk_${Date.now()}_${idx}`;
      const skuCode = (row.sku_code || `SKU-BLK-${Date.now().toString().slice(-5)}-${idx}`).trim();
      const salePrice = Math.max(100, parseInt(row.lowest_sale_price || row.sale_price || row.price || 15900, 10));
      const origPrice = Math.max(salePrice, parseInt(row.lowest_original_price || row.original_price || Math.round(salePrice * 1.35), 10));
      const stockQty = Math.max(0, parseInt(row.stock_quantity ?? 100, 10));
      const thumb = (row.thumbnail_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500').trim();
      const optJson = row.option_json || '{"옵션":"기본"}';

      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
        ).bind(prodId, partnerId, catId, title, thumb, `<p>${title} 정품 직배송 상품입니다.</p>`, origPrice, salePrice)
      );
      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 5, ?)`
        ).bind(skuId, prodId, skuCode, optJson, origPrice, salePrice, stockQty, stockQty > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK')
      );
      createdIds.push({ product_id: prodId, sku_id: skuId, sku_code: skuCode, title });
    }

    if (stmts.length > 0) {
      await env.DB.batch(stmts);
    }

    const bulkData = { inserted_count: createdIds.length, imported_count: createdIds.length, products: createdIds, items: createdIds };
    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      partner_id: partnerId,
      ...bulkData,
      data: bulkData,
      message: `총 ${createdIds.length}건의 신규 SKU 상품이 D1 데이터베이스에 일괄 등록되었습니다.`
    }), { status: 201, headers: corsHeaders });
  }

  // 4. Partner Update SKU Stock & Price (Enforce Ownership + Individual SKU Targeting)
  if (url.pathname.startsWith('/api/v1/partner/products/') && url.pathname.endsWith('/stock') && (request.method === 'PUT' || request.method === 'PATCH')) {
    const targetId = url.pathname.split('/')[5];
    const body = await request.json().catch(() => ({}));
    const newStock = Math.max(0, parseInt(body.stock_quantity, 10));
    const skuIdParam = body.sku_id || targetId;

    // Verify ownership via product or SKU join
    const ownedSku = await env.DB.prepare(
      `SELECT s.id as sku_id, s.product_id, s.stock_quantity
       FROM product_skus s
       JOIN products p ON s.product_id = p.id
       WHERE (s.id = ? OR p.id = ?) AND p.partner_id = ?
       LIMIT 1`
    ).bind(skuIdParam, targetId, partnerId).first();

    if (!ownedSku) {
      return new Response(JSON.stringify({ error: 'Forbidden: Tenant mismatch. Product/SKU not owned by partner.' }), { status: 403, headers: corsHeaders });
    }

    const newStatus = newStock <= 0 ? 'OUT_OF_STOCK' : 'IN_STOCK';
    const delta = newStock - (ownedSku.stock_quantity || 0);

    // If specific sku_id was supplied or targetId matches a sku_id, update only that SKU
    const isExactSku = Boolean(body.sku_id || targetId.startsWith('sku_'));
    const updateQuery = isExactSku
      ? 'UPDATE product_skus SET stock_quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      : 'UPDATE product_skus SET stock_quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?';
    const bindKey = isExactSku ? ownedSku.sku_id : ownedSku.product_id;

    await env.DB.batch([
      env.DB.prepare(updateQuery).bind(newStock, newStatus, bindKey),
      env.DB.prepare(
        `INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key)
         VALUES (?, ?, 'MANUAL_ADJUST', ?, ?, ?, ?)`
      ).bind(`ldg_adj_${Date.now()}`, ownedSku.sku_id, delta, newStock, partnerId, `adj_${ownedSku.sku_id}_${Date.now()}`)
    ]);

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', product_id: ownedSku.product_id, sku_id: ownedSku.sku_id,
      stock_quantity: newStock, status: newStatus, message: 'Stock and ledger updated'
    }), { headers: corsHeaders });
  }

  // 5. Partner Sub-Orders (Strictly Isolated to Partner)
  if (url.pathname === '/api/v1/partner/orders' && request.method === 'GET') {
    const { results: subOrders } = await env.DB.prepare(
      `SELECT s.*, o.order_no, o.recipient_name, o.recipient_phone, o.shipping_address_line1, o.shipping_address_line2, o.shipping_postal_code, o.shipping_memo, o.created_at as order_date
       FROM sub_orders s
       JOIN orders o ON s.parent_order_id = o.id
       WHERE s.partner_id = ?
       ORDER BY s.created_at DESC`
    ).bind(partnerId).all();

    for (const sub of subOrders) {
      const { results: items } = await env.DB.prepare(`
        SELECT i.*, s.product_id, p.thumbnail_url
        FROM order_items i
        LEFT JOIN product_skus s ON i.sku_id = s.id
        LEFT JOIN products p ON s.product_id = p.id
        WHERE i.sub_order_id = ?
      `).bind(sub.id).all();
      sub.items = items;
    }

    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', partner_id: partnerId, count: subOrders.length, data: subOrders }), { headers: corsHeaders });
  }

  // 5.5 Partner Bulk Shipment Update (Must Own Sub-Orders)
  if (url.pathname === '/api/v1/partner/orders/bulk-shipment' && (request.method === 'PUT' || request.method === 'POST')) {
    const body = await request.json().catch(() => ({}));
    const shipments = Array.isArray(body.shipments) ? body.shipments : [];
    if (!shipments.length) {
      return new Response(JSON.stringify({ error: 'Shipments list is empty' }), { status: 400, headers: corsHeaders });
    }

    const stmts = [];
    let updatedCount = 0;
    for (const sh of shipments) {
      if (!sh.sub_order_id || !sh.tracking_number) continue;
      stmts.push(
        env.DB.prepare(`
          UPDATE sub_orders
          SET carrier_code = ?, tracking_number = ?, status = 'SHIPPED', shipped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND partner_id = ?
        `).bind(sh.carrier || 'CJ대한통운', sh.tracking_number.trim(), sh.sub_order_id, partnerId)
      );
      updatedCount++;
    }

    if (stmts.length > 0) {
      await env.DB.batch(stmts);
    }

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      updated_count: updatedCount,
      message: `총 ${updatedCount}건의 주문 송장이 일괄 등록되고 출고 완료 처리되었습니다.`
    }), { headers: corsHeaders });
  }

  // 6. Partner Update Shipment (Must Own Sub-Order)
  if (url.pathname.startsWith('/api/v1/partner/orders/') && url.pathname.endsWith('/shipment') && (request.method === 'PUT' || request.method === 'POST')) {
    const subOrderId = url.pathname.split('/')[5];
    const body = await request.json().catch(() => ({}));
    const carrier = body.carrier || body.carrier_code || 'CJ대한통운';
    const trackingNo = (body.tracking_number || '').trim();

    const subOrder = await env.DB.prepare('SELECT id, status FROM sub_orders WHERE id = ? AND partner_id = ?').bind(subOrderId, partnerId).first();
    if (!subOrder) {
      return new Response(JSON.stringify({ error: 'Forbidden: Sub-order not found or belongs to another partner.' }), { status: 403, headers: corsHeaders });
    }

    await env.DB.prepare(
      `UPDATE sub_orders
       SET carrier_code = ?, tracking_number = ?, status = 'SHIPPED', shipped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND partner_id = ?`
    ).bind(carrier, trackingNo, subOrderId, partnerId).run();

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', sub_order_id: subOrderId, carrier, tracking_number: trackingNo, status: 'SHIPPED'
    }), { headers: corsHeaders });
  }

  // 7. Partner Live Settlements Ledger (GET /api/v1/partner/settlements)
  if (url.pathname === '/api/v1/partner/settlements' && request.method === 'GET') {
    const { results: settlements } = await env.DB.prepare(
      `SELECT st.*, sub.sub_order_no, sub.status as sub_order_status, o.order_no, o.created_at as order_date
       FROM settlements st
       LEFT JOIN sub_orders sub ON st.sub_order_id = sub.id
       LEFT JOIN orders o ON sub.parent_order_id = o.id
       WHERE st.partner_id = ?
       ORDER BY st.created_at DESC`
    ).bind(partnerId).all();

    const activeRows = settlements.filter(s => s.status !== 'CANCELLED');
    const summary = {
      totalGross: activeRows.reduce((sum, s) => sum + (s.gross_amount || 0), 0),
      commission: activeRows.reduce((sum, s) => sum + (s.commission_amount || 0), 0),
      shippingSettled: activeRows.reduce((sum, s) => sum + (s.shipping_fee || 0), 0),
      netPayout: activeRows.reduce((sum, s) => sum + (s.net_payout_amount || 0), 0),
      pendingCount: activeRows.filter(s => s.status === 'PENDING').length,
      settledCount: activeRows.filter(s => s.status === 'SETTLED').length
    };

    const mappedSettlements = settlements.map(s => ({
      ...s,
      order_id: s.order_no || s.sub_order_no || s.sub_order_id,
      settlement_status: s.status === 'SETTLED' ? 'PAID' : s.status
    }));
    const fullSummary = {
      ...summary,
      gross_sales: summary.totalGross,
      total_commission: summary.commission,
      net_payout: summary.netPayout,
      paid_amount: activeRows.filter(s => s.status === 'SETTLED').reduce((sum, s) => sum + (s.net_payout_amount || 0), 0),
      pending_amount: activeRows.filter(s => s.status === 'PENDING').reduce((sum, s) => sum + (s.net_payout_amount || 0), 0)
    };
    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      partner_id: partnerId,
      business_name: partner.business_name,
      summary: fullSummary,
      count: mappedSettlements.length,
      settlements: mappedSettlements,
      data: { settlements: mappedSettlements, summary: fullSummary }
    }), { headers: corsHeaders });
  }

  // 7.5 Partner Profile & Settlement Settings (GET & PUT /api/v1/partner/profile)
  if (url.pathname === '/api/v1/partner/profile' && request.method === 'GET') {
    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      partner_id: partnerId,
      data: {
        id: partner.id,
        business_name: partner.business_name,
        business_reg_number: partner.business_reg_number,
        commission_rate: partner.commission_rate,
        bank_code: partner.bank_code,
        bank_account_number: partner.bank_account_number,
        bank_account_holder: partner.bank_account_holder,
        settlement_cycle: partner.settlement_cycle || 'WEEKLY',
        return_shipping_address: partner.return_shipping_address || '인천광역시 중구 공항동 물류센터 B동 301호',
        customer_service_phone: partner.customer_service_phone || '1588-0000',
        base_shipping_fee: partner.base_shipping_fee,
        free_shipping_threshold: partner.free_shipping_threshold,
        status: partner.status
      }
    }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/partner/profile' && (request.method === 'PUT' || request.method === 'PATCH')) {
    const body = await request.json().catch(() => ({}));
    const bName = body.business_name || partner.business_name;
    const bCode = body.bank_code || partner.bank_code;
    const bAcc = body.bank_account_number || partner.bank_account_number;
    const bHolder = body.bank_account_holder || partner.bank_account_holder;
    const sCycle = body.settlement_cycle || partner.settlement_cycle || 'WEEKLY';
    const rAddr = body.return_shipping_address || partner.return_shipping_address || '인천광역시 중구 공항동 물류센터 B동 301호';
    const csPhone = body.customer_service_phone || partner.customer_service_phone || '1588-0000';
    const sFee = Number(body.base_shipping_fee ?? partner.base_shipping_fee);
    const sThresh = Number(body.free_shipping_threshold ?? partner.free_shipping_threshold);

    await env.DB.prepare(`
      UPDATE partners
      SET business_name = ?, bank_code = ?, bank_account_number = ?, bank_account_holder = ?,
          settlement_cycle = ?, return_shipping_address = ?, customer_service_phone = ?,
          base_shipping_fee = ?, free_shipping_threshold = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(bName, bCode, bAcc, bHolder, sCycle, rAddr, csPhone, sFee, sThresh, partnerId).run();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      message: '판매자 정보 및 정산 계좌 설정이 성공적으로 저장되었습니다.'
    }), { headers: corsHeaders });
  }

  // 8. Partner Product Q&A Management (GET /api/v1/partner/qna & POST /api/v1/partner/qna/:id/answer)
  if (url.pathname === '/api/v1/partner/qna' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT q.*, p.title as product_title
       FROM product_qna q
       JOIN products p ON q.product_id = p.id
       WHERE q.partner_id = ?
       ORDER BY q.created_at DESC`
    ).bind(partnerId).all();
    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname.match(/^\/api\/v1\/partner\/qna\/[^\/]+\/answer$/) && request.method === 'POST') {
    const qnaId = url.pathname.split('/')[5];
    const body = await request.json().catch(() => ({}));
    if (!body.answer || !body.answer.trim()) {
      return new Response(JSON.stringify({ error: '답변 내용을 입력해 주세요.' }), { status: 400, headers: corsHeaders });
    }
    await env.DB.prepare(
      `UPDATE product_qna SET answer = ?, status = 'ANSWERED', answered_at = CURRENT_TIMESTAMP WHERE id = ? AND partner_id = ?`
    ).bind(body.answer.trim(), qnaId, partnerId).run();
    return new Response(JSON.stringify({ success: true, qna_id: qnaId, status: 'ANSWERED' }), { headers: corsHeaders });
  }

  // 9. Partner Metrics (Excludes CANCELLED Orders)
  if (url.pathname === '/api/v1/partner/metrics' && request.method === 'GET') {
    const prodRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM products WHERE partner_id = ?').bind(partnerId).first();
    const orderRes = await env.DB.prepare(
      "SELECT COUNT(*) as cnt, SUM(total_amount) as total_sales FROM sub_orders WHERE partner_id = ? AND status != 'CANCELLED'"
    ).bind(partnerId).first();
    const stlRes = await env.DB.prepare(
      "SELECT SUM(net_payout_amount) as net_payout FROM settlements WHERE partner_id = ? AND status != 'CANCELLED'"
    ).bind(partnerId).first();
    const qnaRes = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM product_qna WHERE partner_id = ? AND status = 'WAITING'"
    ).bind(partnerId).first();

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', partner_id: partnerId, business_name: partner.business_name,
      products_count: prodRes ? prodRes.cnt : 0,
      orders_count: orderRes ? orderRes.cnt : 0,
      total_sales_amount: orderRes && orderRes.total_sales ? orderRes.total_sales : 0,
      settlement_expected_amount: stlRes && stlRes.net_payout ? stlRes.net_payout : 0,
      waiting_qna_count: qnaRes ? qnaRes.cnt : 0
    }), { headers: corsHeaders });
  }

  return null;
}
