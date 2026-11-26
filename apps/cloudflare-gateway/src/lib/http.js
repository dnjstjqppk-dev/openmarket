// apps/cloudflare-gateway/src/lib/http.js
// Uniform JSON responses, typed HTTP errors, CORS allowlist and safe body parsing.

import { reportError } from './sentry.js';

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const bad = (code, message, extra) => new HttpError(400, code, message, extra);
export const unauthorized = (message = '로그인이 필요합니다.') => new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = '접근 권한이 없습니다.') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = '대상을 찾을 수 없습니다.') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code, message, extra) => new HttpError(409, code, message, extra);
export const unavailable = (code, message) => new HttpError(503, code, message);

export function json(corsHeaders, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export function errorResponse(corsHeaders, err, env, { request = null, ctx = null } = {}) {
  // P0-4: every error carries a tracking id (previously only 500s did), so
  // 4xx/503 reports can be correlated with server logs.
  const requestId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  if (err instanceof HttpError) {
    const res = json(corsHeaders, { success: false, error: err.message, code: err.code, ...err.extra, request_id: requestId }, err.status);
    if (err.headers) for (const [k, v] of Object.entries(err.headers)) res.headers.set(k, v);
    return res;
  }
  console.error(JSON.stringify({ level: 'error', requestId, message: err && err.message, stack: err && err.stack }));
  // NEW-18: unexpected errors go to Sentry (no-op without SENTRY_DSN); never blocks the response.
  try {
    const p = reportError(env, { error: err, request, requestId, ctx });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* reporting must never break the error path */ }
  const expose = env && env.ENVIRONMENT && env.ENVIRONMENT !== 'production';
  return json(corsHeaders, {
    success: false,
    error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    code: 'INTERNAL_ERROR',
    request_id: requestId,
    ...(expose ? { detail: err && err.message } : {})
  }, 500);
}

export async function readJson(request, { maxBytes = 1_000_000 } = {}) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw bad('INVALID_JSON', 'JSON 형식이 올바르지 않습니다.');
  }
}

function originAllowed(origin, env) {
  if (!origin) return false;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return true;
  if (env.ENVIRONMENT !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

export function buildCorsHeaders(request, env = {}) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Idempotency-Key',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // P1: API responses are JSON/text, never executable documents — lock that in.
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'deny'",
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  };
  // P0-2: credentialed cookie requests need an explicit opt-in. The origin is
  // echoed only when allowlisted (never '*'), so this cannot open the API to
  // arbitrary sites.
  if (originAllowed(origin, env)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

export function intParam(value, { min = 0, max = Number.MAX_SAFE_INTEGER, field = 'value' } = {}) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw bad('INVALID_INTEGER', `${field} 값이 올바르지 않습니다.`, { field });
  return n;
}

/** Canonical X-Idempotency-Key shape (P2-P01): one regex for checkout, sub-cancel and payouts. */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,100}$/;

/**
 * Validate an idempotency key. Absent (null/undefined) stays null so callers keep
 * their "no key" path; a PRESENT malformed key — including '' — is a 400 (P-N02:
 * never silently downgrade, the client would lose retry protection on a typo).
 */
export function idempotencyKey(value) {
  if (value === undefined || value === null) return null;
  const s = String(value);
  if (!IDEMPOTENCY_KEY_RE.test(s)) throw bad('INVALID_IDEMPOTENCY_KEY', 'X-Idempotency-Key 형식이 올바르지 않습니다.');
  return s;
}

/**
 * Validate a stored/rendered URL (P2-SEC-04/05). Allows https: absolute URLs and,
 * when allowRelative, site-relative paths ('/x', never protocol-relative '//x').
 * Rejects javascript:, data:, http: and other exfiltration/XSS vectors.
 */
export function safeUrl(value, { field = 'URL', max = 2000, required = false, allowRelative = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad('REQUIRED', `${field} 항목은 필수입니다.`, { field });
    return '';
  }
  const s = String(value).trim();
  if (required && !s) throw bad('REQUIRED', `${field} 항목은 필수입니다.`, { field });
  if (s.length > max) throw bad('TOO_LONG', `${field} 항목이 너무 깁니다.`, { field });
  const ok = /^https:\/\/[^/\s]+(\/\S*)?$/.test(s) || (allowRelative && /^\/(?!\/)\S*$/.test(s));
  if (!ok) throw bad('INVALID_URL', `${field} 주소 형식이 올바르지 않습니다. (https: 또는 사이트 상대경로만 허용)`, { field });
  return s;
}

/**
 * 2-9: CSV download for list APIs. BOM + quoted cells (SettlementView
 * convention), so spreadsheet apps open it without mojibake or split cells.
 */
export function csvResponse(corsHeaders, filename, columns, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = '\uFEFF' + [columns.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
  const headers = { ...corsHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` };
  return new Response(body, { status: 200, headers });
}

export function str(value, { max = 500, field = 'value', required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad('REQUIRED', `${field} 항목은 필수입니다.`, { field });
    return '';
  }
  const s = String(value).trim();
  if (required && !s) throw bad('REQUIRED', `${field} 항목은 필수입니다.`, { field });
  if (s.length > max) throw bad('TOO_LONG', `${field} 항목이 너무 깁니다.`, { field });
  return s;
}
