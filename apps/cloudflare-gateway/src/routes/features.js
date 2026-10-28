// apps/cloudflare-gateway/src/routes/features.js
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
      ).bind(`kw_${Date.now()}`, kw, kw.toLowerCase()).run();
    }
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  }

  // 3. Lightning Deals Campaigns
  if (url.pathname === '/api/v1/campaigns/lightning' && request.method === 'GET') {
    const campaign = await env.DB.prepare(
      "SELECT * FROM flash_sale_campaigns WHERE status = 'ACTIVE' LIMIT 1"
    ).first() || { id: 'fls_today', title: '⚡ OLMOA 오늘의 번개특가 한정 수량 대방출', ends_at: new Date(Date.now() + 36000000).toISOString() };

    const { results: items } = await env.DB.prepare(
      `SELECT f.*, p.id as slug, p.title, p.thumbnail_url, p.lowest_original_price, p.lowest_sale_price, p.partner_id,
              COALESCE(pt.business_name, 'OLMOA DIRECT') as brand,
              pt.business_name, s.option_combination_json, s.stock_quantity as sku_stock
       FROM flash_sale_items f
       JOIN products p ON f.product_id = p.id
       LEFT JOIN partners pt ON p.partner_id = pt.id
       LEFT JOIN product_skus s ON f.sku_id = s.id
       ORDER BY f.sort_order ASC`
    ).all();

    const mappedDeals = items.map(it => ({
      ...it,
      deal_price: it.flash_price || it.lowest_sale_price,
      sold_quantity: it.sold_stock || 40,
      discount_rate: it.lowest_original_price > (it.flash_price || it.lowest_sale_price)
        ? Math.round(((it.lowest_original_price - (it.flash_price || it.lowest_sale_price)) / it.lowest_original_price) * 100)
        : 30,
      sold_percent: Math.min(100, Math.round(((it.sold_stock || 0) / (it.allocated_stock || 1)) * 100)),
      remaining_stock: Math.max(0, (it.allocated_stock || 0) - (it.sold_stock || 0))
    }));

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA',
      campaign,
      items: mappedDeals,
      data: { campaign, deals: mappedDeals, items: mappedDeals }
    }), { headers: corsHeaders });
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

      const avgVal = avgRow && avgRow.avg_rating ? parseFloat(avgRow.avg_rating.toFixed(1)) : 4.8;
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
      const customerId = request.headers.get('X-Customer-Id') || b.customer_id || b.user_id || 'u_customer_001';
      const contentText = (b.content || b.comment || '').trim();
      if (!contentText) {
        return new Response(JSON.stringify({ error: '리뷰 내용을 입력해 주세요.' }), { status: 400, headers: corsHeaders });
      }
      const revId = `rev_${Date.now()}`;
      const ratingVal = Math.max(1, Math.min(5, Number(b.rating) || 5));
      await env.DB.prepare(
        `INSERT INTO product_reviews (id, product_id, user_id, reviewer_name, sku_option_summary, rating, content, images_json, is_verified_purchase)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        revId, prodId, customerId, (b.reviewer_name || b.customer_name || '인증 구매자').trim(),
        b.sku_option_summary || '기본 옵션', ratingVal,
        contentText, JSON.stringify(Array.isArray(b.images) ? b.images : [])
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
      return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
    }
    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const customerId = request.headers.get('X-Customer-Id') || b.customer_id || b.user_id || 'u_customer_001';
      if (!b.question || !b.question.trim()) {
        return new Response(JSON.stringify({ error: '문의 내용을 입력해 주세요.' }), { status: 400, headers: corsHeaders });
      }
      const prod = await env.DB.prepare('SELECT partner_id FROM products WHERE id = ?').bind(prodId).first();
      const qnaId = `qna_${Date.now()}`;
      await env.DB.prepare(
        `INSERT INTO product_qna (id, product_id, partner_id, user_id, questioner_name, question, is_secret, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING')`
      ).bind(
        qnaId, prodId, prod ? prod.partner_id : 'pt_001', customerId,
        (b.questioner_name || b.customer_name || '고객').trim(), b.question.trim(), b.is_secret ? 1 : 0
      ).run();
      const created = { id: qnaId, qna_id: qnaId, product_id: prodId, question: b.question.trim(), status: 'WAITING' };
      return new Response(JSON.stringify({ success: true, qna_id: qnaId, data: created, message: '상품 문의가 등록되었습니다.' }), { status: 201, headers: corsHeaders });
    }
  }

  // 6. Coupons & Claim Coupon
  if (url.pathname === '/api/v1/coupons' && request.method === 'GET') {
    const customerId = request.headers.get('X-Customer-Id') || url.searchParams.get('customer_id') || 'u_customer_001';
    const { results: coupons } = await env.DB.prepare("SELECT * FROM coupons WHERE is_active = 1").all();
    const { results: userCoupons } = await env.DB.prepare("SELECT coupon_id, is_used FROM user_coupons WHERE user_id = ?").bind(customerId).all();
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
        is_used: claimedMap[c.id] ? !!claimedMap[c.id].is_used : false
      }))
    }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/coupons/claim' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const customerId = request.headers.get('X-Customer-Id') || b.customer_id || 'u_customer_001';
    const codeOrId = (b.coupon_id || b.code || '').trim();
    let coupon = await env.DB.prepare('SELECT * FROM coupons WHERE id = ? OR UPPER(code) = UPPER(?)').bind(codeOrId, codeOrId).first();
    if (!coupon) {
      coupon = await env.DB.prepare('SELECT * FROM coupons WHERE is_active = 1 LIMIT 1').first();
    }
    if (!coupon) {
      return new Response(JSON.stringify({ error: '유효하지 않은 쿠폰 코드입니다.' }), { status: 404, headers: corsHeaders });
    }
    const existing = await env.DB.prepare('SELECT id FROM user_coupons WHERE user_id = ? AND coupon_id = ?').bind(customerId, coupon.id).first();
    if (!existing) {
      await env.DB.prepare('INSERT INTO user_coupons (id, user_id, coupon_id, is_used) VALUES (?, ?, ?, 0)').bind(`uc_${Date.now()}`, customerId, coupon.id).run();
    }
    return new Response(JSON.stringify({ success: true, coupon, data: coupon, message: '쿠폰이 쿠폰함에 발급되었습니다.' }), { headers: corsHeaders });
  }

  // 7. User Credits Balance & Ledger
  if (url.pathname === '/api/v1/credits' && request.method === 'GET') {
    const customerId = request.headers.get('X-Customer-Id') || url.searchParams.get('customer_id') || 'u_customer_001';
    const { results } = await env.DB.prepare('SELECT *, amount_delta as amount FROM user_credits WHERE user_id = ? ORDER BY created_at DESC').bind(customerId).all();
    const balanceRow = await env.DB.prepare('SELECT SUM(amount_delta) as total_balance FROM user_credits WHERE user_id = ?').bind(customerId).first();
    const balance = balanceRow && balanceRow.total_balance ? Math.max(0, balanceRow.total_balance) : 5000;
    return new Response(JSON.stringify({
      success: true,
      customer_id: customerId,
      balance,
      data: { balance, history: results }
    }), { headers: corsHeaders });
  }

  // 8. Customer Wishlist (GET / POST / DELETE /api/v1/wishlist)
  if (url.pathname === '/api/v1/wishlist') {
    const customerId = request.headers.get('X-Customer-Id') || url.searchParams.get('customer_id') || 'u_customer_001';
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
      const cid = b.customer_id || customerId;
      if (!prodId) return new Response(JSON.stringify({ error: 'product_id required' }), { status: 400, headers: corsHeaders });
      const existing = await env.DB.prepare('SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?').bind(cid, prodId).first();
      if (existing) {
        await env.DB.prepare('DELETE FROM wishlists WHERE id = ?').bind(existing.id).run();
        return new Response(JSON.stringify({ success: true, wished: false, action: 'REMOVED', product_id: prodId }), { headers: corsHeaders });
      } else {
        await env.DB.prepare('INSERT INTO wishlists (id, user_id, product_id) VALUES (?, ?, ?)').bind(`wsh_${Date.now()}`, cid, prodId).run();
        return new Response(JSON.stringify({ success: true, wished: true, action: 'ADDED', product_id: prodId }), { status: 200, headers: corsHeaders });
      }
    }
  }

  // 9. Support FAQ & 1:1 Customer Inquiries
  if (url.pathname === '/api/v1/support/faq' && request.method === 'GET') {
    const faqs = [
      { category: '배송', q: '배송 기간과 배송비 정책은 어떻게 되나요?', a: 'OLMOA 입점 파트너사별로 30,000원 이상 구매 시 100% 무료 직배송되며, 결제 완료 후 영업일 기준 평균 2~4일 이내 안전하게 도착합니다.' },
      { category: '최저가보상', q: '30일 최저가 차액 보상제는 어떻게 신청하나요?', a: '결제 후 30일 이내 동일 상품의 올모아 판매가가 인하된 경우 [주문·배송 조회 > 주문 상세 > 30일 최저가 차액 보상 신청]을 클릭하시면 차액 전액이 올모아 적립금(크레딧)으로 즉시 자동 지급됩니다.' },
      { category: '반품/환불', q: '90일 무료 반품 정책이 궁금합니다.', a: '배송 완료일로부터 90일 이내 단순 변심을 포함하여 모든 주문 건의 첫 회 반품 배송비가 무료이며, 수거 확인 즉시 에스크로 결제 대금 100%가 전액 환불됩니다.' },
      { category: '결제/에스크로', q: '올모아 에스크로 구매자 보호란 무엇인가요?', a: '고객님이 결제하신 대금은 판매자에게 즉시 넘어가지 않고 OLMOA 에스크로 신탁 원장에 안전하게 보관되며, 고객님이 상품을 정상 수령하고 구매확정한 이후에만 파트너에게 정산됩니다.' },
      { category: '파트너입점', q: '올모아 글로벌 셀러로 입점하려면 어떻게 해야 하나요?', a: '상단 [셀러 입점] 메뉴를 통해 사업자등록증 및 정산 계좌를 제출하시면 운영 관리자 심사(평균 24시간 이내) 완료 즉시 전용 파트너 센터에서 상품 등록 및 대량 CSV 업로드가 가능합니다.' }
    ];
    return new Response(JSON.stringify({ success: true, data: faqs }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/support/inquiries') {
    const customerId = request.headers.get('X-Customer-Id') || url.searchParams.get('customer_id') || 'u_customer_001';
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
      const inqId = `inq_${Date.now()}`;
      const cat = ['DELIVERY', 'REFUND_RETURN', 'PRICE_MATCH', 'PAYMENT', 'PARTNER_JOIN', 'OTHER'].includes(b.category) ? b.category : 'OTHER';
      await env.DB.prepare(
        `INSERT INTO support_inquiries (id, user_id, order_id, category, subject, content, status)
         VALUES (?, ?, ?, ?, ?, ?, 'OPEN')`
      ).bind(inqId, b.customer_id || customerId, b.order_id || null, cat, b.subject.trim(), msgText).run();
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
    const customerId = request.headers.get('X-Customer-Id') || url.searchParams.get('customer_id') || 'u_customer_001';
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

      const addrId = 'addr_' + Date.now();
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
    const customerId = request.headers.get('X-Customer-Id') || 'u_customer_001';
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
    const customerId = request.headers.get('X-Customer-Id') || url.searchParams.get('customer_id') || 'u_customer_001';
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
      ).bind(customerId).all();
      const unreadCount = results.filter(n => Number(n.is_read) === 0).length;
      return new Response(JSON.stringify({ success: true, unread_count: unreadCount, count: results.length, data: results }), { headers: corsHeaders });
    }
  }

  if (url.pathname === '/api/v1/notifications/read-all' && (request.method === 'PUT' || request.method === 'POST')) {
    const customerId = request.headers.get('X-Customer-Id') || 'u_customer_001';
    await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(customerId).run();
    return new Response(JSON.stringify({ success: true, message: '모든 알림을 읽음 처리했습니다.' }), { headers: corsHeaders });
  }

  const notiMatch = url.pathname.match(/^\/api\/v1\/notifications\/([a-zA-Z0-9_-]+)\/read$/);
  if (notiMatch && (request.method === 'PUT' || request.method === 'POST')) {
    const notiId = notiMatch[1];
    const customerId = request.headers.get('X-Customer-Id') || 'u_customer_001';
    await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').bind(notiId, customerId).run();
    return new Response(JSON.stringify({ success: true, message: '알림을 읽음 처리했습니다.' }), { headers: corsHeaders });
  }

  return null;
}
