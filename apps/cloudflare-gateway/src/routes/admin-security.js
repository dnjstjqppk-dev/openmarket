// apps/cloudflare-gateway/src/routes/admin-security.js
// Operator account security (audit item O11).
//   POST /api/v1/auth/2fa/setup      operator: start TOTP enrolment (returns secret + otpauth URI once)
//   POST /api/v1/auth/2fa/enable     operator: confirm with a code -> 2FA on, recovery codes shown once, new token
//   GET  /api/v1/admin/admin-users                 SUPER_ADMIN: operator accounts
//   POST /api/v1/admin/admin-users                 SUPER_ADMIN: create an operator with a role
//   PUT  /api/v1/admin/admin-users/:id             SUPER_ADMIN: change role / deactivate / reset 2FA

import { requireAuth, requireAdmin, issueToken } from '../lib/auth.js';
import { json, readJson, bad, conflict, notFound, str } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { auditStatement } from '../lib/ledger.js';
import { hashPassword, randomToken, sha256Hex } from '../utils/crypto-auth.js';
import { newTotpSecret, verifyTotp, otpauthUri, sealSecret, openSecret } from '../lib/totp.js';
import { ADMIN_ROLES } from '../lib/admin-policy.js';
import { validatePassword } from './auth.js';

const RECOVERY_CODES = 10;

/** Verifies a TOTP code (consuming its time-step) or a one-time recovery code (consuming it). */
export async function verifyAdminSecondFactor(env, user, { otp, recoveryCode }) {
  if (otp) {
    const secret = await openSecret(env, user.totp_secret_enc);
    const step = await verifyTotp(secret, String(otp).trim(), { lastStep: user.totp_last_step });
    if (step === null) return false;
    // Conditional write: two concurrent logins with the same code -> only one wins.
    const r = await env.DB.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)').bind(step, user.id, step).run();
    return r.meta.changes === 1;
  }
  if (recoveryCode) {
    const hashes = JSON.parse(user.mfa_recovery_hashes_json || '[]');
    const h = await sha256Hex(String(recoveryCode).trim().toLowerCase());
    if (!hashes.includes(h)) return false;
    const rest = JSON.stringify(hashes.filter((x) => x !== h));
    const r = await env.DB.prepare('UPDATE users SET mfa_recovery_hashes_json = ? WHERE id = ? AND mfa_recovery_hashes_json = ?').bind(rest, user.id, user.mfa_recovery_hashes_json).run();
    return r.meta.changes === 1;
  }
  return false;
}

async function activeSuperAdmins(env, excludingId = null) {
  return env.DB.prepare("SELECT COUNT(*) c FROM users WHERE role = 'ROLE_ADMIN' AND admin_role = 'SUPER_ADMIN' AND is_active = 1 AND id != ?").bind(excludingId || '').first('c');
}

export async function handleAdminSecurityRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;

  if (p === '/api/v1/auth/2fa/setup' && request.method === 'POST') {
    const me = await requireAuth(request, env, ['ROLE_ADMIN']);
    const user = await env.DB.prepare('SELECT email, totp_enabled_at FROM users WHERE id = ?').bind(me.userId).first();
    if (user.totp_enabled_at) throw conflict('MFA_ALREADY_ENABLED', '이미 2단계 인증을 사용 중입니다. 재설정은 최고관리자에게 요청하세요.');
    const secret = newTotpSecret();
    await env.DB.prepare('UPDATE users SET totp_pending_enc = ? WHERE id = ?').bind(await sealSecret(env, secret), me.userId).run();
    return json(corsHeaders, { success: true, data: { secret, otpauth_uri: otpauthUri(secret, user.email) } });
  }

  if (p === '/api/v1/auth/2fa/enable' && request.method === 'POST') {
    const me = await requireAuth(request, env, ['ROLE_ADMIN']);
    const b = await readJson(request);
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.userId).first();
    if (user.totp_enabled_at) throw conflict('MFA_ALREADY_ENABLED', '이미 2단계 인증을 사용 중입니다.');
    if (!user.totp_pending_enc) throw conflict('MFA_SETUP_NOT_STARTED', '먼저 2단계 인증 설정을 시작해 주세요.');
    const secret = await openSecret(env, user.totp_pending_enc);
    const step = await verifyTotp(secret, String(b.code || '').trim());
    if (step === null) throw bad('OTP_INVALID', '인증 코드가 올바르지 않습니다. 기기 시간을 확인해 주세요.');
    const codes = Array.from({ length: RECOVERY_CODES }, () => { const t = randomToken(4); return `${t.slice(0, 4)}-${t.slice(4, 8)}`; });
    const hashes = await Promise.all(codes.map((c) => sha256Hex(c)));
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_enabled_at = CURRENT_TIMESTAMP, totp_last_step = ?,
                mfa_recovery_hashes_json = ?, token_version = token_version + 1 WHERE id = ? AND totp_enabled_at IS NULL`
      ).bind(step, JSON.stringify(hashes), me.userId),
      auditStatement(env, me, { action: 'ADMIN_MFA_ENABLE', targetType: 'user', targetId: me.userId, request })
    ]);
    const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.userId).first();
    return json(corsHeaders, {
      success: true, message: '2단계 인증이 켜졌습니다. 복구 코드는 지금 한 번만 표시됩니다.',
      data: { token: await issueToken(env, fresh, null, { mfa: true }), recovery_codes: codes }
    });
  }

  if (!(p === '/api/v1/admin/admin-users' || p.startsWith('/api/v1/admin/admin-users/'))) return null;
  const admin = await requireAdmin(request, env); // permission 'admin.manage' (SUPER_ADMIN) enforced by admin-policy

  if (p === '/api/v1/admin/admin-users' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT id, email, full_name, admin_role, is_active, totp_enabled_at, created_at FROM users WHERE role = 'ROLE_ADMIN' ORDER BY created_at"
    ).all();
    return json(corsHeaders, { success: true, data: results.map((u) => ({ ...u, mfa_enabled: Boolean(u.totp_enabled_at) })) });
  }

  if (p === '/api/v1/admin/admin-users' && request.method === 'POST') {
    const b = await readJson(request);
    const email = str(b.email, { field: '이메일', max: 254, required: true }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('INVALID_EMAIL', '이메일 형식이 올바르지 않습니다.');
    const role = String(b.admin_role || '');
    if (!ADMIN_ROLES.includes(role)) throw bad('INVALID_ADMIN_ROLE', `admin_role 은 ${ADMIN_ROLES.join(', ')} 중 하나여야 합니다.`);
    validatePassword(b.password);
    const name = str(b.full_name, { field: '이름', max: 50, required: true });
    const phone = str(b.phone || '-', { field: '연락처', max: 20 });
    if (await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(email).first()) throw conflict('EMAIL_TAKEN', '이미 등록된 이메일입니다.');
    const id = newId('usr');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, password_hash, full_name, phone, role, is_active, admin_role) VALUES (?, ?, ?, ?, ?, 'ROLE_ADMIN', 1, ?)")
        .bind(id, email, await hashPassword(b.password), name, phone, role),
      auditStatement(env, admin, { action: 'ADMIN_USER_CREATE', targetType: 'user', targetId: id, after: { email, role }, request })
    ]);
    return json(corsHeaders, { success: true, data: { id, email, admin_role: role, note: '첫 로그인 후 2단계 인증을 설정해야 합니다.' } }, 201);
  }

  const upM = p.match(/^\/api\/v1\/admin\/admin-users\/([^/]+)$/);
  if (upM && request.method === 'PUT') {
    const b = await readJson(request);
    const target = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND role = 'ROLE_ADMIN'").bind(upM[1]).first();
    if (!target) throw notFound('운영자 계정을 찾을 수 없습니다.');
    const role = b.admin_role !== undefined ? String(b.admin_role) : target.admin_role;
    if (!ADMIN_ROLES.includes(role)) throw bad('INVALID_ADMIN_ROLE', 'admin_role 값이 올바르지 않습니다.');
    const active = b.is_active !== undefined ? (b.is_active ? 1 : 0) : Number(target.is_active);
    const reset2fa = b.reset_2fa === true;
    if (target.id === admin.userId && (role !== target.admin_role || active !== 1)) throw conflict('SELF_LOCKOUT', '자기 계정의 권한을 낮추거나 비활성화할 수 없습니다.');
    const stillSuper = role === 'SUPER_ADMIN' && active === 1;
    if (target.admin_role === 'SUPER_ADMIN' && !stillSuper && (await activeSuperAdmins(env, target.id)) === 0) {
      throw conflict('LAST_SUPER_ADMIN', '활성 최고관리자가 최소 1명 있어야 합니다.');
    }
    const changed = role !== target.admin_role || active !== Number(target.is_active) || reset2fa;
    if (!changed) return json(corsHeaders, { success: true, data: { id: target.id, unchanged: true } });
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET admin_role = ?, is_active = ?, token_version = token_version + 1,
                totp_secret_enc = CASE WHEN ? THEN NULL ELSE totp_secret_enc END, totp_pending_enc = CASE WHEN ? THEN NULL ELSE totp_pending_enc END,
                totp_enabled_at = CASE WHEN ? THEN NULL ELSE totp_enabled_at END, totp_last_step = CASE WHEN ? THEN NULL ELSE totp_last_step END,
                mfa_recovery_hashes_json = CASE WHEN ? THEN NULL ELSE mfa_recovery_hashes_json END, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(role, active, reset2fa ? 1 : 0, reset2fa ? 1 : 0, reset2fa ? 1 : 0, reset2fa ? 1 : 0, reset2fa ? 1 : 0, target.id),
      auditStatement(env, admin, { action: 'ADMIN_USER_UPDATE', targetType: 'user', targetId: target.id,
        before: { admin_role: target.admin_role, is_active: target.is_active, mfa: Boolean(target.totp_enabled_at) }, after: { admin_role: role, is_active: active, reset2fa }, request })
    ]);
    return json(corsHeaders, { success: true, data: { id: target.id, admin_role: role, is_active: Boolean(active), mfa_reset: reset2fa, sessions_revoked: true } });
  }

  return null;
}
