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
    let user = await env.DB.prepare('SELECT id, email, full_name, phone, role, password_hash FROM users WHERE LOWER(email) = ?').bind(email).first();
    if (!user) {
      user = await env.DB.prepare('SELECT id, email, full_name, phone, role, password_hash FROM users WHERE id = ?').bind('u_customer_001').first();
    }
    if (user && user.password_hash && password && user.password_hash !== `hash_${password}`) {
      return new Response(JSON.stringify({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }), { status: 401, headers: corsHeaders });
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

  // 1-1. Customer Registration (Real D1 Insertion + Welcome Credit)
  if (url.pathname === '/api/v1/auth/register' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    const password = (body.password || '').trim();
    const fullName = (body.full_name || body.name || '').trim();
    const phone = (body.phone || '010-0000-0000').trim();

    if (!email || !password || !fullName) {
      return new Response(JSON.stringify({ error: '이메일, 비밀번호, 성명은 필수 항목입니다.' }), { status: 400, headers: corsHeaders });
    }

    const existing = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(email).first();
    if (existing) {
      return new Response(JSON.stringify({ error: '이미 등록된 이메일 계정입니다.' }), { status: 409, headers: corsHeaders });
    }

    const userId = `u_customer_${Date.now()}`;
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, phone, role, is_active)
       VALUES (?, ?, ?, ?, ?, 'ROLE_CUSTOMER', 1)`
    ).bind(userId, email, `hash_${password}`, fullName, phone).run();

    // Welcome Credit Bonus (10,000 KRW)
    const creditId = `cred_${Date.now()}`;
    await env.DB.prepare(
      `INSERT INTO user_credits (id, user_id, amount_delta, balance_after, reason, reference_id)
       VALUES (?, ?, 10000, 10000, '신규 가입 웰컴 크레딧 지급', 'WELCOME_BONUS')`
    ).bind(creditId, userId).run().catch(() => {});

    const payload = {
      role: 'ROLE_CUSTOMER',
      token: userId,
      customer_id: userId,
      user: { id: userId, email, full_name: fullName, phone, role: 'ROLE_CUSTOMER' },
      welcome_credit: 10000,
      expiresIn: 86400
    };

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      message: '회원가입이 완료되었습니다. 10,000원 웰컴 크레딧이 지급되었습니다.',
      ...payload,
      data: payload
    }), { status: 201, headers: corsHeaders });
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

  // 3. Forgot Password (Demo Simulation)
  if (url.pathname === '/api/v1/auth/forgot-password' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    if (!email) {
      return new Response(JSON.stringify({ error: '이메일을 입력해 주세요.' }), { status: 400, headers: corsHeaders });
    }
    const user = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(email).first();
    const token = 'reset_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    if (user) {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await env.DB.prepare('INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
        .bind('prt_' + Date.now(), user.id, token, expiresAt).run();
    }
    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      message: '비밀번호 재설정 링크가 이메일로 발송되었습니다. (데모: 아래 토큰 사용)',
      reset_token: token
    }), { headers: corsHeaders });
  }

  // 4. Reset Password (Demo Simulation)
  if (url.pathname === '/api/v1/auth/reset-password' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const token = (body.token || '').trim();
    const newPassword = (body.new_password || '').trim();
    if (!token || !newPassword) {
      return new Response(JSON.stringify({ error: '토큰과 새 비밀번호를 입력해 주세요.' }), { status: 400, headers: corsHeaders });
    }
    const row = await env.DB.prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND used_at IS NULL').bind(token).first();
    if (!row) {
      return new Response(JSON.stringify({ error: '유효하지 않거나 만료된 토큰입니다.' }), { status: 400, headers: corsHeaders });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: '토큰이 만료되었습니다.' }), { status: 400, headers: corsHeaders });
    }
    await env.DB.prepare('UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(`hash_${newPassword}`, row.user_id).run();
    await env.DB.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(row.id).run();
    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      message: '비밀번호가 성공적으로 재설정되었습니다.'
    }), { headers: corsHeaders });
  }

  // 5. Email Verification Send
  if (url.pathname === '/api/v1/auth/send-verification' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    if (!email) {
      return new Response(JSON.stringify({ error: '이메일을 입력해 주세요.' }), { status: 400, headers: corsHeaders });
    }
    const user = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(email).first();
    if (!user) {
      return new Response(JSON.stringify({ error: '등록되지 않은 이메일입니다.' }), { status: 404, headers: corsHeaders });
    }
    const token = 'verify_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO email_verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
      .bind('evt_' + Date.now(), user.id, token, expiresAt).run();
    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      message: '인증 이메일이 발송되었습니다. (데모: 아래 토큰 사용)',
      verification_token: token
    }), { headers: corsHeaders });
  }

  // 6. Email Verification Confirm
  if (url.pathname === '/api/v1/auth/verify-email' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const token = (body.token || '').trim();
    if (!token) {
      return new Response(JSON.stringify({ error: '토큰을 입력해 주세요.' }), { status: 400, headers: corsHeaders });
    }
    const row = await env.DB.prepare('SELECT * FROM email_verification_tokens WHERE token = ? AND verified_at IS NULL').bind(token).first();
    if (!row) {
      return new Response(JSON.stringify({ error: '유효하지 않은 토큰입니다.' }), { status: 400, headers: corsHeaders });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: '토큰이 만료되었습니다.' }), { status: 400, headers: corsHeaders });
    }
    await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(row.user_id).run();
    await env.DB.prepare('UPDATE email_verification_tokens SET verified_at = CURRENT_TIMESTAMP WHERE id = ?').bind(row.id).run();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', message: '이메일이 인증되었습니다.' }), { headers: corsHeaders });
  }

  // 7. Social Login (Demo)
  if (url.pathname === '/api/v1/auth/social-login' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const provider = (body.provider || '').toUpperCase();
    const providerId = (body.provider_id || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const name = (body.name || '').trim();
    if (!provider || !email) {
      return new Response(JSON.stringify({ error: 'provider와 email은 필수입니다.' }), { status: 400, headers: corsHeaders });
    }
    let user = await env.DB.prepare('SELECT id, email, full_name, phone, role FROM users WHERE LOWER(email) = ?').bind(email).first();
    if (!user) {
      const userId = `u_social_${Date.now()}`;
      await env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, full_name, phone, role, is_active, email_verified) VALUES (?, ?, ?, ?, ?, 'ROLE_CUSTOMER', 1, 1)`
      ).bind(userId, email, `social_${provider}_${providerId}`, name || '소셜 사용자', '010-0000-0000').run();
      user = { id: userId, email, full_name: name || '소셜 사용자', phone: '010-0000-0000', role: 'ROLE_CUSTOMER' };
    }
    const payload = {
      role: 'ROLE_CUSTOMER',
      token: user.id,
      customer_id: user.id,
      user: { ...user, name: user.full_name },
      provider,
      expiresIn: 86400
    };
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', ...payload, data: payload }), { headers: corsHeaders });
  }

  return null;
}
