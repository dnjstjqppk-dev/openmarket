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

/**
 * MerchantReturnPolicy from a seller shipping policy + the effective window.
 * Null without a policy row (never a default policy — 6-11).
 */
export function returnPolicyNode(policy, windowDays = 7) {
  if (!policy) return null;
  const fee = Number(policy.return_fee ?? 0);
  const node = {
    '@type': 'MerchantReturnPolicy',
    returnPolicyCountry: 'KR',
    merchantReturnDays: Number.isSafeInteger(windowDays) && windowDays > 0 ? windowDays : 7,
    returnFees: fee > 0 ? 'https://schema.org/ReturnFeesCustomer' : 'https://schema.org/FreeReturn',
    returnMethod: 'https://schema.org/ReturnByMail'
  };
  if (fee > 0) {
    node.customerRemorseReturnFees = { '@type': 'MonetaryAmount', value: fee, currency: 'KRW' };
  }
  return node;
}

/** Product graph (+Offer; +AggregateRating only when reviewCount > 0). */
export function productGraph(base, p, { crumbs = [], rating = null, reviewCount = 0, availability = 'https://schema.org/InStock', shipping = null, gtin = null, description = null, sku = null, reviews = [], priceValidUntil = null, returns = null, windowDays = 7, url = null, offerPrice = null, offerCurrency = null } = {}) {
  // 2026-11-27: the URL's own currency (offerPrice/offerCurrency), exactly what that page renders; KRW otherwise.
  const price = offerPrice !== null && offerPrice !== undefined && offerCurrency ? Number(offerPrice) : (Number(p.lowest_sale_price ?? p.sale_price ?? 0) || 0);
  const priceCurrency = offerPrice !== null && offerPrice !== undefined && offerCurrency ? String(offerCurrency) : 'KRW';
  const updated = String(p.updated_at || '').slice(0, 10);
  const product = {
    '@context': CTX, '@type': 'Product',
    name: clean(p.title) || 'OLMOA 상품',
    url: url ? abs(base, url) : abs(base, `/product/${encodeURIComponent(p.id)}`),
    ...(p.thumbnail_url ? { image: [p.thumbnail_url] } : {}),
    // 6-5: same freshness value as the sitemap lastmod and the .md timestamp.
    ...(/^\d{4}-\d{2}-\d{2}$/.test(updated) ? { dateModified: updated } : {}),
    // 6-3: same seller description the page renders (plain text, caller-supplied).
    ...(clean(description) ? { description: clean(description).slice(0, 1000) } : {}),
    ...(clean(sku ?? p.id) ? { sku: clean(sku ?? p.id) } : {}),
    // 6-12: identifiers from the seller's own rows (each omitted when empty).
    ...(clean(p.brand) ? { brand: { '@type': 'Brand', name: clean(p.brand) } } : {}),
    ...(clean(p.manufacturer) ? { manufacturer: { '@type': 'Organization', name: clean(p.manufacturer) } } : {}),
    ...(clean(p.model_name) ? { mpn: clean(p.model_name) } : {}),
    offers: { '@type': 'Offer', priceCurrency, price, availability, ...(url ? { url: abs(base, url) } : {}) }
  };
  const digits = String(gtin || '').replace(/\D/g, '');
  const gtinProp = { 8: 'gtin8', 12: 'gtin12', 13: 'gtin13', 14: 'gtin14' }[digits.length] || null;
  if (gtinProp) product[gtinProp] = digits;
  if (Number.isSafeInteger(reviewCount) && reviewCount > 0 && Number.isFinite(Number(rating))) {
    product.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number(rating), reviewCount };
  }
  const liveReviews = (reviews || []).filter((r) => r && clean(r.body) && Number.isFinite(Number(r.rating))).slice(0, 5);
  if (liveReviews.length) {
    product.review = liveReviews.map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: clean(r.author) || '구매자' },
      reviewRating: { '@type': 'Rating', ratingValue: Number(r.rating) },
      reviewBody: clean(r.body).slice(0, 500),
      ...(r.date ? { datePublished: String(r.date).slice(0, 10) } : {})
    }));
  }
  if (priceValidUntil && /^\d{4}-\d{2}-\d{2}/.test(String(priceValidUntil))) {
    product.offers.priceValidUntil = String(priceValidUntil).slice(0, 10);
  }
  const returnsNode = returnPolicyNode(returns || shipping, windowDays);
  if (returnsNode) product.offers.hasMerchantReturnPolicy = returnsNode;
  // 6-11: shipping rate from the seller-chosen policy (free 0, paid/conditional
  // the base fee, per-qty the per-unit fee; the free threshold and per-unit
  // nature stay in the page text and product docs, never invented here).
  if (shipping && String(shipping.fee_type || '').toUpperCase() !== '') {
    const rate = String(shipping.fee_type).toUpperCase() === 'FREE' ? 0 : Number(shipping.base_fee ?? 0);
    product.offers.shippingDetails = {
      '@type': 'OfferShippingDetails',
      shippingRate: { '@type': 'MonetaryAmount', value: Number.isSafeInteger(rate) && rate >= 0 ? rate : 0, currency: 'KRW' },
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'KR' },
      // 6-3: handling days from the same policy row (omitted when unset).
      ...(Number.isSafeInteger(Number(shipping.processing_days)) && Number(shipping.processing_days) > 0
        ? { deliveryTime: { '@type': 'ShippingDeliveryTime', handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: Number(shipping.processing_days), unitCode: 'DAY' } } }
        : {})
    };
  }
  return crumbs.length ? [product, breadcrumbGraph(base, crumbs)] : [product];
}

/** QAPage from brief-style [{ q, a }]; empty input yields no graph (null). */
export function qaPageGraph(base, productId, qna = [], url = null) {
  const items = (qna || []).filter((r) => r && clean(r.q) && clean(r.a)).slice(0, 10);
  if (!items.length) return null;
  return {
    '@context': CTX, '@type': 'QAPage',
    url: url ? abs(base, url) : abs(base, `/product/${encodeURIComponent(productId)}`),
    mainEntity: items.map((r) => ({
      '@type': 'Question', name: clean(r.q),
      acceptedAnswer: { '@type': 'Answer', text: clean(r.a).slice(0, 1000) }
    }))
  };
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
export function itemListGraph(base, name, items = [], hrefOf = null) {
  return {
    '@context': CTX, '@type': 'ItemList', name: clean(name) || '상품 목록',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1,
      url: abs(base, hrefOf ? hrefOf(it) : `/product/${encodeURIComponent(it.id)}`), name: clean(it.title)
    }))
  };
}

/** Serialize one graph as an XSS-safe <script type="application/ld+json"> tag. */
export function scriptTag(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}
