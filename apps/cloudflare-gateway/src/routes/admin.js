// apps/cloudflare-gateway/src/routes/admin.js
// Operator console API. Requires an authenticated ROLE_ADMIN user; every mutation writes admin_audit_log.

import { requireAdmin } from '../lib/auth.js';
import { hasPermission } from '../lib/admin-policy.js';
import { readJson, json, bad, conflict, forbidden, notFound, str, safeUrl, intParam, csvResponse, idempotencyKey } from '../lib/http.js';
import { hashPassword } from '../utils/crypto-auth.js';
import { validatePassword } from './auth.js';
import { newId } from '../lib/ids.js';
import { auditStatement, grantCreditStatements } from '../lib/ledger.js';
import { refundOrder, loadOrderBundle, mapDbError } from '../services/orders.js';
import { pushClaimCreditGranted, pushClaimRejected } from '../services/push.js';
import { logPiiView, maskLast4 } from '../services/privacy.js';
import { isSealedPii, maybeOpenPii, sealPii } from '../lib/pii-crypto.js';
import { decidePayoutRequest, markRequestTransferred } from '../services/payouts.js';
import { computeMonthlyGrades } from '../services/grading.js';

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
    // 2-9: waiting queues behind the metrics.
    const wPartners = await env.DB.prepare("SELECT COUNT(*) AS c FROM partners WHERE status = 'PENDING'").first('c') || 0;
    const wProducts = await env.DB.prepare("SELECT COUNT(*) AS c FROM products WHERE review_status = 'PENDING'").first('c') || 0;
    const wPayouts = await env.DB.prepare("SELECT COUNT(*) AS c FROM payout_requests WHERE status = 'REQUESTED'").first('c') || 0;
    const wFds = await env.DB.prepare("SELECT COUNT(*) AS c FROM orders WHERE fds_decision = 'REVIEW'").first('c') || 0;

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
      },
      waiting: {
        partner_applications: wPartners,
        product_reviews: wProducts,
        disputes: claimRes ? claimRes.cnt : 0,
        payout_requests: wPayouts,
        fds_reviews: wFds
      }
    }), { headers: corsHeaders });
  }

  // 2c. Admin Reviews Moderation (2-9: page + period + CSV replace the fixed 100).
  if (url.pathname === '/api/v1/admin/reviews' && request.method === 'GET') {
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = url.searchParams.get('from') || null;
    const to = url.searchParams.get('to') || null;
    if ((from && !dayRe.test(from)) || (to && !dayRe.test(to))) throw bad('INVALID_PERIOD', 'from·to는 YYYY-MM-DD 형식이어야 합니다.');
    const where = [];
    const args = [];
    if (from) { where.push('date(r.created_at) >= date(?)'); args.push(from); }
    if (to) { where.push('date(r.created_at) <= date(?)'); args.push(to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '50', 10) || 50));
    const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM product_reviews r ${whereSql}`).bind(...args).first('c') || 0;
    const asCsv = String(url.searchParams.get('format') || '').toLowerCase() === 'csv';
    const { results } = await env.DB.prepare(
      `SELECT r.*, p.title as product_title, u.email as reviewer_email
       FROM product_reviews r
       LEFT JOIN products p ON r.product_id = p.id
       LEFT JOIN users u ON r.user_id = u.id
       ${whereSql} ORDER BY r.created_at DESC ${asCsv ? 'LIMIT 5000' : 'LIMIT ? OFFSET ?'}`
    ).bind(...args, ...(asCsv ? [] : [perPage, (page - 1) * perPage])).all();
    await logPiiView(env, admin, 'admin.reviews', 'review', results.map((r) => r.id), 'reviewer_email', request);
    if (asCsv) {
      return csvResponse(corsHeaders, 'admin_reviews.csv',
        ['id', 'product_id', 'product_title', 'reviewer_email', 'rating', 'visibility', 'created_at'],
        results.map((r) => [r.id, r.product_id, r.product_title, r.reviewer_email, r.rating, r.visibility, r.created_at]));
    }
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length,
      pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) }, data: results }), { headers: corsHeaders });
  }

  // 2-9: reported-review queue + visibility (blind drops the stored aggregates via trigger).
  if (url.pathname === '/api/v1/admin/review-reports' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT rr.*, r.product_id, r.rating, r.content, r.visibility, p.title AS product_title
       FROM review_reports rr JOIN product_reviews r ON r.id = rr.review_id LEFT JOIN products p ON p.id = r.product_id
       ORDER BY rr.created_at DESC LIMIT 200`
    ).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  const reviewVisM = url.pathname.match(/^\/api\/v1\/admin\/reviews\/([^/]+)\/visibility$/);
  if (reviewVisM && (request.method === 'PUT' || request.method === 'POST')) {
    const body = await readJson(request);
    const vis = String(body.visibility || '').toUpperCase();
    if (!['VISIBLE', 'BLIND'].includes(vis)) throw bad('INVALID_VISIBILITY', 'visibility는 VISIBLE·BLIND 중 하나여야 합니다.');
    const before = await env.DB.prepare('SELECT id, visibility FROM product_reviews WHERE id = ?').bind(reviewVisM[1]).first();
    if (!before) throw notFound('리뷰를 찾을 수 없습니다.');
    const reason = vis === 'BLIND' ? (str(body.blind_reason, { field: '블라인드 사유', max: 500 }) || null) : null;
    await env.DB.batch([
      env.DB.prepare('UPDATE product_reviews SET visibility = ?, blind_reason = ? WHERE id = ?').bind(vis, reason, before.id),
      audit('REVIEW_VISIBILITY', 'review', before.id, { visibility: before.visibility }, { visibility: vis, blind_reason: reason })
    ]);
    const data = { id: before.id, visibility: vis };
    return json(corsHeaders, { success: true, ...data, data });
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
    // P2-A01: ?q= narrows to one customer picker page (id/email prefix); 2-9 adds page + period + CSV.
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = url.searchParams.get('from') || null;
    const to = url.searchParams.get('to') || null;
    if ((from && !dayRe.test(from)) || (to && !dayRe.test(to))) throw bad('INVALID_PERIOD', 'from·to는 YYYY-MM-DD 형식이어야 합니다.');
    const where = [];
    const args = [];
    if (q) { where.push(`(users.id = ? OR users.email LIKE ? ESCAPE '\\')`); args.push(q, `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); }
    if (from) { where.push('date(users.created_at) >= date(?)'); args.push(from); }
    if (to) { where.push('date(users.created_at) <= date(?)'); args.push(to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '50', 10) || 50));
    const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM users ${whereSql}`).bind(...args).first('c') || 0;
    const asCsv = String(url.searchParams.get('format') || '').toLowerCase() === 'csv';
    const { results } = await env.DB.prepare(
      `SELECT id, email, full_name, phone, role, is_active, created_at,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = users.id) as order_count
       FROM users ${whereSql} ORDER BY created_at DESC ${asCsv ? 'LIMIT 5000' : 'LIMIT ? OFFSET ?'}`
    ).bind(...args, ...(asCsv ? [] : [perPage, (page - 1) * perPage])).all();
    await logPiiView(env, admin, 'admin.users', 'user', results.map((u) => u.id), 'email,full_name,phone', request);
    if (asCsv) {
      return csvResponse(corsHeaders, 'admin_users.csv',
        ['id', 'email', 'full_name', 'phone', 'role', 'is_active', 'order_count', 'created_at'],
        results.map((u) => [u.id, u.email, u.full_name, u.phone, u.role, u.is_active, u.order_count, u.created_at]));
    }
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length,
      pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) }, data: results }), { headers: corsHeaders });
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

  // O10: 개인정보 접속기록 조회 (who viewed / exported / destroyed personal data). 2-9: page + period + CSV.
  if (url.pathname === '/api/v1/admin/privacy/access-log' && request.method === 'GET') {
    const actor = url.searchParams.get('actor_user_id');
    const subject = url.searchParams.get('subject_id');
    const action = url.searchParams.get('action');
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = url.searchParams.get('from') || null;
    const to = url.searchParams.get('to') || null;
    if ((from && !dayRe.test(from)) || (to && !dayRe.test(to))) throw bad('INVALID_PERIOD', 'from·to는 YYYY-MM-DD 형식이어야 합니다.');
    const where = ['(? IS NULL OR actor_user_id = ?)', '(? IS NULL OR action = ?)', "(? IS NULL OR EXISTS (SELECT 1 FROM json_each(subject_ids_json) WHERE value = ?))"];
    const args = [actor, actor, action, action, subject, subject];
    if (from) { where.push('date(created_at) >= date(?)'); args.push(from); }
    if (to) { where.push('date(created_at) <= date(?)'); args.push(to); }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const perPage = Math.min(500, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '50', 10) || 50));
    const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM pii_access_log ${whereSql}`).bind(...args).first('c') || 0;
    const asCsv = String(url.searchParams.get('format') || '').toLowerCase() === 'csv';
    const { results } = await env.DB.prepare(
      `SELECT * FROM pii_access_log ${whereSql} ORDER BY rowid DESC ${asCsv ? 'LIMIT 5000' : 'LIMIT ? OFFSET ?'}`
    ).bind(...args, ...(asCsv ? [] : [perPage, (page - 1) * perPage])).all();
    const rows = results.map((r) => ({ ...r, subject_ids: JSON.parse(r.subject_ids_json || '[]') }));
    if (asCsv) {
      return csvResponse(corsHeaders, 'admin_access_log.csv',
        ['id', 'actor_user_id', 'actor_role', 'action', 'resource', 'subject_type', 'subject_count', 'fields', 'created_at'],
        rows.map((r) => [r.id, r.actor_user_id, r.actor_role, r.action, r.resource, r.subject_type, r.subject_count, r.fields, r.created_at]));
    }
    return json(corsHeaders, { success: true, count: rows.length,
      pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) }, data: rows });
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
    // SEC-10: open sealed accounts before masking (legacy plaintext passes through).
    const maskedPartners = [];
    for (const r of results) maskedPartners.push({ ...r, bank_account_number: maskLast4(await maybeOpenPii(env, r.bank_account_number)) });
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: maskedPartners }), { headers: corsHeaders });
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

  // 4. Admin All Products List & Status Management (2-9: page + period + CSV replace the fixed 150).
  if (url.pathname === '/api/v1/admin/products' && request.method === 'GET') {
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = url.searchParams.get('from') || null;
    const to = url.searchParams.get('to') || null;
    if ((from && !dayRe.test(from)) || (to && !dayRe.test(to))) throw bad('INVALID_PERIOD', 'from·to는 YYYY-MM-DD 형식이어야 합니다.');
    const where = [];
    const args = [];
    if (from) { where.push('date(p.created_at) >= date(?)'); args.push(from); }
    if (to) { where.push('date(p.created_at) <= date(?)'); args.push(to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '50', 10) || 50));
    const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM products p ${whereSql}`).bind(...args).first('c') || 0;
    const asCsv = String(url.searchParams.get('format') || '').toLowerCase() === 'csv';
    const { results } = await env.DB.prepare(
      `SELECT p.*, pt.business_name, c.name as category_name,
              (SELECT COUNT(*) FROM product_skus s WHERE s.product_id = p.id) as sku_count,
              (SELECT SUM(stock_quantity) FROM product_skus s WHERE s.product_id = p.id) as total_stock
       FROM products p
       LEFT JOIN partners pt ON p.partner_id = pt.id
       LEFT JOIN categories c ON p.category_id = c.id
       ${whereSql} ORDER BY p.created_at DESC ${asCsv ? 'LIMIT 5000' : 'LIMIT ? OFFSET ?'}`
    ).bind(...args, ...(asCsv ? [] : [perPage, (page - 1) * perPage])).all();
    if (asCsv) {
      return csvResponse(corsHeaders, 'admin_products.csv',
        ['id', 'title', 'partner', 'category', 'sale_price', 'stock', 'status', 'review_status', 'created_at'],
        results.map((r) => [r.id, r.title, r.business_name, r.category_name, r.lowest_sale_price, r.total_stock, r.status, r.review_status, r.created_at]));
    }
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length,
      pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) }, data: results }), { headers: corsHeaders });
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
    // SEC-10: the audit trail keeps last-4 traceability, never a full account number (old or new).
    const maskedReq = { ...req, bank_account_number: maskLast4(await maybeOpenPii(env, req.bank_account_number)) };
    if (decision === 'APPROVE') {
      if (!evidence) throw bad('EVIDENCE_REQUIRED', '계좌 실명 확인 근거를 입력해 주세요.');
      // Queued values are sealed since SEC-10; a request queued before that is sealed here on approval.
      const approvedAccount = isSealedPii(req.bank_account_number) ? req.bank_account_number : await sealPii(env, req.bank_account_number);
      const approvedHolder = isSealedPii(req.bank_account_holder) ? req.bank_account_holder : await sealPii(env, req.bank_account_holder);
      await env.DB.batch([
        env.DB.prepare('UPDATE partners SET bank_code = ?, bank_account_number = ?, bank_account_holder = ?, payout_account_verified = 1, payout_change_request_json = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(req.bank_code, approvedAccount, approvedHolder, pt.id),
        audit('PAYOUT_ACCOUNT_CHANGE_APPROVE', 'partner', pt.id,
          { bank_code: pt.bank_code, bank_account_number: maskLast4(await maybeOpenPii(env, pt.bank_account_number)) },
          { ...maskedReq, evidence })
      ]);
      return json(corsHeaders, { success: true, applied: true });
    }
    await env.DB.batch([env.DB.prepare('UPDATE partners SET payout_change_request_json = NULL WHERE id = ?').bind(pt.id), audit('PAYOUT_ACCOUNT_CHANGE_REJECT', 'partner', pt.id, maskedReq, null)]);
    return json(corsHeaders, { success: true, applied: false });
  }

  // 6. Admin All Orders
  if (url.pathname === '/api/v1/admin/orders' && request.method === 'GET') {
    const admPage = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const admPerPage = Math.min(200, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '50', 10) || 50));
    const admTotal = await env.DB.prepare('SELECT COUNT(*) AS c FROM orders').first('c') || 0;
    const { results: orders } = await env.DB.prepare(
      'SELECT o.*, u.email as buyer_email FROM orders o LEFT JOIN users u ON o.customer_id = u.id ORDER BY o.created_at DESC LIMIT ? OFFSET ?'
    ).bind(admPerPage, (admPage - 1) * admPerPage).all();

    for (const ord of orders) {
      const { results: subs } = await env.DB.prepare(
        'SELECT s.*, p.business_name FROM sub_orders s LEFT JOIN partners p ON s.partner_id = p.id WHERE s.parent_order_id = ?'
      ).bind(ord.id).all();
      for (const s of subs) {
        const { results: items } = await env.DB.prepare('SELECT * FROM order_items WHERE sub_order_id = ?').bind(s.id).all();
        s.items = items;
      }
      ord.sub_orders = subs;
      // SEC-10: the operator console reads the full PCCC; open the sealed value.
      ord.pccc = await maybeOpenPii(env, ord.pccc);
    }
    await logPiiView(env, admin, 'admin.orders', 'order', orders.map((o) => o.id), 'buyer_email,recipient_name,recipient_phone,shipping_address,pccc', request);
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: orders.length, pagination: { page: admPage, per_page: admPerPage, total: Number(admTotal) || 0, total_pages: Math.max(1, Math.ceil((Number(admTotal) || 0) / admPerPage)) }, data: orders }), { headers: corsHeaders });
  }

  // 7. Admin Ledger / Settlements & Approve Payout
  if ((url.pathname === '/api/v1/admin/ledger' || url.pathname === '/api/v1/admin/ledgers') && request.method === 'GET') {
    const ledPage = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const ledPerPage = Math.min(200, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '50', 10) || 50));
    const ledTotal = await env.DB.prepare('SELECT COUNT(*) AS c FROM settlements').first('c') || 0;
    const { results } = await env.DB.prepare(
      `SELECT s.*, p.business_name, sub.sub_order_no, sub.status as sub_order_status
       FROM settlements s
       LEFT JOIN partners p ON s.partner_id = p.id
       LEFT JOIN sub_orders sub ON s.sub_order_id = sub.id
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
    ).bind(ledPerPage, (ledPage - 1) * ledPerPage).all();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, pagination: { page: ledPage, per_page: ledPerPage, total: Number(ledTotal) || 0, total_pages: Math.max(1, Math.ceil((Number(ledTotal) || 0) / ledPerPage)) }, data: results }), { headers: corsHeaders });
  }

  if (url.pathname.match(/^\/api\/v1\/admin\/settlements\/[^\/]+\/approve$/) && request.method === 'POST') {
    return json(corsHeaders, { success: false, code: 'USE_PAYOUT_ENGINE', error: '개별 정산 승인은 폐지되었습니다. POST /api/v1/admin/finance/payouts 로 판매자 단위 지급을 생성하세요.' }, 410);
  }

  // 8. Admin Claims & Dispute Management
  if (url.pathname === '/api/v1/admin/claims' && request.method === 'GET') {
    const clmPage = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const clmPerPage = Math.min(200, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '50', 10) || 50));
    const clmTotal = await env.DB.prepare('SELECT COUNT(*) AS c FROM returns').first('c') || 0;
    const { results } = await env.DB.prepare(
      `SELECT r.*, o.order_no, u.email as customer_email
       FROM returns r
       LEFT JOIN orders o ON r.order_id = o.id
       LEFT JOIN users u ON r.user_id = u.id
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    ).bind(clmPerPage, (clmPage - 1) * clmPerPage).all();
    await logPiiView(env, admin, 'admin.claims', 'claim', results.map((r) => r.id), 'customer_email', request);
    return new Response(JSON.stringify({ success: true, count: results.length, pagination: { page: clmPage, per_page: clmPerPage, total: Number(clmTotal) || 0, total_pages: Math.max(1, Math.ceil((Number(clmTotal) || 0) / clmPerPage)) }, data: results }), { headers: corsHeaders });
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
      try {
        const ord = await env.DB.prepare('SELECT order_no FROM orders WHERE id = ?').bind(claim.order_id).first();
        await pushClaimRejected(env, { orderNo: ord ? ord.order_no : claim.order_id, customerId: claim.user_id, note });
      } catch { /* push must never fail the decision */ }
      return json(corsHeaders, { success: true, claim_id: clmId, status: 'REJECTED' });
    }
    if (claim.claim_type === 'PRICE_ADJUSTMENT') {
      // NEW-P0-01: approval releases a CAPPED grant and charges the sellers' settlements.
      // Concurrent double-approves collapse on ux_user_credits_user_reference (same
      // referenceId) and surface as CLAIM_ALREADY_PROCESSED instead of a double payout.
      if (!hasPermission(admin.adminRole, 'orders.refund')) throw forbidden('환불 승인 권한이 없습니다. (필요 권한: orders.refund)');
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(claim.order_id).first();
      if (!order) throw notFound('주문을 찾을 수 없습니다.');
      const snap = JSON.parse(claim.items_json || '[]');
      const rawTotal = snap.reduce((a, l) => a + (Number(l.line_diff) || 0), 0);
      const cap = Math.min(Math.floor((order.total_pay_amount || 0) * 0.10), 10000);
      const grant = Math.min(rawTotal, cap);
      const st = [];
      if (grant > 0) {
        // Pro-rate the capped grant across sub-orders by snapshot share (largest remainder).
        // Subs without a settlement row (DIRECT sales) stay an operator cost.
        const subs = {};
        for (const l of snap) subs[l.sub_order_id] = (subs[l.sub_order_id] || 0) + l.line_diff;
        const shares = Object.keys(subs).map((id) => ({ id, exact: (grant * subs[id]) / rawTotal }));
        let assigned = 0;
        for (const s of shares) { s.floor = Math.floor(s.exact); assigned += s.floor; }
        shares.sort((a, b) => (b.exact - b.floor) - (a.exact - a.floor));
        for (let i = 0; i < grant - assigned; i++) shares[i % shares.length].floor += 1;
        st.push(...grantCreditStatements(env, { userId: claim.user_id, amount: grant, reason: '최저가 보상 차액 적립(관리자 승인)', referenceId: clmId, entityId: order.operator_entity_id, txnType: 'PRICE_ADJUSTMENT' }));
        for (const s of shares) {
          if (s.floor <= 0) continue;
          const stl = await env.DB.prepare('SELECT id, partner_id FROM settlements WHERE sub_order_id = ?').bind(s.id).first();
          if (!stl) continue;
          st.push(env.DB.prepare(
            `INSERT INTO settlement_adjustments (id, settlement_id, partner_id, gross_delta, commission_delta, shipping_delta, net_delta, reason)
             VALUES (?, ?, ?, 0, 0, 0, ?, ?)`
          ).bind(newId('adj'), stl.id, stl.partner_id, -s.floor, `PRICE_ADJUSTMENT_CLAIM:${clmId}`));
        }
      }
      st.push(env.DB.prepare("UPDATE returns SET status = 'REFUNDED', refund_amount = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'REQUESTED'").bind(grant, admin.userId, clmId));
      st.push(audit('CLAIM_PRICE_ADJUST', 'claim', clmId, claim, { granted: grant, capped_from: rawTotal }));
      try {
        await env.DB.batch(st);
      } catch (e) {
        throw mapDbError(e) ? conflict('CLAIM_ALREADY_PROCESSED', `이미 처리된 클레임입니다. (${clmId})`) : e;
      }
      if (grant > 0) {
        try {
          await pushClaimCreditGranted(env, { orderNo: order.order_no, customerId: claim.user_id, amount: grant });
        } catch { /* push must never fail the decision */ }
      }
      return json(corsHeaders, { success: true, claim_id: clmId, status: 'REFUNDED', granted: grant });
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
    // P2-SEC-04: banner fields render raw in the storefront — cap lengths and
    // keep URLs to https / site-relative (no javascript: or data: payloads).
    const title = str(body.title ?? '신규 프로모션', { field: '배너 제목', max: 120 }) || '신규 프로모션';
    const subtitle = str(body.subtitle, { field: '배너 부제', max: 200 });
    const badgeText = str(body.badge_text ?? 'SPECIAL', { field: '배너 뱃지', max: 40 }) || 'SPECIAL';
    // P2-A02: no stock-photo default — a banner without an explicit image is rejected, never silently illustrated.
    const imageUrl = safeUrl(body.image_url, { field: '배너 이미지', required: true });
    const linkUrl = safeUrl(body.link_url || '/channel/lightning-deals', { field: '배너 링크', allowRelative: true, required: true });
    const bgGradient = str(body.bg_gradient ?? 'from-orange-500 to-red-600', { field: '배너 배경', max: 120 }) || 'from-orange-500 to-red-600';
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
      if (!existing) throw notFound('Banner not found');
      const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;
      const displayOrder = body.display_order !== undefined ? parseInt(body.display_order, 10) : existing.display_order;
      const title = body.title ? str(body.title, { field: '배너 제목', max: 120 }) : existing.title;
      const subtitle = body.subtitle !== undefined ? str(body.subtitle, { field: '배너 부제', max: 200 }) : existing.subtitle;
      const badgeText = body.badge_text !== undefined ? str(body.badge_text, { field: '배너 뱃지', max: 40 }) : existing.badge_text;
      const bgGradient = body.bg_gradient ? str(body.bg_gradient, { field: '배너 배경', max: 120 }) : existing.bg_gradient;
      const linkUrl = body.link_url ? safeUrl(body.link_url, { field: '배너 링크', allowRelative: true, required: true }) : existing.link_url;

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
    await logPiiView(env, admin, 'admin.notifications', 'user', results.map((n) => n.user_id), 'user_email,user_name', request);
    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/admin/notifications' && request.method === 'POST') {
    const body = await readJson(request);
    const target = body.target || 'ALL';
    const title = str(body.title ?? '올모아 공지사항', { field: '알림 제목', max: 120 }) || '올모아 공지사항';
    const message = str(body.message, { field: '알림 메시지', max: 2000 });
    const type = ['ORDER_STATUS', 'DISCOUNT', 'CREDIT_GRANTED', 'SYSTEM'].includes(body.type) ? body.type : 'SYSTEM';
    const actionUrl = safeUrl(body.action_url || body.link_url || '/', { field: '알림 이동 주소', allowRelative: true, required: true });

    if (!title || !message) throw bad('NOTIFICATION_REQUIRED', '알림 제목과 메시지는 필수 항목입니다.');

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

  // P1-A13: operator audit-trail query (admin_audit_log is otherwise INSERT-only).
  if (url.pathname === '/api/v1/admin/audit-log' && request.method === 'GET') {
    const actor = url.searchParams.get('actor_user_id');
    const action = url.searchParams.get('action');
    const targetType = url.searchParams.get('target_type');
    const targetId = url.searchParams.get('target_id');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
    const { results } = await env.DB.prepare(
      `SELECT * FROM admin_audit_log
       WHERE (? IS NULL OR actor_user_id = ?) AND (? IS NULL OR action = ?)
         AND (? IS NULL OR target_type = ?) AND (? IS NULL OR target_id = ?)
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
    ).bind(actor, actor, action, action, targetType, targetType, targetId, targetId, limit).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  // 10b. NEW-09: customer 1:1 inquiries - list + reply (previously no operator path existed).
  if (url.pathname === '/api/v1/admin/inquiries' && request.method === 'GET') {
    const inqStatus = (url.searchParams.get('status') || '').toUpperCase();
    const inqPage = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const inqPerPage = Math.min(200, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '50', 10) || 50));
    const inqWhere = ['OPEN', 'ANSWERED', 'CLOSED'].includes(inqStatus) ? 'WHERE i.status = ?' : '';
    const inqKeys = inqWhere ? [inqStatus] : [];
    const inqTotal = await env.DB.prepare(`SELECT COUNT(*) AS c FROM support_inquiries i ${inqWhere}`).bind(...inqKeys).first('c') || 0;
    const { results } = await env.DB.prepare(
      `SELECT i.*, u.email AS customer_email, u.full_name AS customer_name
       FROM support_inquiries i LEFT JOIN users u ON u.id = i.user_id
       ${inqWhere} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...inqKeys, inqPerPage, (inqPage - 1) * inqPerPage).all();
    await logPiiView(env, admin, 'admin.inquiries', 'inquiry', results.map((r) => r.id), 'customer_email', request);
    return json(corsHeaders, { success: true, count: results.length, pagination: { page: inqPage, per_page: inqPerPage, total: Number(inqTotal) || 0, total_pages: Math.max(1, Math.ceil((Number(inqTotal) || 0) / inqPerPage)) }, data: results });
  }

  const inqReplyM = url.pathname.match(/^\/api\/v1\/admin\/inquiries\/([^/]+)\/reply$/);
  if (inqReplyM && request.method === 'POST') {
    if (!hasPermission(admin.adminRole, 'orders.manage')) throw forbidden('문의 답변 권한이 없습니다. (필요 권한: orders.manage)');
    const inq = await env.DB.prepare('SELECT * FROM support_inquiries WHERE id = ?').bind(inqReplyM[1]).first();
    if (!inq) throw notFound('문의를 찾을 수 없습니다.');
    if (inq.status === 'CLOSED') throw conflict('INQUIRY_CLOSED', '종결된 문의에는 답변할 수 없습니다.');
    const inqBody = await readJson(request);
    const answer = str(inqBody.answer, { field: '답변', max: 10000, required: true });
    const close = inqBody.close === true;
    const nextStatus = close ? 'CLOSED' : 'ANSWERED';
    await env.DB.batch([
      env.DB.prepare('UPDATE support_inquiries SET answer = ?, status = ? WHERE id = ?').bind(answer, nextStatus, inq.id),
      audit('INQUIRY_REPLY', 'inquiry', inq.id, { status: inq.status }, { status: nextStatus })
    ]);
    return json(corsHeaders, { success: true, inquiry_id: inq.id, status: nextStatus });
  }

  // 11. Admin Coupon Management
  if (url.pathname === '/api/v1/admin/coupons' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: results.length, data: results }), { headers: corsHeaders });
  }

  if (url.pathname === '/api/v1/admin/coupons' && request.method === 'POST') {
    // 2-9: platform coupons with burden split, scope, issue mode and quantity.
    const body = await readJson(request);
    if (!String(body.code || '').trim() || !String(body.title || '').trim()) throw bad('COUPON_REQUIRED', '쿠폰 코드와 제목은 필수입니다.');
    const code = str(body.code, { field: '쿠폰 코드', max: 40 }).toUpperCase();
    const title = str(body.title, { field: '쿠폰명', max: 200 });
    const dtype = String(body.discount_type || 'FIXED_AMOUNT').toUpperCase();
    if (!['FIXED_AMOUNT', 'PERCENT'].includes(dtype)) throw bad('INVALID_DISCOUNT_TYPE', 'discount_type은 FIXED_AMOUNT·PERCENT 중 하나여야 합니다.');
    const dv = Number(body.discount_value);
    if (!Number.isSafeInteger(dv) || dv <= 0 || (dtype === 'PERCENT' && dv > 90)) throw bad('INVALID_DISCOUNT', '할인 값이 올바르지 않습니다.');
    const scope = String(body.scope || 'ALL').toUpperCase();
    if (!['ALL', 'SELLER', 'PRODUCT', 'CATEGORY'].includes(scope)) throw bad('INVALID_SCOPE', 'scope은 ALL·SELLER·PRODUCT·CATEGORY 중 하나여야 합니다.');
    const share = body.platform_share_bps === undefined ? 10000 : intParam(body.platform_share_bps, { min: 0, max: 10000, field: '플랫폼 분담 비율' });
    const sellerIds = Array.isArray(body.seller_ids) ? [...new Set(body.seller_ids.map((x) => String(x || '').trim()).filter(Boolean))] : [];
    const targetIds = Array.isArray(body.target_ids) ? [...new Set(body.target_ids.map((x) => String(x || '').trim()).filter(Boolean))] : [];
    if (scope === 'SELLER' && share < 10000 && !sellerIds.length) {
      throw bad('SELLERS_REQUIRED', '판매자 분담이 있으면 대상 판매자를 지정해야 합니다.');
    }
    if ((scope === 'PRODUCT' || scope === 'CATEGORY') && !targetIds.length) throw bad('TARGETS_REQUIRED', '선택 범위 쿠폰은 target_ids가 필요합니다.');
    for (const sid of sellerIds) {
      const ok = await env.DB.prepare('SELECT id FROM partners WHERE id = ?').bind(sid).first();
      if (!ok) throw bad('INVALID_SELLER', `대상 판매자(${sid})를 찾을 수 없습니다.`);
    }
    for (const tid of targetIds) {
      const ok = scope === 'PRODUCT'
        ? await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(tid).first()
        : await env.DB.prepare('SELECT id FROM categories WHERE id = ? OR slug = ?').bind(tid, tid).first();
      if (!ok) throw bad('INVALID_TARGET', `대상(${tid})을 찾을 수 없습니다.`);
    }
    const method = String(body.issue_method || 'DOWNLOAD').toUpperCase();
    if (!['DOWNLOAD', 'CODE', 'AUTO'].includes(method)) throw bad('INVALID_ISSUE_METHOD', 'issue_method는 DOWNLOAD·CODE·AUTO 중 하나여야 합니다.');
    const id = newId('cpn');
    const stmts = [env.DB.prepare(
      `INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, max_discount_amount,
        expires_at, starts_at, is_active, issuer, scope, platform_share_bps, dup_group, issue_method, total_quantity, per_user_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'PLATFORM', ?, ?, 'PLATFORM', ?, ?, ?)`
    ).bind(id, code, title, dtype, dv,
      body.min_order_amount === undefined ? 0 : intParam(body.min_order_amount, { min: 0, max: 100_000_000, field: '최소 주문금액' }),
      body.max_discount_amount === undefined || body.max_discount_amount === null ? null : intParam(body.max_discount_amount, { min: 1, max: 100_000_000, field: '최대 할인액' }),
      str(body.expires_at, { max: 30 }) || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 19).replace('T', ' '),
      body.starts_at === undefined || body.starts_at === null ? null : str(body.starts_at, { max: 30 }),
      scope, share, method,
      body.total_quantity === undefined || body.total_quantity === null ? null : intParam(body.total_quantity, { min: 1, max: 10_000_000, field: '총 수량' }),
      body.per_user_limit === undefined || body.per_user_limit === null ? null : intParam(body.per_user_limit, { min: 1, max: 100, field: '1인 한도' })),
      audit('COUPON_CREATE', 'coupon', id, null, { code, title, scope, share })];
    for (const sid of sellerIds) {
      stmts.push(env.DB.prepare('INSERT INTO coupon_targets (coupon_id, target_type, target_id) VALUES (?, ?, ?)').bind(id, 'SELLER', sid));
    }
    for (const tid of targetIds) {
      stmts.push(env.DB.prepare('INSERT INTO coupon_targets (coupon_id, target_type, target_id) VALUES (?, ?, ?)')
        .bind(id, scope === 'PRODUCT' ? 'PRODUCT' : 'CATEGORY', tid));
    }
    try {
      await env.DB.batch(stmts);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('COUPON_CODE_TAKEN', '이미 사용 중인 쿠폰 코드입니다.');
      throw e;
    }
    return new Response(JSON.stringify({ success: true, message: '쿠폰이 생성되었습니다.', data: { id, code, title } }), { status: 201, headers: corsHeaders });
  }

  // 2-9: operator coupon edit (money freezes after issue) + suspend (seller coupons included).
  const adminCouponPutM = url.pathname.match(/^\/api\/v1\/admin\/coupons\/([^/]+)$/);
  if (adminCouponPutM && (request.method === 'PUT' || request.method === 'PATCH')) {
    const body = await readJson(request);
    const cp = await env.DB.prepare('SELECT * FROM coupons WHERE id = ?').bind(adminCouponPutM[1]).first();
    if (!cp) throw notFound('쿠폰을 찾을 수 없습니다.');
    const started = Number(cp.issued_count) > 0;
    const moneyKeys = ['discount_type', 'discount_value', 'min_order_amount', 'max_discount_amount', 'scope', 'target_ids', 'seller_ids', 'platform_share_bps', 'total_quantity', 'per_user_limit', 'starts_at', 'expires_at'];
    if (started && moneyKeys.some((k) => body[k] !== undefined)) {
      throw conflict('COUPON_IMMUTABLE_AFTER_ISSUE', '발급이 시작된 쿠폰은 할인값·범위를 바꿀 수 없습니다. 중지만 가능합니다.');
    }
    if (body.discount_type !== undefined && !['FIXED_AMOUNT', 'PERCENT'].includes(String(body.discount_type).toUpperCase())) {
      throw bad('INVALID_DISCOUNT_TYPE', 'discount_type은 FIXED_AMOUNT·PERCENT 중 하나여야 합니다.');
    }
    const dtype = body.discount_type !== undefined ? String(body.discount_type).toUpperCase() : cp.discount_type;
    const dval = body.discount_value !== undefined ? Number(body.discount_value) : cp.discount_value;
    if (!Number.isSafeInteger(dval) || dval <= 0 || (dtype === 'PERCENT' && dval > 90)) throw bad('INVALID_DISCOUNT', '할인 값이 올바르지 않습니다.');
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE coupons SET title = ?, discount_type = ?, discount_value = ?, min_order_amount = ?, max_discount_amount = ?,
          expires_at = ?, starts_at = ?, total_quantity = ?, per_user_limit = ?, is_active = ? WHERE id = ?`
      ).bind(body.title !== undefined ? str(body.title, { field: '쿠폰명', max: 200, required: true }) : cp.title, dtype, dval,
        body.min_order_amount !== undefined ? intParam(body.min_order_amount, { min: 0, max: 100_000_000, field: '최소 주문금액' }) : cp.min_order_amount,
        body.max_discount_amount !== undefined ? (body.max_discount_amount === null ? null : intParam(body.max_discount_amount, { min: 1, max: 100_000_000, field: '최대 할인액' })) : cp.max_discount_amount,
        body.expires_at !== undefined ? str(body.expires_at, { max: 30, required: true }) : cp.expires_at,
        body.starts_at !== undefined ? (body.starts_at === null ? null : str(body.starts_at, { max: 30 })) : cp.starts_at,
        body.total_quantity !== undefined ? (body.total_quantity === null ? null : intParam(body.total_quantity, { min: 1, max: 10_000_000, field: '총 수량' })) : cp.total_quantity,
        body.per_user_limit !== undefined ? (body.per_user_limit === null ? null : intParam(body.per_user_limit, { min: 1, max: 100, field: '1인 한도' })) : cp.per_user_limit,
        body.is_active !== undefined ? (body.is_active ? 1 : 0) : cp.is_active, cp.id),
      audit('COUPON_UPDATE', 'coupon', cp.id, { title: cp.title }, { title: body.title ?? cp.title })
    ]);
    const updatedCp = await env.DB.prepare('SELECT * FROM coupons WHERE id = ?').bind(cp.id).first();
    return json(corsHeaders, { success: true, ...updatedCp, data: updatedCp });
  }
  const adminCouponSuspM = url.pathname.match(/^\/api\/v1\/admin\/coupons\/([^/]+)\/suspend$/);
  if (adminCouponSuspM && (request.method === 'PUT' || request.method === 'POST')) {
    const cp = await env.DB.prepare('SELECT id, code FROM coupons WHERE id = ?').bind(adminCouponSuspM[1]).first();
    if (!cp) throw notFound('쿠폰을 찾을 수 없습니다.');
    await env.DB.batch([
      env.DB.prepare('UPDATE coupons SET is_active = 0 WHERE id = ?').bind(cp.id),
      audit('COUPON_SUSPEND', 'coupon', cp.id, null, { code: cp.code })
    ]);
    return json(corsHeaders, { success: true, suspended: true });
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
    if (!name) throw bad('CATEGORY_NAME_REQUIRED', '카테고리명은 필수입니다.');
    const id = body.id || newId('cat');
    const parentId = body.parent_id || null;
    if (parentId) {
      const parent = await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(parentId).first();
      if (!parent) throw bad('INVALID_PARENT_CATEGORY', '존재하지 않는 상위 카테고리입니다.');
    }
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

  // 2-9: category icon, commission (0~3000bps) and notice template.
  // Commission rates are read live at checkout, so changes price new orders only.
  if (adminCatMatch && (request.method === 'PUT' || request.method === 'PATCH')) {
    const body = await readJson(request);
    const cat = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(adminCatMatch[1]).first();
    if (!cat) throw notFound('카테고리를 찾을 수 없습니다.');
    let bps = cat.commission_rate_bps;
    if (body.commission_rate_bps !== undefined) {
      bps = body.commission_rate_bps === null ? null : intParam(body.commission_rate_bps, { min: 0, max: 3000, field: '수수료율' });
    }
    let tpl = cat.notice_template_id;
    if (body.notice_template_id !== undefined) {
      if (body.notice_template_id === null || String(body.notice_template_id).trim() === '') tpl = null;
      else {
        const t = await env.DB.prepare('SELECT id FROM notice_templates WHERE id = ? AND is_active = 1').bind(String(body.notice_template_id)).first();
        if (!t) throw bad('INVALID_NOTICE_TEMPLATE', '사용할 수 없는 고시 템플릿입니다.');
        tpl = t.id;
      }
    }
    const icon = body.icon_key !== undefined ? (body.icon_key === null ? null : str(body.icon_key, { field: '아이콘', max: 60 })) : cat.icon_key;
    const name = body.name !== undefined ? str(body.name, { field: '카테고리명', max: 200, required: true }) : cat.name;
    await env.DB.batch([
      env.DB.prepare('UPDATE categories SET name = ?, icon_key = ?, commission_rate_bps = ?, notice_template_id = ? WHERE id = ?')
        .bind(name, icon, bps, tpl, cat.id),
      audit('CATEGORY_UPDATE', 'category', cat.id, { commission_rate_bps: cat.commission_rate_bps }, { commission_rate_bps: bps, icon_key: icon, notice_template_id: tpl })
    ]);
    const updatedCat = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(cat.id).first();
    return json(corsHeaders, { success: true, ...updatedCat, data: updatedCat });
  }

  // 2-9: notice templates. Content edits bump the version; products snapshot theirs.
  if (url.pathname === '/api/v1/admin/notice-templates' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM notice_templates ORDER BY updated_at DESC').all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  if (url.pathname === '/api/v1/admin/notice-templates' && request.method === 'POST') {
    const body = await readJson(request);
    const name = str(body.name, { field: '템플릿명', max: 200, required: true });
    const items = body.items;
    if (!Array.isArray(items) || !items.length) throw bad('ITEMS_REQUIRED', '고시 항목(items) 배열이 필요합니다.');
    const clean = items.map((it, i) => {
      const key = str(it.key, { field: `항목 ${i + 1} 키`, max: 200, required: true });
      return { key, label: str(it.label ?? it.name ?? key, { max: 200 }) || key, required: it.required ? 1 : 0 };
    });
    if (new Set(clean.map((it) => it.key)).size !== clean.length) throw bad('DUPLICATE_ITEM', '항목 키가 중복되었습니다.');
    const id = newId('nt');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO notice_templates (id, name, items_json, version, is_active) VALUES (?, ?, ?, 1, ?)')
        .bind(id, name, JSON.stringify(clean), body.is_active === 0 || body.is_active === false ? 0 : 1),
      audit('NOTICE_TEMPLATE_CREATE', 'notice_template', id, null, { name })
    ]);
    const createdTpl = await env.DB.prepare('SELECT * FROM notice_templates WHERE id = ?').bind(id).first();
    return json(corsHeaders, { success: true, ...createdTpl, data: createdTpl }, 201);
  }
  const ntM = url.pathname.match(/^\/api\/v1\/admin\/notice-templates\/([^/]+)$/);
  if (ntM && (request.method === 'PUT' || request.method === 'PATCH')) {
    const body = await readJson(request);
    const tpl = await env.DB.prepare('SELECT * FROM notice_templates WHERE id = ?').bind(ntM[1]).first();
    if (!tpl) throw notFound('고시 템플릿을 찾을 수 없습니다.');
    let itemsJson = tpl.items_json;
    let bump = false;
    if (body.items !== undefined) {
      if (!Array.isArray(body.items) || !body.items.length) throw bad('ITEMS_REQUIRED', '고시 항목(items) 배열이 필요합니다.');
      const clean = body.items.map((it, i) => {
        const key = str(it.key, { field: `항목 ${i + 1} 키`, max: 200, required: true });
        return { key, label: str(it.label ?? it.name ?? key, { max: 200 }) || key, required: it.required ? 1 : 0 };
      });
      if (new Set(clean.map((it) => it.key)).size !== clean.length) throw bad('DUPLICATE_ITEM', '항목 키가 중복되었습니다.');
      const next = JSON.stringify(clean);
      if (next !== tpl.items_json) { itemsJson = next; bump = true; }
    }
    const name = body.name !== undefined ? str(body.name, { field: '템플릿명', max: 200, required: true }) : tpl.name;
    if (name !== tpl.name) bump = true;
    await env.DB.batch([
      env.DB.prepare('UPDATE notice_templates SET name = ?, items_json = ?, version = version + ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(name, itemsJson, bump ? 1 : 0, body.is_active !== undefined ? (body.is_active ? 1 : 0) : tpl.is_active, tpl.id),
      audit('NOTICE_TEMPLATE_UPDATE', 'notice_template', tpl.id, { version: tpl.version }, { version: tpl.version + (bump ? 1 : 0) })
    ]);
    const updatedTpl = await env.DB.prepare('SELECT * FROM notice_templates WHERE id = ?').bind(tpl.id).first();
    return json(corsHeaders, { success: true, ...updatedTpl, data: updatedTpl });
  }

  // 2-9: platform policies with trigger-kept history. Backdates are refused
  // (>= today, matching the d1_56 guard: an effective-today policy is live).
  if (url.pathname === '/api/v1/admin/platform-policies' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM platform_policies ORDER BY key ASC').all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  if (url.pathname === '/api/v1/admin/platform-policies' && (request.method === 'PUT' || request.method === 'POST')) {
    const body = await readJson(request);
    const key = str(body.key, { field: '정책 키', max: 100, required: true });
    if (body.value === undefined || body.value === null || String(body.value).trim() === '') throw bad('VALUE_REQUIRED', '정책 값을 입력해 주세요.');
    const value = String(body.value).slice(0, 2000);
    const eff = str(body.effective_from, { field: '적용일', max: 10, required: true });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) throw bad('INVALID_DATE', '적용일은 YYYY-MM-DD 형식이어야 합니다.');
    const today = new Date().toISOString().slice(0, 10);
    if (eff < today) throw bad('POLICY_NO_BACKDATE', '적용일은 오늘 이후여야 합니다.');
    const before = await env.DB.prepare('SELECT * FROM platform_policies WHERE key = ?').bind(key).first();
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO platform_policies (key, value, effective_from, updated_by) VALUES (?, ?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, effective_from = excluded.effective_from,
             updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
        ).bind(key, value, eff, admin.userId),
        audit('POLICY_UPSERT', 'platform_policy', key, before ? { value: before.value, effective_from: before.effective_from } : null, { value, effective_from: eff })
      ]);
    } catch (e) {
      if (String(e && e.message || '').includes('POLICY_NO_BACKDATE')) throw bad('POLICY_NO_BACKDATE', '적용일은 오늘 이후여야 합니다.');
      throw e;
    }
    const row = await env.DB.prepare('SELECT * FROM platform_policies WHERE key = ?').bind(key).first();
    return json(corsHeaders, { success: true, ...row, data: row });
  }

  // 2-9: flash-sale campaigns, direct picks, application review.
  const normDt = (v, field) => {
    const s = str(v, { field, max: 30, required: true });
    if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s)) throw bad('INVALID_DATETIME', `${field}은 YYYY-MM-DD[ HH:MM[:SS]] 형식이어야 합니다.`);
    return s.length === 10 ? `${s} 00:00:00` : (s.length === 16 ? `${s}:00` : s);
  };
  if (url.pathname === '/api/v1/admin/flash-sales' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM flash_sale_campaigns ORDER BY starts_at DESC').all();
    for (const c of results) {
      c.items = (await env.DB.prepare('SELECT * FROM flash_sale_items WHERE campaign_id = ? ORDER BY sort_order ASC').bind(c.id).all()).results;
    }
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  if (url.pathname === '/api/v1/admin/flash-sales' && request.method === 'POST') {
    const body = await readJson(request);
    const title = str(body.title, { field: '캠페인명', max: 200, required: true });
    const startsAt = normDt(body.starts_at, '시작일시');
    const endsAt = normDt(body.ends_at, '종료일시');
    if (!(endsAt > startsAt)) throw bad('INVALID_WINDOW', '종료일시는 시작일시보다 늦어야 합니다.');
    const status = body.status === undefined ? 'DRAFT' : String(body.status).toUpperCase();
    if (!['DRAFT', 'ACTIVE', 'ENDED'].includes(status)) throw bad('INVALID_STATUS', 'status는 DRAFT·ACTIVE·ENDED 중 하나여야 합니다.');
    const id = newId('fls');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO flash_sale_campaigns (id, title, banner_url, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, title, body.banner_url !== undefined ? safeUrl(body.banner_url, { field: '배너', allowRelative: true }) : null, startsAt, endsAt, status),
      audit('FLASH_CAMPAIGN_CREATE', 'flash_sale_campaign', id, null, { title, status })
    ]);
    const createdCamp = await env.DB.prepare('SELECT * FROM flash_sale_campaigns WHERE id = ?').bind(id).first();
    return json(corsHeaders, { success: true, ...createdCamp, data: createdCamp }, 201);
  }
  const flsPutM = url.pathname.match(/^\/api\/v1\/admin\/flash-sales\/([^/]+)$/);
  if (flsPutM && (request.method === 'PUT' || request.method === 'PATCH')) {
    const body = await readJson(request);
    const camp = await env.DB.prepare('SELECT * FROM flash_sale_campaigns WHERE id = ?').bind(flsPutM[1]).first();
    if (!camp) throw notFound('특가 캠페인을 찾을 수 없습니다.');
    const startsAt = body.starts_at !== undefined ? normDt(body.starts_at, '시작일시') : camp.starts_at;
    const endsAt = body.ends_at !== undefined ? normDt(body.ends_at, '종료일시') : camp.ends_at;
    if (!(endsAt > startsAt)) throw bad('INVALID_WINDOW', '종료일시는 시작일시보다 늦어야 합니다.');
    const status = body.status !== undefined ? String(body.status).toUpperCase() : camp.status;
    if (!['DRAFT', 'ACTIVE', 'ENDED'].includes(status)) throw bad('INVALID_STATUS', 'status는 DRAFT·ACTIVE·ENDED 중 하나여야 합니다.');
    await env.DB.batch([
      env.DB.prepare('UPDATE flash_sale_campaigns SET title = ?, banner_url = ?, starts_at = ?, ends_at = ?, status = ? WHERE id = ?')
        .bind(body.title !== undefined ? str(body.title, { field: '캠페인명', max: 200, required: true }) : camp.title,
          body.banner_url !== undefined ? (body.banner_url === null ? null : safeUrl(body.banner_url, { field: '배너', allowRelative: true })) : camp.banner_url,
          startsAt, endsAt, status, camp.id),
      audit('FLASH_CAMPAIGN_UPDATE', 'flash_sale_campaign', camp.id, { status: camp.status }, { status })
    ]);
    const updatedCamp = await env.DB.prepare('SELECT * FROM flash_sale_campaigns WHERE id = ?').bind(camp.id).first();
    return json(corsHeaders, { success: true, ...updatedCamp, data: updatedCamp });
  }
  const flsItemPostM = url.pathname.match(/^\/api\/v1\/admin\/flash-sales\/([^/]+)\/items$/);
  if (flsItemPostM && request.method === 'POST') {
    const body = await readJson(request);
    const camp = await env.DB.prepare('SELECT * FROM flash_sale_campaigns WHERE id = ?').bind(flsItemPostM[1]).first();
    if (!camp) throw notFound('특가 캠페인을 찾을 수 없습니다.');
    if (camp.status === 'ENDED') throw conflict('CAMPAIGN_CLOSED', '종료된 캠페인에는 편성할 수 없습니다.');
    const sku = await env.DB.prepare('SELECT id, product_id, sale_price, original_price, stock_quantity FROM product_skus WHERE id = ?').bind(String(body.sku_id || '')).first();
    if (!sku) throw notFound('옵션을 찾을 수 없습니다.');
    const deal = intParam(body.deal_price, { min: 100, max: 100_000_000, field: '딜가' });
    if (deal >= sku.sale_price) throw bad('DEAL_NOT_BELOW_SALE', '딜가는 판매가보다 낮아야 합니다.');
    const alloc = intParam(body.allocated_stock, { min: 1, max: 1_000_000, field: '배정 수량' });
    if (alloc > sku.stock_quantity) throw bad('ALLOCATION_EXCEEDS_STOCK', '배정 수량은 현재 재고를 넘을 수 없습니다.');
    const itemId = newId('fsi');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO flash_sale_items (id, campaign_id, product_id, sku_id, deal_price, discount_rate, allocated_stock, sold_stock, sort_order, status, applicant_partner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'APPROVED', NULL)`
      ).bind(itemId, camp.id, sku.product_id, sku.id, deal,
        sku.original_price > deal ? Math.floor(((sku.original_price - deal) * 100) / sku.original_price) : 0, alloc,
        body.sort_order === undefined ? 0 : intParam(body.sort_order, { min: 0, max: 100000, field: '정렬 순서' })),
      audit('FLASH_ITEM_ASSIGN', 'flash_sale_item', itemId, null, { campaign_id: camp.id, sku_id: sku.id, deal_price: deal })
    ]);
    const createdItem = await env.DB.prepare('SELECT * FROM flash_sale_items WHERE id = ?').bind(itemId).first();
    return json(corsHeaders, { success: true, ...createdItem, data: createdItem }, 201);
  }
  const flsItemPutM = url.pathname.match(/^\/api\/v1\/admin\/flash-sales\/([^/]+)\/items\/([^/]+)$/);
  if (flsItemPutM && (request.method === 'PUT' || request.method === 'PATCH')) {
    const body = await readJson(request);
    const camp = await env.DB.prepare('SELECT * FROM flash_sale_campaigns WHERE id = ?').bind(flsItemPutM[1]).first();
    if (!camp) throw notFound('특가 캠페인을 찾을 수 없습니다.');
    const item = await env.DB.prepare('SELECT * FROM flash_sale_items WHERE id = ? AND campaign_id = ?').bind(flsItemPutM[2], camp.id).first();
    if (!item) throw notFound('특가 상품을 찾을 수 없습니다.');
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const live = camp.status === 'ACTIVE' && camp.starts_at <= now && now < camp.ends_at;
    if (body.decision !== undefined) {
      const dec = String(body.decision).toUpperCase();
      if (!['APPROVE', 'APPROVED', 'REJECT', 'REJECTED'].includes(dec)) throw bad('INVALID_DECISION', 'decision은 APPROVE 또는 REJECT입니다.');
      if (item.status !== 'REQUESTED') throw conflict('NOT_REQUESTED', '신청 상태의 특가만 승인·반려할 수 있습니다.');
      const next = dec.startsWith('APPROVE') ? 'APPROVED' : 'REJECTED';
      await env.DB.batch([
        env.DB.prepare('UPDATE flash_sale_items SET status = ? WHERE id = ?').bind(next, item.id),
        audit('FLASH_ITEM_DECISION', 'flash_sale_item', item.id, { status: item.status }, { status: next })
      ]);
      const decided = await env.DB.prepare('SELECT * FROM flash_sale_items WHERE id = ?').bind(item.id).first();
      return json(corsHeaders, { success: true, ...decided, data: decided });
    }
    if (body.deal_price !== undefined) {
      if (live) throw conflict('DEAL_FROZEN_WHILE_LIVE', '진행 중인 특가의 딜가는 바꿀 수 없습니다.');
      const sku = await env.DB.prepare('SELECT sale_price, original_price FROM product_skus WHERE id = ?').bind(item.sku_id).first();
      const deal = intParam(body.deal_price, { min: 100, max: 100_000_000, field: '딜가' });
      if (sku && deal >= sku.sale_price) throw bad('DEAL_NOT_BELOW_SALE', '딜가는 판매가보다 낮아야 합니다.');
      await env.DB.batch([
        env.DB.prepare('UPDATE flash_sale_items SET deal_price = ? WHERE id = ?').bind(deal, item.id),
        audit('FLASH_ITEM_PRICE', 'flash_sale_item', item.id, { deal_price: item.deal_price }, { deal_price: deal })
      ]);
    }
    if (body.allocated_stock !== undefined) {
      const alloc = intParam(body.allocated_stock, { min: item.sold_stock || 0, max: 1_000_000, field: '배정 수량' });
      await env.DB.batch([
        env.DB.prepare('UPDATE flash_sale_items SET allocated_stock = ? WHERE id = ?').bind(alloc, item.id),
        audit('FLASH_ITEM_ALLOC', 'flash_sale_item', item.id, { allocated_stock: item.allocated_stock }, { allocated_stock: alloc })
      ]);
    }
    const updatedItem = await env.DB.prepare('SELECT * FROM flash_sale_items WHERE id = ?').bind(item.id).first();
    return json(corsHeaders, { success: true, ...updatedItem, data: updatedItem });
  }

  // 2-9: exhibitions with product lineups.
  if (url.pathname === '/api/v1/admin/exhibitions' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM exhibitions ORDER BY sort_order ASC, starts_at DESC').all();
    for (const e of results) {
      e.product_ids = (await env.DB.prepare('SELECT product_id FROM exhibition_products WHERE exhibition_id = ? ORDER BY sort_order ASC').bind(e.id).all()).results.map((r) => r.product_id);
    }
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  if (url.pathname === '/api/v1/admin/exhibitions' && request.method === 'POST') {
    const body = await readJson(request);
    const title = str(body.title, { field: '기획전명', max: 200, required: true });
    const startsAt = normDt(body.starts_at, '시작일시');
    const endsAt = normDt(body.ends_at, '종료일시');
    if (!(endsAt > startsAt)) throw bad('INVALID_WINDOW', '종료일시는 시작일시보다 늦어야 합니다.');
    const status = body.status === undefined ? 'DRAFT' : String(body.status).toUpperCase();
    if (!['DRAFT', 'ACTIVE', 'ENDED'].includes(status)) throw bad('INVALID_STATUS', 'status는 DRAFT·ACTIVE·ENDED 중 하나여야 합니다.');
    const pids = Array.isArray(body.product_ids) ? [...new Set(body.product_ids.map((x) => String(x || '').trim()).filter(Boolean))] : [];
    for (const pid of pids) {
      const ok = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(pid).first();
      if (!ok) throw bad('INVALID_PRODUCT', `상품(${pid})을 찾을 수 없습니다.`);
    }
    const id = newId('exh');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO exhibitions (id, title, banner_url, starts_at, ends_at, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, title, body.banner_url !== undefined ? safeUrl(body.banner_url, { field: '배너', allowRelative: true }) : null,
          startsAt, endsAt, status, body.sort_order === undefined ? 0 : intParam(body.sort_order, { min: 0, max: 100000, field: '정렬 순서' })),
      ...pids.map((pid, i) => env.DB.prepare('INSERT INTO exhibition_products (exhibition_id, product_id, sort_order) VALUES (?, ?, ?)').bind(id, pid, i)),
      audit('EXHIBITION_CREATE', 'exhibition', id, null, { title, status })
    ]);
    const createdEx = await env.DB.prepare('SELECT * FROM exhibitions WHERE id = ?').bind(id).first();
    return json(corsHeaders, { success: true, ...createdEx, data: createdEx }, 201);
  }
  const exhM = url.pathname.match(/^\/api\/v1\/admin\/exhibitions\/([^/]+)$/);
  if (exhM && (request.method === 'PUT' || request.method === 'PATCH')) {
    const body = await readJson(request);
    const ex = await env.DB.prepare('SELECT * FROM exhibitions WHERE id = ?').bind(exhM[1]).first();
    if (!ex) throw notFound('기획전을 찾을 수 없습니다.');
    const startsAt = body.starts_at !== undefined ? normDt(body.starts_at, '시작일시') : ex.starts_at;
    const endsAt = body.ends_at !== undefined ? normDt(body.ends_at, '종료일시') : ex.ends_at;
    if (!(endsAt > startsAt)) throw bad('INVALID_WINDOW', '종료일시는 시작일시보다 늦어야 합니다.');
    const status = body.status !== undefined ? String(body.status).toUpperCase() : ex.status;
    if (!['DRAFT', 'ACTIVE', 'ENDED'].includes(status)) throw bad('INVALID_STATUS', 'status는 DRAFT·ACTIVE·ENDED 중 하나여야 합니다.');
    const stmts = [env.DB.prepare('UPDATE exhibitions SET title = ?, banner_url = ?, starts_at = ?, ends_at = ?, status = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(body.title !== undefined ? str(body.title, { field: '기획전명', max: 200, required: true }) : ex.title,
        body.banner_url !== undefined ? (body.banner_url === null ? null : safeUrl(body.banner_url, { field: '배너', allowRelative: true })) : ex.banner_url,
        startsAt, endsAt, status,
        body.sort_order !== undefined ? intParam(body.sort_order, { min: 0, max: 100000, field: '정렬 순서' }) : ex.sort_order, ex.id)];
    if (body.product_ids !== undefined) {
      if (!Array.isArray(body.product_ids)) throw bad('INVALID_PRODUCTS', 'product_ids는 배열이어야 합니다.');
      const pids = [...new Set(body.product_ids.map((x) => String(x || '').trim()).filter(Boolean))];
      for (const pid of pids) {
        const ok = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(pid).first();
        if (!ok) throw bad('INVALID_PRODUCT', `상품(${pid})을 찾을 수 없습니다.`);
      }
      stmts.push(env.DB.prepare('DELETE FROM exhibition_products WHERE exhibition_id = ?').bind(ex.id));
      pids.forEach((pid, i) => stmts.push(env.DB.prepare('INSERT INTO exhibition_products (exhibition_id, product_id, sort_order) VALUES (?, ?, ?)').bind(ex.id, pid, i)));
    }
    stmts.push(audit('EXHIBITION_UPDATE', 'exhibition', ex.id, { status: ex.status }, { status }));
    await env.DB.batch(stmts);
    const updatedEx = await env.DB.prepare('SELECT * FROM exhibitions WHERE id = ?').bind(ex.id).first();
    return json(corsHeaders, { success: true, ...updatedEx, data: updatedEx });
  }

  // 2-9: payout request decisions. Approvals pay through the payout engine;
  // transfers mirror onto the linked request. Keys are mandatory (2-common-6).
  if (url.pathname === '/api/v1/admin/payout-requests' && request.method === 'GET') {
    const stRaw = url.searchParams.get('status');
    const fst = stRaw ? String(stRaw).toUpperCase() : null;
    if (fst && !['REQUESTED', 'APPROVED', 'REJECTED', 'TRANSFERRED', 'CANCELLED'].includes(fst)) throw bad('INVALID_STATUS', 'status 값이 올바르지 않습니다.');
    const { results } = await env.DB.prepare(
      `SELECT r.*, p.business_name FROM payout_requests r JOIN partners p ON p.id = r.partner_id
       ${fst ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC`
    ).bind(...(fst ? [fst] : [])).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  const pwrM = url.pathname.match(/^\/api\/v1\/admin\/payout-requests\/([^/]+)$/);
  if (pwrM && (request.method === 'PUT' || request.method === 'POST')) {
    const body = await readJson(request);
    const decision = String(body.decision || '').toUpperCase();
    if (!['APPROVE', 'APPROVED', 'REJECT', 'REJECTED', 'TRANSFER', 'TRANSFERRED'].includes(decision)) {
      throw bad('INVALID_DECISION', 'decision은 APPROVE·REJECT·TRANSFER 중 하나여야 합니다.');
    }
    const key = idempotencyKey(body.idempotency_key ?? request.headers.get('X-Idempotency-Key') ?? null);
    if (!key) throw bad('IDEMPOTENCY_KEY_REQUIRED', 'X-Idempotency-Key 헤더가 필요합니다.');
    if (decision.startsWith('REJECT')) {
      const row = await decidePayoutRequest(env, { requestId: pwrM[1], approve: false, reason: body.reason, adminId: admin.userId, adminRole: admin.adminRole });
      return json(corsHeaders, { success: true, ...row, data: row });
    }
    if (decision.startsWith('TRANSFER')) {
      const row = await env.DB.prepare('SELECT * FROM payout_requests WHERE id = ?').bind(pwrM[1]).first();
      if (!row) throw notFound('출금 신청을 찾을 수 없습니다.');
      if (row.status !== 'APPROVED' || !row.payout_id) throw conflict('NOT_APPROVED', '승인된 신청만 이체 완료 처리할 수 있습니다.');
      const ref = str(body.bank_transfer_ref, { field: '이체 참조번호', max: 100, required: true });
      const r = await env.DB.batch([
        env.DB.prepare("UPDATE payouts SET status = 'TRANSFERRED', bank_transfer_ref = ? WHERE id = ? AND status = 'APPROVED'").bind(ref, row.payout_id),
        audit('PAYOUT_REQUEST_TRANSFER', 'payout_request', row.id, { status: 'APPROVED' }, { status: 'TRANSFERRED', bank_transfer_ref: ref })
      ]);
      if (r[0].meta.changes !== 1) throw conflict('PAYOUT_NOT_APPROVED', '지급 대기 상태의 건이 아닙니다.');
      await markRequestTransferred(env, row.payout_id);
      const done = await env.DB.prepare('SELECT * FROM payout_requests WHERE id = ?').bind(row.id).first();
      return json(corsHeaders, { success: true, ...done, data: done });
    }
    const row = await decidePayoutRequest(env, { requestId: pwrM[1], approve: true, adminId: admin.userId, adminRole: admin.adminRole, idemKey: key });
    return json(corsHeaders, { success: true, ...row, data: row });
  }

  // 2-9: penalty rules, imposition and appeal decisions.
  if (url.pathname === '/api/v1/admin/penalty-rules' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM penalty_rules ORDER BY code ASC').all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  if (url.pathname === '/api/v1/admin/penalty-rules' && (request.method === 'PUT' || request.method === 'POST')) {
    const body = await readJson(request);
    const code = str(body.code, { field: '규칙 코드', max: 60, required: true }).toUpperCase();
    const name = str(body.name, { field: '규칙명', max: 200, required: true });
    const points = intParam(body.points ?? 0, { min: 0, max: 1_000_000, field: '점수' });
    const amount = intParam(body.amount ?? 0, { min: 0, max: 100_000_000, field: '금액' });
    const enabled = body.is_enabled ? 1 : 0;
    const before = await env.DB.prepare('SELECT * FROM penalty_rules WHERE code = ?').bind(code).first();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO penalty_rules (code, name, points, amount, is_enabled) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (code) DO UPDATE SET name = excluded.name, points = excluded.points, amount = excluded.amount,
           is_enabled = excluded.is_enabled, updated_at = CURRENT_TIMESTAMP`
      ).bind(code, name, points, amount, enabled),
      audit('PENALTY_RULE_UPSERT', 'penalty_rule', code, before, { name, points, amount, is_enabled: enabled })
    ]);
    const rule = await env.DB.prepare('SELECT * FROM penalty_rules WHERE code = ?').bind(code).first();
    return json(corsHeaders, { success: true, ...rule, data: rule });
  }
  const penImpM = url.pathname.match(/^\/api\/v1\/admin\/partners\/([^/]+)\/penalties$/);
  if (penImpM && request.method === 'POST') {
    const body = await readJson(request);
    const pt = await env.DB.prepare('SELECT id FROM partners WHERE id = ?').bind(penImpM[1]).first();
    if (!pt) throw notFound('입점사를 찾을 수 없습니다.');
    const rule = await env.DB.prepare('SELECT * FROM penalty_rules WHERE code = ?').bind(String(body.rule_code || '').toUpperCase()).first();
    if (!rule) throw notFound('페널티 규칙을 찾을 수 없습니다.');
    if (Number(rule.is_enabled) !== 1) throw conflict('RULE_DISABLED', '꺼진 규칙으로는 부과할 수 없습니다.');
    const reason = str(body.reason, { field: '사유', max: 500, required: true });
    let subId = null;
    if (body.sub_order_id) {
      const s = await env.DB.prepare('SELECT id FROM sub_orders WHERE id = ? AND partner_id = ?').bind(String(body.sub_order_id), pt.id).first();
      if (!s) throw notFound('주문을 찾을 수 없습니다.');
      subId = s.id;
    }
    const id = newId('pp');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO partner_penalties (id, partner_id, sub_order_id, penalty_type, penalty_amount, reason, status, rule_code, points, decided_by)
         VALUES (?, ?, ?, ?, ?, ?, 'IMPOSED', ?, ?, ?)`
      ).bind(id, pt.id, subId, rule.code, rule.amount, reason, rule.code, rule.points, admin.userId),
      audit('PENALTY_IMPOSE', 'penalty', id, null, { partner_id: pt.id, rule_code: rule.code, points: rule.points, amount: rule.amount })
    ]);
    const imposed = await env.DB.prepare('SELECT * FROM partner_penalties WHERE id = ?').bind(id).first();
    return json(corsHeaders, { success: true, ...imposed, data: imposed }, 201);
  }
  const penDecM = url.pathname.match(/^\/api\/v1\/admin\/penalties\/([^/]+)$/);
  if (penDecM && (request.method === 'PUT' || request.method === 'POST')) {
    const body = await readJson(request);
    const pen = await env.DB.prepare('SELECT * FROM partner_penalties WHERE id = ?').bind(penDecM[1]).first();
    if (!pen) throw notFound('페널티를 찾을 수 없습니다.');
    const dec = String(body.decision || '').toUpperCase();
    if (!['REVOKE', 'REVOKED', 'UPHOLD', 'UPHELD'].includes(dec)) throw bad('INVALID_DECISION', 'decision은 REVOKE 또는 UPHOLD입니다.');
    if (['REVOKED', 'UPHELD'].includes(pen.status)) throw conflict('PENALTY_DECIDED', '이미 처리된 페널티입니다.');
    const next = dec.startsWith('REVOKE') ? 'REVOKED' : 'UPHELD';
    const note = str(body.note, { max: 500 });
    await env.DB.batch([
      env.DB.prepare('UPDATE partner_penalties SET status = ?, decided_by = ? WHERE id = ?').bind(next, admin.userId, pen.id),
      audit('PENALTY_DECIDE', 'penalty', pen.id, { status: pen.status }, { status: next, note })
    ]);
    const decided = await env.DB.prepare('SELECT * FROM partner_penalties WHERE id = ?').bind(pen.id).first();
    return json(corsHeaders, { success: true, ...decided, data: decided });
  }

  // 2-9: grade policies + monthly recompute.
  if (url.pathname === '/api/v1/admin/grade-policies' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM grade_policies ORDER BY sort_order ASC').all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }
  if (url.pathname === '/api/v1/admin/grade-policies' && (request.method === 'PUT' || request.method === 'POST')) {
    const body = await readJson(request);
    const code = str(body.grade_code, { field: '등급 코드', max: 20, required: true }).toUpperCase();
    const name = str(body.name, { field: '등급명', max: 200, required: true });
    const rate = (v, field) => (v === undefined || v === null ? null : (() => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) throw bad('INVALID_RATE', `${field}은 0~1 사이여야 합니다.`);
      return n;
    })());
    const row = {
      name, sort_order: body.sort_order === undefined ? 0 : intParam(body.sort_order, { min: 0, max: 100000, field: '정렬 순서' }),
      min_sales: body.min_sales === undefined || body.min_sales === null ? null : intParam(body.min_sales, { min: 0, max: 100_000_000_000, field: '최소 매출' }),
      max_claim_rate: rate(body.max_claim_rate, '최대 클레임율'),
      min_ship_on_time_rate: rate(body.min_ship_on_time_rate, '최소 정시출고율'),
      max_penalty_points: body.max_penalty_points === undefined || body.max_penalty_points === null ? null : intParam(body.max_penalty_points, { min: 0, max: 1_000_000, field: '최대 페널티 점수' }),
      is_enabled: body.is_enabled ? 1 : 0
    };
    const before = await env.DB.prepare('SELECT * FROM grade_policies WHERE grade_code = ?').bind(code).first();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO grade_policies (grade_code, name, sort_order, min_sales, max_claim_rate, min_ship_on_time_rate, max_penalty_points, is_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (grade_code) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order, min_sales = excluded.min_sales,
           max_claim_rate = excluded.max_claim_rate, min_ship_on_time_rate = excluded.min_ship_on_time_rate,
           max_penalty_points = excluded.max_penalty_points, is_enabled = excluded.is_enabled, updated_at = CURRENT_TIMESTAMP`
      ).bind(code, row.name, row.sort_order, row.min_sales, row.max_claim_rate, row.min_ship_on_time_rate, row.max_penalty_points, row.is_enabled),
      audit('GRADE_POLICY_UPSERT', 'grade_policy', code, before, row)
    ]);
    const policy = await env.DB.prepare('SELECT * FROM grade_policies WHERE grade_code = ?').bind(code).first();
    return json(corsHeaders, { success: true, ...policy, data: policy });
  }
  if (url.pathname === '/api/v1/admin/grades/compute' && request.method === 'POST') {
    const body = await readJson(request);
    const month = str(body.month, { field: '월', max: 7, required: true });
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('INVALID_MONTH', 'month는 YYYY-MM 형식이어야 합니다.');
    const n = await computeMonthlyGrades(env, month);
    await audit('GRADES_COMPUTE', 'grade_month', month, null, { computed: n }).run();
    const data = { month, computed: n };
    return json(corsHeaders, { success: true, ...data, data });
  }

  return null;
}

