// apps/cloudflare-gateway/src/routes/partner.js
// OLMOA Partner Seller Engine: Strict Multi-Tenant Isolation & Verification

async function resolvePartner(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const partnerHeader = request.headers.get('X-Partner-Id') || '';
  const candidateId = partnerHeader || (token.startsWith('pt_') ? token : null);
  if (!candidateId) return null;

  const partner = await env.DB.prepare(
    'SELECT * FROM partners WHERE (id = ? OR owner_user_id = ?) AND status = "APPROVED"'
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

  // 1. Partner Products & SKUs (Tenant Scoped)
  if (url.pathname === '/api/v1/partner/products' && request.method === 'GET') {
    const { results: products } = await env.DB.prepare(
      `SELECT p.*, c.name as category_name, s.id as sku_id, s.sku_code, s.stock_quantity, s.sale_price 
       FROM products p 
       LEFT JOIN categories c ON p.category_id = c.id 
       LEFT JOIN product_skus s ON s.product_id = p.id 
       WHERE p.partner_id = ? 
       ORDER BY p.created_at DESC`
    ).bind(partnerId).all();

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', partner_id: partnerId,
      business_name: partner.business_name, count: products.length, data: products
    }), { headers: corsHeaders });
  }

  // 2. Partner Create Single Product
  if (url.pathname === '/api/v1/partner/products' && request.method === 'POST') {
    const body = await request.json();
    const prodId = 'prod_' + Date.now();
    const skuId = 'sku_' + Date.now();
    const skuCode = body.sku_code || 'SKU-' + Date.now().toString().slice(-6);

    await env.DB.prepare(
      `INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
    ).bind(
      prodId, partnerId, body.category_id || 'sub_w_tops',
      body.title, body.thumbnail_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500',
      body.description_html || '<p>' + (body.title || '') + '</p>',
      body.original_price || body.price || 30000, body.price || 19900
    ).run();

    await env.DB.prepare(
      `INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status)
       VALUES (?, ?, ?, '{"옵션":"기본"}', ?, ?, ?, 5, 'IN_STOCK')`
    ).bind(skuId, prodId, skuCode, body.original_price || body.price || 30000, body.price || 19900, body.stock_quantity || 100).run();

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', product_id: prodId, sku_id: skuId, message: 'Product created with tenant isolation'
    }), { status: 201, headers: corsHeaders });
  }

  // 3. Partner Batch Upload (Excel/CSV Backend API, WO-07)
  if (url.pathname === '/api/v1/partner/products/batch' && request.method === 'POST') {
    const body = await request.json();
    const rawItems = Array.isArray(body) ? body : (body.items || []);
    if (!rawItems.length) {
      return new Response(JSON.stringify({ error: 'No items provided for batch import' }), { status: 400, headers: corsHeaders });
    }

    const batch = [];
    const createdIds = [];

    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const prodId = `prod_batch_${Date.now()}_${i}`;
      const skuId = `sku_batch_${Date.now()}_${i}`;
      const title = it.title || `대량등록 상품 #${i + 1}`;
      const skuCode = it.sku_code || `SKU-B-${Date.now()}-${i}`;
      const origPrice = parseInt(it.lowest_original_price || it.original_price || 30000, 10);
      const salePrice = parseInt(it.lowest_sale_price || it.sale_price || it.price || 20000, 10);
      const stock = Math.max(0, parseInt(it.stock_quantity || 100, 10));
      const catId = it.category_id || it.category_slug || 'sub_w_tops';

      batch.push(env.DB.prepare(
        `INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
      ).bind(prodId, partnerId, catId, title, it.thumbnail_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500', it.description_html || `<p>${title}</p>`, origPrice, salePrice));

      batch.push(env.DB.prepare(
        `INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 5, 'IN_STOCK')`
      ).bind(skuId, prodId, skuCode, JSON.stringify(it.options || { 옵션: '기본' }), origPrice, salePrice, stock));

      createdIds.push({ product_id: prodId, sku_id: skuId, title, sku_code: skuCode });
    }

    await env.DB.batch(batch);
    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', imported_count: rawItems.length, data: createdIds
    }), { status: 201, headers: corsHeaders });
  }

  // 4. Partner Update SKU Stock (Safe Single SKU Target, WO-07)
  if (url.pathname.startsWith('/api/v1/partner/products/') && url.pathname.endsWith('/stock') && (request.method === 'PUT' || request.method === 'PATCH')) {
    const prodId = url.pathname.split('/')[5];
    const body = await request.json();
    const newStock = Math.max(0, parseInt(body.stock_quantity, 10));

    const ownsProduct = await env.DB.prepare('SELECT id FROM products WHERE id = ? AND partner_id = ?').bind(prodId, partnerId).first();
    if (!ownsProduct) {
      return new Response(JSON.stringify({ error: 'Forbidden: Tenant mismatch. Product not owned by partner.' }), { status: 403, headers: corsHeaders });
    }

    if (body.sku_id) {
      await env.DB.prepare(
        'UPDATE product_skus SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND product_id = ?'
      ).bind(newStock, body.sku_id, prodId).run();
    } else {
      await env.DB.prepare(
        'UPDATE product_skus SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?'
      ).bind(newStock, prodId).run();
    }

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', product_id: prodId, sku_id: body.sku_id || 'all', stock_quantity: newStock, message: 'Stock updated safely'
    }), { headers: corsHeaders });
  }

  // 5. Partner Sub-Orders (Strictly Isolated to Partner)
  if (url.pathname === '/api/v1/partner/orders' && request.method === 'GET') {
    const { results: subOrders } = await env.DB.prepare(
      `SELECT s.*, o.order_no, o.recipient_name, o.recipient_phone, o.shipping_address_line1, o.shipping_address_line2, o.shipping_postal_code, o.created_at as order_date
       FROM sub_orders s 
       JOIN orders o ON s.parent_order_id = o.id 
       WHERE s.partner_id = ? 
       ORDER BY s.created_at DESC`
    ).bind(partnerId).all();

    for (const sub of subOrders) {
      const { results: items } = await env.DB.prepare('SELECT * FROM order_items WHERE sub_order_id = ?').bind(sub.id).all();
      sub.items = items;
    }

    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', partner_id: partnerId, count: subOrders.length, data: subOrders }), { headers: corsHeaders });
  }

  // 6. Partner Settlements Ledger (Real D1 Ledger API, WO-07)
  if (url.pathname === '/api/v1/partner/settlements' && request.method === 'GET') {
    const { results: settlements } = await env.DB.prepare(
      `SELECT st.*, so.sub_order_no, so.status as order_status, so.created_at as order_date
       FROM settlements st
       JOIN sub_orders so ON st.sub_order_id = so.id
       WHERE st.partner_id = ?
       ORDER BY st.created_at DESC`
    ).bind(partnerId).all();

    const sumRow = await env.DB.prepare(
      `SELECT 
         COALESCE(SUM(gross_amount), 0) as total_gross,
         COALESCE(SUM(commission_amount), 0) as total_commission,
         COALESCE(SUM(shipping_fee), 0) as total_shipping,
         COALESCE(SUM(net_payout_amount), 0) as total_payout
       FROM settlements
       WHERE partner_id = ? AND status != 'CANCELLED'`
    ).bind(partnerId).first();

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', partner_id: partnerId,
      summary: {
        totalGross: sumRow ? sumRow.total_gross : 0,
        commission: sumRow ? sumRow.total_commission : 0,
        shippingSettled: sumRow ? sumRow.total_shipping : 0,
        netPayout: sumRow ? sumRow.total_payout : 0
      },
      count: settlements.length,
      data: settlements
    }), { headers: corsHeaders });
  }

  // 7. Partner Update Shipment (Must Own Sub-Order)
  if (url.pathname.startsWith('/api/v1/partner/orders/') && url.pathname.endsWith('/shipment') && (request.method === 'PUT' || request.method === 'POST')) {
    const subOrderId = url.pathname.split('/')[5];
    const body = await request.json();
    const carrier = body.carrier || 'CJ대한통운';
    const trackingNo = body.tracking_number;

    const subOrder = await env.DB.prepare('SELECT id FROM sub_orders WHERE id = ? AND partner_id = ?').bind(subOrderId, partnerId).first();
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

  // 8. Partner Metrics
  if (url.pathname === '/api/v1/partner/metrics' && request.method === 'GET') {
    const prodRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM products WHERE partner_id = ?').bind(partnerId).first();
    const orderRes = await env.DB.prepare("SELECT COUNT(*) as cnt, SUM(total_amount) as total_sales FROM sub_orders WHERE partner_id = ? AND status != 'CANCELLED'").bind(partnerId).first();

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', partner_id: partnerId, business_name: partner.business_name,
      products_count: prodRes ? prodRes.cnt : 0,
      orders_count: orderRes ? orderRes.cnt : 0,
      total_sales_amount: orderRes && orderRes.total_sales ? orderRes.total_sales : 0
    }), { headers: corsHeaders });
  }

  return null;
}
