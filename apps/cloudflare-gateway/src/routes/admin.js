// apps/cloudflare-gateway/src/routes/admin.js
// Operator console API. Requires an authenticated ROLE_ADMIN user; every mutation writes admin_audit_log.

import { requireAdmin } from '../lib/auth.js';
import { hasPermission } from '../lib/admin-policy.js';
import { readJson, json, bad, conflict, forbidden, notFound, str } from '../lib/http.js';
import { hashPassword } from '../utils/crypto-auth.js';
import { validatePassword } from './auth.js';
import { newId } from '../lib/ids.js';
import { auditStatement } from '../lib/ledger.js';
import { refundOrder, loadOrderBundle } from '../services/orders.js';
import { logPiiView } from '../services/privacy.js';

export async function handleAdminRoutes(request, url, env, corsHeaders) {
  if (!url.pathname.startsWith('/api/v1/admin')) return null;
  const admin = await requireAdmin(request, env);
  const audit = (action, targetType, targetId, before, after) => auditStatement(env, admin, { action, targetType, targetId, before, after, request });

  // 1. Admin Dashboard Statistics (Excludes CANCELLED Orders from GMV)
  if ((url.pathname === '/api/v1/admin/dashboard' || url.pathname === '/api/v1/admin/metrics') && request.method === 'GET') {
    const prodRes = await env.DB.prepare("SELECT COUNT(*) as cnt FROM products WHERE status = 'ACTIVE'").first();
    const orderRes = await env.DB.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(total_goods_amount - volume_discount_amount + total_shipping_amount),0) as total_gmv FROM orders WHERE paid_at IS NOT NULL AND is_sandbox = 0").first();
    const partnerRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM partners').first();
    const userRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first();
    const oosRes = await env.DB.prepare('SELECT COUNT(*) as cnt FROM product_skus WHERE stock_quantity = 0').first();
    const claimRes = await env.DB.prepare("SELECT COUNT(*) as cnt FROM returns WHERE status = 'REQUESTED'").first();
    const stlRes = await env.DB.prepare("SELECT COUNT(*) as cnt, SUM(net_payout_amount) as pending_payout FROM settlements WHERE status IN ('PENDING','ELIGIBLE_FOR_PAYOUT')").first();

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

  // 2c. Admin Reviews Moderation
  if (url.pathname === '/api/v1/admin/reviews' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT r.*, p.title as product_title, u.email as reviewer_email
       FROM product_reviews r
       LEFT JOIN products p ON r.product_id = p.id
       LEFT JOIN users u ON r.user_id = u.id
       ORDER BY r.created_at DESC LIMIT 100`
    ).all();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
  }

  const adminReviewMatch = url.pathname.match(/^\/api\/v1\/admin\/reviews\/([^\/]+)$/);
  if (adminReviewMatch && request.method === 'DELETE') {
    const reviewId = adminReviewMatch[1];
    const before = await env.DB.prepare('SELECT * FROM product_reviews WHERE id = ?').bind(reviewId).first();
    if (!before) throw notFound('리뷰를 찾을 수 없습니다.');
    await env.DB.batch([env.DB.prepare('DELETE FROM product_reviews WHERE id = ?').bind(reviewId), audit('REVIEW_DELETE', 'review', reviewId, before, null)]);
    return new Response(JSON.stringify({ success: true, message: '리뷰가 삭제되었습니다.' }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/admin/users' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, email, full_name, phone, role, is_active, created_at,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = users.id) as order_count
       FROM users ORDER BY created_at DESC LIMIT 100`
    ).all();
    await logPiiView(env, admin, 'admin.users', 'user', results.map((u) => u.id), 'email,full_name,phone', request);
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
  }

  // P2R-01: operator password reset — the supported recovery path while no mail
  // provider is integrated. Sets a policy-checked password, revokes every
  // session, clears lockout, and audits. Operator accounts are excluded (their
  // recovery stays a break-glass DB procedure); the password never echoes back.
  const resetMatch = url.pathname.match(/^\/api\/v1\/admin\/users\/([^\/]+)\/reset-password$/);
  if (resetMatch && request.method === 'POST') {
    const body = await readJson(request);
    const target = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(resetMatch[1]).first();
    if (!target) throw notFound('사용자를 찾을 수 없습니다.');
    if (target.role === 'ROLE_ADMIN') throw forbidden('운영자 계정은 보안 절차로 초기화하세요.');
    validatePassword(body.new_password);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP, token_version = token_version + 1, failed_login_count = 0, locked_until = NULL WHERE id = ?')
        .bind(await hashPassword(body.new_password), target.id),
      audit('USER_PASSWORD_RESET', 'user', target.id, { email: target.email }, null)
    ]);
    return json(corsHeaders, { success: true, message: '비밀번호가 재설정되었습니다. 새 비밀번호를 안전한 경로로 전달하고, 로그인 후 변경을 안내해 주세요.' });
  }

  // O10: 개인정보 접속기록 조회 (who viewed / exported / destroyed personal data).
  if (url.pathname === '/api/v1/admin/privacy/access-log' && request.method === 'GET') {
    const actor = url.searchParams.get('actor_user_id');
    const subject = url.searchParams.get('subject_id');
    const action = url.searchParams.get('action');
    const { results } = await env.DB.prepare(
      `SELECT * FROM pii_access_log WHERE (? IS NULL OR actor_user_id = ?) AND (? IS NULL OR action = ?)
         AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(subject_ids_json) WHERE value = ?))
       ORDER BY rowid DESC LIMIT 500`
    ).bind(actor, actor, action, action, subject, subject).all();
    return json(corsHeaders, { success: true, count: results.length, data: results.map((r) => ({ ...r, subject_ids: JSON.parse(r.subject_ids_json || '[]') })) });
  }

  if (url.pathname === '/api/v1/admin/partners' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT p.*, u.email, u.full_name, u.phone,
              (SELECT COUNT(*) FROM products pr WHERE pr.partner_id = p.id) as product_count
       FROM partners p
       LEFT JOIN users u ON p.owner_user_id = u.id
       ORDER BY p.created_at DESC`
    ).all();
    await logPiiView(env, admin, 'admin.partners', 'user', results.map((r) => r.owner_user_id), 'email,full_name,phone,bank_account', request);
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
  }

  // 3. Admin Verify Partner (Approve / Reject / Risk Tiering / Rolling Reserve)
  if (url.pathname.startsWith('/api/v1/admin/partners/') && url.pathname.endsWith('/verify') && (request.method === 'PUT' || request.method === 'POST')) {
    const partnerId = url.pathname.split('/')[5];
    const body = await readJson(request);
    if (!['APPROVED', 'REJECTED', 'SUSPENDED', 'PENDING'].includes(body.status)) throw bad('INVALID_STATUS', 'status 값이 올바르지 않습니다.');
    const status = body.status;
    const beforePartner = await env.DB.prepare('SELECT id, status, kyc_status, applied_at, risk_tier, rolling_reserve_pct, rolling_reserve_days FROM partners WHERE id = ?').bind(partnerId).first();
    if (!beforePartner) throw notFound('입점사를 찾을 수 없습니다.');
    // O05: an onboarding applicant is approved only through the document review (no shortcut around KYB).
    if (beforePartner.applied_at && beforePartner.kyc_status !== 'APPROVED' && status === 'APPROVED') {
      throw conflict('USE_APPLICATION_REVIEW', '입점 신청 판매자는 서류 심사(POST /api/v1/admin/partner-applications/:id/review)로만 승인할 수 있습니다.');
    }
    const riskTier = body.risk_tier || 'TIER_1_NORMAL';
    if (!['TIER_1_NORMAL', 'TIER_2_WATCH', 'TIER_3_HIGH_RISK'].includes(riskTier)) throw bad('INVALID_RISK_TIER', 'risk_tier 값이 올바르지 않습니다.');
    const reservePct = body.rolling_reserve_pct !== undefined ? Number(body.rolling_reserve_pct) : (riskTier === 'TIER_3_HIGH_RISK' ? 10.0 : (riskTier === 'TIER_2_WATCH' ? 5.0 : 0.0));
    // Reserve is applied at payout time (finance.js); keep it in a range a seller contract can plausibly state.
    if (!Number.isFinite(reservePct) || reservePct < 0 || reservePct > 50 || Math.abs(Math.round(reservePct * 100) - reservePct * 100) > 1e-6) {
      throw bad('INVALID_RESERVE_PCT', '롤링 리저브 비율은 0~50% (소수점 둘째 자리까지) 이어야 합니다.');
    }
    const reserveDays = body.rolling_reserve_days !== undefined ? Number(body.rolling_reserve_days) : Number(beforePartner.rolling_reserve_days || 90);
    if (!Number.isInteger(reserveDays) || reserveDays < 1 || reserveDays > 365) throw bad('INVALID_RESERVE_DAYS', '리저브 보류 기간은 1~365일 정수여야 합니다.');
    const kycNotes = body.kyc_notes ? String(body.kyc_notes).trim().slice(0, 2000) : null;

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE partners
         SET status = ?, kyc_status = CASE WHEN applied_at IS NULL THEN ? ELSE kyc_status END, risk_tier = ?, rolling_reserve_pct = ?, rolling_reserve_days = ?, kyc_notes = COALESCE(?, kyc_notes), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(status, status, riskTier, reservePct, reserveDays, kycNotes, partnerId),
      audit('PARTNER_VERIFY', 'partner', partnerId, beforePartner, { status, riskTier, reservePct, reserveDays, kycNotes })
    ]);

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', partner_id: partnerId, status, risk_tier: riskTier, rolling_reserve_pct: reservePct, rolling_reserve_days: reserveDays, kyc_notes: kycNotes, data: { partner_id: partnerId, status, risk_tier: riskTier, rolling_reserve_pct: reservePct, rolling_reserve_days: reserveDays, kyc_notes: kycNotes }
    }), { headers: corsHeaders });
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
    const body = await readJson(request);
    if (!['ACTIVE', 'HIDDEN', 'DELETED'].includes(body.status)) throw bad('INVALID_STATUS', 'status 값이 올바르지 않습니다.');
    const status = body.status;
    const beforeProd = await env.DB.prepare('SELECT id, status, review_status FROM products WHERE id = ?').bind(prodId).first();
    if (!beforeProd) throw notFound('상품을 찾을 수 없습니다.');
    if (status === 'ACTIVE' && beforeProd.review_status !== 'APPROVED') throw conflict('REVIEW_REQUIRED', '심사 승인되지 않은 상품은 판매 상태로 전환할 수 없습니다.');
    await env.DB.batch([
      env.DB.prepare('UPDATE products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status, prodId),
      audit('PRODUCT_STATUS', 'product', prodId, beforeProd, { status })
    ]);
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', product_id: prodId, status }), { headers: corsHeaders });
  }

  // 5b. Product review decision (MODEL B 상품 심사)
  const reviewMatch = url.pathname.match(/^\/api\/v1\/admin\/products\/([^\/]+)\/review$/);
  if (reviewMatch && (request.method === 'POST' || request.method === 'PUT')) {
    const body = await readJson(request);
    const prod = await env.DB.prepare('SELECT id, status, review_status FROM products WHERE id = ?').bind(reviewMatch[1]).first();
    if (!prod) throw notFound('상품을 찾을 수 없습니다.');
    const decision = String(body.decision || '').toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(decision)) throw bad('INVALID_DECISION', 'decision은 APPROVE 또는 REJECT 입니다.');
    const note = str(body.note, { max: 500 });
    if (decision === 'REJECT' && !note) throw bad('REASON_REQUIRED', '반려 사유를 입력해 주세요.');
    const next = decision === 'APPROVE' ? { review_status: 'APPROVED', status: 'ACTIVE' } : { review_status: 'REJECTED', status: 'DRAFT' };
    await env.DB.batch([
      env.DB.prepare('UPDATE products SET review_status = ?, status = ?, review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next.review_status, next.status, note || null, prod.id),
      audit('PRODUCT_REVIEW', 'product', prod.id, prod, { ...next, note })
    ]);
    return json(corsHeaders, { success: true, product_id: prod.id, ...next });
  }

  // 5c. Partner payout-account verification / change approval
  const payoutAccMatch = url.pathname.match(/^\/api\/v1\/admin\/partners\/([^\/]+)\/payout-account$/);
  if (payoutAccMatch && request.method === 'POST') {
    const body = await readJson(request);
    const pt = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(payoutAccMatch[1]).first();
    if (!pt) throw notFound('입점사를 찾을 수 없습니다.');
    const decision = String(body.decision || '').toUpperCase();
    const evidence = str(body.verification_evidence, { max: 300 });
    if (decision === 'VERIFY_CURRENT') {
      if (!evidence) throw bad('EVIDENCE_REQUIRED', '계좌 실명 확인 근거를 입력해 주세요.');
      await env.DB.batch([env.DB.prepare('UPDATE partners SET payout_account_verified = 1 WHERE id = ?').bind(pt.id), audit('PAYOUT_ACCOUNT_VERIFY', 'partner', pt.id, null, { evidence })]);
      return json(corsHeaders, { success: true, payout_account_verified: true });
    }
    if (!pt.payout_change_request_json) throw conflict('NO_PENDING_CHANGE', '대기 중인 계좌 변경 요청이 없습니다.');
    const req = JSON.parse(pt.payout_change_request_json);
    if (decision === 'APPROVE') {
      if (!evidence) throw bad('EVIDENCE_REQUIRED', '계좌 실명 확인 근거를 입력해 주세요.');
      await env.DB.batch([
        env.DB.prepare('UPDATE partners SET bank_code = ?, bank_account_number = ?, bank_account_holder = ?, payout_account_verified = 1, payout_change_request_json = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(req.bank_code, req.bank_account_number, req.bank_account_holder, pt.id),
        audit('PAYOUT_ACCOUNT_CHANGE_APPROVE', 'partner', pt.id, { bank_code: pt.bank_code, bank_account_number: pt.bank_account_number }, { ...req, evidence })
      ]);
      return json(corsHeaders, { success: true, applied: true });
    }
    await env.DB.batch([env.DB.prepare('UPDATE partners SET payout_change_request_json = NULL WHERE id = ?').bind(pt.id), audit('PAYOUT_ACCOUNT_CHANGE_REJECT', 'partner', pt.id, req, null)]);
    return json(corsHeaders, { success: true, applied: false });
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
      for (const s of subs) {
        const { results: items } = await env.DB.prepare('SELECT * FROM order_items WHERE sub_order_id = ?').bind(s.id).all();
        s.items = items;
      }
      ord.sub_orders = subs;
    }
    await logPiiView(env, admin, 'admin.orders', 'order', orders.map((o) => o.id), 'buyer_email,recipient_name,recipient_phone,shipping_address,pccc', request);
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
    return json(corsHeaders, { success: false, code: 'USE_PAYOUT_ENGINE', error: '개별 정산 승인은 폐지되었습니다. POST /api/v1/admin/finance/payouts 로 판매자 단위 지급을 생성하세요.' }, 410);
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
    const body = await readJson(request);
    const claim = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(clmId).first();
    if (!claim) throw notFound('클레임을 찾을 수 없습니다.');
    if (claim.status !== 'REQUESTED') throw conflict('CLAIM_ALREADY_PROCESSED', `이미 처리된 클레임입니다. (${claim.status})`);
    const decision = String(body.decision || body.status || '').toUpperCase();
    if (decision === 'REJECTED' || decision === 'REJECT') {
      const note = str(body.notes, { max: 500, field: '사유', required: true });
      await env.DB.batch([
        env.DB.prepare("UPDATE returns SET status = 'REJECTED', notes = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'REQUESTED'").bind(note, admin.userId, clmId),
        env.DB.prepare("UPDATE sub_orders SET status = 'DELIVERED' WHERE id = ? AND status = 'RETURN_REQUESTED'").bind(claim.sub_order_id),
        audit('CLAIM_REJECT', 'claim', clmId, claim, { note })
      ]);
      return json(corsHeaders, { success: true, claim_id: clmId, status: 'REJECTED' });
    }
    if (claim.claim_type !== 'RETURN') throw conflict('UNSUPPORTED', '반품(RETURN) 클레임만 환불 승인할 수 있습니다.');
    // Approve moves money via refundOrder — require the refund privilege, not just orders.manage.
    if (!hasPermission(admin.adminRole, 'orders.refund')) throw forbidden('환불 승인 권한이 없습니다. (필요 권한: orders.refund)');
    const r = await refundOrder(env, admin, claim.order_id, {
      lines: JSON.parse(claim.items_json || '[]'), shippingSubOrderIds: [], subOrderId: claim.sub_order_id, claimId: clmId, reasonCode: 'RETURN',
      restock: body.restock !== false && body.returnless !== true, idemKey: `claim:${clmId}`, subStatusOnFull: 'RETURNED', orderStatusOnFull: 'REFUNDED'
    });
    await env.DB.batch([
      env.DB.prepare("UPDATE sub_orders SET status = 'DELIVERED' WHERE id = ? AND status = 'RETURN_REQUESTED'").bind(claim.sub_order_id),
      audit('CLAIM_REFUND', 'claim', clmId, claim, { refund_id: r.refund && r.refund.id })
    ]);
    return json(corsHeaders, { success: true, claim_id: clmId, status: 'REFUNDED', refund: r.refund });
  }

  // 9. Admin Banners Management
  if (url.pathname === '/api/v1/admin/banners' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM banners ORDER BY display_order ASC, created_at DESC'
    ).all();
    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/admin/banners' && request.method === 'POST') {
    const body = await readJson(request);
    const bannerId = newId('bnr');
    const title = (body.title || '신규 프로모션').trim();
    const subtitle = (body.subtitle || '').trim();
    const badgeText = (body.badge_text || 'SPECIAL').trim();
    const imageUrl = (body.image_url || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200').trim();
    const linkUrl = (body.link_url || '/channel/lightning-deals').trim();
    const bgGradient = (body.bg_gradient || 'from-orange-500 to-red-600').trim();
    const displayOrder = parseInt(body.display_order ?? 0, 10);
    const isActive = body.is_active === false || body.is_active === 0 ? 0 : 1;

    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO banners (id, title, subtitle, badge_text, image_url, link_url, bg_gradient, display_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(bannerId, title, subtitle, badgeText, imageUrl, linkUrl, bgGradient, displayOrder, isActive),
      audit('BANNER_CREATE', 'banner', bannerId, null, { title })
    ]);

    const created = await env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(bannerId).first();
    return new Response(JSON.stringify({ success: true, message: '프로모션 배너가 등록되었습니다.', data: created }), { status: 201, headers: corsHeaders });
  }

  const adminBannerMatch = url.pathname.match(/^\/api\/v1\/admin\/banners\/([a-zA-Z0-9_-]+)/);
  if (adminBannerMatch) {
    const bnrId = adminBannerMatch[1];
    if (request.method === 'PUT' || request.method === 'PATCH') {
      const body = await readJson(request);
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

      await env.DB.batch([
        env.DB.prepare(
          'UPDATE banners SET title = ?, subtitle = ?, badge_text = ?, bg_gradient = ?, link_url = ?, display_order = ?, is_active = ? WHERE id = ?'
        ).bind(title, subtitle, badgeText, bgGradient, linkUrl, displayOrder, isActive, bnrId),
        audit('BANNER_UPDATE', 'banner', bnrId, { title: existing.title, is_active: existing.is_active }, { title, is_active: isActive })
      ]);

      const updated = await env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(bnrId).first();
      return new Response(JSON.stringify({ success: true, message: '배너가 수정되었습니다.', data: updated }), { headers: corsHeaders });
    }
    if (request.method === 'DELETE') {
      const doomed = await env.DB.prepare('SELECT id, title FROM banners WHERE id = ?').bind(bnrId).first();
      if (!doomed) throw notFound('배너를 찾을 수 없습니다.');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM banners WHERE id = ?').bind(bnrId),
        audit('BANNER_DELETE', 'banner', bnrId, { title: doomed.title }, null)
      ]);
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
    const body = await readJson(request);
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
      const { results: users } = await env.DB.prepare("SELECT id FROM users WHERE role = 'ROLE_CUSTOMER' AND is_active = 1").all();
      targetUserIds = users.map(u => u.id);
    } else {
      targetUserIds = [target];
    }

    const stmts = targetUserIds.map((uid, idx) => {
      const notiId = newId('ntf') + '_' + idx;
      return env.DB.prepare(
        'INSERT INTO notifications (id, user_id, title, message, type, action_url) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(notiId, uid, title, message, type, actionUrl);
    });

    const broadcastAudit = audit('NOTIFICATION_BROADCAST', 'notification',
      targetUserIds.length > 0 ? `${targetUserIds[0]}+${targetUserIds.length - 1}-more` : 'broadcast',
      null, { target, count: targetUserIds.length, title });
    if (stmts.length > 0) {
      await env.DB.batch([...stmts, broadcastAudit]);
    } else {
      await broadcastAudit.run();
    }

    return new Response(JSON.stringify({
      success: true,
      broadcast_count: targetUserIds.length,
      message: `총 ${targetUserIds.length}명의 고객에게 알림이 성공적으로 발송되었습니다.`
    }), { status: 201, headers: corsHeaders });
  }

  // 11. Admin Coupon Management
  if (url.pathname === '/api/v1/admin/coupons' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/admin/coupons' && request.method === 'POST') {
    const body = await readJson(request);
    const code = (body.code || '').trim().toUpperCase();
    const title = (body.title || '').trim();
    if (!code || !title) {
      return new Response(JSON.stringify({ error: '쿠폰 코드와 제목은 필수입니다.' }), { status: 400, headers: corsHeaders });
    }
    const id = newId('cpn');
    const dv = Number(body.discount_value);
    if (!Number.isSafeInteger(dv) || dv <= 0 || (body.discount_type === 'PERCENT' && dv > 90)) throw bad('INVALID_DISCOUNT', '할인 값이 올바르지 않습니다.');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, max_discount_amount, expires_at, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        id, code, title,
        body.discount_type === 'PERCENT' ? 'PERCENT' : 'FIXED_AMOUNT',
        Number(body.discount_value || 0),
        Number(body.min_order_amount || 0),
        body.max_discount_amount ? Number(body.max_discount_amount) : null,
        body.expires_at || new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0,10)
      ),
      audit('COUPON_CREATE', 'coupon', id, null, { code, title })
    ]);
    return new Response(JSON.stringify({ success: true, message: '쿠폰이 생성되었습니다.', data: { id, code, title } }), { status: 201, headers: corsHeaders });
  }

  const adminCouponMatch = url.pathname.match(/^\/api\/v1\/admin\/coupons\/([^\/]+)$/);
  if (adminCouponMatch && request.method === 'DELETE') {
    const couponId = adminCouponMatch[1];
    await env.DB.batch([env.DB.prepare('UPDATE coupons SET is_active = 0 WHERE id = ?').bind(couponId), audit('COUPON_DEACTIVATE', 'coupon', couponId, null, null)]);
    return json(corsHeaders, { success: true, message: '쿠폰이 비활성화되었습니다. (사용 이력 보존)' });
  }

  // 12. Admin Category Management
  if (url.pathname === '/api/v1/admin/categories' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY c.depth ASC, c.sort_order ASC'
    ).all();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/admin/categories' && request.method === 'POST') {
    const body = await readJson(request);
    const name = (body.name || '').trim();
    const slug = (body.slug || name.toLowerCase().replace(/\s+/g, '-')).trim();
    if (!name) {
      return new Response(JSON.stringify({ error: '카테고리명은 필수입니다.' }), { status: 400, headers: corsHeaders });
    }
    const id = body.id || newId('cat');
    const parentId = body.parent_id || null;
    const depth = parentId ? 1 : 0;
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO categories (id, parent_id, name, slug, depth, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
      ).bind(id, parentId, name, slug, depth, Number(body.sort_order || 0)),
      audit('CATEGORY_CREATE', 'category', id, null, { slug })
    ]);
    return new Response(JSON.stringify({ success: true, message: '카테고리가 생성되었습니다.', data: { id, name, slug } }), { status: 201, headers: corsHeaders });
  }

  const adminCatMatch = url.pathname.match(/^\/api\/v1\/admin\/categories\/([^\/]+)$/);
  if (adminCatMatch && request.method === 'DELETE') {
    const catId = adminCatMatch[1];
    const used = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM products WHERE category_id = ?) + (SELECT COUNT(*) FROM categories WHERE parent_id = ?) AS c').bind(catId, catId).first('c');
    if (used > 0) throw conflict('CATEGORY_IN_USE', '상품 또는 하위 카테고리가 있는 카테고리는 삭제할 수 없습니다. 비활성화하세요.');
    await env.DB.batch([env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(catId), audit('CATEGORY_DELETE', 'category', catId, null, null)]);
    return new Response(JSON.stringify({ success: true, message: '카테고리가 삭제되었습니다.' }), { headers: corsHeaders });
  }

  return null;
}

