// apps/cloudflare-gateway/src/lib/auth.js
// Single source of identity: a signed JWT, re-validated against the users table on every request.
// Identity is NEVER taken from X-Customer-Id / X-Partner-Id / X-Admin-Secret headers or request bodies.

import { verifyJwt, signJwt } from '../utils/crypto-auth.js';
import { HttpError, unauthorized, forbidden, unavailable } from './http.js';

const principalCache = new WeakMap();

export function getJwtSecret(env) {
  const s = env && env.JWT_SECRET;
  if (typeof s !== 'string' || s.length < 32) {
    throw unavailable('AUTH_NOT_CONFIGURED', '인증 서버 설정이 완료되지 않았습니다. (JWT_SECRET 미설정)');
  }
  return s;
}

export async function issueToken(env, user, partner) {
  const claims = { sub: user.id, role: user.role, tv: user.token_version || 0 };
  if (partner) claims.pid = partner.id;
  return signJwt(claims, getJwtSecret(env), 60 * 60 * 12);
}

/** Returns the principal or null. Throws only for server mis-configuration. */
export async function authenticate(request, env) {
  if (principalCache.has(request)) return principalCache.get(request);
  const header = request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+(\S+)$/i);
  let principal = null;
  if (m) {
    const payload = await verifyJwt(m[1], getJwtSecret(env));
    if (payload && typeof payload.sub === 'string') {
      const user = await env.DB.prepare(
        'SELECT id, email, full_name, role, is_active, token_version FROM users WHERE id = ?'
      ).bind(payload.sub).first();
      if (user && Number(user.is_active) === 1 && Number(user.token_version || 0) === Number(payload.tv || 0) && user.role === payload.role) {
        principal = { userId: user.id, role: user.role, email: user.email, name: user.full_name, partnerId: null, partner: null };
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
  if (got.length !== expected.length) throw unauthorized('웹훅 인증 실패');
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) throw unauthorized('웹훅 인증 실패');
}
