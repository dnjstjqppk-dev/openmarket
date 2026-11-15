// apps/cloudflare-gateway/src/routes/features.js
// Customer engagement features. Identity = verified JWT (requireCustomer / authenticate).
import { requireCustomer, requireAdmin, authenticate } from '../lib/auth.js';
import { json, readJson, bad, conflict, forbidden, notFound, str, safeUrl, idempotencyKey } from '../lib/http.js';
import { newId, sqlNow } from '../lib/ids.js';
import { claimCoupon, couponAmount, matchScope } from '../services/coupons.js';
import { computeTrending } from '../services/trending.js';
import { allocate } from '../lib/money.js';
import { auditStatement } from '../lib/ledger.js';
import { sha256Hex } from '../utils/crypto-auth.js';
import { sealPii } from '../lib/pii-crypto.js';

// OLMOA Extended Features: Autocomplete (with Synonyms), Flash Sales, Reviews, Q&A, Coupons, Credits, Wishlist & Support

export async function handleFeatureRoutes(request, url, env, corsHeaders) {
  // 1. Search Autocomplete (Chosung + Normalized + Synonyms + Product Previews)
  if (url.pathname === '/api/v1/search/autocomplete' && request.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) {
      const { results: trending } = await env.DB.prepare(
        'SELECT keyword, category_name, category_slug, search_count, is_promoted FROM search_keywords ORDER BY search_count DESC LIMIT 10'
      ).all();
      const { results: categories } = await env.DB.prepare(
        'SELECT id, name, slug FROM categories WHERE parent_id IS NULL AND depth = 0 ORDER BY sort_order ASC LIMIT 8'
      ).all();
      return new Response(JSON.stringify({
        success: true, brand: 'OLMOA',
        trending_keywords: trending,
        recommended_categories: categories,
        data: { keywords: trending, suggestions: trending, categories, products: [] }
      }), { headers: corsHeaders });
    }

    const synRow = await env.DB.prepare(
      'SELECT canonical_keyword FROM search_synonyms WHERE LOWER(term) LIKE LOWER(?) LIMIT 1'
    ).bind(`${q}%`).first();
    const synKeyword = synRow ? synRow.canonical_keyword : q;

    const { results: suggestions } = await env.DB.prepare(
      `SELECT keyword, category_name, category_slug, product_hit_count, search_count
       FROM search_keywords
       WHERE normalized_keyword LIKE ? OR chosung LIKE ? OR keyword LIKE ? OR keyword LIKE ?
       ORDER BY search_count DESC LIMIT 8`
    ).bind(`${q.toLowerCase()}%`, `${q}%`, `%${q}%`, `%${synKeyword}%`).all();

    const { results: categories } = await env.DB.prepare(
      'SELECT id, name, slug, depth FROM categories WHERE name LIKE ? OR slug LIKE ? ORDER BY depth ASC LIMIT 4'
    ).bind(`%${q}%`, `%${q}%`).all();

    const { results: rawProducts } = await env.DB.prepare(
      `SELECT id, id as slug, title, thumbnail_url, lowest_sale_price, lowest_original_price, total_sold_count
       FROM products
       WHERE status = 'ACTIVE' AND (title LIKE ? OR description_html LIKE ? OR title LIKE ?)
       ORDER BY total_sold_count DESC LIMIT 5`
    ).bind(`%${q}%`, `%${q}%`, `%${synKeyword}%`).all();

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', query: q, resolved_synonym: synRow ? synRow.canonical_keyword : null,
      suggestions, categories, products: rawProducts,
      data: {
        keywords: suggestions,
        suggestions,
        categories,
        products: rawProducts,
        resolved_synonym: synRow ? synRow.canonical_keyword : null
      }
    }), { headers: corsHeaders });
  }

  // 2. Search Logging
  if (url.pathname === '/api/v1/search/log' && request.method === 'POST') {
    const body = await readJson(request);
    const kw = str(body.keyword, { max: 100 }).trim();
    if (kw) {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO search_keywords (id, keyword, normalized_keyword, search_count)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(keyword) DO UPDATE SET search_count = search_count + 1, updated_at = CURRENT_TIMESTAMP`
        ).bind(newId('kw'), kw, kw.toLowerCase()),
        env.DB.prepare(
          `INSERT INTO search_keyword_hourly (keyword, hour, search_count)
           VALUES (?, strftime('%Y-%m-%d %H:00:00', 'now'), 1)
           ON CONFLICT(keyword, hour) DO UPDATE SET search_count = search_count + 1`
        ).bind(kw.toLowerCase())
      ]);
    }
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  }

  // 2b. Trending searches (2-9): top 10 of the last 24h with rank deltas.
  if (url.pathname === '/api/v1/search/trending' && request.method === 'GET') {
    const trending = await computeTrending(env);
    return json(corsHeaders, { success: true, count: trending.length, trending, data: { trending } });
  }

  // 3. Lightning Deals Campaigns (only a real, currently running campaign; prices shown = prices charged)
  if (url.pathname === '/api/v1/campaigns/lightning' && request.method === 'GET') {
    const now = sqlNow();
    const campaign = await env.DB.prepare(
      "SELECT * FROM flash_sale_campaigns WHERE status = 'ACTIVE' AND starts_at <= ? AND ends_at > ? ORDER BY ends_at LIMIT 1"
    ).bind(now, now).first();
    // 3-11: the nearest upcoming round for the next-session preview.
    const nextRound = await env.DB.prepare(
      "SELECT id, title, starts_at, ends_at FROM flash_sale_campaigns WHERE status = 'UPCOMING' AND starts_at > ? ORDER BY starts_at ASC LIMIT 1"
    ).bind(now).first() || null;
    if (!campaign) return json(corsHeaders, { success: true, campaign: null, items: [], next_campaign: nextRound, data: { campaign: null, deals: [], items: [], next_campaign: nextRound } });
    const { results: items } = await env.DB.prepare(
      `SELECT f.id, f.product_id, f.sku_id, f.deal_price, f.allocated_stock, f.sold_stock, f.sort_order, p.id as slug, p.title, p.thumbnail_url, p.partner_id,
              pt.business_name AS brand, pt.business_name,
              COALESCE(s.original_price, p.lowest_original_price) AS original_price, s.stock_quantity AS sku_stock
       FROM flash_sale_items f JOIN products p ON f.product_id = p.id LEFT JOIN partners pt ON p.partner_id = pt.id LEFT JOIN product_skus s ON f.sku_id = s.id
       WHERE f.campaign_id = ? AND f.status = 'APPROVED' AND p.status = 'ACTIVE' AND p.review_status = 'APPROVED' ORDER BY f.sort_order ASC`
    ).bind(campaign.id).all();
    // 2-6: checkout charges f.deal_price, so the feed shows it with measured sell-through.
    const mappedDeals = items.map((it) => ({
      ...it,
      charged_price: it.deal_price,
      lowest_sale_price: it.deal_price,
      lowest_original_price: it.original_price,
      sold_quantity: it.sold_stock || 0,
      discount_rate: it.original_price > it.deal_price ? Math.floor(((it.original_price - it.deal_price) * 100) / it.original_price) : 0,
      sold_percent: it.allocated_stock > 0 ? Math.min(100, Math.floor(((it.sold_stock || 0) * 100) / it.allocated_stock)) : 0,
      remaining_stock: Math.max(0, it.sku_id == null
        ? (it.allocated_stock || 0) - (it.sold_stock || 0)
        : Math.min(it.sku_stock ?? 0, (it.allocated_stock || 0) - (it.sold_stock || 0)))
    }));
    return json(corsHeaders, { success: true, campaign, items: mappedDeals, next_campaign: nextRound, data: { campaign, deals: mappedDeals, items: mappedDeals, next_campaign: nextRound } });
  }

  // 4. Product Reviews List & Create
  if (url.pathname.match(/^\/api\/v1\/products\/[^\/]+\/reviews$/)) {
    const prodId = url.pathname.split('/')[4];
    if (request.method === 'GET') {
      // 2-9: page, sort, photo/rating/option filters, measured summary, seller
      // replies. Blind reviews stay out of the list, the total and the summary.
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '20', 10) || 20));
      const sortKey = String(url.searchParams.get('sort') || 'latest').toLowerCase();
      const sortSql = {
        latest: 'created_at DESC, rowid ASC',
        helpful: 'helpful_count DESC, created_at DESC, rowid ASC',
        rating_high: 'rating DESC, created_at DESC, rowid ASC',
        rating_low: 'rating ASC, created_at DESC, rowid ASC'
      }[sortKey];
      if (!sortSql) throw bad('INVALID_SORT', 'sort는 latest·helpful·rating_high·rating_low 중 하나여야 합니다.');
      const ratingRaw = url.searchParams.get('rating');
      let ratingFilter = null;
      if (ratingRaw !== null && ratingRaw !== '') {
        ratingFilter = Number(ratingRaw);
        if (!Number.isInteger(ratingFilter) || ratingFilter < 1 || ratingFilter > 5) {
          throw bad('INVALID_RATING', 'rating 필터는 1~5 사이의 정수여야 합니다.');
        }
      }
      const photosOnly = ['true', '1'].includes(String(url.searchParams.get('photos_only') || '').toLowerCase());
      const optionFilter = str(url.searchParams.get('option') || '', { max: 100 });
      const where = ['product_id = ?', "visibility = 'VISIBLE'"];
      const params = [prodId];
      if (ratingFilter !== null) { where.push('rating = ?'); params.push(ratingFilter); }
      if (photosOnly) where.push("COALESCE(images_json, '') NOT IN ('', '[]', 'null')");
      if (optionFilter) {
        where.push('sku_option_summary LIKE ? ESCAPE \'\\\'');
        params.push(`%${optionFilter.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      }
      const whereSql = where.join(' AND ');
      const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM product_reviews WHERE ${whereSql}`).bind(...params).first('c') || 0;
      const { results: reviews } = await env.DB.prepare(
        `SELECT * FROM product_reviews WHERE ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?`
      ).bind(...params, perPage, (page - 1) * perPage).all();
      const { results: allVisible } = await env.DB.prepare(
        "SELECT rating, images_json, fit_type FROM product_reviews WHERE product_id = ? AND visibility = 'VISIBLE'"
      ).bind(prodId).all();
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let photoCount = 0;
      const fit = { TRUE_TO_SIZE: 0, RUNS_SMALL: 0, RUNS_LARGE: 0 };
      let ratingSum = 0;
      for (const r of allVisible) {
        const bucket = Math.min(5, Math.max(1, Math.round(Number(r.rating))));
        distribution[bucket] += 1;
        ratingSum += Number(r.rating);
        const imgs = String(r.images_json || '');
        if (imgs !== '' && imgs !== '[]' && imgs !== 'null') photoCount += 1;
        if (r.fit_type && fit[r.fit_type] !== undefined) fit[r.fit_type] += 1;
      }
      const cntVal = allVisible.length;
      const avgVal = cntVal > 0 ? parseFloat((ratingSum / cntVal).toFixed(1)) : null;
      const replies = {};
      if (reviews.length) {
        const { results: replyRows } = await env.DB.prepare(
          `SELECT review_id, body, created_at FROM review_replies WHERE review_id IN (${reviews.map(() => '?').join(',')})`
        ).bind(...reviews.map((r) => r.id)).all();
        for (const rr of replyRows) replies[rr.review_id] = { body: rr.body, created_at: rr.created_at };
      }
      const parsedReviews = reviews.map(r => {
        let images = [];
        try { images = JSON.parse(r.images_json || '[]'); } catch (_) {}
        return {
          ...r,
          comment: r.content,
          customer_name: r.reviewer_name,
          images,
          reply: replies[r.id] || null
        };
      });

      return new Response(JSON.stringify({
        success: true, brand: 'OLMOA', product_id: prodId,
        avg_rating: avgVal,
        review_count: cntVal,
        reviews: parsedReviews,
        data: {
          reviews: parsedReviews,
          summary: { count: cntVal, average_rating: avgVal, distribution, photo_count: photoCount, fit },
          pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) }
        }
      }), { headers: corsHeaders });
    }

    if (request.method === 'POST') {
      const b = await readJson(request);
      const customerId = (await requireCustomer(request, env)).userId;
      const contentText = (b.content || b.comment || '').trim();
      const purchase = await env.DB.prepare(
        `SELECT i.id, i.option_summary, o.id AS order_id FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id JOIN orders o ON o.id = s.parent_order_id
         WHERE o.customer_id = ? AND i.product_id = ? AND s.status IN ('DELIVERED','PURCHASE_CONFIRMED') AND i.refunded_quantity < i.quantity LIMIT 1`
      ).bind(customerId, prodId).first();
      if (!purchase) throw forbidden('배송 완료된 구매 고객만 리뷰를 작성할 수 있습니다.');
      const dup = await env.DB.prepare('SELECT id FROM product_reviews WHERE product_id = ? AND user_id = ? AND order_id = ?').bind(prodId, customerId, purchase.order_id).first();
      if (dup) throw conflict('REVIEW_EXISTS', '이미 이 주문에 대한 리뷰를 작성했습니다.');
      const me = await env.DB.prepare('SELECT full_name FROM users WHERE id = ?').bind(customerId).first();
      const maskedName = me && me.full_name ? me.full_name.slice(0, 1) + '*'.repeat(Math.max(1, me.full_name.length - 1)) : '구매자';
      if (!contentText) throw bad('CONTENT_REQUIRED', '리뷰 내용을 입력해 주세요.');
      const revId = newId('rev');
      // The buyer must choose the rating; nothing is filled in on their behalf.
      const ratingVal = Number(b.rating);
      if (!Number.isInteger(ratingVal) || ratingVal < 1 || ratingVal > 5) {
        return new Response(JSON.stringify({ success: false, code: 'INVALID_RATING', error: '별점(1~5)을 선택해 주세요.' }), { status: 400, headers: corsHeaders });
      }
      // P2-SEC-05: review photos render as raw <img src> — https / site-relative
      // only (no data: blobs, no tracking pixels on other schemes, no giants).
      let reviewImages = [];
      if (b.images !== undefined && b.images !== null) {
        if (!Array.isArray(b.images)) throw bad('INVALID_IMAGE_URL', '리뷰 이미지 목록 형식이 올바르지 않습니다.');
        try {
          reviewImages = b.images.slice(0, 10).map((u) => safeUrl(u, { field: '리뷰 이미지', allowRelative: true, required: true }));
        } catch (e) {
          throw bad('INVALID_IMAGE_URL', '리뷰 이미지는 https 또는 사이트 상대경로(URL 2000자 이내)만 등록할 수 있습니다.');
        }
      }
      await env.DB.prepare(
        `INSERT INTO product_reviews (id, product_id, order_id, user_id, reviewer_name, author_name, sku_option_summary, rating, content, images_json, is_verified_purchase, user_height_cm, user_weight_kg, fit_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).bind(
        revId, prodId, purchase.order_id, customerId, maskedName, maskedName, purchase.option_summary, ratingVal,
        str(contentText, { max: 3000, field: '리뷰' }), JSON.stringify(reviewImages),
        b.user_height_cm ? Math.round(Number(b.user_height_cm)) || null : null, b.user_weight_kg ? Math.round(Number(b.user_weight_kg)) || null : null,
        ['TRUE_TO_SIZE', 'RUNS_SMALL', 'RUNS_LARGE'].includes(b.fit_type) ? b.fit_type : null
      ).run();

      const created = { id: revId, review_id: revId, product_id: prodId, rating: ratingVal, comment: contentText, content: contentText, is_verified_purchase: 1 };
      return new Response(JSON.stringify({ success: true, review_id: revId, data: created, message: '구매 리뷰가 등록되었습니다.' }), { status: 201, headers: corsHeaders });
    }
  }

  // 4b. Review helpful toggle (2-9): second call untoggles; own reviews rejected.
  const helpfulMatch = url.pathname.match(/^\/api\/v1\/reviews\/([^/]+)\/helpful$/);
  if (helpfulMatch && request.method === 'POST') {
    const me = await requireCustomer(request, env);
    const review = await env.DB.prepare('SELECT id, user_id, helpful_count FROM product_reviews WHERE id = ?').bind(helpfulMatch[1]).first();
    if (!review) throw notFound('리뷰를 찾을 수 없습니다.');
    if (review.user_id === me.userId) throw forbidden('본인이 작성한 리뷰에는 도움돼요를 누를 수 없습니다.');
    const existing = await env.DB.prepare('SELECT id FROM review_helpful_votes WHERE review_id = ? AND user_id = ?').bind(review.id, me.userId).first();
    let helpful;
    if (existing) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM review_helpful_votes WHERE id = ?').bind(existing.id),
        env.DB.prepare('UPDATE product_reviews SET helpful_count = MAX(0, helpful_count - 1) WHERE id = ?').bind(review.id)
      ]);
      helpful = false;
    } else {
      try {
        await env.DB.batch([
          env.DB.prepare('INSERT INTO review_helpful_votes (id, review_id, user_id) VALUES (?, ?, ?)').bind(newId('rhv'), review.id, me.userId),
          env.DB.prepare('UPDATE product_reviews SET helpful_count = helpful_count + 1 WHERE id = ?').bind(review.id)
        ]);
      } catch (e) {
        // Lost a concurrent first vote; the stored count already moved once.
        if (!String(e && e.message || '').includes('UNIQUE constraint failed')) throw e;
      }
      helpful = true;
    }
    const count = await env.DB.prepare('SELECT helpful_count AS c FROM product_reviews WHERE id = ?').bind(review.id).first('c');
    const data = { helpful, count: Number(count) || 0 };
    return json(corsHeaders, { success: true, ...data, data });
  }

  // 4c. Review reports (2-9): reason validated, one report per member per review.
  const reportMatch = url.pathname.match(/^\/api\/v1\/reviews\/([^/]+)\/report$/);
  if (reportMatch && request.method === 'POST') {
    const me = await requireCustomer(request, env);
    const body = await readJson(request);
    const reason = String(body.reason || '').toUpperCase();
    if (!['PROFANITY', 'PRIVACY', 'AD', 'IRRELEVANT', 'OTHER'].includes(reason)) {
      throw bad('INVALID_REASON', 'reason은 PROFANITY·PRIVACY·AD·IRRELEVANT·OTHER 중 하나여야 합니다.');
    }
    const review = await env.DB.prepare('SELECT id FROM product_reviews WHERE id = ?').bind(reportMatch[1]).first();
    if (!review) throw notFound('리뷰를 찾을 수 없습니다.');
    const dup = await env.DB.prepare('SELECT id FROM review_reports WHERE review_id = ? AND reporter_user_id = ?').bind(review.id, me.userId).first();
    if (dup) throw conflict('REPORT_EXISTS', '이미 신고한 리뷰입니다.');
    const reportId = newId('rrp');
    try {
      await env.DB.prepare('INSERT INTO review_reports (id, review_id, reporter_user_id, reason) VALUES (?, ?, ?, ?)').bind(reportId, review.id, me.userId, reason).run();
    } catch (e) {
      if (String(e && e.message || '').includes('UNIQUE constraint failed')) throw conflict('REPORT_EXISTS', '이미 신고한 리뷰입니다.');
      throw e;
    }
    const data = { report_id: reportId, review_id: review.id, reason };
    return json(corsHeaders, { success: true, ...data, data }, 201);
  }

  // 5. Product Q&A List & Create (GET/POST /api/v1/products/:id/qna)
  if (url.pathname.match(/^\/api\/v1\/products\/[^\/]+\/qna$/)) {
    const prodId = url.pathname.split('/')[4];
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM product_qna WHERE product_id = ? ORDER BY created_at DESC'
      ).bind(prodId).all();
      const viewer = await authenticate(request, env);
      const data = results.map((q) => (Number(q.is_secret) === 1 && (!viewer || viewer.userId !== q.user_id))
        ? { id: q.id, product_id: q.product_id, is_secret: 1, status: q.status, question: '비밀글입니다.', answer: q.answer ? '비밀글 답변입니다.' : null, created_at: q.created_at }
        : { ...q, user_id: undefined });
      return json(corsHeaders, { success: true, count: data.length, data });
    }
    if (request.method === 'POST') {
      const b = await readJson(request);
      const customerId = (await requireCustomer(request, env)).userId;
      if (!b.question || !b.question.trim()) throw bad('QUESTION_REQUIRED', '문의 내용을 입력해 주세요.');
      const prod = await env.DB.prepare('SELECT partner_id FROM products WHERE id = ?').bind(prodId).first();
      if (!prod) throw notFound('상품을 찾을 수 없습니다.');
      const qnaId = newId('qna');
      await env.DB.prepare(
        `INSERT INTO product_qna (id, product_id, partner_id, user_id, questioner_name, question, is_secret, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING')`
      ).bind(
        qnaId, prodId, prod.partner_id, customerId,
        '고객', str(b.question, { max: 2000, field: '문의' }), b.is_secret ? 1 : 0
      ).run();
      const created = { id: qnaId, qna_id: qnaId, product_id: prodId, question: b.question.trim(), status: 'WAITING' };
      return new Response(JSON.stringify({ success: true, qna_id: qnaId, data: created, message: '상품 문의가 등록되었습니다.' }), { status: 201, headers: corsHeaders });
    }
  }

  // 6. Coupon wallet (2-9): usable holdings, claimable offers, used/expired holdings.
  if (url.pathname === '/api/v1/coupons' && request.method === 'GET') {
    const me = await authenticate(request, env);
    const now = sqlNow();
    const { results: coupons } = await env.DB.prepare(
      'SELECT c.*, pt.business_name AS seller_name FROM coupons c LEFT JOIN partners pt ON pt.id = c.seller_id ORDER BY c.expires_at ASC').all();
    const { results: holdings } = me
      ? await env.DB.prepare('SELECT uc.id AS user_coupon_id, uc.is_used, uc.used_at, uc.created_at AS held_at, c.*, pt.business_name AS seller_name FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id LEFT JOIN partners pt ON pt.id = c.seller_id WHERE uc.user_id = ? ORDER BY uc.created_at DESC').bind(me.userId).all()
      : { results: [] };
    const live = (c) => Number(c.is_active) === 1 && c.expires_at > now && (!c.starts_at || c.starts_at <= now);
    const usable = [];
    const usedExpired = [];
    const heldCounts = {};
    const unusedHeld = new Set();
    for (const h of holdings) {
      heldCounts[h.coupon_id] = (heldCounts[h.coupon_id] || 0) + 1;
      const row = { ...h, name: h.title || h.code, valid_until: h.expires_at };
      if (Number(h.is_used) === 0 && live(h)) { usable.push(row); unusedHeld.add(h.coupon_id); }
      else usedExpired.push(row);
    }
    // Claimable = a live downloadable offer with quantity left that the viewer
    // has no unused holding of (and has not hit the per-user limit). AUTO
    // coupons never appear: they cannot be claimed by hand.
    const claimable = coupons.filter((c) =>
      live(c) && c.issue_method !== 'AUTO' && (c.total_quantity == null || Number(c.issued_count) < Number(c.total_quantity)) &&
      !unusedHeld.has(c.id) && (c.per_user_limit == null || (heldCounts[c.id] || 0) < Number(c.per_user_limit))
    ).map((c) => ({ ...c, name: c.title || c.code, valid_until: c.expires_at }));
    const data = { usable, claimable, used_expired: usedExpired };
    return json(corsHeaders, { success: true, count: usable.length + claimable.length + usedExpired.length, ...data, data });
  }

  if (url.pathname === '/api/v1/coupons/claim' && request.method === 'POST') {
    const b = await readJson(request);
    const customerId = (await requireCustomer(request, env)).userId;
    const key = idempotencyKey(request.headers.get('X-Idempotency-Key') ?? b.idempotency_key ?? null);
    const out = await claimCoupon(env, customerId, b.coupon_id || b.code, key);
    const coupon = await env.DB.prepare('SELECT * FROM coupons WHERE id = ?').bind(out.userCoupon.coupon_id).first();
    return new Response(JSON.stringify({ success: true, coupon, data: coupon, user_coupon_id: out.userCoupon.id,
      ...(out.replay ? { idempotent_replay: true } : {}), message: '쿠폰이 쿠폰함에 발급되었습니다.' }), { headers: corsHeaders });
  }

  // 6b. Best coupon combination (2-9): max savings over the current cart —
  // one platform coupon plus the best store coupon per seller, evaluated in
  // checkout order (store first, platform on the remainder). An estimate:
  // checkout re-verifies min-order and scope at order time.
  if (url.pathname === '/api/v1/coupons/best' && request.method === 'POST') {
    const me = await requireCustomer(request, env);
    const now = sqlNow();
    // 3-5: device-local carts estimate by sending their lines; omitted body
    // falls back to the server cart.
    const bestBody = await readJson(request);
    let cartRows;
    if (bestBody.items !== undefined) {
      if (!Array.isArray(bestBody.items)) throw bad('INVALID_ITEMS', 'items는 배열이어야 합니다.');
      if (bestBody.items.length > 100) throw bad('CART_TOO_LARGE', '한 번에 최대 100개 품목까지 계산할 수 있습니다.');
      cartRows = [];
      for (const it of bestBody.items) {
        const skuId = String(it.sku_id || '').trim();
        const qty = Number(it.quantity);
        if (!skuId) throw bad('SKU_REQUIRED', 'sku_id가 비어 있는 품목이 있습니다.');
        if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw bad('INVALID_QUANTITY', `수량은 1~99 사이의 정수여야 합니다. (${skuId})`);
        const row = await env.DB.prepare(
          `SELECT s.id AS sku_id, s.product_id, s.sale_price, p.partner_id, p.category_id
           FROM product_skus s JOIN products p ON p.id = s.product_id WHERE s.id = ? AND p.status = 'ACTIVE'`
        ).bind(skuId).first();
        if (!row) throw bad('INVALID_SKU', `존재하지 않는 상품 옵션입니다. (${skuId})`);
        cartRows.push({ ...row, quantity: qty });
      }
    } else {
      ({ results: cartRows } = await env.DB.prepare(
        `SELECT c.sku_id, c.quantity, s.product_id, s.sale_price, p.partner_id, p.category_id
         FROM cart_items c JOIN product_skus s ON s.id = c.sku_id JOIN products p ON p.id = s.product_id
         WHERE c.user_id = ? AND p.status = 'ACTIVE'`
      ).bind(me.userId).all());
    }
    const lines = cartRows.map((r) => ({
      skuId: r.sku_id, productId: r.product_id, partnerId: r.partner_id, categoryId: r.category_id,
      lineTotal: Number(r.sale_price) * Number(r.quantity), storeAlloc: 0
    }));
    const empty = { platform: null, store: [], total_discount: 0 };
    if (!lines.length) return json(corsHeaders, { success: true, ...empty, data: empty });
    const { results: held } = await env.DB.prepare(
      `SELECT uc.id AS user_coupon_id, c.* FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
       WHERE uc.user_id = ? AND uc.is_used = 0 AND c.is_active = 1 AND c.expires_at > ?
       AND (c.starts_at IS NULL OR c.starts_at <= ?)`
    ).bind(me.userId, now, now).all();
    const discountOf = async (coupon, eligibleLines, baseOf) => {
      const sum = eligibleLines.reduce((a, l) => a + baseOf(l), 0);
      if (sum < (coupon.min_order_amount || 0)) return null;
      try {
        return couponAmount(coupon, sum);
      } catch {
        return null;
      }
    };
    const storeBest = [];
    const sellers = [...new Set(lines.map((l) => l.partnerId))];
    for (const sellerId of sellers) {
      const mine = held.filter((h) => h.dup_group === 'STORE');
      let best = null;
      for (const h of mine) {
        const eligible = [];
        for (const l of lines) {
          if (l.partnerId !== sellerId) continue;
          if (await matchScope(env, h, l)) eligible.push(l);
        }
        if (!eligible.length) continue;
        const amount = await discountOf(h, eligible, (l) => l.lineTotal);
        if (amount == null || amount <= 0) continue;
        if (!best || amount > best.discount_amount) {
          best = { seller_id: sellerId, user_coupon_id: h.user_coupon_id, coupon_id: h.id, code: h.code, discount_amount: amount, _eligible: eligible };
        }
      }
      if (best) {
        const parts = allocate(best.discount_amount, best._eligible.map((l) => l.lineTotal));
        best._eligible.forEach((l, i) => { l.storeAlloc = parts[i]; });
        delete best._eligible;
        storeBest.push(best);
      }
    }
    storeBest.sort((a, b) => (a.seller_id < b.seller_id ? -1 : 1));
    let platformBest = null;
    for (const h of held.filter((x) => x.dup_group === 'PLATFORM')) {
      const eligible = [];
      for (const l of lines) {
        if (await matchScope(env, h, l)) eligible.push(l);
      }
      if (!eligible.length) continue;
      const rawSum = eligible.reduce((a, l) => a + l.lineTotal, 0);
      if (rawSum < (h.min_order_amount || 0)) continue;
      const targetSum = eligible.reduce((a, l) => a + (l.lineTotal - l.storeAlloc), 0);
      let amount;
      try {
        amount = couponAmount({ ...h, min_order_amount: 0 }, targetSum);
      } catch {
        continue;
      }
      if (amount <= 0) continue;
      if (!platformBest || amount > platformBest.discount_amount) {
        platformBest = { user_coupon_id: h.user_coupon_id, coupon_id: h.id, code: h.code, discount_amount: amount };
      }
    }
    const total = (platformBest ? platformBest.discount_amount : 0) + storeBest.reduce((a, s) => a + s.discount_amount, 0);
    const data = { platform: platformBest, store: storeBest, total_discount: total };
    return json(corsHeaders, { success: true, ...data, data });
  }

  // 7. User Credits Balance & Ledger
  if (url.pathname === '/api/v1/credits' && request.method === 'GET') {
    const customerId = (await requireCustomer(request, env)).userId;
    const { results } = await env.DB.prepare('SELECT *, amount_delta as amount FROM user_credits WHERE user_id = ? ORDER BY created_at DESC').bind(customerId).all();
    const balanceRow = await env.DB.prepare('SELECT SUM(amount_delta) as total_balance FROM user_credits WHERE user_id = ?').bind(customerId).first();
    const balance = balanceRow && balanceRow.total_balance ? balanceRow.total_balance : 0;
    return new Response(JSON.stringify({
      success: true,
      customer_id: customerId,
      balance,
      data: { balance, history: results }
    }), { headers: corsHeaders });
  }

  // 8. Customer Wishlist (GET / POST / DELETE /api/v1/wishlist)
  if (url.pathname === '/api/v1/wishlist') {
    const customerId = (await requireCustomer(request, env)).userId;
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT w.id as wishlist_id, w.created_at as wished_at, p.*, p.id as product_id, p.id as slug,
                COALESCE(pt.business_name, 'OLMOA DIRECT') as brand, c.name as category_name, pt.business_name
         FROM wishlists w
         JOIN products p ON w.product_id = p.id
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN partners pt ON p.partner_id = pt.id
         WHERE w.user_id = ?
         ORDER BY w.created_at DESC`
      ).bind(customerId).all();
      return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
    }
    if (request.method === 'POST') {
      const b = await readJson(request);
      // P2-SEC-04: presence is not enough — cap the id shape before it touches SQL.
      const prodId = str(b.product_id, { field: 'product_id', max: 64 });
      const cid = customerId;
      if (!prodId) throw bad('PRODUCT_REQUIRED', 'product_id required');
      const existing = await env.DB.prepare('SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?').bind(cid, prodId).first();
      if (existing) {
        await env.DB.prepare('DELETE FROM wishlists WHERE id = ?').bind(existing.id).run();
        return new Response(JSON.stringify({ success: true, wished: false, action: 'REMOVED', product_id: prodId }), { headers: corsHeaders });
      } else {
        await env.DB.prepare('INSERT INTO wishlists (id, user_id, product_id) VALUES (?, ?, ?)').bind(newId('wsh'), cid, prodId).run();
        return new Response(JSON.stringify({ success: true, wished: true, action: 'ADDED', product_id: prodId }), { status: 200, headers: corsHeaders });
      }
    }
  }

  // 8b. Customer Cart (GET / PUT /api/v1/cart) — P1-M05 server sync.
  // Replace semantics: the client sends the full line set. Unknown SKUs are
  // rejected (400 INVALID_SKU), never silently dropped, so the client can
  // show exactly which line failed. Prices/stock are re-read live on GET.
  if (url.pathname === '/api/v1/cart') {
    const customerId = (await requireCustomer(request, env)).userId;
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT c.sku_id, c.quantity, c.updated_at,
                s.product_id, s.sale_price, s.original_price, s.stock_quantity,
                p.title, p.thumbnail_url, p.status AS product_status, p.partner_id
         FROM cart_items c
         JOIN product_skus s ON s.id = c.sku_id
         JOIN products p ON p.id = s.product_id
         WHERE c.user_id = ?
         ORDER BY c.updated_at DESC`
      ).bind(customerId).all();
      return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
    }
    if (request.method === 'PUT') {
      const b = await readJson(request);
      const items = Array.isArray(b.items) ? b.items : null;
      if (!items) throw bad('ITEMS_REQUIRED', 'items 배열을 보내 주세요.');
      if (items.length > 100) throw bad('CART_TOO_LARGE', '장바구니는 최대 100개 품목까지 저장됩니다.');
      const lines = [];
      for (const it of items) {
        const skuId = String(it.sku_id || '').trim();
        const qty = Number(it.quantity);
        if (!skuId) throw bad('SKU_REQUIRED', 'sku_id가 비어 있는 품목이 있습니다.');
        if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw bad('INVALID_QUANTITY', `수량은 1~99 사이의 정수여야 합니다. (${skuId})`);
        const sku = await env.DB.prepare('SELECT id FROM product_skus WHERE id = ?').bind(skuId).first();
        if (!sku) throw bad('INVALID_SKU', `존재하지 않는 상품 옵션입니다. (${skuId})`, { sku_id: skuId });
        lines.push({ sku_id: skuId, quantity: qty });
      }
      const stmts = [env.DB.prepare('DELETE FROM cart_items WHERE user_id = ?').bind(customerId)];
      for (const l of lines) {
        stmts.push(env.DB.prepare(
          'INSERT INTO cart_items (user_id, sku_id, quantity, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
        ).bind(customerId, l.sku_id, l.quantity));
      }
      await env.DB.batch(stmts);
      return new Response(JSON.stringify({ success: true, count: lines.length, data: lines }), { headers: corsHeaders });
    }
  }

  // 9. Support FAQ & 1:1 Customer Inquiries
  if (url.pathname === '/api/v1/support/faq' && request.method === 'GET') {
    const faqs = [
      { category: '배송', q: '배송비와 배송 기간은 어떻게 되나요?', a: '배송비와 무료배송 기준은 판매자(직영/입점)별로 다르며 주문서에서 판매자별로 확인할 수 있습니다. 배송 예정일을 넘긴 경우 주문 상세에서 지연 보상을 신청할 수 있습니다.' },
      { category: '판매가 인하 보상', q: '구매 후 가격이 내리면 보상받을 수 있나요?', a: '결제 후 30일 이내, 24시간 이상 유지된 판매가 인하에 한해 주문 상세에서 1회 신청할 수 있으며, 운영자 승인 시 결제액의 최대 10%(상한 10,000원)까지 해당 판매자 부담으로 적립됩니다.' },
      { category: '반품/환불', q: '반품은 어떻게 하나요?', a: '상품 수령 후 7일 이내 주문 상세에서 반품을 신청할 수 있습니다. 판매자가 회수·확인하면 결제 금액은 원결제수단으로, 사용한 적립금은 적립금으로 환불됩니다. 단순 변심 반품은 반품 배송비가 부과될 수 있습니다.' },
      { category: '결제', q: '결제 대금은 언제 판매자에게 지급되나요?', a: '입점 판매자의 판매대금은 구매확정(또는 배송완료 후 7일 자동 확정) 이후 정산되며, 정산 후 환불이 발생하면 다음 정산에서 차감됩니다.' },
      { category: '파트너입점', q: '올모아 글로벌 셀러로 입점하려면 어떻게 해야 하나요?', a: '상단 [셀러 입점] 메뉴를 통해 사업자등록증 및 정산 계좌를 제출하시면 운영 관리자 심사 완료 후 전용 파트너 센터에서 상품 등록 및 대량 CSV 업로드가 가능합니다.' }
    ];
    return new Response(JSON.stringify({ success: true, data: faqs }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/support/inquiries') {
    const customerId = (await requireCustomer(request, env)).userId;
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT *, content as message FROM support_inquiries WHERE user_id = ? ORDER BY created_at DESC').bind(customerId).all();
      return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
    }
    if (request.method === 'POST') {
      const b = await readJson(request);
      const msgText = (b.content || b.message || '').trim();
      if (!b.subject || !msgText) throw bad('INQUIRY_REQUIRED', '문의 제목과 내용을 모두 입력해 주세요.');
      const inqId = newId('inq');
      const cat = ['DELIVERY', 'REFUND_RETURN', 'PRICE_MATCH', 'PAYMENT', 'PARTNER_JOIN', 'OTHER'].includes(b.category) ? b.category : 'OTHER';
      await env.DB.prepare(
        `INSERT INTO support_inquiries (id, user_id, order_id, category, subject, content, status)
         VALUES (?, ?, ?, ?, ?, ?, 'OPEN')`
      ).bind(inqId, customerId, b.order_id || null, cat, str(b.subject, { max: 200, required: true, field: '제목' }), str(msgText, { max: 5000, field: '내용' })).run();
      return new Response(JSON.stringify({
        success: true,
        inquiry_id: inqId,
        data: { id: inqId, inquiry_id: inqId, status: 'OPEN' },
        message: '1:1 고객 문의가 정상 접수되었습니다.'
      }), { status: 201, headers: corsHeaders });
    }
  }

  // 10. Dynamic Promotional Banners
  if (url.pathname === '/api/v1/banners' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM banners WHERE is_active = 1 ORDER BY display_order ASC, created_at DESC'
    ).all();
    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
  }

  // 11. Multi-Address Book Management (Customer)
  if (url.pathname === '/api/v1/addresses') {
    const customerId = (await requireCustomer(request, env)).userId;
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC'
      ).bind(customerId).all();
      return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
    }
    if (request.method === 'POST') {
      const b = await readJson(request);
      const recipientName = (b.recipient_name || b.name || '').trim();
      const phone = (b.phone || '').trim();
      const postalCode = (b.postal_code || b.zip || '').trim();
      const addressLine1 = (b.address_line1 || b.address || '').trim();
      const addressLine2 = (b.address_line2 || b.detail_address || '').trim();
      const isDefault = b.is_default ? 1 : 0;
      const note = (b.delivery_note || b.note || '').trim();

      if (!recipientName || !phone || !addressLine1) throw bad('ADDRESS_REQUIRED', '수령인, 연락처, 주소는 필수 입력 항목입니다.');
      if (!/^\d{5}$/.test(postalCode)) throw bad('INVALID_POSTAL_CODE', '우편번호는 5자리 숫자여야 합니다.');

      const addrId = newId('addr');
      if (isDefault) {
        if (env.DB.batch) {
          await env.DB.batch([
            env.DB.prepare('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?').bind(customerId),
            env.DB.prepare(
              'INSERT INTO user_addresses (id, user_id, recipient_name, phone, postal_code, address_line1, address_line2, is_default, delivery_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(addrId, customerId, recipientName, phone, postalCode, addressLine1, addressLine2, isDefault, note)
          ]);
        } else {
          await env.DB.prepare('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?').bind(customerId).run();
          await env.DB.prepare(
            'INSERT INTO user_addresses (id, user_id, recipient_name, phone, postal_code, address_line1, address_line2, is_default, delivery_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(addrId, customerId, recipientName, phone, postalCode, addressLine1, addressLine2, isDefault, note).run();
        }
      } else {
        await env.DB.prepare(
          'INSERT INTO user_addresses (id, user_id, recipient_name, phone, postal_code, address_line1, address_line2, is_default, delivery_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(addrId, customerId, recipientName, phone, postalCode, addressLine1, addressLine2, isDefault, note).run();
      }

      const created = await env.DB.prepare('SELECT * FROM user_addresses WHERE id = ?').bind(addrId).first();
      return new Response(JSON.stringify({ success: true, message: '배송지가 등록되었습니다.', data: created }), { status: 201, headers: corsHeaders });
    }
  }

  const addrMatch = url.pathname.match(/^\/api\/v1\/addresses\/([a-zA-Z0-9_-]+)/);
  if (addrMatch) {
    const addrId = addrMatch[1];
    const customerId = (await requireCustomer(request, env)).userId;
    if (url.pathname.endsWith('/default') && (request.method === 'PUT' || request.method === 'POST')) {
      const exists = await env.DB.prepare('SELECT id FROM user_addresses WHERE id = ? AND user_id = ?').bind(addrId, customerId).first();
      if (!exists) throw notFound('Address not found or unauthorized');
      if (env.DB.batch) {
        await env.DB.batch([
          env.DB.prepare('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?').bind(customerId),
          env.DB.prepare('UPDATE user_addresses SET is_default = 1 WHERE id = ? AND user_id = ?').bind(addrId, customerId)
        ]);
      } else {
        await env.DB.prepare('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?').bind(customerId).run();
        await env.DB.prepare('UPDATE user_addresses SET is_default = 1 WHERE id = ? AND user_id = ?').bind(addrId, customerId).run();
      }
      return new Response(JSON.stringify({ success: true, message: '기본 배송지로 설정되었습니다.' }), { headers: corsHeaders });
    }
    if (request.method === 'DELETE') {
      const exists = await env.DB.prepare('SELECT id FROM user_addresses WHERE id = ? AND user_id = ?').bind(addrId, customerId).first();
      if (!exists) throw notFound('Address not found or unauthorized');
      await env.DB.prepare('DELETE FROM user_addresses WHERE id = ? AND user_id = ?').bind(addrId, customerId).run();
      return new Response(JSON.stringify({ success: true, message: '배송지가 삭제되었습니다.' }), { headers: corsHeaders });
    }
  }

  // 12. Customer Notifications & Alerts
  if (url.pathname === '/api/v1/notifications') {
    const customerId = (await requireCustomer(request, env)).userId;
    if (request.method === 'GET') {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '20', 10) || 20));
      const total = await env.DB.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?').bind(customerId).first('c') || 0;
      const unreadCount = await env.DB.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').bind(customerId).first('c') || 0;
      const { results } = await env.DB.prepare(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).bind(customerId, perPage, (page - 1) * perPage).all();
      return new Response(JSON.stringify({ success: true, unread_count: Number(unreadCount) || 0, count: results.length, pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) }, data: results }), { headers: corsHeaders });
    }
  }

  // 12-1. External Real-time Dispatcher (SMS / Kakao AlimTalk / Email)
  if (url.pathname === '/api/v1/notifications/dispatch' && request.method === 'POST') {
    const dispatchAdmin = await requireAdmin(request, env);
    const body = await readJson(request);
    const channel = (body.channel || 'ALIMTALK').toUpperCase();
    const recipient = String(body.recipient || body.phone || body.email || '').trim();
    const templateCode = String(body.template_code || 'ORDER_NOTIFICATION').toUpperCase();
    const title = String(body.title || 'OLMOA 알림').trim();
    const content = String(body.content || body.message || '올모아 주문 알림입니다.').trim();

    if (!recipient) throw bad('RECIPIENT_REQUIRED', 'recipient is required for dispatch');

    const logId = newId('dlv');
    let provider = 'SOLAPI';
    let status = 'NOT_SENT_PROVIDER_NOT_CONFIGURED';
    let providerMsgId = null;

    // Real API integration if SOLAPI keys present. NEW-05: no fake sender
    // fallback — without a registered SOLAPI_SENDER_NUMBER the send is not
    // attempted and the misconfiguration is reported honestly.
    const smsSender = String(env.SOLAPI_SENDER_NUMBER || '').replace(/[^0-9]/g, '');
    const senderConfigured = smsSender.length >= 8;
    if (env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET && senderConfigured) {
      try {
        const solapiRes = await fetch('https://api.solapi.com/messages/v4/send', {
          method: 'POST',
          headers: {
            'Authorization': await solapiAuthHeader(env),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: {
              to: recipient.replace(/[^0-9]/g, ''),
              from: smsSender,
              text: content
            }
          })
        });
        const sJson = await solapiRes.json().catch(() => ({}));
        if (solapiRes.ok) {
          providerMsgId = sJson.groupInfo?.groupId || sJson.messageId || null;
          status = 'SENT';
        } else {
          status = 'FAILED';
        }
      } catch (err) {
        status = 'FAILED';
      }
    } else if (env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET && !senderConfigured) {
      status = 'NOT_SENT_SENDER_NOT_CONFIGURED';
    }

    // SEC-10: recipient + content are sealed at rest; recipient_hash is the blind
    // index for withdrawal purge (the exact trimmed recipient string is hashed).
    await env.DB.prepare(
      `INSERT INTO notification_delivery_logs (id, channel, recipient, recipient_hash, template_code, title, content, status, provider, provider_msg_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(logId, channel, await sealPii(env, recipient), await sha256Hex(recipient), templateCode, title,
      await sealPii(env, content), status, provider, providerMsgId).run();
    await auditStatement(env, dispatchAdmin, { action: 'SMS_DISPATCH', targetType: 'notification_delivery', targetId: logId, after: { channel, template_code: templateCode, status, provider }, request }).run();

    return new Response(JSON.stringify({
      success: true,
      provider_configured: Boolean(env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET),
      sender_configured: senderConfigured,
      ...(senderConfigured ? {} : { config_error: 'SOLAPI_SENDER_NUMBER 미설정: 사전 등록된 발신번호를 설정해야 SMS를 발송할 수 있습니다.' }),
      data: {
        log_id: logId,
        channel,
        recipient,
        template_code: templateCode,
        status,
        provider,
        provider_msg_id: providerMsgId,
        dispatched_at: new Date().toISOString()
      }
    }), { status: 200, headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/notifications/read-all' && (request.method === 'PUT' || request.method === 'POST')) {
    const customerId = (await requireCustomer(request, env)).userId;
    await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(customerId).run();
    return new Response(JSON.stringify({ success: true, message: '모든 알림을 읽음 처리했습니다.' }), { headers: corsHeaders });
  }

  const notiMatch = url.pathname.match(/^\/api\/v1\/notifications\/([a-zA-Z0-9_-]+)\/read$/);
  if (notiMatch && (request.method === 'PUT' || request.method === 'POST')) {
    const notiId = notiMatch[1];
    const customerId = (await requireCustomer(request, env)).userId;
    await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').bind(notiId, customerId).run();
    return new Response(JSON.stringify({ success: true, message: '알림을 읽음 처리했습니다.' }), { headers: corsHeaders });
  }

  // 13. Store follows (2-9).
  const followMatch = url.pathname.match(/^\/api\/v1\/stores\/([^/]+)\/follow$/);
  if (followMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    const me = await requireCustomer(request, env);
    const partner = await env.DB.prepare('SELECT id FROM partners WHERE id = ?').bind(followMatch[1]).first();
    if (!partner) throw notFound('판매자를 찾을 수 없습니다.');
    let following;
    if (request.method === 'POST') {
      await env.DB.prepare('INSERT OR IGNORE INTO store_follows (id, user_id, partner_id) VALUES (?, ?, ?)')
        .bind(newId('sf'), me.userId, partner.id).run();
      following = true;
    } else {
      await env.DB.prepare('DELETE FROM store_follows WHERE user_id = ? AND partner_id = ?').bind(me.userId, partner.id).run();
      following = false;
    }
    const data = { following, partner_id: partner.id };
    return json(corsHeaders, { success: true, ...data, data });
  }
  // 13b. Public store reviews (3-10): visible reviews on the seller's
  // products, newest first. Unknown and non-approved sellers stay hidden.
  const storeReviewsMatch = url.pathname.match(/^\/api\/v1\/stores\/([^/]+)\/reviews$/);
  if (storeReviewsMatch && request.method === 'GET') {
    const partner = await env.DB.prepare("SELECT id FROM partners WHERE id = ? AND status = 'APPROVED'").bind(storeReviewsMatch[1]).first();
    if (!partner) throw notFound('판매자를 찾을 수 없습니다.');
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') || '20', 10) || 20));
    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM product_reviews r JOIN products p ON p.id = r.product_id
       WHERE p.partner_id = ? AND r.visibility = 'VISIBLE'`
    ).bind(partner.id).first('c') || 0;
    const { results } = await env.DB.prepare(
      `SELECT r.*, p.title AS product_title, p.thumbnail_url
       FROM product_reviews r JOIN products p ON p.id = r.product_id
       WHERE p.partner_id = ? AND r.visibility = 'VISIBLE'
       ORDER BY r.created_at DESC, r.rowid DESC LIMIT ? OFFSET ?`
    ).bind(partner.id, perPage, (page - 1) * perPage).all();
    const replies = {};
    if (results.length) {
      const { results: replyRows } = await env.DB.prepare(
        `SELECT review_id, body, created_at FROM review_replies WHERE review_id IN (${results.map(() => '?').join(',')})`
      ).bind(...results.map((r) => r.id)).all();
      for (const rr of replyRows) replies[rr.review_id] = { body: rr.body, created_at: rr.created_at };
    }
    const reviews = results.map((r) => {
      let images = [];
      try { images = JSON.parse(r.images_json || '[]'); } catch (_) { /* keep empty */ }
      if (!Array.isArray(images)) images = [];
      return { ...r, comment: r.content, customer_name: r.reviewer_name, images, reply: replies[r.id] || null };
    });
    const data = { reviews, pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) } };
    return json(corsHeaders, { success: true, count: data.pagination.total, data });
  }
  if (url.pathname === '/api/v1/me/followed-stores' && request.method === 'GET') {
    const me = await requireCustomer(request, env);
    const { results } = await env.DB.prepare(
      `SELECT f.partner_id, f.created_at AS followed_at, p.business_name,
              (SELECT COUNT(*) FROM products WHERE partner_id = p.id AND status = 'ACTIVE') AS product_count
       FROM store_follows f JOIN partners p ON p.id = f.partner_id
       WHERE f.user_id = ? ORDER BY f.created_at DESC`
    ).bind(me.userId).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  // 14. Recently viewed products (2-9): newest first, one card per product.
  if (url.pathname === '/api/v1/me/recently-viewed' && request.method === 'GET') {
    const me = await requireCustomer(request, env);
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.title, p.thumbnail_url, p.lowest_sale_price, p.lowest_original_price,
              p.status, p.partner_id, MAX(v.viewed_at) AS viewed_at
       FROM product_views v JOIN products p ON p.id = v.product_id
       WHERE v.user_id = ?
       GROUP BY v.product_id ORDER BY viewed_at DESC, MAX(v.rowid) DESC LIMIT ?`
    ).bind(me.userId, limit).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  if (url.pathname === '/api/v1/me/recently-viewed/merge' && request.method === 'POST') {
    const me = await requireCustomer(request, env);
    const body = await readJson(request);
    if (!Array.isArray(body.product_ids)) throw bad('PRODUCT_IDS_REQUIRED', 'product_ids 배열을 보내 주세요.');
    if (body.product_ids.length > 50) throw bad('MERGE_TOO_LARGE', '한 번에 최대 50개까지 합칠 수 있습니다.');
    const ids = [...new Set(body.product_ids.map((x) => String(x || '').trim()).filter(Boolean))];
    let merged = 0;
    const base = Date.now();
    for (let i = 0; i < ids.length; i++) {
      const prod = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(ids[i]).first();
      if (!prod) continue; // browser history may hold removed products; skip, never fail
      const stamp = new Date(base + i).toISOString().replace('T', ' ').slice(0, 23);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM product_views WHERE user_id = ? AND product_id = ?').bind(me.userId, prod.id),
        env.DB.prepare('INSERT INTO product_views (id, product_id, user_id, day, viewed_at) VALUES (?, ?, ?, date(?), ?)')
          .bind(newId('pvw'), prod.id, me.userId, stamp, stamp)
      ]);
      merged += 1;
    }
    const data = { merged };
    return json(corsHeaders, { success: true, ...data, data });
  }
  const recentDelMatch = url.pathname.match(/^\/api\/v1\/me\/recently-viewed\/([^/]+)$/);
  if (recentDelMatch && request.method === 'DELETE') {
    const me = await requireCustomer(request, env);
    const r = await env.DB.prepare('DELETE FROM product_views WHERE user_id = ? AND product_id = ?').bind(me.userId, recentDelMatch[1]).run();
    const data = { removed: r.meta.changes > 0, product_id: recentDelMatch[1] };
    return json(corsHeaders, { success: true, ...data, data });
  }

  // 14b. My reviews (3-9): everything I wrote, newest first. My own
  // blinded reviews stay visible to me with their visibility flag; other
  // members' rows never appear.
  if (url.pathname === '/api/v1/me/reviews' && request.method === 'GET') {
    const me = await requireCustomer(request, env);
    const { results } = await env.DB.prepare(
      `SELECT r.*, p.title AS product_title, p.thumbnail_url
       FROM product_reviews r JOIN products p ON p.id = r.product_id
       WHERE r.user_id = ? ORDER BY r.created_at DESC, r.rowid DESC`
    ).bind(me.userId).all();
    const replies = {};
    if (results.length) {
      const { results: replyRows } = await env.DB.prepare(
        `SELECT review_id, body, created_at FROM review_replies WHERE review_id IN (${results.map(() => '?').join(',')})`
      ).bind(...results.map((r) => r.id)).all();
      for (const rr of replyRows) replies[rr.review_id] = { body: rr.body, created_at: rr.created_at };
    }
    const data = results.map((r) => {
      let images = [];
      try { images = JSON.parse(r.images_json || '[]'); } catch (_) { /* keep empty */ }
      if (!Array.isArray(images)) images = [];
      return { ...r, comment: r.content, customer_name: r.reviewer_name, images, reply: replies[r.id] || null };
    });
    return json(corsHeaders, { success: true, count: data.length, data });
  }

  // 14c. Reviewable purchases (3-9): the same rule as POST reviews — a
  // delivered/confirmed line I have not fully refunded and not reviewed yet,
  // one row per (product, order) like the duplicate guard.
  if (url.pathname === '/api/v1/me/reviewable' && request.method === 'GET') {
    const me = await requireCustomer(request, env);
    const { results } = await env.DB.prepare(
      `SELECT i.product_id, p.title AS product_title, p.thumbnail_url,
              o.id AS order_id, o.order_no, o.created_at AS ordered_at,
              MIN(i.option_summary) AS option_summary
       FROM order_items i
       JOIN sub_orders s ON s.id = i.sub_order_id
       JOIN orders o ON o.id = s.parent_order_id
       JOIN products p ON p.id = i.product_id
       WHERE o.customer_id = ? AND s.status IN ('DELIVERED','PURCHASE_CONFIRMED')
         AND i.refunded_quantity < i.quantity
         AND NOT EXISTS (SELECT 1 FROM product_reviews r
                         WHERE r.product_id = i.product_id AND r.user_id = o.customer_id AND r.order_id = o.id)
       GROUP BY i.product_id, o.id ORDER BY o.created_at DESC, i.product_id ASC`
    ).bind(me.userId).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  // 14d. Order phase summary (3-9): whole-account counts using the exact
  // buyer-list rule — all-pending is upcoming, all-terminal is completed,
  // everything else (including sub-less orders) is purchasing.
  if (url.pathname === '/api/v1/me/order-summary' && request.method === 'GET') {
    const me = await requireCustomer(request, env);
    const { results } = await env.DB.prepare(
      `SELECT o.id, COUNT(s.id) AS sub_count,
              SUM(CASE WHEN s.status = 'PAYMENT_PENDING' THEN 1 ELSE 0 END) AS pending_count,
              SUM(CASE WHEN s.status IN ('PURCHASE_CONFIRMED','CANCELLED','RETURNED','EXPIRED') THEN 1 ELSE 0 END) AS terminal_count
       FROM orders o LEFT JOIN sub_orders s ON s.parent_order_id = o.id
       WHERE o.customer_id = ? GROUP BY o.id`
    ).bind(me.userId).all();
    const data = { upcoming: 0, purchasing: 0, completed: 0, total: results.length };
    for (const o of results) {
      const subs = Number(o.sub_count);
      if (subs > 0 && Number(o.pending_count) === subs) data.upcoming += 1;
      else if (subs > 0 && Number(o.terminal_count) === subs) data.completed += 1;
      else data.purchasing += 1;
    }
    return json(corsHeaders, { success: true, ...data, data });
  }

  // 15. Restock subscriptions (2-9): only genuinely stocked-out SKUs.
  if (url.pathname === '/api/v1/restock-subscriptions' && (request.method === 'POST' || request.method === 'DELETE')) {
    const me = await requireCustomer(request, env);
    const body = await readJson(request);
    const skuId = str(body.sku_id, { field: 'sku_id', max: 64 });
    if (!skuId) throw bad('SKU_REQUIRED', 'sku_id를 지정해 주세요.');
    const sku = await env.DB.prepare('SELECT id, stock_quantity FROM product_skus WHERE id = ?').bind(skuId).first();
    if (!sku) throw notFound('상품 옵션을 찾을 수 없습니다.');
    if (request.method === 'POST') {
      if (Number(sku.stock_quantity) > 0) throw conflict('STOCK_AVAILABLE', '재고가 있는 상품은 재입고 알림을 신청할 수 없습니다.');
      const prior = await env.DB.prepare('SELECT id FROM restock_subscriptions WHERE user_id = ? AND sku_id = ?').bind(me.userId, skuId).first();
      if (prior) {
        const data = { subscribed: true, sku_id: skuId, idempotent_replay: true };
        return json(corsHeaders, { success: true, ...data, data }, 200);
      }
      await env.DB.prepare('INSERT INTO restock_subscriptions (id, user_id, sku_id) VALUES (?, ?, ?)').bind(newId('rst'), me.userId, skuId).run();
      const data = { subscribed: true, sku_id: skuId };
      return json(corsHeaders, { success: true, ...data, data }, 201);
    }
    await env.DB.prepare('DELETE FROM restock_subscriptions WHERE user_id = ? AND sku_id = ?').bind(me.userId, skuId).run();
    const data = { subscribed: false, sku_id: skuId };
    return json(corsHeaders, { success: true, ...data, data });
  }

  return null;
}

async function solapiAuthHeader(env) {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SOLAPI_API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
  return `HMAC-SHA256 apiKey=${env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${hex}`;
}
