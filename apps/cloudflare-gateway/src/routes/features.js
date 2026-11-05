// apps/cloudflare-gateway/src/routes/features.js
// Customer engagement features. Identity = verified JWT (requireCustomer / authenticate).
import { requireCustomer, requireAdmin, authenticate } from '../lib/auth.js';
import { json, readJson, bad, conflict, forbidden, notFound, str } from '../lib/http.js';
import { newId, sqlNow } from '../lib/ids.js';

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
    const body = await request.json().catch(() => ({}));
    const kw = (body.keyword || '').trim();
    if (kw) {
      await env.DB.prepare(
        `INSERT INTO search_keywords (id, keyword, normalized_keyword, search_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(keyword) DO UPDATE SET search_count = search_count + 1, updated_at = CURRENT_TIMESTAMP`
      ).bind(newId('kw'), kw, kw.toLowerCase()).run();
    }
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  }

  // 3. Lightning Deals Campaigns (only a real, currently running campaign; prices shown = prices charged)
  if (url.pathname === '/api/v1/campaigns/lightning' && request.method === 'GET') {
    const now = sqlNow();
    const campaign = await env.DB.prepare(
      "SELECT * FROM flash_sale_campaigns WHERE status = 'ACTIVE' AND starts_at <= ? AND ends_at > ? ORDER BY ends_at LIMIT 1"
    ).bind(now, now).first();
    if (!campaign) return json(corsHeaders, { success: true, campaign: null, items: [], data: { campaign: null, deals: [], items: [] } });
    const { results: items } = await env.DB.prepare(
      `SELECT f.id, f.product_id, f.sku_id, f.allocated_stock, f.sold_stock, f.sort_order, p.id as slug, p.title, p.thumbnail_url, p.partner_id,
              pt.business_name AS brand, pt.business_name, COALESCE(s.sale_price, p.lowest_sale_price) AS charged_price,
              COALESCE(s.original_price, p.lowest_original_price) AS original_price, s.stock_quantity AS sku_stock
       FROM flash_sale_items f JOIN products p ON f.product_id = p.id LEFT JOIN partners pt ON p.partner_id = pt.id LEFT JOIN product_skus s ON f.sku_id = s.id
       WHERE f.campaign_id = ? AND p.status = 'ACTIVE' AND p.review_status = 'APPROVED' ORDER BY f.sort_order ASC`
    ).bind(campaign.id).all();
    // NOTE: checkout charges product_skus.sale_price; a separate deal-price engine is not implemented, so the
    // displayed deal price is the real charged price and the discount is computed from it (no fabricated numbers).
    const mappedDeals = items.map((it) => ({
      ...it,
      deal_price: it.charged_price,
      lowest_sale_price: it.charged_price,
      lowest_original_price: it.original_price,
      sold_quantity: it.sold_stock || 0,
      discount_rate: it.original_price > it.charged_price ? Math.floor(((it.original_price - it.charged_price) * 100) / it.original_price) : 0,
      sold_percent: it.allocated_stock > 0 ? Math.min(100, Math.floor(((it.sold_stock || 0) * 100) / it.allocated_stock)) : 0,
      remaining_stock: Math.max(0, Math.min(it.sku_stock ?? 0, (it.allocated_stock || 0) - (it.sold_stock || 0)))
    }));
    return json(corsHeaders, { success: true, campaign, items: mappedDeals, data: { campaign, deals: mappedDeals, items: mappedDeals } });
  }

  // 4. Product Reviews List & Create
  if (url.pathname.match(/^\/api\/v1\/products\/[^\/]+\/reviews$/)) {
    const prodId = url.pathname.split('/')[4];
    if (request.method === 'GET') {
      const { results: reviews } = await env.DB.prepare(
        'SELECT * FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC'
      ).bind(prodId).all();

      const avgRow = await env.DB.prepare(
        'SELECT AVG(rating) as avg_rating, COUNT(*) as review_count FROM product_reviews WHERE product_id = ?'
      ).bind(prodId).first();

      const parsedReviews = reviews.map(r => {
        let images = [];
        try { images = JSON.parse(r.images_json || '[]'); } catch (_) {}
        return {
          ...r,
          comment: r.content,
          customer_name: r.reviewer_name,
          images
        };
      });

      const avgVal = avgRow && avgRow.review_count > 0 && avgRow.avg_rating != null ? parseFloat(Number(avgRow.avg_rating).toFixed(1)) : null;
      const cntVal = avgRow ? avgRow.review_count : parsedReviews.length;

      return new Response(JSON.stringify({
        success: true, brand: 'OLMOA', product_id: prodId,
        avg_rating: avgVal,
        review_count: cntVal,
        reviews: parsedReviews,
        data: {
          reviews: parsedReviews,
          summary: { count: cntVal, average_rating: avgVal }
        }
      }), { headers: corsHeaders });
    }

    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
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
      if (!contentText) {
        return new Response(JSON.stringify({ error: '리뷰 내용을 입력해 주세요.' }), { status: 400, headers: corsHeaders });
      }
      const revId = newId('rev');
      // The buyer must choose the rating; nothing is filled in on their behalf.
      const ratingVal = Number(b.rating);
      if (!Number.isInteger(ratingVal) || ratingVal < 1 || ratingVal > 5) {
        return new Response(JSON.stringify({ success: false, code: 'INVALID_RATING', error: '별점(1~5)을 선택해 주세요.' }), { status: 400, headers: corsHeaders });
      }
      await env.DB.prepare(
        `INSERT INTO product_reviews (id, product_id, order_id, user_id, reviewer_name, author_name, sku_option_summary, rating, content, images_json, is_verified_purchase, user_height_cm, user_weight_kg, fit_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).bind(
        revId, prodId, purchase.order_id, customerId, maskedName, maskedName, purchase.option_summary, ratingVal,
        str(contentText, { max: 3000, field: '리뷰' }), JSON.stringify(Array.isArray(b.images) ? b.images.slice(0, 10).map(String) : []),
        b.user_height_cm ? Math.round(Number(b.user_height_cm)) || null : null, b.user_weight_kg ? Math.round(Number(b.user_weight_kg)) || null : null,
        ['TRUE_TO_SIZE', 'RUNS_SMALL', 'RUNS_LARGE'].includes(b.fit_type) ? b.fit_type : null
      ).run();

      const created = { id: revId, review_id: revId, product_id: prodId, rating: ratingVal, comment: contentText, content: contentText, is_verified_purchase: 1 };
      return new Response(JSON.stringify({ success: true, review_id: revId, data: created, message: '구매 리뷰가 등록되었습니다.' }), { status: 201, headers: corsHeaders });
    }
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
      const b = await request.json().catch(() => ({}));
      const customerId = (await requireCustomer(request, env)).userId;
      if (!b.question || !b.question.trim()) {
        return new Response(JSON.stringify({ error: '문의 내용을 입력해 주세요.' }), { status: 400, headers: corsHeaders });
      }
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

  // 6. Coupons & Claim Coupon
  if (url.pathname === '/api/v1/coupons' && request.method === 'GET') {
    const me = await authenticate(request, env);
    const { results: coupons } = await env.DB.prepare("SELECT * FROM coupons WHERE is_active = 1 AND expires_at > ?").bind(sqlNow()).all();
    const userCoupons = me ? (await env.DB.prepare("SELECT id AS user_coupon_id, coupon_id, is_used FROM user_coupons WHERE user_id = ?").bind(me.userId).all()).results : [];
    const claimedMap = {};
    for (const uc of userCoupons) claimedMap[uc.coupon_id] = uc;

    return new Response(JSON.stringify({
      success: true,
      count: coupons.length,
      data: coupons.map(c => ({
        ...c,
        name: c.title || c.code,
        valid_until: c.expires_at,
        claimed_status: claimedMap[c.id] ? (claimedMap[c.id].is_used ? 'USED' : 'CLAIMED') : null,
        is_claimed: !!claimedMap[c.id],
        user_coupon_id: claimedMap[c.id] ? claimedMap[c.id].user_coupon_id : null,
        is_used: claimedMap[c.id] ? !!claimedMap[c.id].is_used : false
      }))
    }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/coupons/claim' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const customerId = (await requireCustomer(request, env)).userId;
    const codeOrId = (b.coupon_id || b.code || '').trim();
    const coupon = codeOrId ? await env.DB.prepare('SELECT * FROM coupons WHERE (id = ? OR UPPER(code) = UPPER(?)) AND is_active = 1 AND expires_at > ?').bind(codeOrId, codeOrId, sqlNow()).first() : null;
    if (!coupon) {
      return new Response(JSON.stringify({ error: '유효하지 않은 쿠폰 코드입니다.' }), { status: 404, headers: corsHeaders });
    }
    await env.DB.prepare('INSERT OR IGNORE INTO user_coupons (id, user_id, coupon_id, is_used) VALUES (?, ?, ?, 0)').bind(newId('uc'), customerId, coupon.id).run();
    return new Response(JSON.stringify({ success: true, coupon, data: coupon, message: '쿠폰이 쿠폰함에 발급되었습니다.' }), { headers: corsHeaders });
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
      const b = await request.json().catch(() => ({}));
      const prodId = b.product_id;
      const cid = customerId;
      if (!prodId) return new Response(JSON.stringify({ error: 'product_id required' }), { status: 400, headers: corsHeaders });
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

  // 9. Support FAQ & 1:1 Customer Inquiries
  if (url.pathname === '/api/v1/support/faq' && request.method === 'GET') {
    const faqs = [
      { category: '배송', q: '배송비와 배송 기간은 어떻게 되나요?', a: '배송비와 무료배송 기준은 판매자(직영/입점)별로 다르며 주문서에서 판매자별로 확인할 수 있습니다. 배송 예정일을 넘긴 경우 주문 상세에서 지연 보상을 신청할 수 있습니다.' },
      { category: '판매가 인하 보상', q: '구매 후 가격이 내리면 보상받을 수 있나요?', a: '결제 후 30일 이내 올모아 판매가가 인하된 경우 주문 상세에서 1회 신청할 수 있으며, 실제 인하 차액이 적립금으로 지급됩니다.' },
      { category: '반품/환불', q: '반품은 어떻게 하나요?', a: '상품 수령 후 7일 이내 주문 상세에서 반품을 신청할 수 있습니다. 판매자가 회수·확인하면 결제 금액은 원결제수단으로, 사용한 적립금은 적립금으로 환불됩니다. 단순 변심 반품은 반품 배송비가 부과될 수 있습니다.' },
      { category: '결제', q: '결제 대금은 언제 판매자에게 지급되나요?', a: '입점 판매자의 판매대금은 구매확정(또는 배송완료 후 7일 자동 확정) 이후 정산되며, 정산 후 환불이 발생하면 다음 정산에서 차감됩니다.' },
      { category: '파트너입점', q: '올모아 글로벌 셀러로 입점하려면 어떻게 해야 하나요?', a: '상단 [셀러 입점] 메뉴를 통해 사업자등록증 및 정산 계좌를 제출하시면 운영 관리자 심사(평균 24시간 이내) 완료 즉시 전용 파트너 센터에서 상품 등록 및 대량 CSV 업로드가 가능합니다.' }
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
      const b = await request.json().catch(() => ({}));
      const msgText = (b.content || b.message || '').trim();
      if (!b.subject || !msgText) {
        return new Response(JSON.stringify({ error: '문의 제목과 내용을 모두 입력해 주세요.' }), { status: 400, headers: corsHeaders });
      }
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
      const b = await request.json().catch(() => ({}));
      const recipientName = (b.recipient_name || b.name || '').trim();
      const phone = (b.phone || '').trim();
      const postalCode = (b.postal_code || b.zip || '00000').trim();
      const addressLine1 = (b.address_line1 || b.address || '').trim();
      const addressLine2 = (b.address_line2 || b.detail_address || '').trim();
      const isDefault = b.is_default ? 1 : 0;
      const note = (b.delivery_note || b.note || '').trim();

      if (!recipientName || !phone || !addressLine1) {
        return new Response(JSON.stringify({ error: '수령인, 연락처, 주소는 필수 입력 항목입니다.' }), { status: 400, headers: corsHeaders });
      }

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
      if (!exists) {
        return new Response(JSON.stringify({ error: 'Address not found or unauthorized' }), { status: 404, headers: corsHeaders });
      }
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
      if (!exists) {
        return new Response(JSON.stringify({ error: 'Address not found or unauthorized' }), { status: 404, headers: corsHeaders });
      }
      await env.DB.prepare('DELETE FROM user_addresses WHERE id = ? AND user_id = ?').bind(addrId, customerId).run();
      return new Response(JSON.stringify({ success: true, message: '배송지가 삭제되었습니다.' }), { headers: corsHeaders });
    }
  }

  // 12. Customer Notifications & Alerts
  if (url.pathname === '/api/v1/notifications') {
    const customerId = (await requireCustomer(request, env)).userId;
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
      ).bind(customerId).all();
      const unreadCount = results.filter(n => Number(n.is_read) === 0).length;
      return new Response(JSON.stringify({ success: true, unread_count: unreadCount, count: results.length, data: results }), { headers: corsHeaders });
    }
  }

  // 12-1. External Real-time Dispatcher (SMS / Kakao AlimTalk / Email)
  if (url.pathname === '/api/v1/notifications/dispatch' && request.method === 'POST') {
    await requireAdmin(request, env);
    const body = await readJson(request);
    const channel = (body.channel || 'ALIMTALK').toUpperCase();
    const recipient = String(body.recipient || body.phone || body.email || '').trim();
    const templateCode = String(body.template_code || 'ORDER_NOTIFICATION').toUpperCase();
    const title = String(body.title || 'OLMOA 알림').trim();
    const content = String(body.content || body.message || '올모아 주문 알림입니다.').trim();

    if (!recipient) {
      return new Response(JSON.stringify({ error: 'recipient is required for dispatch' }), { status: 400, headers: corsHeaders });
    }

    const logId = newId('dlv');
    let provider = 'SOLAPI';
    let status = 'NOT_SENT_PROVIDER_NOT_CONFIGURED';
    let providerMsgId = null;

    // Real API integration if SOLAPI keys present
    if (env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET) {
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
              from: env.SOLAPI_SENDER_NUMBER || '15880000',
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
    }

    await env.DB.prepare(
      `INSERT INTO notification_delivery_logs (id, channel, recipient, template_code, title, content, status, provider, provider_msg_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(logId, channel, recipient, templateCode, title, content, status, provider, providerMsgId).run();

    return new Response(JSON.stringify({
      success: true,
      provider_configured: Boolean(env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET),
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
