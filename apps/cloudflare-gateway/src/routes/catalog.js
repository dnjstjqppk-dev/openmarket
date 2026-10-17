// apps/cloudflare-gateway/src/routes/catalog.js
// OLMOA Catalog Engine: Categories, Products & Search

export async function handleCatalogRoutes(request, url, env, corsHeaders) {
  // 1. All Categories Tree
  if (url.pathname === '/api/v1/categories' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, parent_id, name, slug, depth, sort_order FROM categories WHERE is_active = 1 ORDER BY depth ASC, sort_order ASC'
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

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      data: { ...category, subcategories }
    }), { headers: corsHeaders });
  }

  // 3. Products with Category, Search & Query Filters
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

  // 4. Single Product with SKUs and Partner
  if (url.pathname.startsWith('/api/v1/products/') && request.method === 'GET') {
    const prodId = url.pathname.replace('/api/v1/products/', '').trim();
    const product = await env.DB.prepare(
      `SELECT p.*, c.name as category_name, c.slug as category_slug, pt.business_name, pt.base_shipping_fee, pt.free_shipping_threshold 
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
      return { ...s, options: opt };
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

  return null;
}
