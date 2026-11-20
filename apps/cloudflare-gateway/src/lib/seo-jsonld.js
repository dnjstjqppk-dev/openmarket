// apps/cloudflare-gateway/src/lib/seo-jsonld.js
// JSON-LD graph builders (schema.org): Organization, WebSite, BreadcrumbList,
// Product/Offer(+AggregateRating when the counts are real), FAQPage, ItemList.
// Pure functions over live rows — no ratings are invented when count is 0.

import { clean } from './seo-meta.js';

const CTX = 'https://schema.org';
const abs = (base, path) => `${String(base).replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

/** Site-wide graphs: Organization + WebSite with SearchAction. */
export function siteGraphs(base) {
  return [
    { '@context': CTX, '@type': 'Organization', name: 'OLMOA', url: base, logo: abs(base, '/olmoa-logo.svg') },
    {
      '@context': CTX, '@type': 'WebSite', name: 'OLMOA', url: base,
      potentialAction: { '@type': 'SearchAction', target: `${abs(base, '/search')}?q={query}`, 'query-input': 'required name=query' }
    }
  ];
}

/** BreadcrumbList from [{ label, to }]; the last crumb carries no URL. */
export function breadcrumbGraph(base, crumbs = []) {
  return {
    '@context': CTX, '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: clean(c.label),
      ...(i < crumbs.length - 1 && c.to ? { item: abs(base, c.to) } : {})
    }))
  };
}

/** Product graph (+Offer; +AggregateRating only when reviewCount > 0). */
export function productGraph(base, p, { crumbs = [], rating = null, reviewCount = 0, availability = 'https://schema.org/InStock' } = {}) {
  const price = Number(p.lowest_sale_price ?? p.sale_price ?? 0) || 0;
  const product = {
    '@context': CTX, '@type': 'Product',
    name: clean(p.title) || 'OLMOA 상품',
    url: abs(base, `/product/${encodeURIComponent(p.id)}`),
    ...(p.thumbnail_url ? { image: [p.thumbnail_url] } : {}),
    offers: { '@type': 'Offer', priceCurrency: 'KRW', price, availability }
  };
  if (Number.isSafeInteger(reviewCount) && reviewCount > 0 && Number.isFinite(Number(rating))) {
    product.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number(rating), reviewCount };
  }
  return crumbs.length ? [product, breadcrumbGraph(base, crumbs)] : [product];
}

/** FAQPage from [{ q, a }]; empty input yields no graph (null). */
export function faqGraph(faqs = []) {
  const items = faqs.filter((f) => clean(f.q) && clean(f.a));
  if (!items.length) return null;
  return {
    '@context': CTX, '@type': 'FAQPage',
    mainEntity: items.map((f) => ({ '@type': 'Question', name: clean(f.q), acceptedAnswer: { '@type': 'Answer', text: clean(f.a) } }))
  };
}

/** ItemList for PLP/channel rows [{ id, title }]. */
export function itemListGraph(base, name, items = []) {
  return {
    '@context': CTX, '@type': 'ItemList', name: clean(name) || '상품 목록',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1,
      url: abs(base, `/product/${encodeURIComponent(it.id)}`), name: clean(it.title)
    }))
  };
}

/** Serialize one graph as an XSS-safe <script type="application/ld+json"> tag. */
export function scriptTag(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}
