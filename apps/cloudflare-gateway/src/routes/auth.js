// apps/cloudflare-gateway/src/routes/auth.js
// Unified authentication. Every role logs in with a users-table account and a PBKDF2 password.

import { hashPassword, verifyPassword, randomToken, sha256Hex } from '../utils/crypto-auth.js';
import { issueToken, requireAuth } from '../lib/auth.js';
import { json, readJson, bad, unauthorized, conflict, str, HttpError } from '../lib/http.js';
import { newId, sqlNow } from '../lib/ids.js';
import { grantCreditStatements, getActiveOperator } from '../lib/ledger.js';
import { exportCustomerData, withdrawalBlockers, withdrawCustomer } from '../services/privacy.js';
import { ipAllowed, clientIp, twoFactorRequired } from '../lib/admin-policy.js';
import { verifyAdminSecondFactor } from './admin-security.js';

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const WELCOME_CREDIT = 10000;
const ROLE_ALIASES = { ADMIN: 'ROLE_ADMIN', ROLE_ADMIN: 'ROLE_ADMIN', PARTNER: 'ROLE_PARTNER', ROLE_PARTNER: 'ROLE_PARTNER', CUSTOMER: 'ROLE_CUSTOMER', ROLE_CUSTOMER: 'ROLE_CUSTOMER' };

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10 || pw.length > 128) throw bad('WEAK_PASSWORD', '비밀번호는 10자 이상 128자 이하여야 합니다.');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) throw bad('WEAK_PASSWORD', '비밀번호는 영문 대/소문자, 숫자, 특수문자 중 3종류 이상을 포함해야 합니다.');
}

function publicUser(u) {
  return { id: u.id, email: u.email, full_name: u.full_name, name: u.full_name, phone: u.phone, role: u.role, email_verified: u.email_verified };
}

export async function handleAuthRoutes(request, url, env, corsHeaders) {
  if (!url.pathname.startsWith('/api/v1/auth')) return null;
  const p = url.pathname;

  if (p === '/api/v1/auth/login' && request.method === 'POST') {
    const body = await readJson(request);
    const email = str(body.email, { field: '이메일', max: 254 }).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const expectedRole = ROLE_ALIASES[String(body.role || 'CUSTOMER').toUpperCase()] || 'ROLE_CUSTOMER';
    if (!email || !password) throw bad('CREDENTIALS_REQUIRED', '이메일과 비밀번호를 입력해 주세요.');

    const user = await env.DB.prepare('SELECT * FROM users WHERE LOWER(email) = ?').bind(email).first();
    const generic = unauthorized('이메일 또는 비밀번호가 올바르지 않습니다.');
    if (!user) { await verifyPassword(password, 'pbkdf2:100000:00:00'); throw generic; }
    if (user.locked_until && user.locked_until > sqlNow()) throw new HttpError(423, 'ACCOUNT_LOCKED', '로그인 시도가 너무 많아 잠시 잠겼습니다. 15분 후 다시 시도해 주세요.');
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const fails = Number(user.failed_login_count || 0) + 1;
      await env.DB.prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?')
        .bind(fails >= MAX_FAILED ? 0 : fails, fails >= MAX_FAILED ? sqlNow(LOCK_MS) : null, user.id).run();
      throw generic;
    }
    if (Number(user.is_active) !== 1) throw new HttpError(403, 'ACCOUNT_DISABLED', '비활성화된 계정입니다.');
    if (user.role !== expectedRole) throw generic; // do not reveal which role the account has
    let mfa = false;
    if (user.role === 'ROLE_ADMIN') {
      if (!ipAllowed(env, clientIp(request))) throw new HttpError(403, 'ADMIN_IP_NOT_ALLOWED', '허용되지 않은 위치에서의 관리자 로그인입니다.');
      if (user.totp_enabled_at) {
        if (!body.otp && !body.recovery_code) throw new HttpError(401, 'OTP_REQUIRED', '인증 앱의 6자리 코드를 입력해 주세요.');
        if (!(await verifyAdminSecondFactor(env, user, { otp: body.otp, recoveryCode: body.recovery_code }))) {
          const fails = Number(user.failed_login_count || 0) + 1;
          await env.DB.prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?')
            .bind(fails >= MAX_FAILED ? 0 : fails, fails >= MAX_FAILED ? sqlNow(LOCK_MS) : null, user.id).run();
          throw new HttpError(401, 'OTP_INVALID', '인증 코드가 올바르지 않거나 이미 사용되었습니다.');
        }
        mfa = true;
      }
    }
    await env.DB.prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?').bind(user.id).run();

    let partner = null;
    if (user.role === 'ROLE_PARTNER') {
      partner = await env.DB.prepare('SELECT id, business_name, status, sales_model FROM partners WHERE owner_user_id = ?').bind(user.id).first();
      if (!partner) throw new HttpError(403, 'PARTNER_PROFILE_MISSING', '입점사 정보가 연결되지 않은 판매자 계정입니다.');
    }
    const token = await issueToken(env, user, partner, { mfa });
    const payload = {
      role: user.role, token, expiresIn: 43200, user: publicUser(user),
      ...(user.role === 'ROLE_ADMIN' ? { admin_role: user.admin_role, mfa_enabled: Boolean(user.totp_enabled_at), mfa_setup_required: !user.totp_enabled_at && twoFactorRequired(env) } : {}),
      ...(user.role === 'ROLE_CUSTOMER' ? { customer_id: user.id } : {}),
      ...(partner ? { partner_id: partner.id, partner } : {})
    };
    return json(corsHeaders, { success: true, ...payload, data: payload });
  }

  if (p === '/api/v1/auth/register' && request.method === 'POST') {
    const body = await readJson(request);
    const email = str(body.email, { field: '이메일', max: 254, required: true }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('INVALID_EMAIL', '이메일 형식이 올바르지 않습니다.');
    const fullName = str(body.full_name || body.name, { field: '성명', max: 50, required: true });
    const phone = str(body.phone, { field: '휴대폰 번호', max: 20, required: true });
    if (!/^01[016789]-?\d{3,4}-?\d{4}$/.test(phone)) throw bad('INVALID_PHONE', '휴대폰 번호 형식이 올바르지 않습니다.');
    if (body.agree_terms !== true || body.agree_privacy !== true) throw bad('CONSENT_REQUIRED', '이용약관 및 개인정보 수집·이용에 동의해 주세요.');
    validatePassword(body.password);

    const exists = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(email).first();
    if (exists) throw conflict('EMAIL_TAKEN', '이미 등록된 이메일입니다.');
    const userId = newId('usr');
    const hash = await hashPassword(body.password);
    const operator = await getActiveOperator(env);
    const st = [
      env.DB.prepare(`INSERT INTO users (id, email, password_hash, full_name, phone, role, is_active) VALUES (?, ?, ?, ?, ?, 'ROLE_CUSTOMER', 1)`)
        .bind(userId, email, hash, fullName, phone)
    ];
    if (operator) {
      st.push(...grantCreditStatements(env, { userId, amount: WELCOME_CREDIT, reason: '신규 가입 웰컴 적립금', referenceId: `welcome:${userId}`, entityId: operator.id, txnType: 'WELCOME_CREDIT' }));
    }
    try {
      await env.DB.batch(st);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('EMAIL_TAKEN', '이미 등록된 이메일입니다.');
      throw e;
    }
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    const token = await issueToken(env, user, null);
    const payload = { role: 'ROLE_CUSTOMER', token, customer_id: userId, user: publicUser(user), welcome_credit: operator ? WELCOME_CREDIT : 0, expiresIn: 43200 };
    return json(corsHeaders, { success: true, message: '회원가입이 완료되었습니다.', ...payload, data: payload }, 201);
  }

  if ((p === '/api/v1/auth/me' || p === '/api/v1/auth/profile') && request.method === 'GET') {
    const me = await requireAuth(request, env);
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.userId).first();
    const credit = await env.DB.prepare('SELECT COALESCE(SUM(amount_delta), 0) AS b FROM user_credits WHERE user_id = ?').bind(me.userId).first('b');
    const coupons = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id WHERE uc.user_id = ? AND uc.is_used = 0 AND c.is_active = 1 AND c.expires_at > ?'
    ).bind(me.userId, sqlNow()).first('c');
    const wish = await env.DB.prepare('SELECT COUNT(*) AS c FROM wishlists WHERE user_id = ?').bind(me.userId).first('c');
    const adminInfo = user.role === 'ROLE_ADMIN' ? { admin: { role: user.admin_role, mfa_enabled: Boolean(user.totp_enabled_at), mfa_setup_required: !user.totp_enabled_at && twoFactorRequired(env) } } : {};
    return json(corsHeaders, { success: true, data: { user: publicUser(user), partner_id: me.partnerId, credit_balance: credit, available_coupons: coupons, wishlist_count: wish, ...adminInfo } });
  }

  if (p === '/api/v1/auth/profile' && (request.method === 'PUT' || request.method === 'PATCH')) {
    const me = await requireAuth(request, env);
    const body = await readJson(request);
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.userId).first();
    const fullName = body.full_name !== undefined ? str(body.full_name, { field: '성명', max: 50, required: true }) : user.full_name;
    const phone = body.phone !== undefined ? str(body.phone, { field: '휴대폰 번호', max: 20, required: true }) : user.phone;
    let hash = user.password_hash;
    let tokenVersion = Number(user.token_version || 0);
    if (body.new_password !== undefined) {
      if (!(await verifyPassword(String(body.current_password || ''), user.password_hash))) throw bad('CURRENT_PASSWORD_MISMATCH', '현재 비밀번호가 일치하지 않습니다.');
      validatePassword(body.new_password);
      hash = await hashPassword(body.new_password);
      tokenVersion += 1; // revoke all other sessions
    }
    await env.DB.prepare('UPDATE users SET full_name = ?, phone = ?, password_hash = ?, token_version = ?, password_changed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE password_changed_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(fullName, phone, hash, tokenVersion, body.new_password !== undefined ? 1 : 0, me.userId).run();
    const updated = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.userId).first();
    const token = tokenVersion !== Number(user.token_version || 0) ? await issueToken(env, updated, me.partner, { mfa: me.mfa }) : undefined;
    return json(corsHeaders, { success: true, message: '회원 정보가 수정되었습니다.', data: { user: publicUser(updated), token } });
  }

  // O10: 개인정보 열람 (data-subject export) and 회원 탈퇴 (withdrawal).
  if (p === '/api/v1/auth/privacy/export' && request.method === 'GET') {
    const me = await requireAuth(request, env, ['ROLE_CUSTOMER']);
    return json(corsHeaders, { success: true, data: await exportCustomerData(env, me, request) });
  }

  if (p === '/api/v1/auth/withdraw/precheck' && request.method === 'GET') {
    const me = await requireAuth(request, env, ['ROLE_CUSTOMER']);
    const blockers = await withdrawalBlockers(env, me.userId);
    const credit = await env.DB.prepare('SELECT COALESCE(SUM(amount_delta), 0) AS b FROM user_credits WHERE user_id = ?').bind(me.userId).first('b');
    return json(corsHeaders, { success: true, data: { can_withdraw: blockers.length === 0, blockers, credit_balance: credit } });
  }

  if (p === '/api/v1/auth/withdraw' && request.method === 'POST') {
    const me = await requireAuth(request, env);
    if (me.role !== 'ROLE_CUSTOMER') throw conflict('WITHDRAWAL_NOT_SELF_SERVICE', '판매자·운영자 계정은 정산·계약 정리 후 운영자 절차로 해지합니다.');
    const body = await readJson(request);
    if (body.confirm !== true) throw bad('CONFIRM_REQUIRED', '탈퇴 안내를 확인하고 동의해 주세요.');
    const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(me.userId).first();
    if (!(await verifyPassword(String(body.password || ''), user.password_hash))) throw bad('CURRENT_PASSWORD_MISMATCH', '비밀번호가 일치하지 않습니다.');
    const r = await withdrawCustomer(env, me, { acknowledgeCreditForfeit: body.acknowledge_credit_forfeit === true, request });
    return json(corsHeaders, { success: true, message: '회원 탈퇴가 완료되었습니다. 법령에 따라 보관하는 거래 기록은 보관 기간이 끝나면 파기됩니다.', data: r });
  }

  if (p === '/api/v1/auth/logout-all' && request.method === 'POST') {
    const me = await requireAuth(request, env);
    await env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').bind(me.userId).run();
    return json(corsHeaders, { success: true, message: '모든 기기에서 로그아웃되었습니다.' });
  }

  if (p === '/api/v1/auth/forgot-password' && request.method === 'POST') {
    const body = await readJson(request);
    const email = str(body.email, { field: '이메일', max: 254, required: true }).toLowerCase();
    const user = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(email).first();
    let devToken;
    if (user) {
      const token = randomToken(32);
      await env.DB.prepare('INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
        .bind(newId('prt'), user.id, await sha256Hex(token), new Date(Date.now() + 30 * 60 * 1000).toISOString()).run();
      // E-mail delivery provider is not integrated yet; the token is only exposed in local development.
      if (env.ENVIRONMENT === 'development') devToken = token;
    }
    // No mail provider is integrated, so nothing is sent: say so instead of "안내가 발송됩니다" (a buyer would
    // wait for a mail that never comes). Same answer for registered and unknown addresses (no enumeration).
    return json(corsHeaders, {
      success: true,
      message: '현재 이메일 발송 기능이 연동되어 있지 않아 재설정 안내 메일을 보내지 못합니다. 고객센터로 문의해 주세요.',
      email_delivery: 'NOT_INTEGRATED',
      ...(devToken ? { dev_reset_token: devToken } : {})
    });
  }

  if (p === '/api/v1/auth/reset-password' && request.method === 'POST') {
    const body = await readJson(request);
    const token = str(body.token, { field: '토큰', max: 200, required: true });
    validatePassword(body.new_password);
    const row = await env.DB.prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND used_at IS NULL').bind(await sha256Hex(token)).first();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) throw bad('INVALID_TOKEN', '유효하지 않거나 만료된 토큰입니다.');
    const hash = await hashPassword(body.new_password);
    const res = await env.DB.batch([
      env.DB.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL').bind(row.id),
      env.DB.prepare('UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP, token_version = token_version + 1, failed_login_count = 0, locked_until = NULL WHERE id = ?').bind(hash, row.user_id)
    ]);
    if (!res[0].meta || res[0].meta.changes !== 1) throw bad('INVALID_TOKEN', '이미 사용된 토큰입니다.');
    return json(corsHeaders, { success: true, message: '비밀번호가 재설정되었습니다.' });
  }

  if (p === '/api/v1/auth/send-verification' && request.method === 'POST') {
    const me = await requireAuth(request, env);
    const token = randomToken(24);
    await env.DB.prepare('INSERT INTO email_verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
      .bind(newId('evt'), me.userId, await sha256Hex(token), new Date(Date.now() + 24 * 3600 * 1000).toISOString()).run();
    return json(corsHeaders, { success: true, message: '인증 메일 발송 요청이 접수되었습니다.', email_delivery: 'NOT_INTEGRATED', ...(env.ENVIRONMENT === 'development' ? { dev_verification_token: token } : {}) });
  }

  if (p === '/api/v1/auth/verify-email' && request.method === 'POST') {
    const body = await readJson(request);
    const token = str(body.token, { field: '토큰', max: 200, required: true });
    const row = await env.DB.prepare('SELECT * FROM email_verification_tokens WHERE token = ? AND verified_at IS NULL').bind(await sha256Hex(token)).first();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) throw bad('INVALID_TOKEN', '유효하지 않거나 만료된 토큰입니다.');
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(row.user_id),
      env.DB.prepare('UPDATE email_verification_tokens SET verified_at = CURRENT_TIMESTAMP WHERE id = ?').bind(row.id)
    ]);
    return json(corsHeaders, { success: true, message: '이메일이 인증되었습니다.' });
  }

  if (p === '/api/v1/auth/social-login' && request.method === 'POST') {
    // Previously trusted a client-supplied e-mail (account takeover, audit E08). Disabled until the
    // provider's OAuth code exchange + ID-token verification is implemented with real client credentials.
    return json(corsHeaders, { success: false, code: 'SOCIAL_LOGIN_NOT_INTEGRATED', error: '소셜 로그인은 아직 제공되지 않습니다.' }, 501);
  }

  return null;
}
