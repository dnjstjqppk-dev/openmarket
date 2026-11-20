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

const krw = (n) => (Number.isSafeInteger(n) && n > 0 ? `${n.toLocaleString('ko-KR')}원` : '');

/** Product detail meta from the product row + its category name. */
export function productMeta(p, categoryName = '') {
  const title = clean(p && p.title) || `${SITE_NAME} 상품`;
  const cat = clean(categoryName);
  const price = krw(p && (p.lowest_sale_price ?? p.sale_price));
  const full = `${title}${cat ? ` | ${cat}` : ''} | ${SITE_NAME}`;
  const desc = `${title}${cat ? ` — ${cat}` : ''}${price ? ` ${price}` : ''}. ${SITE_NAME}에서 무료배송 혜택으로 만나보세요.`;
  return { title: clip(full, TITLE_MAX), description: clip(desc, DESC_MAX), h1: title };
}

/** Category PLP meta from the category row + its live product count. */
export function categoryMeta(c, count = 0) {
  const name = clean(c && c.name) || '카테고리';
  const n = Number.isSafeInteger(count) && count > 0 ? count : 0;
  const full = `${name} | ${SITE_NAME}`;
  const desc = n > 0
    ? `${name} 상품 ${n.toLocaleString('ko-KR')}개를 ${SITE_NAME}에서 만나보세요.`
    : `${name} 상품을 ${SITE_NAME}에서 만나보세요.`;
  return { title: clip(full, TITLE_MAX), description: clip(desc, DESC_MAX), h1: name };
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
