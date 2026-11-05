// apps/cloudflare-gateway/src/lib/admin-policy.js
// Operator access policy (audit item O11), enforced once in authenticate() for EVERY request made with an
// operator token — so endpoints that check `role === 'ROLE_ADMIN'` inline are covered too.
//   1. IP allow-list (ADMIN_IP_ALLOWLIST)        2. two-factor authentication        3. least-privilege permissions
// Unmapped /api/v1/admin/* paths require SUPER_ADMIN (fail closed).

import { HttpError } from './http.js';

export const ADMIN_ROLES = ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS', 'CS', 'PRIVACY_OFFICER'];

export const ROLE_PERMISSIONS = Object.freeze({
  SUPER_ADMIN: ['*'],
  FINANCE: ['dashboard', 'finance.read', 'finance.payout', 'orders.read', 'orders.refund', 'business.read', 'partners.read'],
  OPERATIONS: ['dashboard', 'catalog.read', 'catalog.manage', 'partners.read', 'partners.manage', 'sourcing', 'orders.read', 'orders.manage', 'marketing', 'business.read'],
  CS: ['dashboard', 'orders.read', 'orders.manage', 'orders.refund', 'users.read', 'catalog.read'],
  PRIVACY_OFFICER: ['dashboard', 'privacy.audit', 'users.read']
});

const R = (method, re, read, write = read) => ({ method, re, read, write });
// First match wins. `read` applies to GET/HEAD, `write` to everything else.
const RULES = [
  R(null, /^\/api\/v1\/auth\//, null),                                   // own account, 2FA enrolment
  R(null, /^\/api\/v1\/admin\/admin-users(\/|$)/, 'admin.manage'),
  R(null, /^\/api\/v1\/admin\/privacy\//, 'privacy.audit'),
  R(null, /^\/api\/v1\/admin\/business-entities(\/|$)/, 'business.read', 'business.manage'),
  R(null, /^\/api\/v1\/admin\/partners\/[^/]+\/payout-account$/, 'finance.payout'),
  R(null, /^\/api\/v1\/admin\/(finance|reconciliation|ledgers?)(\/|$)/, 'finance.read', 'finance.payout'),
  R('POST', /^\/api\/v1\/admin\/orders\/[^/]+\/refund$/, 'orders.refund'),
  R(null, /^\/api\/v1\/admin\/sub-orders\//, 'orders.manage'),
  R(null, /^\/api\/v1\/admin\/(partners|partner-applications)(\/|$)/, 'partners.read', 'partners.manage'),
  R(null, /^\/api\/v1\/admin\/(suppliers|supplier-mappings|purchase-orders)(\/|$)/, 'sourcing'),
  R(null, /^\/api\/v1\/admin\/(products|categories|reviews|ipr-reports|sample-qc)(\/|$)/, 'catalog.read', 'catalog.manage'),
  R(null, /^\/api\/v1\/admin\/(coupons|banners|notifications)(\/|$)/, 'marketing'),
  R(null, /^\/api\/v1\/admin\/(orders|claims|disputes)(\/|$)/, 'orders.read', 'orders.manage'),
  R(null, /^\/api\/v1\/admin\/users(\/|$)/, 'users.read'),
  R(null, /^\/api\/v1\/admin\/(dashboard|metrics|control-tower|fds)(\/|$)/, 'dashboard'),
  R(null, /^\/api\/v1\/admin(\/|$)/, 'super'),                             // fail closed
  // Operator actions on shared (non-/admin) routes added with the sourcing / finance modules
  R(null, /^\/api\/v1\/finance\//, 'finance.read', 'finance.payout'),
  R(null, /^\/api\/v1\/(supplier-orders|sync)(\/|$)/, 'sourcing'),
  R(null, /^\/api\/v1\/bidding\//, 'sourcing'),
  R(null, /^\/api\/v1\/pricing\//, 'catalog.read', 'catalog.manage'),
  R(null, /^\/api\/v1\/(channels|imports)(\/|$)/, 'catalog.read', 'catalog.manage'),
  // Operator actions on customer-facing routes
  R('POST', /^\/api\/v1\/orders\/[^/]+\/(cancel|sub-orders\/[^/]+\/cancel)$/, 'orders.refund'),
  R(null, /^\/api\/v1\/orders\/cron\//, 'super'),
  R(null, /^\/api\/v1\/orders\//, 'orders.read', 'orders.manage'),
  R(null, /^\/api\/v1\/storage\/file\//, 'partners.read'),               // KYB documents
  R(null, /^\/api\/v1\/logistics\/tracking\//, 'orders.read')
];

export function requiredPermission(method, path) {
  for (const r of RULES) {
    if (r.method && r.method !== method) continue;
    if (r.re.test(path)) return method === 'GET' || method === 'HEAD' ? r.read : r.write;
  }
  return null;
}

export function hasPermission(adminRole, perm) {
  if (!perm) return true;
  const perms = ROLE_PERMISSIONS[adminRole] || [];
  return perms.includes('*') || (perm !== 'super' && perms.includes(perm));
}

// ---- IP allow-list: "203.0.113.7, 198.51.100.0/24" (IPv4 CIDR or exact IPv4/IPv6). Empty = no restriction.
function ipv4ToInt(ip) {
  const m = String(ip).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function ipAllowed(env, ip) {
  const list = String(env.ADMIN_IP_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  if (!ip) return false;
  for (const entry of list) {
    if (entry.includes('/')) {
      const [base, bitsStr] = entry.split('/');
      const bits = Number(bitsStr);
      const a = ipv4ToInt(ip); const b = ipv4ToInt(base);
      if (a === null || b === null || !(bits >= 0 && bits <= 32)) continue;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if (((a & mask) >>> 0) === ((b & mask) >>> 0)) return true;
    } else if (entry.toLowerCase() === String(ip).toLowerCase()) {
      return true;
    }
  }
  return false;
}

export const clientIp = (request) => request.headers.get('CF-Connecting-IP') || null;

/** 2FA is mandatory for operators in production, opt-in elsewhere (ADMIN_2FA_REQUIRED=true|false overrides). */
export function twoFactorRequired(env) {
  const v = String(env.ADMIN_2FA_REQUIRED || '').toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return env.ENVIRONMENT === 'production'; // cannot be switched off in production
  return env.ENVIRONMENT === 'production';
}

/** Throws when the operator request must not proceed. `user` is the fresh users row, `payload` the verified JWT. */
export function enforceAdminPolicy(request, env, user, payload) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!ipAllowed(env, clientIp(request))) {
    throw new HttpError(403, 'ADMIN_IP_NOT_ALLOWED', '허용되지 않은 위치에서의 관리자 접근입니다.');
  }
  const enrolled = Boolean(user.totp_enabled_at);
  if (enrolled && payload.mfa !== 1) {
    throw new HttpError(401, 'MFA_REQUIRED', '2단계 인증으로 다시 로그인해 주세요.');
  }
  if (!enrolled && twoFactorRequired(env) && !path.startsWith('/api/v1/auth/')) {
    throw new HttpError(403, 'ADMIN_2FA_SETUP_REQUIRED', '관리자 계정은 2단계 인증을 설정해야 이용할 수 있습니다.');
  }
  const perm = requiredPermission(request.method, path);
  if (!hasPermission(user.admin_role, perm)) {
    throw new HttpError(403, 'ADMIN_PERMISSION_DENIED', `이 작업 권한이 없습니다. (필요 권한: ${perm})`, { required_permission: perm, admin_role: user.admin_role || null });
  }
}
