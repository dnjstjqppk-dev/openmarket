// apps/cloudflare-gateway/src/routes/admin.js
// OLMOA Admin Console Engine: Metrics, Partner Verification & Audit

export async function handleAdminRoutes(request, url, env, corsHeaders) {
  // 1. Admin Dashboard Statistics
  if (url.pathname === '/api/v1/admin/dashboard' && request.method === 'GET') {
    const prodRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM products').first();
    const orderRes = await env.DB.prepare('SELECT COUNT(*) as cnt, SUM(total_pay_amount) as total_gmv FROM orders').first();
    const partnerRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM partners').first();
    const userRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      metrics: {
        total_products: prodRes ? prodRes.cnt : 0,
        total_orders: orderRes ? orderRes.cnt : 0,
        total_gmv_amount: orderRes && orderRes.total_gmv ? orderRes.total_gmv : 0,
        total_partners: partnerRes ? partnerRes.cnt : 0,
        total_users: userRes ? userRes.cnt : 0
      }
    }), { headers: corsHeaders });
  }

  // 2. Admin Partners List
  if (url.pathname === '/api/v1/admin/partners' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT p.*, u.email, u.full_name, u.phone 
       FROM partners p 
       LEFT JOIN users u ON p.owner_user_id = u.id 
       ORDER BY p.created_at DESC`
    ).all();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      count: results.length,
      data: results
    }), { headers: corsHeaders });
  }

  // 3. Admin Verify Partner (Approve / Reject)
  if (url.pathname.startsWith('/api/v1/admin/partners/') && url.pathname.endsWith('/verify') && (request.method === 'PUT' || request.method === 'POST')) {
    const partnerId = url.pathname.split('/')[5];
    const body = await request.json();
    const status = body.status === 'REJECTED' ? 'REJECTED' : 'APPROVED';

    await env.DB.prepare(
      'UPDATE partners SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(status, partnerId).run();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      partner_id: partnerId,
      status: status,
      message: `Partner has been ${status}`
    }), { headers: corsHeaders });
  }

  // 4. Admin All Orders
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

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      count: orders.length,
      data: orders
    }), { headers: corsHeaders });
  }

  // 5. Admin Ledger / Settlements
  if (url.pathname === '/api/v1/admin/ledger' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT s.*, p.business_name FROM settlements s LEFT JOIN partners p ON s.partner_id = p.id ORDER BY s.created_at DESC'
    ).all();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      count: results.length,
      data: results
    }), { headers: corsHeaders });
  }

  return null;
}
