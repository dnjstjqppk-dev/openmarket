// apps/cloudflare-gateway/src/lib/product-identifiers.js
// 6-12 (decision-20): domestic-marketplace product identifiers.
// Brand is required on new registrations ("노브랜드/자체제작" when brandless);
// manufacturer/model are optional; every SKU carries a GS1-valid barcode or an
// explicit exemption reason (never an invented number — Coupang 2026-05-27
// notice forbids arbitrary numbers for exempt goods).

import { bad } from './http.js';

/** Brand value for brandless goods (UI offers it as a one-tap choice). */
export const NOBRAND_VALUE = '노브랜드/자체제작';

/** Exemption reasons (task list; aligned with the Coupang exception classes). */
export const GTIN_EXEMPT_REASONS = {
  SELF_MADE: '자체제작',
  HANDMADE: '수공예',
  NOBRAND_IMPORT: '노브랜드 수입',
  OVERSEAS_AGENT: '해외구매대행',
  OTHER: '기타'
};

/** GTIN-8/12/13/14 digits plus the GS1 mod-10 check digit. */
export function isValidGtin(raw) {
  const s = String(raw || '').replace(/[\s-]/g, '');
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return false;
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[s.length - 1 - i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return sum % 10 === 0;
}

/** Canonical GTIN (digits only) or null. */
export function normalizeGtin(raw) {
  const s = String(raw || '').replace(/[\s-]/g, '');
  return isValidGtin(s) ? s : null;
}

/**
 * Validate one SKU's identifier pair. Returns { gtin, exempt } where exactly
 * one side is set. Throws 400 on bad digits or a bad reason.
 */
export function validateSkuIdentifiers(input = {}, { where = '' } = {}) {
  const at = where ? `${where}: ` : '';
  const rawGtin = input.gtin !== undefined && input.gtin !== null ? String(input.gtin).trim() : '';
  if (rawGtin !== '') {
    const gtin = normalizeGtin(rawGtin);
    if (!gtin) throw bad('INVALID_GTIN', `${at}바코드 형식이 올바르지 않습니다. 8·12·13·14자리 숫자와 체크디지트를 확인해 주세요.`);
    return { gtin, exempt: null };
  }
  const reasonRaw = input.gtin_exempt_reason !== undefined && input.gtin_exempt_reason !== null
    ? String(input.gtin_exempt_reason).trim() : '';
  if (reasonRaw === '') {
    throw bad('GTIN_REQUIRED', `${at}옵션별 바코드를 입력하거나 "바코드 없음" 사유를 선택해 주세요.`);
  }
  const [code, ...rest] = reasonRaw.split(':');
  const key = String(code || '').trim().toUpperCase();
  if (!GTIN_EXEMPT_REASONS[key]) {
    throw bad('INVALID_EXEMPT_REASON', `${at}바코드 없음 사유가 올바르지 않습니다.`);
  }
  if (key === 'OTHER') {
    const text = rest.join(':').trim();
    if (!text) throw bad('INVALID_EXEMPT_REASON', `${at}기타 사유를 직접 입력해 주세요.`);
    if (text.length > 100) throw bad('INVALID_EXEMPT_REASON', `${at}기타 사유는 100자 이내로 입력해 주세요.`);
    return { gtin: null, exempt: `OTHER:${text}` };
  }
  return { gtin: null, exempt: key };
}

/** schema.org GTIN property name for a canonical GTIN, or null. */
export function gtinPropName(gtin) {
  const len = String(gtin || '').length;
  return { 8: 'gtin8', 12: 'gtin12', 13: 'gtin13', 14: 'gtin14' }[len] || null;
}

/** Products missing brand or any SKU barcode-or-reason (manufacturer/model optional). */
export const missingIdentifiersSql = (alias = 'p') =>
  `(${alias}.brand IS NULL OR ${alias}.brand = '' OR EXISTS (SELECT 1 FROM product_skus s WHERE s.product_id = ${alias}.id AND s.gtin IS NULL AND (s.gtin_exempt_reason IS NULL OR s.gtin_exempt_reason = '')))`;

/** Products sharing a barcode with another product. */
export const gtinConflictSql = (alias = 'p') =>
  `EXISTS (SELECT 1 FROM product_skus s WHERE s.product_id = ${alias}.id AND s.gtin IS NOT NULL AND EXISTS (SELECT 1 FROM product_skus s2 WHERE s2.gtin = s.gtin AND s2.product_id != ${alias}.id))`;

/** Non-empty brand for new registrations (free text; UI presets NOBRAND_VALUE). */
export function requireBrand(raw) {
  const brand = String(raw ?? '').trim();
  if (!brand) throw bad('BRAND_REQUIRED', '브랜드를 입력해 주세요. 브랜드가 없으면 "노브랜드/자체제작"을 선택해 주세요.');
  if (brand.length > 100) throw bad('BRAND_REQUIRED', '브랜드는 100자 이내로 입력해 주세요.');
  return brand;
}

/**
 * Other products already using any of these GTINs: [{ gtin, product_ids }].
 * Warning only — registration still succeeds (GTINs are globally unique by
 * design, so a clash always deserves a human look, never a silent write).
 */
export async function findGtinConflicts(env, gtins, excludeProductId = null) {
  const out = [];
  for (const gtin of [...new Set((gtins || []).filter(Boolean))]) {
    const { results } = excludeProductId
      ? await env.DB.prepare('SELECT DISTINCT product_id FROM product_skus WHERE gtin = ? AND product_id != ?').bind(gtin, excludeProductId).all()
      : await env.DB.prepare('SELECT DISTINCT product_id FROM product_skus WHERE gtin = ?').bind(gtin).all();
    const ids = (results || []).map((r) => r.product_id);
    if (ids.length) out.push({ gtin, product_ids: ids });
  }
  return out;
}

/** Human-readable duplicate warnings (no other-seller titles leak). */
export function gtinConflictWarnings(conflicts) {
  return (conflicts || []).map((c) => ({
    code: 'GTIN_DUPLICATE',
    message: `바코드 ${c.gtin}이(가) 다른 상품 ${c.product_ids.length}건에서도 사용 중입니다. 관리자 검수 목록에서 확인해 주세요.`
  }));
}
