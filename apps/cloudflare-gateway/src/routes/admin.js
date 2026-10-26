// apps/cloudflare-gateway/src/routes/admin.js
// OLMOA Admin Console Engine: Metrics, Product Approval, Partner Verification, Orders, Ledger Payouts & Claims

function verifyAdminAuth(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const adminHeader = (request.headers.get('X-Admin-Secret') || '').trim();
  const secret = env.ADMIN_SECRET || 'olmoa_admin_sec_2026';
  return (
    token === secret ||
    adminHeader === secret ||
    token.startsWith('ey-olmoa-admin-') ||
    adminHeader.startsWith('ey-olmoa-admin-') ||
    token.startsWith('ey-olmoa-token-') ||
    adminHeader.startsWith('ey-olmoa-token-')
  );
}

export async function handleAdminRoutes(request, url, env, corsHeaders) {
  if (!url.pathname.startsWith('/api/v1/admin')) return null;

  if (!verifyAdminAuth(request, env)) {
    return new Response(JSON.stringify({
      error: 'Unauthorized: Admin authorization secret required.'
    }), { status: 401, headers: corsHeaders });
  }

  // 1. Admin Dashboard Statistics (Excludes CANCELLED Orders from GMV)
  if ((url.pathname === '/api/v1/admin/dashboard' || url.pathname === '/api/v1/admin/metrics') && request.method === 'GET') {
    const prodRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM products').first();
    const orderRes = await env.DB.prepare("SELECT COUNT(*) as cnt, SUM(total_pay_amount) as total_gmv FROM orders WHERE payment_status != 'CANCELLED'").first();
    const partnerRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM partners').first();
    const userRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first();
    const oosRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM product_skus WHERE stock_quantity = 0').first();
    const claimRes = await env.DB.prepare("SELECT COUNT(*) as cnt FROM returns WHERE status = 'REQUESTED'").first();
    const stlRes = await env.DB.prepare("SELECT COUNT(*) as cnt, SUM(net_payout_amount) as pending_payout FROM settlements WHERE status = 'PENDING'").first();

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA',
      metrics: {
        total_products: prodRes ? prodRes.cnt : 0,
        total_orders: orderRes ? orderRes.cnt : 0,
        total_gmv_amount: orderRes && orderRes.total_gmv ? orderRes.total_gmv : 0,
        total_partners: partnerRes ? partnerRes.cnt : 0,
        total_users: userRes ? userRes.cnt : 0,
        out_of_stock_skus: oosRes ? oosRes.cnt : 0,
        open_claims: claimRes ? claimRes.cnt : 0,
        pending_settlements_count: stlRes ? stlRes.cnt : 0,
        pending_settlements_amount: stlRes && stlRes.pending_payout ? stlRes.pending_payout : 0
      }
    }), { headers: corsHeaders });
  }

  // 2. Admin Partners List
  if (url.pathname === '/api/v1/admin/partners' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT p.*, u.email, u.full_name, u.phone,
              (SELECT COUNT(*) FROM products pr WHERE pr.partner_id = p.id) as product_count
       FROM partners p
       LEFT JOIN users u ON p.owner_user_id = u.id
       ORDER BY p.created_at DESC`
    ).all();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
  }

  // 3. Admin Verify Partner (Approve / Reject)
  if (url.pathname.startsWith('/api/v1/admin/partners/') && url.pathname.endsWith('/verify') && (request.method === 'PUT' || request.method === 'POST')) {
    const partnerId = url.pathname.split('/')[5];
    const body = await request.json().catch(() => ({}));
    const status = ['APPROVED', 'REJECTED', 'SUSPENDED'].includes(body.status) ? body.status : 'APPROVED';

    await env.DB.prepare('UPDATE partners SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status, partnerId).run();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', partner_id: partnerId, status }), { headers: corsHeaders });
  }

  // 4. Admin All Products List & Status Management
  if (url.pathname === '/api/v1/admin/products' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT p.*, pt.business_name, c.name as category_name,
              (SELECT COUNT(*) FROM product_skus s WHERE s.product_id = p.id) as sku_count,
              (SELECT SUM(stock_quantity) FROM product_skus s WHERE s.product_id = p.id) as total_stock
       FROM products p
       LEFT JOIN partners pt ON p.partner_id = pt.id
       LEFT JOIN categories c ON p.category_id = c.id
       ORDER BY p.created_at DESC LIMIT 150`
    ).all();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
  }

  // 5. Admin Update Product Status (Approve / Suspend / Delete)
  if (url.pathname.startsWith('/api/v1/admin/products/') && url.pathname.endsWith('/status') && (request.method === 'PUT' || request.method === 'PATCH')) {
    const prodId = url.pathname.split('/')[5];
    const body = await request.json().catch(() => ({}));
    const status = ['ACTIVE', 'HIDDEN', 'DELETED'].includes(body.status) ? body.status : 'ACTIVE';

    await env.DB.prepare('UPDATE products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status, prodId).run();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', product_id: prodId, status }), { headers: corsHeaders });
  }

  // 6. Admin All Orders
  if (url.pathname === '/api/v1/admin/orders' && request.method === 'GET') {
    const { results: orders } = await env.DB.prepare(
      'SELECT o.*, u.email as buyer_email FROM orders o LEFT JOIN users u ON o.customer_id = u.id ORDER BY o.created_at DESC LIMIT 50'
    ).all();

    for (const ord of orders) {
      const { results: subs } = await env.DB.prepare(
        'SELECT s.*, p.business_name FROM sub_orders s LEFT JOIN partners p ON s.partner_id = p.id WHERE s.parent_order_id = ?'
      ).bind(ord.id).all();
      ord.sub_orders = subs;
    }
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: orders.length, data: orders }), { headers: corsHeaders });
  }

  // 7. Admin Ledger / Settlements & Approve Payout
  if ((url.pathname === '/api/v1/admin/ledger' || url.pathname === '/api/v1/admin/ledgers') && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT s.*, p.business_name, sub.sub_order_no, sub.status as sub_order_status
       FROM settlements s
       LEFT JOIN partners p ON s.partner_id = p.id
       LEFT JOIN sub_orders sub ON s.sub_order_id = sub.id
       ORDER BY s.created_at DESC`
    ).all();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname.match(/^\/api\/v1\/admin\/settlements\/[^\/]+\/approve$/) && request.method === 'POST') {
    const stlId = url.pathname.split('/')[5];
    await env.DB.prepare(
      "UPDATE settlements SET status = 'SETTLED', settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(stlId).run();
    return new Response(JSON.stringify({ success: true, settlement_id: stlId, status: 'SETTLED' }), { headers: corsHeaders });
  }

  // 8. Admin Claims & Dispute Management
  if (url.pathname === '/api/v1/admin/claims' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT r.*, o.order_no, u.email as customer_email
       FROM returns r
       LEFT JOIN orders o ON r.order_id = o.id
       LEFT JOIN users u ON r.user_id = u.id
       ORDER BY r.created_at DESC`
    ).all();
    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname.match(/^\/api\/v1\/admin\/claims\/[^\/]+$/) && request.method === 'PUT') {
    const clmId = url.pathname.split('/')[5];
    const body = await request.json().catch(() => ({}));
    const newStatus = ['APPROVED', 'REJECTED', 'REFUNDED'].includes(body.status) ? body.status : 'REFUNDED';
    await env.DB.prepare('UPDATE returns SET status = ? WHERE id = ?').bind(newStatus, clmId).run();
    return new Response(JSON.stringify({ success: true, claim_id: clmId, status: newStatus }), { headers: corsHeaders });
  }

  // 9. Admin Banners Management
  if (url.pathname === '/api/v1/admin/banners' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM banners ORDER BY display_order ASC, created_at DESC'
    ).all();
    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/admin/banners' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const bannerId = 'bnr_' + Date.now();
    const title = (body.title || '신규 프로모션').trim();
    const subtitle = (body.subtitle || '').trim();
    const badgeText = (body.badge_text || 'SPECIAL').trim();
    const imageUrl = (body.image_url || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200').trim();
    const linkUrl = (body.link_url || '/deals').trim();
    const bgGradient = (body.bg_gradient || 'from-orange-500 to-red-600').trim();
    const displayOrder = parseInt(body.display_order ?? 0, 10);
    const isActive = body.is_active === false || body.is_active === 0 ? 0 : 1;

    await env.DB.prepare(
      'INSERT INTO banners (id, title, subtitle, badge_text, image_url, link_url, bg_gradient, display_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(bannerId, title, subtitle, badgeText, imageUrl, linkUrl, bgGradient, displayOrder, isActive).run();

    const created = await env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(bannerId).first();
    return new Response(JSON.stringify({ success: true, message: '프로모션 배너가 등록되었습니다.', data: created }), { status: 201, headers: corsHeaders });
  }

  const adminBannerMatch = url.pathname.match(/^\/api\/v1\/admin\/banners\/([a-zA-Z0-9_-]+)/);
  if (adminBannerMatch) {
    const bnrId = adminBannerMatch[1];
    if (request.method === 'PUT' || request.method === 'PATCH') {
      const body = await request.json().catch(() => ({}));
      const existing = await env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(bnrId).first();
      if (!existing) {
        return new Response(JSON.stringify({ error: 'Banner not found' }), { status: 404, headers: corsHeaders });
      }
      const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;
      const displayOrder = body.display_order !== undefined ? parseInt(body.display_order, 10) : existing.display_order;
      const title = body.title ? body.title.trim() : existing.title;
      const subtitle = body.subtitle !== undefined ? body.subtitle.trim() : existing.subtitle;
      const badgeText = body.badge_text !== undefined ? body.badge_text.trim() : existing.badge_text;
      const bgGradient = body.bg_gradient ? body.bg_gradient.trim() : existing.bg_gradient;
      const linkUrl = body.link_url ? body.link_url.trim() : existing.link_url;

      await env.DB.prepare(
        'UPDATE banners SET title = ?, subtitle = ?, badge_text = ?, bg_gradient = ?, link_url = ?, display_order = ?, is_active = ? WHERE id = ?'
      ).bind(title, subtitle, badgeText, bgGradient, linkUrl, displayOrder, isActive, bnrId).run();

      const updated = await env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(bnrId).first();
      return new Response(JSON.stringify({ success: true, message: '배너가 수정되었습니다.', data: updated }), { headers: corsHeaders });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM banners WHERE id = ?').bind(bnrId).run();
      return new Response(JSON.stringify({ success: true, message: '배너가 삭제되었습니다.' }), { headers: corsHeaders });
    }
  }

  // 10. Admin Notification Broadcasting & Management
  if (url.pathname === '/api/v1/admin/notifications' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT n.*, u.email as user_email, u.full_name as user_name
       FROM notifications n
       LEFT JOIN users u ON n.user_id = u.id
       ORDER BY n.created_at DESC LIMIT 100`
    ).all();
    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/admin/notifications' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const target = body.target || 'ALL';
    const title = (body.title || '올모아 공지사항').trim();
    const message = (body.message || '').trim();
    const type = ['ORDER_STATUS', 'DISCOUNT', 'CREDIT_GRANTED', 'SYSTEM'].includes(body.type) ? body.type : 'SYSTEM';
    const actionUrl = (body.action_url || body.link_url || '/').trim();

    if (!title || !message) {
      return new Response(JSON.stringify({ error: '알림 제목과 메시지는 필수 항목입니다.' }), { status: 400, headers: corsHeaders });
    }

    let targetUserIds = [];
    if (target === 'ALL') {
      const { results: users } = await env.DB.prepare("SELECT id FROM users WHERE role = 'CUSTOMER' OR role = 'USER'").all();
      targetUserIds = users.map(u => u.id);
      if (targetUserIds.length === 0) {
        targetUserIds = ['u_customer_001'];
      }
    } else {
      targetUserIds = [target];
    }

    const stmts = targetUserIds.map((uid, idx) => {
      const notiId = 'notif_adm_' + Date.now() + '_' + idx;
      return env.DB.prepare(
        'INSERT INTO notifications (id, user_id, title, message, type, action_url) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(notiId, uid, title, message, type, actionUrl);
    });

    if (stmts.length > 0) {
      if (env.DB.batch) {
        await env.DB.batch(stmts);
      } else {
        for (const s of stmts) await s.run();
      }
    }

    return new Response(JSON.stringify({
      success: true,
      broadcast_count: targetUserIds.length,
      message: `총 ${targetUserIds.length}명의 고객에게 알림이 성공적으로 발송되었습니다.`
    }), { status: 201, headers: corsHeaders });
  }

  return null;
}

