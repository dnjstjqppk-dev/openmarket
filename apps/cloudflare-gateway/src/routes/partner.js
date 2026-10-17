// apps/cloudflare-gateway/src/routes/partner.js
// OLMOA Partner Seller Engine: Products, SKU Inventory, Order Fulfillment

export async function handlePartnerRoutes(request, url, env, corsHeaders) {
  const partnerId = request.headers.get('X-Partner-Id') || 'pt_001';

  // 1. Partner Products & SKUs
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
      success: true,
      brand: 'OLMOA',
      count: products.length,
      data: products
    }), { headers: corsHeaders });
  }

  // 2. Partner Create Product
  if (url.pathname === '/api/v1/partner/products' && request.method === 'POST') {
    const body = await request.json();
    const prodId = 'prod_' + Date.now();
    const skuId = 'sku_' + Date.now();
    const skuCode = body.sku_code || 'SKU-' + Date.now().toString().slice(-6);

    await env.DB.prepare(
      `INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html, lowest_original_price, lowest_sale_price, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
    ).bind(
      prodId, partnerId, body.category_id || 'cat_fashion',
      body.title, body.thumbnail_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500',
      body.description_html || '<p>' + (body.title || '') + '</p>',
      body.original_price || body.price || 30000,
      body.price || 19900
    ).run();

    await env.DB.prepare(
      `INSERT INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status)
       VALUES (?, ?, ?, '{"옵션":"기본"}', ?, ?, ?, 5, 'IN_STOCK')`
    ).bind(
      skuId, prodId, skuCode,
      body.original_price || body.price || 30000,
      body.price || 19900,
      body.stock_quantity || 100
    ).run();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      product_id: prodId,
      sku_id: skuId,
      message: 'Product & SKU successfully created in D1'
    }), { status: 201, headers: corsHeaders });
  }

  // 3. Partner Update SKU Stock
  if (url.pathname.startsWith('/api/v1/partner/products/') && url.pathname.endsWith('/stock') && (request.method === 'PUT' || request.method === 'PATCH')) {
    const prodId = url.pathname.split('/')[5];
    const body = await request.json();
    const newStock = parseInt(body.stock_quantity, 10);

    await env.DB.prepare(
      'UPDATE product_skus SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? OR id = ?'
    ).bind(newStock, prodId, prodId).run();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      product_id: prodId,
      stock_quantity: newStock,
      message: 'Stock updated in D1'
    }), { headers: corsHeaders });
  }

  // 4. Partner Sub-Orders & Fulfillment
  if (url.pathname === '/api/v1/partner/orders' && request.method === 'GET') {
    const { results: subOrders } = await env.DB.prepare(
      `SELECT s.*, o.order_no, o.recipient_name, o.recipient_phone, o.shipping_address_line1, o.shipping_address_line2, o.shipping_postal_code, o.created_at as order_date
       FROM sub_orders s 
       JOIN orders o ON s.parent_order_id = o.id 
       WHERE s.partner_id = ? 
       ORDER BY s.created_at DESC`
    ).bind(partnerId).all();

    for (const sub of subOrders) {
      const { results: items } = await env.DB.prepare(
        'SELECT * FROM order_items WHERE sub_order_id = ?'
      ).bind(sub.id).all();
      sub.items = items;
    }

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      count: subOrders.length,
      data: subOrders
    }), { headers: corsHeaders });
  }

  // 5. Partner Update Shipment (Tracking Number)
  if (url.pathname.startsWith('/api/v1/partner/orders/') && url.pathname.endsWith('/shipment') && (request.method === 'PUT' || request.method === 'POST')) {
    const subOrderId = url.pathname.split('/')[5];
    const body = await request.json();
    const carrier = body.carrier || 'CJ대한통운';
    const trackingNo = body.tracking_number;

    await env.DB.prepare(
      `UPDATE sub_orders 
       SET carrier_code = ?, tracking_number = ?, status = 'SHIPPED', shipped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`
    ).bind(carrier, trackingNo, subOrderId).run();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      sub_order_id: subOrderId,
      carrier: carrier,
      tracking_number: trackingNo,
      status: 'SHIPPED',
      message: 'Shipment dispatched & tracking updated in D1'
    }), { headers: corsHeaders });
  }

  // 6. Partner Dashboard Metrics
  if (url.pathname === '/api/v1/partner/metrics' && request.method === 'GET') {
    const prodRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM products WHERE partner_id = ?').bind(partnerId).first();
    const orderRes = await env.DB.prepare('SELECT COUNT(*) as cnt, SUM(total_amount) as total_sales FROM sub_orders WHERE partner_id = ?').bind(partnerId).first();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      partner_id: partnerId,
      products_count: prodRes ? prodRes.cnt : 0,
      orders_count: orderRes ? orderRes.cnt : 0,
      total_sales_amount: orderRes && orderRes.total_sales ? orderRes.total_sales : 0
    }), { headers: corsHeaders });
  }

  return null;
}
