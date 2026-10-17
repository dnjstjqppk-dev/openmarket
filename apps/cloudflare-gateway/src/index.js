// apps/cloudflare-gateway/src/index.js
// OLMOA Cloudflare Edge Gateway with D1 Cloud SQL Database binding and Go Backend Proxy

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
        brand: 'OLMOA',
        koreanBrand: '올모아',
        tagline: '내가 찾는 모든 것, 여기.',
        service: 'OLMOA Cloudflare Gateway & Edge API',
        databaseEngine: 'Cloudflare D1 (Serverless Relational SQL)',
        databaseStatus: dbStatus,
        activeProductsInD1: productCount,
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
        // 1. All Categories Tree
        if (url.pathname === '/api/v1/categories' && request.method === 'GET') {
          const { results } = await env.DB.prepare(
            'SELECT id, parent_id, name, slug, depth, sort_order FROM categories WHERE is_active = 1 ORDER BY depth ASC, sort_order ASC'
          ).all();
          return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
        }

        // 2. Single Category Info & Subcategories
        if (url.pathname.startsWith('/api/v1/categories/') && request.method === 'GET') {
          const slug = url.pathname.replace('/api/v1/categories/', '').trim();
          const category = await env.DB.prepare(
            'SELECT * FROM categories WHERE slug = ? OR id = ? LIMIT 1'
          ).bind(slug, slug).first();

          if (!category) {
            return new Response(JSON.stringify({ error: 'Category not found', slug }), { status: 404, headers: corsHeaders });
          }

          const { results: subcategories } = await env.DB.prepare(
            'SELECT id, name, slug, sort_order FROM categories WHERE parent_id = ? ORDER BY sort_order ASC'
          ).bind(category.id).all();

          return new Response(JSON.stringify({
            success: true,
            brand: 'OLMOA',
            data: { ...category, subcategories }
          }), { headers: corsHeaders });
        }

        // 3. Products with Category & Query Filters
        if (url.pathname === '/api/v1/products' && request.method === 'GET') {
          const catParam = url.searchParams.get('category');
          const sortParam = url.searchParams.get('sort') || 'popular';
          const searchParam = url.searchParams.get('q') || url.searchParams.get('search');
          const minPrice = url.searchParams.get('min_price');
          const maxPrice = url.searchParams.get('max_price');

          let query = `
            SELECT p.*, c.name as category_name, c.slug as category_slug, pt.business_name 
            FROM products p 
            LEFT JOIN categories c ON p.category_id = c.id 
            LEFT JOIN partners pt ON p.partner_id = pt.id 
            WHERE p.status = 'ACTIVE'
          `;
          const binds = [];

          if (catParam && catParam !== 'all') {
            const catRow = await env.DB.prepare('SELECT id FROM categories WHERE slug = ? OR id = ?').bind(catParam, catParam).first();
            if (catRow) {
              query += ` AND (p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))`;
              binds.push(catRow.id, catRow.id);
            } else {
              query += ` AND (c.slug = ? OR p.category_id = ?)`;
              binds.push(catParam, catParam);
            }
          }

          if (searchParam) {
            query += ` AND (p.title LIKE ? OR p.description_html LIKE ?)`;
            binds.push(`%${searchParam}%`, `%${searchParam}%`);
          }

          if (minPrice) {
            query += ` AND p.lowest_sale_price >= ?`;
            binds.push(parseInt(minPrice, 10));
          }
          if (maxPrice) {
            query += ` AND p.lowest_sale_price <= ?`;
            binds.push(parseInt(maxPrice, 10));
          }

          if (sortParam === 'price_asc') {
            query += ` ORDER BY p.lowest_sale_price ASC`;
          } else if (sortParam === 'price_desc') {
            query += ` ORDER BY p.lowest_sale_price DESC`;
          } else if (sortParam === 'newest') {
            query += ` ORDER BY p.created_at DESC`;
          } else {
            query += ` ORDER BY p.total_sold_count DESC`;
          }

          let stmt = env.DB.prepare(query);
          if (binds.length > 0) {
            stmt = stmt.bind(...binds);
          }
          const { results } = await stmt.all();

          return new Response(JSON.stringify({
            success: true,
            brand: 'OLMOA',
            count: results.length,
            filters: { category: catParam, sort: sortParam, search: searchParam },
            data: results
          }), { headers: corsHeaders });
        }

        // 4. Single Product with SKUs
        if (url.pathname.startsWith('/api/v1/products/') && request.method === 'GET') {
          const prodId = url.pathname.replace('/api/v1/products/', '');
          const product = await env.DB.prepare(
            `SELECT p.*, c.name as category_name, c.slug as category_slug, pt.business_name 
             FROM products p 
             LEFT JOIN categories c ON p.category_id = c.id 
             LEFT JOIN partners pt ON p.partner_id = pt.id 
             WHERE p.id = ?`
          ).bind(prodId).first();

          if (!product) {
            return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404, headers: corsHeaders });
          }
          const { results: skus } = await env.DB.prepare('SELECT * FROM product_skus WHERE product_id = ?').bind(prodId).all();
          return new Response(JSON.stringify({ success: true, brand: 'OLMOA', data: { ...product, skus } }), { headers: corsHeaders });
        }

        // 5. Checkout
        if (url.pathname === '/api/v1/orders/checkout' && request.method === 'POST') {
          const body = await request.json();
          const orderId = 'olm_ord_' + Date.now();
          const orderNo = 'OLM' + Date.now().toString().slice(-8);

          await env.DB.prepare(
            `INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_pay_amount, currency, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code)
             VALUES (?, ?, ?, ?, ?, ?, 'KRW', ?, ?, ?, ?, ?)`
          ).bind(
            orderId,
            orderNo,
            body.customer_id || 'u_customer_001',
            body.total_goods_amount || 49900,
            body.total_shipping_amount || 0,
            (body.total_goods_amount || 49900) + (body.total_shipping_amount || 0),
            body.recipient_name || 'Customer',
            body.recipient_phone || '010-0000-0000',
            body.shipping_address_line1 || 'Seoul, Korea',
            body.shipping_address_line2 || 'Apt 101',
            body.shipping_postal_code || '06000'
          ).run();

          return new Response(JSON.stringify({
            success: true,
            brand: 'OLMOA',
            order_id: orderId,
            order_no: orderNo,
            message: 'Order created and persisted in OLMOA Cloudflare D1 SQL Database',
            status: 'PAYMENT_CONFIRMED'
          }), { status: 201, headers: corsHeaders });
        }

        // 6. Orders
        if (url.pathname === '/api/v1/orders' && request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50').all();
          return new Response(JSON.stringify({ success: true, brand: 'OLMOA', data: results }), { headers: corsHeaders });
        }
      } catch (dbErr) {
        return new Response(JSON.stringify({ error: 'D1 Query Execution Failed', details: dbErr.message }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response(JSON.stringify({
      gateway: 'OLMOA Edge Gateway',
      route: url.pathname,
      targetBackend: 'Go 1.23 API Service (apps/api)',
      brand: 'OLMOA',
      databaseStatus: 'Cloudflare D1 Bound',
      status: 'ROUTING_ACTIVE'
    }), { status: 200, headers: corsHeaders });
  }
};
