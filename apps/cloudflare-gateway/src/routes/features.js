// apps/cloudflare-gateway/src/routes/features.js
// OLMOA Extended Features: Autocomplete, Flash Sales, Reviews, Coupons & Order Claims

function sanitizeText(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export async function handleFeatureRoutes(request, url, env, corsHeaders) {
  // 1. Search Autocomplete & Trending
  if ((url.pathname === '/api/v1/search/autocomplete' || url.pathname === '/api/v1/search/trending') && request.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || url.pathname === '/api/v1/search/trending') {
      const { results: trending } = await env.DB.prepare(
        'SELECT keyword, search_count, is_promoted FROM search_keywords ORDER BY search_count DESC LIMIT 10'
      ).all();
      const { results: categories } = await env.DB.prepare(
        'SELECT id, name, slug FROM categories WHERE depth = 0 LIMIT 8'
      ).all();
      return new Response(JSON.stringify({
        success: true, brand: 'OLMOA',
        trending_keywords: trending,
        recommended_categories: categories
      }), { headers: corsHeaders });
    }

    const { results: suggestions } = await env.DB.prepare(
      `SELECT keyword, category_name, category_slug, product_hit_count 
       FROM search_keywords 
       WHERE normalized_keyword LIKE ? OR chosung LIKE ? OR keyword LIKE ?
       ORDER BY search_count DESC LIMIT 8`
    ).bind(`${q}%`, `${q}%`, `%${q}%`).all();

    const { results: categories } = await env.DB.prepare(
      'SELECT id, name, slug FROM categories WHERE name LIKE ? OR slug LIKE ? LIMIT 3'
    ).bind(`%${q}%`, `%${q}%`).all();

    const { results: products } = await env.DB.prepare(
      `SELECT id, title, thumbnail_url, lowest_sale_price, lowest_original_price, total_sold_count 
       FROM products 
       WHERE status = 'ACTIVE' AND (title LIKE ? OR description_html LIKE ?)
       LIMIT 4`
    ).bind(`%${q}%`, `%${q}%`).all();

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', query: q,
      suggestions, categories, products
    }), { headers: corsHeaders });
  }

  // 2. Search Logging
  if (url.pathname === '/api/v1/search/log' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const kw = (body.keyword || '').trim();
    if (kw) {
      await env.DB.prepare(
        `INSERT INTO search_keywords (id, keyword, normalized_keyword, search_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(keyword) DO UPDATE SET search_count = search_count + 1, updated_at = CURRENT_TIMESTAMP`
      ).bind(`kw_${Date.now()}`, kw, kw.toLowerCase()).run();
    }
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  }

  // 3. Lightning Deals Campaigns
  if (url.pathname === '/api/v1/campaigns/lightning' && request.method === 'GET') {
    const campaign = await env.DB.prepare(
      "SELECT * FROM flash_sale_campaigns WHERE status = 'ACTIVE' LIMIT 1"
    ).first();

    const { results: items } = await env.DB.prepare(
      `SELECT f.*, p.title, p.thumbnail_url, p.lowest_original_price, p.lowest_sale_price 
       FROM flash_sale_items f 
       JOIN products p ON f.product_id = p.id 
       ORDER BY f.sort_order ASC`
    ).all();

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA',
      campaign: campaign || { id: 'fls_live', title: 'OLMOA 번개특가', ends_at: new Date(Date.now() + 36000000).toISOString() },
      items: items.map(it => ({
        ...it,
        sold_percent: Math.min(100, Math.round((it.sold_stock / (it.allocated_stock || 1)) * 100))
      }))
    }), { headers: corsHeaders });
  }

  // 4. Product Reviews List & Create (Sanitized, WO-09)
  if (url.pathname.match(/^\/api\/v1\/products\/[^\/]+\/reviews$/)) {
    const prodId = url.pathname.split('/')[4];
    if (request.method === 'GET') {
      const { results: reviews } = await env.DB.prepare(
        'SELECT * FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC'
      ).bind(prodId).all();

      const avgRow = await env.DB.prepare(
        'SELECT AVG(rating) as avg_rating, COUNT(*) as review_count FROM product_reviews WHERE product_id = ?'
      ).bind(prodId).first();

      return new Response(JSON.stringify({
        success: true, brand: 'OLMOA', product_id: prodId,
        avg_rating: avgRow && avgRow.avg_rating ? parseFloat(avgRow.avg_rating.toFixed(1)) : 4.8,
        review_count: avgRow ? avgRow.review_count : reviews.length,
        data: reviews
      }), { headers: corsHeaders });
    }

    if (request.method === 'POST') {
      const b = await request.json();
      const revId = `rev_${Date.now()}`;
      const safeContent = sanitizeText(b.content || '');
      const safeReviewer = sanitizeText(b.reviewer_name || '구매자');
      const safeSummary = sanitizeText(b.sku_option_summary || '기본');

      await env.DB.prepare(
        `INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, sku_option_summary, rating, content, images_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        revId, prodId, b.user_id || 'u_customer_001', safeReviewer,
        safeSummary, Math.max(1, Math.min(5, b.rating || 5)),
        safeContent, JSON.stringify(b.images || [])
      ).run();

      return new Response(JSON.stringify({ success: true, review_id: revId }), { status: 201, headers: corsHeaders });
    }
  }

  // 5. Order Claims: Return / Exchange / Dispute (WO-10)
  if (url.pathname.match(/^\/api\/v1\/orders\/[^\/]+\/claim$/) && request.method === 'POST') {
    const ordId = url.pathname.split('/')[4];
    const b = await request.json();
    const claimType = (b.claim_type || 'RETURN').toUpperCase();
    const reason = sanitizeText(b.reason || '고객 단순 변심 또는 상품 불만족');
    const newStatus = claimType === 'EXCHANGE' ? 'EXCHANGE_REQUESTED' : 'RETURN_REQUESTED';

    const order = await env.DB.prepare('SELECT id FROM orders WHERE id = ? OR order_no = ?').bind(ordId, ordId).first();
    if (!order) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: corsHeaders });

    if (b.sub_order_id) {
      await env.DB.prepare('UPDATE sub_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND parent_order_id = ?')
        .bind(newStatus, b.sub_order_id, order.id).run();
    } else {
      await env.DB.prepare('UPDATE sub_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE parent_order_id = ?')
        .bind(newStatus, order.id).run();
    }

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA',
      order_id: order.id, claim_type: claimType, reason, status: newStatus,
      message: `${claimType === 'EXCHANGE' ? '교환' : '반품'} 접수가 정상 완료되었습니다.`
    }), { status: 200, headers: corsHeaders });
  }

  // 6. Coupons & Support FAQ
  if (url.pathname === '/api/v1/coupons' && request.method === 'GET') {
    const { results } = await env.DB.prepare("SELECT * FROM coupons WHERE is_active = 1").all();
    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/support/faq' && request.method === 'GET') {
    const faqs = [
      { q: '배송 기간은 얼마나 걸리나요?', a: 'OLMOA 글로벌 익스프레스 풀필먼트로 결제 완료 후 영업일 기준 3~5일 이내 무료 직배송됩니다.' },
      { q: '최저가 보상제는 어떻게 이용하나요?', a: '구매 후 30일 이내 올모아 내 판매가가 인하된 경우 클릭 한 번으로 차액 전액을 적립금 크레딧으로 즉시 환급해 드립니다.' },
      { q: '무료 반품 정책이 궁금합니다.', a: '배송 완료 후 90일 이내 단순 변심을 포함하여 첫 회 무료 반품 100% 전액 환불을 보장합니다.' }
    ];
    return new Response(JSON.stringify({ success: true, data: faqs }), { headers: corsHeaders });
  }

  return null;
}
