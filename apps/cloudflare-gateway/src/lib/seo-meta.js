// apps/cloudflare-gateway/src/lib/seo-meta.js
// Entity-based meta rewriting: every title/description/H1 derives from live
// catalog entities (product, category, store) — never a template with blanks.
// The SPA hook (useSeoHead.ts) mirrors clip/clean so server and client agree.

export const SITE_NAME = 'OLMOA';
const TITLE_MAX = 60;
const DESC_MAX = 160;

/** Strip tags, collapse whitespace, drop control chars. Pure. */
export function clean(raw) {
  return String(raw ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** Clip to max chars on a word boundary, ellipsis only when clipped. Pure. */
export function clip(raw, max) {
  const s = clean(raw);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${sp > max * 0.5 ? cut.slice(0, sp) : cut}…`;
}

/** 6-8: `상품명 | 브랜드 | OLMOA`; the description is extracted from the
 *  product text — facts only, no blanket shipping or marketing phrases. */
export function productMeta(p, brand = '') {
  const title = clean(p && p.title) || `${SITE_NAME} 상품`;
  const b = clean(brand || (p && (p.brand || p.brand_name)) || '');
  const full = b ? `${title} | ${b} | ${SITE_NAME}` : `${title} | ${SITE_NAME}`;
  const text = clean(p && (p.description_html || p.description)) || title;
  return { title: clip(full, TITLE_MAX), description: clip(text, DESC_MAX), h1: title };
}

/** 6-8: `하위 - 상위 | OLMOA` (top level: `카테고리명 | OLMOA`); the
 *  description combines facts only — sub names, sub count, live count. */
export function categoryMeta(c, count = 0, parentName = '', subNames = [], subTotal = 0) {
  const name = clean(c && c.name) || '카테고리';
  const parent = clean(parentName);
  const n = Number.isSafeInteger(count) && count > 0 ? count : 0;
  const full = parent ? `${name} - ${parent} | ${SITE_NAME}` : `${name} | ${SITE_NAME}`;
  const subs = (Array.isArray(subNames) ? subNames : []).map((s) => clean(s)).filter(Boolean);
  const total = Number.isSafeInteger(subTotal) && subTotal > 0 ? subTotal : subs.length;
  const shown = subs.slice(0, 3).join('·');
  const parts = [name];
  if (shown && total > 0) parts.push(`${shown}${total > subs.slice(0, 3).length ? ' 등' : ''} 하위 ${total}개`);
  else if (total > 0) parts.push(`하위 ${total}개`);
  if (n > 0) parts.push(`상품 ${n.toLocaleString('ko-KR')}개`);
  return { title: clip(full, TITLE_MAX), description: clip(parts.join(', '), DESC_MAX), h1: name };
}

/** Seller store meta from the store row. */
export function storeMeta(s) {
  const name = clean(s && (s.business_name || s.name)) || '스토어';
  return {
    title: clip(`${name} | ${SITE_NAME} 스토어`, TITLE_MAX),
    description: clip(`${name}의 상품을 ${SITE_NAME}에서 만나보세요.`, DESC_MAX),
    h1: name
  };
}
