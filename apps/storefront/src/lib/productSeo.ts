// apps/storefront/src/lib/productSeo.ts
// Pure SEO builders for PDP/PLP views: head inputs + JSON-LD graphs built
// from live server rows only. Zero-Mock: missing fields omit their node,
// nothing is guessed (no fallback price, rating, or URL).

export function plainText(html: unknown, max = 160): string {
  const t = String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return t.slice(0, Math.max(0, max))
}

/** Lowest live SKU price, or null when no priced SKU exists. */
export function lowestPriceOf(p: any): number | null {
  const skus = Array.isArray(p?.skus) ? p.skus : []
  const prices = skus.map((s: any) => Number(s?.sale_price)).filter((n: number) => Number.isFinite(n) && n >= 0)
  const fallback = Number(p?.lowest_sale_price)
  if (prices.length) return Math.min(...prices)
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : null
}

/** True when any SKU reports stock on hand. */
export function inStockOf(p: any): boolean {
  const skus = Array.isArray(p?.skus) ? p.skus : []
  return skus.some((s: any) => Number(s?.stock_quantity) > 0)
}

export function productHeadOf(p: any, path: string, base: string) {
  const images = Array.isArray(p?.images) ? p.images.map((im: any) => im?.image_url).filter(Boolean) : []
  return {
    path, base,
    title: `${String(p?.title || '상품')} | OLMOA`,
    description: plainText(p?.description_html) || String(p?.title || ''),
    image: images[0] || String(p?.thumbnail_url || '')
  }
}

/** Product + Offer (+rating when reviewed) + BreadcrumbList @graph. */
export function productJsonLdOf(p: any, canonical: string) {
  const price = lowestPriceOf(p)
  const reviewCount = Number(p?.review_count || 0)
  const avgRating = Number(p?.avg_rating)
  const product: Record<string, unknown> = {
    '@type': 'Product',
    name: String(p?.title || '상품'),
    url: canonical,
    image: [String(p?.thumbnail_url || '')].filter(Boolean)
  }
  const brand = String(p?.brand_name || p?.brand || '').trim()
  if (brand) product.brand = { '@type': 'Brand', name: brand }
  if (price !== null) {
    product.offers = {
      '@type': 'Offer', priceCurrency: 'KRW', price,
      availability: inStockOf(p) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: canonical
    }
  }
  if (reviewCount > 0 && Number.isFinite(avgRating)) {
    product.aggregateRating = { '@type': 'AggregateRating', reviewCount, ratingValue: avgRating }
  }
  const crumbs: Record<string, unknown>[] = [{ '@type': 'ListItem', position: 1, name: '홈', item: canonical.split('/product/')[0] + '/' }]
  if (p?.category_slug) crumbs.push({ '@type': 'ListItem', position: 2, name: String(p.category_name || p.category_slug), item: `${canonical.split('/product/')[0]}/category/${p.category_slug}` })
  crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: String(p?.title || '상품'), item: canonical })
  return { '@context': 'https://schema.org', '@graph': [product, { '@type': 'BreadcrumbList', itemListElement: crumbs }] }
}

/** CollectionPage + ItemList for PLP rows (first 20, real URLs only). */
export function plpJsonLdOf(title: string, canonical: string, items: any[], base: string) {
  const elements = (Array.isArray(items) ? items : []).slice(0, 20)
    .map((it: any) => ({ id: it?.slug || it?.product_id || it?.id, name: String(it?.title || it?.name || '') }))
    .filter((e) => e.id && e.name)
    .map((e, i) => ({ '@type': 'ListItem', position: i + 1, name: e.name, url: `${String(base).replace(/\/$/, '')}/product/${e.id}` }))
  return {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url: canonical,
    mainEntity: { '@type': 'ItemList', numberOfItems: elements.length, itemListElement: elements }
  }
}
