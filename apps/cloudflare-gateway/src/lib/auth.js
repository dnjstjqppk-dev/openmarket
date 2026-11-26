// apps/cloudflare-gateway/src/lib/auth.js
// Single source of identity: a signed JWT, re-validated against the users table on every request.
// Identity is NEVER taken from X-Customer-Id / X-Partner-Id / X-Admin-Secret headers or request bodies.

import { verifyJwt, signJwt, randomToken, sha256Hex } from '../utils/crypto-auth.js';
import { HttpError, unauthorized, forbidden, unavailable } from './http.js';
import { enforceAdminPolicy } from './admin-policy.js';
import { newId } from './ids.js';

// P2-SEC-07: short-lived access (1h) + rotating opaque refresh (14d, single use).
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 3600 * 1000;

// P0-2: httpOnly cookie names. Web apps authenticate via these cookies (JS
// cannot read them, so XSS cannot exfiltrate sessions); native/mobile clients
// and tests keep using the Authorization Bearer header (dual-mode).
export const ACCESS_COOKIE = 'olmoa_at';
export const REFRESH_COOKIE = 'olmoa_rt';

export function parseCookies(request) {
  const out = {};
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

function cookieAttrs(env, maxAge, path) {
  // SameSite=Lax: api.<domain> and <domain> share the eTLD+1, so first-party
  // fetches carry the cookie while cross-site POSTs from an attacker's origin
  // do not (CSRF-safe for this JSON API). Secure only in production because
  // local dev serves plain http://localhost.
  const secure = env && env.ENVIRONMENT === 'production' ? '; Secure' : '';
  return `Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** Set-Cookie values for a fresh login/rotation. Both tokens are hex/JWT (cookie-safe). */
export function authCookieHeaders(env, { token, refreshToken }) {
  return [
    `${ACCESS_COOKIE}=${token}; ${cookieAttrs(env, ACCESS_TOKEN_TTL_SECONDS, '/')}`,
    `${REFRESH_COOKIE}=${refreshToken}; ${cookieAttrs(env, Math.floor(REFRESH_TOKEN_TTL_MS / 1000), '/api/v1/auth')}`,
  ];
}

export function clearAuthCookieHeaders(env) {
  return [
    `${ACCESS_COOKIE}=; ${cookieAttrs(env, 0, '/')}`,
    `${REFRESH_COOKIE}=; ${cookieAttrs(env, 0, '/api/v1/auth')}`,
  ];
}

/**
 * Append auth cookies to a Response. pass refreshToken only when the route
 * rotates it (login/refresh/social exchange); access-only issuers (register,
 * MFA enable, password change, application submit) pass { token } alone.
 */
export function attachAuthCookies(res, env, { token, refreshToken = null } = {}) {
  const values = token
    ? (refreshToken ? authCookieHeaders(env, { token, refreshToken }) : [`${ACCESS_COOKIE}=${token}; ${cookieAttrs(env, ACCESS_TOKEN_TTL_SECONDS, '/')}`])
    : [];
  for (const v of values) res.headers.append('Set-Cookie', v);
  return res;
}

const principalCache = new WeakMap();

export function getJwtSecret(env) {
  const s = env && env.JWT_SECRET;
  if (typeof s !== 'string' || s.length < 32) {
    throw unavailable('AUTH_NOT_CONFIGURED', '인증 서버 설정이 완료되지 않았습니다. (JWT_SECRET 미설정)');
  }
  return s;
}

export async function issueToken(env, user, partner, { mfa = false } = {}) {
  const claims = { sub: user.id, role: user.role, tv: user.token_version || 0 };
  if (mfa) claims.mfa = 1;
  if (partner) claims.pid = partner.id;
  return signJwt(claims, getJwtSecret(env), ACCESS_TOKEN_TTL_SECONDS);
}

/** Mint an opaque refresh token bound to the user's current token_version (and MFA state). */
export async function issueRefreshToken(env, user, { mfa = false } = {}) {
  const raw = randomToken(32);
  await env.DB.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, token_version, mfa, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(newId('rft'), user.id, await sha256Hex(raw), Number(user.token_version || 0), mfa ? 1 : 0,
    new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString()).run();
  // Hygiene: drop used rows older than a day (kept that long for reuse detection)
  // and long-expired rows; live rows are untouched.
  await env.DB.prepare(`DELETE FROM refresh_tokens WHERE user_id = ? AND (
      (used_at IS NOT NULL AND used_at < datetime('now', '-1 day')) OR
      (used_at IS NULL AND expires_at < datetime('now', '-1 day')))`).bind(user.id).run();
  return raw;
}

/**
 * Redeem a refresh token: single use, expiry + token_version + active checks.
 * Returns { user, mfa }. A replayed (already used) token burns the whole
 * family — someone is holding a rotated credential — and answers REFRESH_REUSED.
 */
export async function useRefreshToken(env, raw) {
  const row = await env.DB.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
    .bind(await sha256Hex(String(raw || ''))).first();
  if (!row) throw unauthorized('리프레시 토큰이 유효하지 않습니다.');
  if (row.used_at) {
    await env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(row.user_id).run();
    throw new HttpError(401, 'REFRESH_REUSED', '이미 사용된 리프레시 토큰입니다. 다시 로그인해 주세요.');
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first();
  const dead = !user || Number(user.is_active) !== 1
    || new Date(row.expires_at).getTime() < Date.now()
    || Number(user.token_version || 0) !== Number(row.token_version || 0);
  if (dead) {
    await env.DB.prepare('DELETE FROM refresh_tokens WHERE id = ?').bind(row.id).run();
    throw unauthorized('리프레시 토큰이 만료되었거나 무효화되었습니다.');
  }
  const marked = await env.DB.prepare('UPDATE refresh_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL')
    .bind(row.id).run();
  if (marked.meta.changes !== 1) {
    // Lost a concurrent-redeem race: treat like a replay, burn the family.
    await env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(row.user_id).run();
    throw new HttpError(401, 'REFRESH_REUSED', '이미 사용된 리프레시 토큰입니다. 다시 로그인해 주세요.');
  }
  return { user, mfa: Number(row.mfa) === 1 };
}

/** Returns the principal or null. Throws only for server mis-configuration. */
export async function authenticate(request, env) {
  if (principalCache.has(request)) return principalCache.get(request);
  const header = request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+(\S+)$/i);
  // P0-2: Bearer first (native/mobile/tests), then the httpOnly access cookie
  // (web apps). Both feed the same JWT + users-table verification below.
  const jwt = m ? m[1] : (parseCookies(request)[ACCESS_COOKIE] || null);
  let principal = null;
  if (jwt) {
    const payload = await verifyJwt(jwt, getJwtSecret(env));
    if (payload && typeof payload.sub === 'string') {
      const user = await env.DB.prepare(
        'SELECT id, email, full_name, role, is_active, token_version, admin_role, totp_enabled_at FROM users WHERE id = ?'
      ).bind(payload.sub).first();
      if (user && Number(user.is_active) === 1 && Number(user.token_version || 0) === Number(payload.tv || 0) && user.role === payload.role) {
        // O11: operator tokens pass IP allow-list, 2FA and least-privilege checks on every request (throws).
        if (user.role === 'ROLE_ADMIN') enforceAdminPolicy(request, env, user, payload);
        principal = { userId: user.id, role: user.role, email: user.email, name: user.full_name, partnerId: null, partner: null, adminRole: user.admin_role || null, mfa: payload.mfa === 1 };
        if (user.role === 'ROLE_PARTNER') {
          const partner = await env.DB.prepare('SELECT * FROM partners WHERE owner_user_id = ?').bind(user.id).first();
          if (partner && (!payload.pid || payload.pid === partner.id)) {
            principal.partnerId = partner.id;
            principal.partner = partner;
          }
        }
      }
    }
  }
  principalCache.set(request, principal);
  return principal;
}

export async function requireAuth(request, env, roles) {
  const p = await authenticate(request, env);
  if (!p) throw unauthorized();
  if (roles && roles.length && !roles.includes(p.role)) throw forbidden();
  return p;
}

export const requireCustomer = (request, env) => requireAuth(request, env, ['ROLE_CUSTOMER']);
export const requireAdmin = (request, env) => requireAuth(request, env, ['ROLE_ADMIN']);

export async function requireApprovedPartner(request, env) {
  const p = await requireAuth(request, env, ['ROLE_PARTNER']);
  if (!p.partner) throw forbidden('판매자 계정에 연결된 입점사 정보가 없습니다.');
  if (p.partner.status !== 'APPROVED') {
    throw new HttpError(403, 'PARTNER_NOT_APPROVED', `입점 심사 상태(${p.partner.status})에서는 이용할 수 없습니다.`);
  }
  return p;
}

/** Shared-secret check for machine callers (carrier webhooks, schedulers). Fails closed when unset. */
export function requireMachineSecret(request, env, envKey, headerName) {
  const expected = env[envKey];
  if (typeof expected !== 'string' || expected.length < 24) {
    throw unavailable('WEBHOOK_NOT_CONFIGURED', `${envKey} 미설정으로 수신이 비활성화되어 있습니다.`);
  }
  const got = request.headers.get(headerName) || '';
  // P2-SEC-11: no early return on length — scan the full width and fold the length
  // mismatch into the accumulator, so a wrong-length secret takes the same path as a
  // wrong-value one (the 401 below is identical either way).
  let diff = got.length ^ expected.length;
  const n = Math.max(got.length, expected.length);
  for (let i = 0; i < n; i++) {
    const a = i < got.length ? got.charCodeAt(i) : 0;
    const b = i < expected.length ? expected.charCodeAt(i) : 0;
    diff |= a ^ b;
  }
  if (diff !== 0) throw unauthorized('웹훅 인증 실패');
}
