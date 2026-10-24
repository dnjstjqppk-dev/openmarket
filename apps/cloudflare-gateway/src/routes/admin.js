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

  return null;
}
