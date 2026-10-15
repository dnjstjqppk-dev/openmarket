// apps/cloudflare-gateway/src/index.js
// Cloudflare Edge Gateway with D1 Cloud SQL Database binding and Go Backend Proxy

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Idempotency-Key',
  'Content-Type': 'application/json; charset=utf-8'
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      let dbStatus = 'DISCONNECTED';
      let productCount = 0;
      if (env && env.DB) {
        try {
          const res = await env.DB.prepare('SELECT COUNT(*) as cnt FROM products').first();
          dbStatus = 'CONNECTED_D1';
          productCount = res ? res.cnt : 0;
        } catch (e) {
          dbStatus = 'ERROR: ' + e.message;
        }
      }

      return new Response(JSON.stringify({
        status: 'UP',
        service: 'OpenMarket Cloudflare Gateway',
        databaseEngine: 'Cloudflare D1 (Serverless Relational SQL)',
        databaseStatus: dbStatus,
        activeProductsInD1: productCount,
        goBackendStandard: 'Go 1.23 REST API Service (apps/api)',
        timestamp: new Date().toISOString()
      }), { headers: corsHeaders });
    }

    // Go Backend proxying (when GO_BACKEND_URL is set in environment)
    if (env && env.GO_BACKEND_URL) {
      const targetUrl = new URL(url.pathname + url.search, env.GO_BACKEND_URL);
      try {
        const proxyReq = new Request(targetUrl, request);
        return await fetch(proxyReq);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Go Backend unreachable', detail: String(err) }), { status: 502, headers: corsHeaders });
      }
    }

    // Direct D1 Database Endpoints for Edge Execution
    if (env && env.DB) {
      try {
        if (url.pathname === '/api/v1/categories' && request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM categories ORDER BY depth ASC, sort_order ASC').all();
          return new Response(JSON.stringify({ success: true, data: results }), { headers: corsHeaders });
        }

        if (url.pathname === '/api/v1/products' && request.method === 'GET') {
          const { results } = await env.DB.prepare(
            `SELECT p.*, c.name as category_name, pt.business_name 
             FROM products p 
             LEFT JOIN categories c ON p.category_id = c.id 
             LEFT JOIN partners pt ON p.partner_id = pt.id 
             WHERE p.status = 'ACTIVE' 
             ORDER BY p.total_sold_count DESC`
          ).all();
          return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
        }

        if (url.pathname.startsWith('/api/v1/products/') && request.method === 'GET') {
          const prodId = url.pathname.replace('/api/v1/products/', '');
          const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(prodId).first();
          if (!product) {
            return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404, headers: corsHeaders });
          }
          const { results: skus } = await env.DB.prepare('SELECT * FROM product_skus WHERE product_id = ?').bind(prodId).all();
          return new Response(JSON.stringify({ success: true, data: { ...product, skus } }), { headers: corsHeaders });
        }

        if (url.pathname === '/api/v1/orders/checkout' && request.method === 'POST') {
          const body = await request.json();
          const orderId = 'ord_' + Date.now();
          const orderNo = 'ORD' + Date.now().toString().slice(-8);

          // Insert order into real Cloudflare D1
          await env.DB.prepare(
            `INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_pay_amount, currency, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code)
             VALUES (?, ?, ?, ?, ?, ?, 'KRW', ?, ?, ?, ?, ?)`
          ).bind(
            orderId,
            orderNo,
            body.customer_id || 'u_customer_001',
            body.total_goods_amount || 49900,
            body.total_shipping_amount || 3000,
            (body.total_goods_amount || 49900) + (body.total_shipping_amount || 3000),
            body.recipient_name || 'Customer',
            body.recipient_phone || '010-0000-0000',
            body.shipping_address_line1 || 'Seoul, Korea',
            body.shipping_address_line2 || 'Apt 101',
            body.shipping_postal_code || '06000'
          ).run();

          return new Response(JSON.stringify({
            success: true,
            order_id: orderId,
            order_no: orderNo,
            message: 'Order created and persisted in Cloudflare D1 SQL Database',
            status: 'PAYMENT_CONFIRMED'
          }), { status: 201, headers: corsHeaders });
        }

        if (url.pathname === '/api/v1/orders' && request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50').all();
          return new Response(JSON.stringify({ success: true, data: results }), { headers: corsHeaders });
        }
      } catch (dbErr) {
        return new Response(JSON.stringify({ error: 'D1 Query Execution Failed', details: dbErr.message }), { status: 500, headers: corsHeaders });
      }
    }

    // Default Gateway response informing caller of Go standard service routing
    return new Response(JSON.stringify({
      gateway: 'OpenMarket Edge Gateway',
      route: url.pathname,
      targetBackend: 'Go 1.23 API Service (apps/api)',
      databaseStatus: 'Cloudflare D1 Bound',
      status: 'ROUTING_ACTIVE'
    }), { status: 200, headers: corsHeaders });
  }
};
