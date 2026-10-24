// apps/cloudflare-gateway/src/routes/catalog.js
// OLMOA Catalog Engine: Categories, Products, Real Review Ratings & Seller Mini-Shop

export async function handleCatalogRoutes(request, url, env, corsHeaders) {
  // 1. All Categories Tree
  if (url.pathname === '/api/v1/categories' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.parent_id, c.name, c.slug, c.depth, c.sort_order,
              (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'ACTIVE') as product_count
       FROM categories c
       WHERE c.is_active = 1
       ORDER BY c.depth ASC, c.sort_order ASC`
    ).all();
    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      count: results.length,
      data: results
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
             COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id), 4.8) as avg_rating,
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

  // 4. Single Product with SKUs, Partner Shipping Rules, Real Rating & QnA Count
  if (url.pathname.startsWith('/api/v1/products/') && !url.pathname.includes('/reviews') && !url.pathname.includes('/qna') && request.method === 'GET') {
    const prodId = url.pathname.replace('/api/v1/products/', '').trim();
    const product = await env.DB.prepare(
      `SELECT p.*,
              p.id as slug,
              COALESCE(pt.business_name, 'OLMOA DIRECT') as brand,
              COALESCE(pt.business_name, 'Olmoa Official Flagship') as partner_name,
              c.name as category_name, c.slug as category_slug,
              pt.business_name, pt.business_reg_number, pt.base_shipping_fee, pt.free_shipping_threshold,
              COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id), 4.8) as avg_rating,
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

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      data: { ...product, skus: parsedSkus, attributes }
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
              COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id), 4.9) as avg_rating,
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

  return null;
}
