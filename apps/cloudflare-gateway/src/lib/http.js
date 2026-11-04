// apps/cloudflare-gateway/src/lib/http.js
// Uniform JSON responses, typed HTTP errors, CORS allowlist and safe body parsing.

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

export function errorResponse(corsHeaders, err, env) {
  if (err instanceof HttpError) {
    return json(corsHeaders, { success: false, error: err.message, code: err.code, ...err.extra }, err.status);
  }
  const requestId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  console.error(JSON.stringify({ level: 'error', requestId, message: err && err.message, stack: err && err.stack }));
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
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  };
  if (originAllowed(origin, env)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function intParam(value, { min = 0, max = Number.MAX_SAFE_INTEGER, field = 'value' } = {}) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw bad('INVALID_INTEGER', `${field} 값이 올바르지 않습니다.`, { field });
  return n;
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
