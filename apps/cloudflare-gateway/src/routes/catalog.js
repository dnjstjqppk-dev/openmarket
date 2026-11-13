// apps/cloudflare-gateway/src/routes/catalog.js
// OLMOA Catalog Engine: Categories Tree Rollup, Products, Honest Partner Dispatch & Quality Score

import { notFound, HttpError } from '../lib/http.js';

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

// H-1: builds a safe FTS5 MATCH expression from a user query. Terms shorter
// than 3 chars cannot use the trigram index (null = stay on the LIKE path).
// Every term is double-quoted with quotes stripped, so operators, wildcards,
// and quote-breaking input become inert literals. Returns null when no term
// survives, including the synonym canonical as a fallback source.
export function buildFtsMatch(raw, canonical) {
  const termsOf = (s) => String(s || '').split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => [...term].length >= 3)
    .map((term) => `"${term.replace(/"/g, '')}"`);
  const rawTerms = termsOf(raw);
  const canon = String(canonical || '').trim();
  if (!rawTerms.length) {
    if (!canon || canon === String(raw || '').trim()) return null;
    const canonTerms = termsOf(canon);
    return canonTerms.length ? canonTerms.join(' AND ') : null;
  }
  let match = rawTerms.join(' AND ');
  if (canon && canon !== String(raw).trim()) {
    const canonTerms = termsOf(canon);
    if (canonTerms.length) match += ` OR (${canonTerms.join(' AND ')})`;
  }
  return match;
}

// H-1: sub-trigram (1-2 char) raw terms. The FTS index cannot match them,
// so they re-enter as ANDed LIKE predicates on the ranked arm — '무선 이어폰'
// must not match a product with no '무선' anywhere.
export function shortSearchTerms(raw) {
  return String(raw || '').split(/\s+/).map((term) => term.trim()).filter((term) => term.length >= 1 && [...term].length < 3);
}

export function escapeLike(term) {
  return String(term).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
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

    if (!category) throw new HttpError(404, 'NOT_FOUND', 'Category not found', { slug });

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
    const searchParam = url.searchParams.get('q') || url.searchParams.get('search');
    // H-1: keyword searches default to relevance; an explicit sort always wins.
    const sortParam = url.searchParams.get('sort') || (searchParam ? 'relevance' : 'popular');
    const minPrice = url.searchParams.get('min_price');
    const maxPrice = url.searchParams.get('max_price');
    // Offset pagination. `limit` stays as a legacy alias of `per_page`; invalid values fall back to defaults.
    const perPageRaw = Number.parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '100', 10);
    const perPage = Math.min(200, Math.max(1, Number.isSafeInteger(perPageRaw) ? perPageRaw : 100));
    const pageRaw = Number.parseInt(url.searchParams.get('page') || '1', 10);
    const page = Math.max(1, Number.isSafeInteger(pageRaw) ? pageRaw : 1);

    const selectList = `
      SELECT p.*,
             p.id as slug,
             COALESCE(pt.business_name, 'OLMOA DIRECT') as brand,
             COALESCE(pt.business_name, 'Olmoa Official Flagship') as partner_name,
             c.name as category_name, c.slug as category_slug,
             pc.slug as parent_category_slug,
             pt.business_name, pt.base_shipping_fee, pt.free_shipping_threshold,
             (SELECT s.id FROM product_skus s WHERE s.product_id = p.id AND s.stock_quantity > 0 ORDER BY s.sale_price ASC LIMIT 1) as default_sku_id,
             (p.avg_rating_x10 / 10.0) as avg_rating,
             p.review_count as review_count`;
    const fromSql = `
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN categories pc ON c.parent_id = pc.id
      LEFT JOIN partners pt ON p.partner_id = pt.id`;
    const baseWhere = `WHERE p.status = 'ACTIVE'`;
    const binds = [];
    let filterSql = '';

    if (catParam && catParam !== 'all') {
      const catRow = await env.DB.prepare('SELECT id FROM categories WHERE slug = ? OR id = ?').bind(catParam, catParam).first();
      if (catRow) {
        filterSql += ` AND (p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))`;
        binds.push(catRow.id, catRow.id);
      } else {
        filterSql += ` AND (c.slug = ? OR p.category_id = ?)`;
        binds.push(catParam, catParam);
      }
    }

    if (partnerParam) {
      filterSql += ` AND p.partner_id = ?`;
      binds.push(partnerParam);
    }

    if (minPrice) {
      filterSql += ` AND p.lowest_sale_price >= ?`;
      binds.push(Number.isSafeInteger(Number.parseInt(minPrice, 10)) ? Number.parseInt(minPrice, 10) : 0);
    }
    if (maxPrice) {
      filterSql += ` AND p.lowest_sale_price <= ?`;
      binds.push(Number.isSafeInteger(Number.parseInt(maxPrice, 10)) ? Number.parseInt(maxPrice, 10) : 100_000_000);
    }

    // col prefixes data columns: 'p.' inside the product query, '' in the UNION wrapper.
    const sortOrder = (sort, col) => {
      if (sort === 'price_asc') return ` ORDER BY ${col}lowest_sale_price ASC`;
      if (sort === 'price_desc') return ` ORDER BY ${col}lowest_sale_price DESC`;
      if (sort === 'newest') return ` ORDER BY ${col}created_at DESC`;
      if (sort === 'rating') return ` ORDER BY avg_rating DESC, ${col}total_sold_count DESC`;
      if (sort === 'reviews') return ` ORDER BY review_count DESC, ${col}total_sold_count DESC`;
      if (sort === 'relevance' && col === '') return ` ORDER BY CASE WHEN _rank IS NULL THEN 1 ELSE 0 END, _rank ASC, total_sold_count DESC`;
      return ` ORDER BY ${col}total_sold_count DESC`;
    };

    const send = (rows, total) => new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      count: rows.length,
      filters: { category: catParam, partner_id: partnerParam, sort: sortParam, search: searchParam },
      pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) },
      data: rows
    }), { headers: corsHeaders });

    const runQuery = async (sql, sqlBinds) => {
      let stmt = env.DB.prepare(sql);
      if (sqlBinds.length > 0) stmt = stmt.bind(...sqlBinds);
      return stmt.all();
    };

    if (searchParam) {
      const synRow = await env.DB.prepare('SELECT canonical_keyword FROM search_synonyms WHERE LOWER(term) = LOWER(?) LIMIT 1').bind(searchParam.trim()).first();
      const effectiveSearch = synRow ? synRow.canonical_keyword : searchParam.trim();
      const ftsMatch = buildFtsMatch(searchParam.trim(), effectiveSearch);
      // Legacy recall predicate (unchanged semantics): title, description, category, synonym.
      const likePred = ` AND (p.title LIKE ? OR p.description_html LIKE ? OR c.name LIKE ? OR p.title LIKE ?)`;
      const likeBinds = [`%${searchParam}%`, `%${searchParam}%`, `%${searchParam}%`, `%${effectiveSearch}%`];

      if (ftsMatch) {
        // Ranked path: FTS title/brand/category hits by bm25 first, then the
        // LIKE-only recall (mostly description matches) deduplicated below.
        // MATCH only runs in a direct FTS FROM subquery — joins and ORs with
        // other tables are rejected ("unable to use function MATCH").
        const ftsSub = `SELECT product_id, bm25(product_search_fts) AS _r FROM product_search_fts WHERE product_search_fts MATCH ?`;
        const ftsIds = `SELECT product_id FROM product_search_fts WHERE product_search_fts MATCH ?`;
        // Short raw terms AND back in only when the MATCH itself is raw-driven;
        // a canonical-rescued search ('버즈' -> '이어폰') must not require the raw term.
        const rawHasFts = String(searchParam).split(/\s+/).some((term) => [...term.trim()].length >= 3);
        const shorts = rawHasFts ? shortSearchTerms(searchParam.trim()) : [];
        const shortPred = shorts.map(() => ` AND (p.title LIKE ? ESCAPE '\\' OR p.description_html LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`).join('');
        const shortBinds = shorts.flatMap((term) => {
          const pattern = `%${escapeLike(term)}%`;
          return [pattern, pattern, pattern];
        });
        try {
          const arm1 = `${selectList}, m._r AS _rank ${fromSql} JOIN (${ftsSub}) m ON m.product_id = p.id ${baseWhere} ${filterSql}${shortPred}`;
          const arm1Ids = `SELECT p.id ${fromSql} JOIN (${ftsIds}) m ON m.product_id = p.id ${baseWhere} ${filterSql}${shortPred}`;
          const arm2 = `${selectList}, NULL AS _rank ${fromSql} ${baseWhere} ${filterSql}${likePred} AND p.id NOT IN (${ftsIds})`;
          const arm2Ids = `SELECT p.id ${fromSql} ${baseWhere} ${filterSql}${likePred} AND p.id NOT IN (${ftsIds})`;
          const total = await env.DB.prepare(`SELECT COUNT(*) AS total FROM (${arm1Ids} UNION ALL ${arm2Ids})`)
            .bind(ftsMatch, ...binds, ...shortBinds, ...binds, ...likeBinds, ftsMatch).first('total');
          const { results } = await runQuery(
            `SELECT * FROM (${arm1} UNION ALL ${arm2})${sortOrder(sortParam, '')} LIMIT ? OFFSET ?`,
            [ftsMatch, ...binds, ...shortBinds, ...binds, ...likeBinds, ftsMatch, perPage, (page - 1) * perPage]
          );
          for (const row of results) delete row._rank;
          return send(results, total);
        } catch {
          // An unexpected FTS failure must degrade to LIKE, never 500.
        }
      }

      let likeQuery = `${selectList} ${fromSql} ${baseWhere} ${filterSql}${likePred}`;
      const likeAll = [...binds, ...likeBinds];
      let likeOrder = sortOrder(sortParam, 'p.');
      if (sortParam === 'relevance') {
        // Short-query relevance: exact title, title prefix, title contains, then sales.
        likeOrder = ` ORDER BY CASE WHEN p.title = ? THEN 0 WHEN p.title LIKE ? THEN 1 WHEN p.title LIKE ? THEN 2 ELSE 3 END, p.total_sold_count DESC`;
        const q = searchParam.trim();
        likeAll.push(q, `${q}%`, `%${q}%`);
      }
      const total = await env.DB.prepare(`SELECT COUNT(*) AS total FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN categories pc ON c.parent_id = pc.id LEFT JOIN partners pt ON p.partner_id = pt.id ${baseWhere} ${filterSql}${likePred}`).bind(...likeAll.slice(0, likeAll.length - (sortParam === 'relevance' ? 3 : 0))).first('total');
      const { results } = await runQuery(`${likeQuery}${likeOrder} LIMIT ? OFFSET ?`, [...likeAll, perPage, (page - 1) * perPage]);
      return send(results, total);
    }

    const total = await env.DB.prepare(`SELECT COUNT(*) AS total FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN categories pc ON c.parent_id = pc.id LEFT JOIN partners pt ON p.partner_id = pt.id ${baseWhere} ${filterSql}`).bind(...binds).first('total');
    const { results } = await runQuery(`${selectList} ${fromSql} ${baseWhere} ${filterSql}${sortOrder(sortParam, 'p.')} LIMIT ? OFFSET ?`, [...binds, perPage, (page - 1) * perPage]);
    return send(results, total);
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

    if (!product) throw new HttpError(404, 'NOT_FOUND', 'Product not found', { product_id: prodId });

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
              c.name as category_name, c.slug as category_slug, c.notice_template_id as category_notice_template_id,
              pt.business_name, pt.business_reg_number, pt.base_shipping_fee, pt.free_shipping_threshold,
              (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id), 0) as review_count,
              COALESCE((SELECT COUNT(*) FROM product_qna q WHERE q.product_id = p.id), 0) as qna_count
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN partners pt ON p.partner_id = pt.id
       WHERE p.id = ?`
    ).bind(prodId).first();

    if (!product) throw notFound('Product not found');

    const { results: skus } = await env.DB.prepare(
      'SELECT * FROM product_skus WHERE product_id = ? ORDER BY sale_price ASC'
    ).bind(prodId).all();

    const { results: images } = await env.DB.prepare(
      'SELECT id, image_url, alt_text, sort_order, width, height FROM product_images WHERE product_id = ? ORDER BY sort_order ASC'
    ).bind(prodId).all();

    // 2-1: the notice template resolves from the product, falling back to its
    // category; input values come from the stored notice_info_json (d1_42).
    const tplId = product.notice_template_id || product.category_notice_template_id || null;
    let noticeTemplate = null;
    if (tplId) {
      noticeTemplate = await env.DB.prepare('SELECT * FROM notice_templates WHERE id = ?').bind(tplId).first() || null;
    }
    let noticeValues = null;
    if (product.notice_info_json) {
      try { noticeValues = JSON.parse(product.notice_info_json); } catch { noticeValues = null; }
    }

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

    // Only a video the seller actually registered. (prod_e_01 used to get a hard-coded MDN stock clip of a
    // flower, shown on a headphone product page as its "실물 영상".)
    const videoUrl = product.video_url || null;

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
        volume_discounts: volumeDiscounts,
        images,
        notice_template: noticeTemplate,
        notice_values: noticeValues
      }
    }), { headers: corsHeaders });
  }

  // 5. Public Partner Mini-Shop Storefront Endpoint (GET /api/v1/partners/:id/store)
  if (url.pathname.match(/^\/api\/v1\/partners\/[^\/]+\/store$/) && request.method === 'GET') {
    const partnerId = url.pathname.split('/')[4];
    // NEW-10: the public store discloses the seller's legal identity (or null when unregistered).
    const partner = await env.DB.prepare(
      'SELECT id, business_name, business_reg_number, representative_name, business_address, customer_service_phone, cs_email, mail_order_reg_number, status, base_shipping_fee, free_shipping_threshold, created_at FROM partners WHERE id = ?'
    ).bind(partnerId).first();

    // Only sellers that passed onboarding review have a public store (pending, rejected and suspended ones do not).
    if (!partner || partner.status !== 'APPROVED') throw notFound('Partner store not found');

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
    // Store rating = average of the reviews actually written on this partner's products; null when there are none.
    const rv = await env.DB.prepare(
      `SELECT ROUND(AVG(r.rating), 1) AS avg_rating, COUNT(*) AS review_count
       FROM product_reviews r JOIN products p ON p.id = r.product_id WHERE p.partner_id = ?`
    ).bind(partnerId).first();
    const storeReviewCount = rv ? Number(rv.review_count) || 0 : 0;
    const storeRating = storeReviewCount > 0 && rv.avg_rating != null ? Number(rv.avg_rating) : null;

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
          store_rating: storeRating,
          review_count: storeReviewCount
        },
        metrics: {
          product_count: products.length,
          total_sold: totalSold,
          avg_rating: storeRating,
          review_count: storeReviewCount
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
    if (!prod) throw notFound('상품을 찾을 수 없습니다.');
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
