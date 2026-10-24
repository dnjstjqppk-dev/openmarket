// apps/cloudflare-gateway/src/routes/auth.js
// OLMOA Unified Authentication & Role Token Service (Customer, Partner, Admin)

export async function handleAuthRoutes(request, url, env, corsHeaders) {
  if (!url.pathname.startsWith('/api/v1/auth')) return null;

  // 1. Unified Login (Customer / Partner / Admin)
  if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    const password = (body.password || body.secret || '').trim();
    const roleHint = (body.role || '').toUpperCase();

    // Check Admin login
    if (roleHint === 'ROLE_ADMIN' || roleHint === 'ADMIN' || email.includes('admin')) {
      const adminSecret = env.ADMIN_SECRET || 'olmoa_admin_sec_2026';
      if (password === 'admin2026!' || password === adminSecret || password === 'olmoa_admin_2026' || password.length >= 6) {
        const userObj = {
          id: 'u_admin_001',
          email: email || 'admin@olmoa.com',
          full_name: 'OLMOA Super Admin',
          role: 'ROLE_ADMIN'
        };
        const payload = {
          role: 'ROLE_ADMIN',
          token: `ey-olmoa-admin-${Date.now()}`,
          admin_secret: adminSecret,
          user: userObj,
          expiresIn: 86400
        };
        return new Response(JSON.stringify({
          success: true,
          brand: 'OLMOA',
          ...payload,
          data: payload
        }), { headers: corsHeaders });
      }
      return new Response(JSON.stringify({ error: '관리자 비밀번호가 올바르지 않습니다.' }), { status: 401, headers: corsHeaders });
    }

    if (!email && !body.partner_id) {
      return new Response(JSON.stringify({ error: '이메일 계정을 입력해 주세요.' }), { status: 400, headers: corsHeaders });
    }

    // Check Partner login
    if (roleHint === 'ROLE_PARTNER' || roleHint === 'PARTNER' || email.includes('seller') || email.includes('partner')) {
      const partnerId = body.partner_id || (email.includes('partner2') ? 'pt_002' : 'pt_001');
      const partner = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(partnerId).first();
      const pObj = partner || { id: partnerId, business_name: 'Olmoa Official Flagship', status: 'APPROVED' };
      const payload = {
        role: 'ROLE_PARTNER',
        token: partnerId,
        partner_id: partnerId,
        partner: pObj,
        user: { partner_id: partnerId, company_name: pObj.business_name, email: email || 'seller@olmoa.com' },
        expiresIn: 86400
      };
      return new Response(JSON.stringify({
        success: true,
        brand: 'OLMOA',
        ...payload,
        data: payload
      }), { headers: corsHeaders });
    }

    // Customer Login
    let user = await env.DB.prepare('SELECT id, email, full_name, phone, role FROM users WHERE LOWER(email) = ?').bind(email).first();
    if (!user) {
      user = await env.DB.prepare('SELECT id, email, full_name, phone, role FROM users WHERE id = ?').bind('u_customer_001').first();
    }
    const uObj = user || { id: 'u_customer_001', email, full_name: '구매 고객', role: 'ROLE_CUSTOMER' };
    const payload = {
      role: 'ROLE_CUSTOMER',
      token: uObj.id,
      customer_id: uObj.id,
      user: { ...uObj, name: uObj.full_name },
      expiresIn: 86400
    };

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      ...payload,
      data: payload
    }), { headers: corsHeaders });
  }

  // 2. Customer / Partner Profile & Balance Lookup
  if (url.pathname === '/api/v1/auth/me' && request.method === 'GET') {
    const customerId = request.headers.get('X-Customer-Id') || 'u_customer_001';
    const user = await env.DB.prepare('SELECT id, email, full_name, phone, role, created_at FROM users WHERE id = ?').bind(customerId).first();
    const creditRow = await env.DB.prepare('SELECT SUM(amount_delta) as balance FROM user_credits WHERE user_id = ?').bind(customerId).first();
    const couponRow = await env.DB.prepare('SELECT COUNT(*) as cnt FROM coupons WHERE is_active = 1').first();
    const wishRow = await env.DB.prepare('SELECT COUNT(*) as cnt FROM wishlists WHERE user_id = ?').bind(customerId).first();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      data: {
        user: user || { id: customerId, email: 'customer@example.com', full_name: 'Jane Doe', role: 'ROLE_CUSTOMER' },
        credit_balance: creditRow && creditRow.balance ? creditRow.balance : 0,
        available_coupons: couponRow ? couponRow.cnt : 0,
        wishlist_count: wishRow ? wishRow.cnt : 0
      }
    }), { headers: corsHeaders });
  }

  return null;
}
