// apps/cloudflare-gateway/src/routes/legal.js
// Work order 5-6: public versioned legal documents (TERMS/PRIVACY/REFUND).
// Registration lives in admin.js (SUPER_ADMIN only); signup version defaults in
// auth.js reuse currentLegalVersion() below.

import { json, bad } from '../lib/http.js';

export const LEGAL_KINDS = Object.freeze({ terms: 'TERMS', privacy: 'PRIVACY', refund: 'REFUND' });

// Today as a KST YYYY-MM-DD calendar day. LEGAL_TEST_TODAY_KST pins the clock in
// tests (unset in production), following the TODAY_SHIP_TEST_NOW_KST pattern.
export function todayKstDate(env) {
  const pinned = String(env?.LEGAL_TEST_TODAY_KST || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function isCalendarDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!(y >= 2000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const t = Date.UTC(y, m - 1, d);
  const c = new Date(t);
  return c.getUTCFullYear() === y && c.getUTCMonth() === m - 1 && c.getUTCDate() === d;
}

// Whole calendar days from `fromYmd` to `toYmd` (both YYYY-MM-DD, KST days).
export function daysBetween(fromYmd, toYmd) {
  const [fy, fm, fd] = String(fromYmd).split('-').map(Number);
  const [ty, tm, td] = String(toYmd).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// Latest effective version of a kind (null when none is effective yet).
export async function currentLegalVersion(env, kind) {
  try {
    return await env.DB.prepare(
      `SELECT version FROM legal_documents WHERE kind = ? AND effective_date <= ?
       ORDER BY effective_date DESC, created_at DESC LIMIT 1`
    ).bind(kind, todayKstDate(env)).first('version');
  } catch {
    return null;
  }
}

export async function handleLegalRoutes(request, url, env, corsHeaders) {
  const m = url.pathname.match(/^\/api\/v1\/legal\/([^/]+)$/);
  if (!m || request.method !== 'GET') return null;
  const kind = LEGAL_KINDS[String(m[1] || '').toLowerCase()];
  if (!kind) throw bad('INVALID_LEGAL_KIND', '약관 종류는 terms·privacy·refund 중 하나여야 합니다.');
  const today = todayKstDate(env);
  const { results } = await env.DB.prepare(
    `SELECT id, kind, version, effective_date, body, author_user_id, created_at
     FROM legal_documents WHERE kind = ? ORDER BY effective_date DESC, created_at DESC`
  ).bind(kind).all();
  const effective = results.filter((d) => d.effective_date <= today);
  const upcoming = results
    .filter((d) => d.effective_date > today)
    .map((d) => ({ ...d, days_until_effective: daysBetween(today, d.effective_date) }))
    .sort((a, b) => (a.effective_date < b.effective_date ? -1 : 1));
  const current = effective[0] || null;
  const history = effective.slice(1);
  const nearest = upcoming[0] || null;
  const notice = nearest && nearest.days_until_effective <= 7
    ? { version: nearest.version, effective_date: nearest.effective_date, days_until_effective: nearest.days_until_effective }
    : null;
  return json(corsHeaders, { success: true, data: { kind, today, current, upcoming, history, notice } });
}
