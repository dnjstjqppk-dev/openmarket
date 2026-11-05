// apps/cloudflare-gateway/src/routes/catalog.js
// OLMOA Catalog Engine: Categories Tree Rollup, Products, Honest Partner Dispatch & Quality Score

export function computeServerQualityScore(product) {
  if (!product) return 0;
  let score = 0;
  const title = String(product.title || '').trim();
  if (title.length >= 8) score += 20;

  const thumb = String(product.thumbnail_url || '').trim();
  if (thumb.length > 10 && !thumb.includes('placeholder')) score += 20;

  const desc = String(product.description_html || '').trim();
  if (desc.length >= 40) score += 25;

  const salePrice = Number(product.lowest_sale_price || product.sale_price || 0);
  const stock = Number(product.stock_quantity != null ? product.stock_quantity : (product.total_sold_count != null ? 100 : 0));
  if (salePrice > 0 && stock > 0) score += 15;

  const hsCode = String(product.hs_code || '').trim();
  if (/^\d{4}(\.\d{2})?$/.test(hsCode)) score += 10;

  const origin = String(product.country_origin || '').trim();
  if (origin.length >= 2) score += 10;

  return Math.min(100, score);
}

export async function handleCatalogRoutes(request, url, env, corsHeaders) {
  // 1. All Categories Tree with Bottom-Up Descendant Rollup
  if (url.pathname === '/api/v1/categories' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.parent_id, c.name, c.slug, c.depth, c.sort_order,
              (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'ACTIVE') as direct_count
       FROM categories c
       WHERE c.is_active = 1
       ORDER BY c.depth DESC, c.sort_order ASC`
    ).all();

    // Roll up product counts bottom-up from leaf subcategories to root categories
    const countMap = {};
    for (const c of results) {
      countMap[c.id] = (countMap[c.id] || 0) + (c.direct_count || 0);
      if (c.parent_id) {
        countMap[c.parent_id] = (countMap[c.parent_id] || 0) + (countMap[c.id] || 0);
      }
    }

    const tree = results
      .map(c => ({
        id: c.id,
        parent_id: c.parent_id,
        name: c.name,
        slug: c.slug,
        depth: c.depth,
        sort_order: c.sort_order,
        product_count: countMap[c.id] || 0
      }))
      .sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return a.sort_order - b.sort_order;
      });

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      count: tree.length,
      data: tree
    }), { headers: corsHeaders });
  }

  // 2. Single Category Info & Subcategories
  if (url.pathname.startsWith('/api/v1/categories/') && request.method === 'GET') {
    const slug = url.pathname.replace('/api/v1/categories/', '').trim();
    const category = await env.DB.prepare(
      'SELECT * FROM categories WHERE slug = ? OR id = ? LIMIT 1'
    ).bind(slug, slug).first();

    if (!category) {
      return new Response(JSON.stringify({ error: 'Category not found', slug }), {
        status: 404,
        headers: corsHeaders
      });
    }

    const { results: subcategories } = await env.DB.prepare(
      'SELECT id, name, slug, sort_order FROM categories WHERE parent_id = ? ORDER BY sort_order ASC'
    ).bind(category.id).all();

    let parentCategory = null;
    if (category.parent_id) {
      parentCategory = await env.DB.prepare('SELECT id, name, slug FROM categories WHERE id = ?').bind(category.parent_id).first();
    }

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      data: { ...category, parent_category: parentCategory, subcategories }
    }), { headers: corsHeaders });
  }

  // 3. Products with Category, Partner, Rating, Search & Query Filters
  if (url.pathname === '/api/v1/products' && request.method === 'GET') {
    const catParam = url.searchParams.get('category');
    const partnerParam = url.searchParams.get('partner_id');
    const sortParam = url.searchParams.get('sort') || 'popular';
    const searchParam = url.searchParams.get('q') || url.searchParams.get('search');
    const minPrice = url.searchParams.get('min_price');
    const maxPrice = url.searchParams.get('max_price');
    const limitParam = parseInt(url.searchParams.get('limit') || '100', 10);

    let query = `
      SELECT p.*,
             p.id as slug,
             COALESCE(pt.business_name, 'OLMOA DIRECT') as brand,
             COALESCE(pt.business_name, 'Olmoa Official Flagship') as partner_name,
             c.name as category_name, c.slug as category_slug,
             pc.slug as parent_category_slug,
             pt.business_name, pt.base_shipping_fee, pt.free_shipping_threshold,
             (SELECT s.id FROM product_skus s WHERE s.product_id = p.id ORDER BY s.sale_price ASC LIMIT 1) as default_sku_id,
             (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id) as avg_rating,
             COALESCE((SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id), 0) as review_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN categories pc ON c.parent_id = pc.id
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

    if (partnerParam) {
      query += ` AND p.partner_id = ?`;
      binds.push(partnerParam);
    }

    if (searchParam) {
      const synRow = await env.DB.prepare('SELECT canonical_keyword FROM search_synonyms WHERE LOWER(term) = LOWER(?) LIMIT 1').bind(searchParam.trim()).first();
      const effectiveSearch = synRow ? synRow.canonical_keyword : searchParam.trim();
      query += ` AND (p.title LIKE ? OR p.description_html LIKE ? OR c.name LIKE ? OR p.title LIKE ?)`;
      binds.push(`%${searchParam}%`, `%${searchParam}%`, `%${searchParam}%`, `%${effectiveSearch}%`);
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
    } else if (sortParam === 'rating') {
      query += ` ORDER BY avg_rating DESC, p.total_sold_count DESC`;
    } else {
      query += ` ORDER BY p.total_sold_count DESC`;
    }

    query += ` LIMIT ?`;
    binds.push(Math.min(200, Math.max(1, limitParam)));

    let stmt = env.DB.prepare(query);
    if (binds.length > 0) {
      stmt = stmt.bind(...binds);
    }
    const { results } = await stmt.all();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      count: results.length,
      filters: { category: catParam, partner_id: partnerParam, sort: sortParam, search: searchParam },
      data: results
    }), { headers: corsHeaders });
  }

  // 4a. Algorithmic Buy Box Evaluation (GET /api/v1/products/:id/buy-box)
  if (url.pathname.match(/^\/api\/v1\/products\/[^\/]+\/buy-box$/) && request.method === 'GET') {
    const prodId = url.pathname.split('/')[4];
    const product = await env.DB.prepare(
      `SELECT p.id, p.title, p.partner_id, p.lowest_sale_price, pt.business_name, pt.base_shipping_fee, pt.free_shipping_threshold
       FROM products p
       LEFT JOIN partners pt ON p.partner_id = pt.id
       WHERE p.id = ?`
    ).bind(prodId).first();

    if (!product) {
      return new Response(JSON.stringify({ error: 'Product not found', product_id: prodId }), { status: 404, headers: corsHeaders });
    }

    const buyBoxAnalysis = {
      product_id: product.id,
      evaluated_at: new Date().toISOString(),
      mode: 'single_supplier_direct',
      competitive_offers_count: 1,
      supplier: {
        partner_id: product.partner_id,
        partner_name: product.business_name || 'OLMOA DIRECT',
        sale_price: product.lowest_sale_price,
        shipping_fee: product.base_shipping_fee || 0,
        free_shipping_min: product.free_shipping_threshold || 30000,
        dispatch_type: 'VERIFIED_PARTNER_DIRECT',
        metrics_status: 'SINGLE_SUPPLIER_STANDALONE'
      },
      winner: {
        partner_id: product.partner_id,
        partner_name: product.business_name || 'OLMOA DIRECT',
        sale_price: product.lowest_sale_price,
        shipping_fee: product.base_shipping_fee || 0,
        free_shipping_min: product.free_shipping_threshold || 30000,
        dispatch_type: 'VERIFIED_PARTNER_DIRECT'
      },
      eligibility: {
        is_buy_box_eligible: true,
        is_lowest_price_guaranteed: false,
        selection_reason: 'SINGLE_EXCLUSIVE_SUPPLIER',
        competitive_price_threshold: product.lowest_sale_price,
        algorithm_rule: 'DIRECT_PARTNER_CATALOG_OFFER'
      }
    };

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA Buy Box Algorithm',
      data: buyBoxAnalysis
    }), { headers: corsHeaders });
  }

  // 4. Single Product with SKUs, Partner Shipping Rules, Real Rating & QnA Count
  if (url.pathname.startsWith('/api/v1/products/') && !url.pathname.includes('/reviews') && !url.pathname.includes('/qna') && !url.pathname.includes('/buy-box') && !url.pathname.includes('/live-activity') && request.method === 'GET') {
    const prodId = url.pathname.replace('/api/v1/products/', '').trim();
    const product = await env.DB.prepare(
      `SELECT p.*,
              p.id as slug,
              COALESCE(pt.business_name, 'OLMOA DIRECT') as brand,
              COALESCE(pt.business_name, 'Olmoa Official Flagship') as partner_name,
              c.name as category_name, c.slug as category_slug,
              pt.business_name, pt.business_reg_number, pt.base_shipping_fee, pt.free_shipping_threshold,
              (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id), 0) as review_count,
              COALESCE((SELECT COUNT(*) FROM product_qna q WHERE q.product_id = p.id), 0) as qna_count
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN partners pt ON p.partner_id = pt.id
       WHERE p.id = ?`
    ).bind(prodId).first();

    if (!product) {
      return new Response(JSON.stringify({ error: 'Product not found' }), {
        status: 404,
        headers: corsHeaders
      });
    }

    const { results: skus } = await env.DB.prepare(
      'SELECT * FROM product_skus WHERE product_id = ? ORDER BY sale_price ASC'
    ).bind(prodId).all();

    const optionsMap = {};
    const parsedSkus = skus.map(s => {
      let opt = {};
      try { opt = JSON.parse(s.option_combination_json); } catch (e) { opt = {}; }
      for (const [k, v] of Object.entries(opt)) {
        if (!optionsMap[k]) optionsMap[k] = new Set();
        optionsMap[k].add(v);
      }
      return {
        ...s,
        option_values_json: s.option_combination_json,
        options: opt
      };
    });

    const attributes = Object.keys(optionsMap).map(name => ({
      name,
      values: Array.from(optionsMap[name])
    }));

    const volumeDiscounts = [
      { min_quantity: 3, discount_rate_pct: 5, label: '3개 이상 5% 추가 할인' },
      { min_quantity: 5, discount_rate_pct: 10, label: '5개 이상 10% 추가 할인' },
      { min_quantity: 10, discount_rate_pct: 15, label: '10개 이상 15% 대량 공급 할인' }
    ];

    const buyBox = {
      mode: 'single_supplier_direct',
      winner_partner_id: product.partner_id,
      winner_partner_name: product.partner_name,
      dispatch_type: 'VERIFIED_PARTNER_DIRECT',
      is_lowest_price_guaranteed: false,
      price_advantage_krw: 0,
      badge: '공식 파트너사 직발송'
    };

    const videoUrl = prodId === 'prod_e_01'
      ? 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
      : (product.video_url || null);

    const qualityScore = computeServerQualityScore(product);

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      data: {
        ...product,
        video_url: videoUrl,
        quality_score: qualityScore,
        skus: parsedSkus,
        attributes,
        buy_box: buyBox,
        volume_discounts: volumeDiscounts
      }
    }), { headers: corsHeaders });
  }

  // 5. Public Partner Mini-Shop Storefront Endpoint (GET /api/v1/partners/:id/store)
  if (url.pathname.match(/^\/api\/v1\/partners\/[^\/]+\/store$/) && request.method === 'GET') {
    const partnerId = url.pathname.split('/')[4];
    const partner = await env.DB.prepare(
      'SELECT id, business_name, business_reg_number, status, base_shipping_fee, free_shipping_threshold, created_at FROM partners WHERE id = ?'
    ).bind(partnerId).first();

    if (!partner) {
      return new Response(JSON.stringify({ error: 'Partner store not found' }), { status: 404, headers: corsHeaders });
    }

    const { results: products } = await env.DB.prepare(
      `SELECT p.*,
              p.id as slug,
              COALESCE(?, 'OLMOA DIRECT') as brand,
              c.name as category_name, c.slug as category_slug,
              (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id), 0) as review_count
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.partner_id = ? AND p.status = 'ACTIVE'
       ORDER BY p.total_sold_count DESC`
    ).bind(partner.business_name, partnerId).all();

    const totalSold = products.reduce((acc, p) => acc + (p.total_sold_count || 0), 0);

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      data: {
        partner: {
          ...partner,
          company_name: partner.business_name,
          business_number: partner.business_reg_number
        },
        shipping_policy: {
          base_fee: partner.base_shipping_fee,
          free_shipping_threshold: partner.free_shipping_threshold
        },
        stats: {
          product_count: products.length,
          total_sold_count: totalSold,
          store_rating: 4.9
        },
        metrics: {
          product_count: products.length,
          total_sold: totalSold,
          avg_rating: 4.9
        },
        products
      }
    }), { headers: corsHeaders });
  }

  // 13. /api/v1/deals/lightning — retired in favour of the real campaign feed (/api/v1/campaigns/lightning in
  //     features.js). The former implementation invented "claimed %" gauges and a timer that reset every midnight.
  if (url.pathname === '/api/v1/deals/lightning' && request.method === 'GET') {
    return new Response(JSON.stringify({ success: false, code: 'GONE', error: '/api/v1/campaigns/lightning 을 사용해 주세요.' }), { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // 14. Image similarity search: no image model is integrated, so nothing may be presented as a visual match.
  if (url.pathname === '/api/v1/search/visual-similarity' && request.method === 'POST') {
    return new Response(JSON.stringify({
      success: false,
      code: 'VISUAL_SEARCH_NOT_AVAILABLE',
      error: '이미지 검색은 아직 제공하지 않습니다. 검색어로 찾아 주세요.'
    }), { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // 15. Product activity: measured values only (paid, non-refunded units), same basis as /urgency-stats.
  const actM = url.pathname.match(/^\/api\/v1\/products\/([^/]+)\/live-activity$/);
  if (actM && request.method === 'GET') {
    const prod = await env.DB.prepare("SELECT id, total_sold_count FROM products WHERE id = ? AND status = 'ACTIVE'").bind(actM[1]).first();
    if (!prod) return new Response(JSON.stringify({ success: false, error: '상품을 찾을 수 없습니다.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const sold24h = await env.DB.prepare(
      `SELECT COALESCE(SUM(i.quantity - i.refunded_quantity), 0) AS q FROM order_items i
       JOIN sub_orders s ON s.id = i.sub_order_id JOIN orders o ON o.id = s.parent_order_id
       WHERE i.product_id = ? AND o.paid_at IS NOT NULL AND o.paid_at >= ?`
    ).bind(prod.id, since).first('q') || 0;
    const stockSum = await env.DB.prepare('SELECT COALESCE(SUM(stock_quantity), 0) AS s FROM product_skus WHERE product_id = ?').bind(prod.id).first('s') || 0;
    return new Response(JSON.stringify({
      success: true,
      product_id: prod.id,
      data: {
        recent_24h_purchases: sold24h,
        all_time_sales: prod.total_sold_count || 0,
        total_remaining_stock: stockSum,
        stock_urgency: stockSum <= 5 && stockSum > 0 ? `남은 수량 ${stockSum}개` : null,
        // Matches routes/temu-ops.js: store credit, claimed by the buyer once the promised delivery date has passed.
        delivery_guarantee: '배송 예정일을 넘기면 주문 상세에서 5,300원 적립금 보상을 신청할 수 있습니다.'
      }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return null;
}
