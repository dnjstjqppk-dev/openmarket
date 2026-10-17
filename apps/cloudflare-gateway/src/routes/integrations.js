// apps/cloudflare-gateway/src/routes/integrations.js
// OLMOA External Integrations: PriceScanner Product Feed & Selbym Partner Boundary

export async function handleIntegrationRoutes(request, url, env, corsHeaders) {
  // 1. PriceScanner Authenticated Product Feed
  if (url.pathname === '/api/v1/integrations/pricescanner/feed' && request.method === 'GET') {
    const feedKey = request.headers.get('X-Integration-Key') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const validKey = env.PRICESCANNER_API_KEY || 'ps_live_feed_key_2026';

    if (!feedKey || feedKey !== validKey) {
      return new Response(JSON.stringify({
        error: 'Unauthorized: Valid X-Integration-Key required for PriceScanner feed.'
      }), { status: 401, headers: corsHeaders });
    }

    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;
    const updatedAfter = url.searchParams.get('updated_after');

    let query = `
      SELECT p.id as product_id, p.partner_id, pt.business_name, p.title, c.name as category_name,
             p.thumbnail_url, p.lowest_original_price, p.lowest_sale_price, p.status, p.updated_at,
             s.id as sku_id, s.sku_code, s.option_combination_json, s.original_price, s.sale_price, 
             s.stock_quantity, s.status as sku_status, pt.base_shipping_fee, pt.free_shipping_threshold
      FROM products p
      JOIN product_skus s ON s.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN partners pt ON p.partner_id = pt.id
      WHERE p.status = 'ACTIVE' AND pt.status = 'APPROVED'
    `;
    const binds = [];

    if (updatedAfter) {
      query += ` AND p.updated_at >= ?`;
      binds.push(updatedAfter);
    }

    query += ` ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`;
    binds.push(limit, offset);

    const stmt = env.DB.prepare(query).bind(...binds);
    const { results } = await stmt.all();

    const countRes = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM products p JOIN partners pt ON p.partner_id = pt.id WHERE p.status = 'ACTIVE' AND pt.status = 'APPROVED'`
    ).first();
    const totalCount = countRes ? countRes.cnt : results.length;

    const feedItems = results.map(row => {
      let options = {};
      try { options = JSON.parse(row.option_combination_json); } catch (_) {}
      return {
        partner_id: row.partner_id,
        partner_name: row.business_name,
        product_id: row.product_id,
        sku_id: row.sku_id,
        sku_code: row.sku_code,
        title: row.title,
        category: row.category_name || 'General',
        options: options,
        image_url: row.thumbnail_url,
        original_price: row.original_price,
        sale_price: row.sale_price,
        currency: 'KRW',
        stock_status: row.stock_quantity > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
        stock_quantity: row.stock_quantity,
        shipping_fee: row.base_shipping_fee || 3000,
        free_shipping_threshold: row.free_shipping_threshold || 30000,
        product_url: `https://openmarket.dnjstjqppk.workers.dev/product/${row.product_id}`,
        last_updated: row.updated_at
      };
    });

    const paginationMeta = {
      page,
      limit,
      total: totalCount,
      has_more: offset + results.length < totalCount
    };

    return new Response(JSON.stringify({
      success: true,
      provider: 'OLMOA Open Market',
      integration: 'PriceScanner Feed Engine v1',
      pagination: paginationMeta,
      count: feedItems.length,
      items: feedItems,
      data: {
        items: feedItems,
        pagination: paginationMeta
      }
    }), {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=60, s-maxage=60'
      }
    });
  }

  // 2. Selbym Partner Boundary & Agreement Status
  if (url.pathname === '/api/v1/integrations/selbym/status' && request.method === 'GET') {
    const selbymData = {
      integration: 'Selbym External Connector',
      status: 'AWAITING_COMMERCIAL_AGREEMENT',
      direct_crawling_allowed: false,
      compliance_policy: 'Strict zero-unauthorized-crawling policy enforced. External data is not accessed without formal operator contract and signed API credentials.',
      adapter_ready: true,
      supported_protocols: ['REST_WEBHOOK', 'JSON_FEED_SYNC'],
      data_isolation: 'Complete physical and logical isolation from core customer/order records.'
    };

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      ...selbymData,
      data: selbymData
    }), { headers: corsHeaders });
  }

  return null;
}
