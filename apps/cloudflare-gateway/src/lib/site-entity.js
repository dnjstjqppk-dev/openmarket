// apps/cloudflare-gateway/src/lib/site-entity.js
// 6-5: the site entity in ONE place. The Organization JSON-LD, llms.txt,
// index.html and the storefront footer must carry identical name, tagline and
// logo (tests/seo_llms_docs_test.mjs enforces the match; the footer and the
// home graph import this module, index.html mirrors it statically).
//
// NOTE: the tagline states what the market IS. It must never promise blanket
// perks (decision-19: no site-wide "free shipping" claims).

export const SITE_NAME = 'OLMOA';
export const SITE_TAGLINE = '국내외 판매자의 상품을 한곳에서 비교하고 구매하는 오픈마켓입니다.';
export const SITE_LOGO = '/olmoa-symbol.svg';

export function organizationGraph(base) {
  const b = String(base || '').replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    description: SITE_TAGLINE,
    url: `${b}/`,
    logo: `${b}${SITE_LOGO}`
  };
}
