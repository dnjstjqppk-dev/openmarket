// apps/cloudflare-gateway/src/lib/ratelimit.js
// API rate limiting (audit item O12) with the Workers Rate Limiting binding (wrangler.jsonc "ratelimits").
// Limits are per Cloudflare location and approximate by design — they stop brute force, credential stuffing,
// signup spam and checkout floods; volumetric attacks are the job of Cloudflare WAF / DDoS rules in front.
//
//   RL_AUTH    10 / 60 s per IP   login, register, password reset, seller application, 2FA, withdrawal
//   RL_LOGIN    5 / 60 s per account (e-mail)  — distributed guessing against one account
//   RL_WRITE   30 / 60 s per user (or IP)      checkout, payment confirm, claims, uploads, reviews, Q&A
//   RL_API    300 / 60 s per IP                everything else
//
// Missing binding (local dev / tests) = no limit, unless RATE_LIMIT_REQUIRED=true (then fail closed with 503).

import { HttpError, unavailable } from './http.js';

const AUTH_PATHS = [
  /^\/api\/v1\/auth\/(login|register|forgot-password|reset-password|verify-email|send-verification|withdraw|2fa\/)/,
  /^\/api\/v1\/partner-applications$/
];
const WRITE_PATHS = [
  /^\/api\/v1\/orders\/checkout$/, /^\/api\/v1\/payments\//, /^\/api\/v1\/orders\/[^/]+\/(claims|cancel|sub-orders\/[^/]+\/cancel)$/,
  /^\/api\/v1\/storage\/upload$/, /^\/api\/v1\/products\/[^/]+\/(reviews|qna)$/, /^\/api\/v1\/support/
];

export function classify(method, path) {
  if (method === 'OPTIONS' || path === '/health' || path === '/api/health') return null;
  if (AUTH_PATHS.some((r) => r.test(path))) return 'RL_AUTH';
  if (method !== 'GET' && method !== 'HEAD' && WRITE_PATHS.some((r) => r.test(path))) return 'RL_WRITE';
  return 'RL_API';
}

async function hit(env, binding, key) {
  const rl = env[binding];
  if (!rl || typeof rl.limit !== 'function') {
    if (String(env.RATE_LIMIT_REQUIRED || '').toLowerCase() === 'true') throw unavailable('RATE_LIMIT_NOT_CONFIGURED', '요청 제한 설정이 없습니다.');
    return true;
  }
  try {
    const { success } = await rl.limit({ key });
    return success;
  } catch {
    return true; // the limiter itself failing must not take the shop down
  }
}

/** Throws 429 when the caller is over a limit. `bodyEmail` is the login e-mail (already parsed by the caller). */
export async function enforceRateLimit(request, env, { userKey = null, loginEmail = null } = {}) {
  const url = new URL(request.url);
  const bucket = classify(request.method, url.pathname);
  if (!bucket) return;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = bucket === 'RL_WRITE' && userKey ? `u:${userKey}` : `ip:${ip}`;
  const checks = [hit(env, bucket, `${bucket}:${key}`)];
  if (loginEmail) checks.push(hit(env, 'RL_LOGIN', `login:${String(loginEmail).toLowerCase()}`));
  const results = await Promise.all(checks);
  if (results.every(Boolean)) return;
  const err = new HttpError(429, 'RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', { retry_after_seconds: 60 });
  err.headers = { 'Retry-After': '60' };
  throw err;
}
