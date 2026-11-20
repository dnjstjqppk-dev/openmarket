// apps/cloudflare-gateway/src/lib/pccc.js
// Personal Customs Clearance Code (개인통관고유부호) validation utility.
// Single source of truth for the PCCC format (P + 12 digits, 13 chars);
// the customs route and the UI hook both derive from this module.
//
// Verification honesty: only a Uni-Pass lookup can bind a code to a person.
// Without UNIPASS_API_KEY every verdict stays FORMAT_ONLY (verified=false).

export const PCCC_RE = /^P\d{12}$/;
export const UNIPASS_URL = 'https://unipass.customs.go.kr:38010/ext/rest/persEcmQry/retrievePersEcm';

/** Uppercase, strip spaces/hyphens; never invents missing digits. */
export function normalizePccc(raw) {
  return String(raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
}

export function isPcccFormat(normalized) {
  return PCCC_RE.test(String(normalized ?? ''));
}

/** Pure format verdict with the user-facing Korean message. */
export function validatePccc(raw) {
  const normalized = normalizePccc(raw);
  if (!normalized) {
    return { ok: false, normalized, code: 'MISSING_PCCC', message: '개인통관고유부호를 입력해주세요.' };
  }
  if (!isPcccFormat(normalized)) {
    return {
      ok: false, normalized, code: 'INVALID_PCCC_FORMAT',
      message: "개인통관고유부호 형식이 올바르지 않습니다. 'P'로 시작하는 13자리 번호여야 합니다 (예: P123456789012)."
    };
  }
  return { ok: true, normalized, code: 'FORMAT_VALID', message: '형식이 올바른 개인통관고유부호입니다.' };
}

/**
 * Live Uni-Pass name/phone binding check. Returns { mode, matched } where
 * mode is UNIPASS_MATCH | UNIPASS_NO_MATCH | UNIPASS_UNAVAILABLE.
 * Upstream failures stay UNIPASS_UNAVAILABLE — never verified, never guessed.
 */
export async function queryUnipass(env, pccc, { name = '', phone = '', timeoutMs = 8000 } = {}) {
  const params = new URLSearchParams({
    crkyCn: env.UNIPASS_API_KEY, persEcm: pccc, pltxNm: name,
    cralTelno: String(phone).replace(/[^0-9]/g, '')
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${UNIPASS_URL}?${params.toString()}`, { signal: ctrl.signal });
    const xml = res.ok ? await res.text() : '';
    const count = Number((xml.match(/<tCo>(\d+)<\/tCo>/) || [])[1] || 0);
    if (count > 0) return { mode: 'UNIPASS_MATCH', matched: true };
    return res.ok ? { mode: 'UNIPASS_NO_MATCH', matched: false } : { mode: 'UNIPASS_UNAVAILABLE', matched: null };
  } catch {
    return { mode: 'UNIPASS_UNAVAILABLE', matched: null };
  } finally {
    clearTimeout(timer);
  }
}
