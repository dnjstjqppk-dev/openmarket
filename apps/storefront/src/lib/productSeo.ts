// apps/storefront/src/lib/productSeo.ts
// Pure SEO builders for PDP/PLP views: head inputs + JSON-LD graphs built
// from live server rows only. Zero-Mock: missing fields omit their node,
// nothing is guessed (no fallback price, rating, or URL).

export function plainText(html: unknown, max = 160): string {
  const t = String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return t.slice(0, Math.max(0, max))
}

/** 6-8: clip on a word boundary with … (mirrors gateway seo-meta clip). */
export function clipText(raw: unknown, max: number): string {
  const s = String(raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return `${sp > max * 0.5 ? cut.slice(0, sp) : cut}…`
}

export const HEAD_TITLE_MAX = 60

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

/** 6-8: `상품명 | 브랜드 | OLMOA` (brand omitted when blank), clipped at 60. */
export function productHeadOf(p: any, path: string, base: string) {
  const images = Array.isArray(p?.images) ? p.images.map((im: any) => im?.image_url).filter(Boolean) : []
  const title = String(p?.title || '상품')
  const brand = String(p?.brand || p?.brand_name || '').trim()
  return {
    path, base,
    title: clipText(brand ? `${title} | ${brand} | OLMOA` : `${title} | OLMOA`, HEAD_TITLE_MAX),
    description: plainText(p?.description_html) || title,
    image: images[0] || String(p?.thumbnail_url || '')
  }
}

export interface CategoryHeadInput {
  name: string
  parentName?: string
  subNames?: string[]
  subTotal?: number
  productCount?: number
}

/** 6-8: `하위 - 상위 | OLMOA` (top level: `카테고리명 | OLMOA`); description is
 *  facts only — sub-category names, sub count, live product count. */
export function categoryHeadOf(c: CategoryHeadInput, path: string, base: string, query?: unknown) {
  const name = String(c?.name || '카테고리')
  const parent = String(c?.parentName || '').trim()
  const title = clipText(parent ? `${name} - ${parent} | OLMOA` : `${name} | OLMOA`, HEAD_TITLE_MAX)
  const subs = (Array.isArray(c?.subNames) ? c.subNames : []).map((s) => String(s || '').trim()).filter(Boolean)
  const subTotal = Number.isSafeInteger(c?.subTotal) && (c.subTotal as number) > 0 ? (c.subTotal as number) : subs.length
  const count = Number.isSafeInteger(c?.productCount) && (c.productCount as number) > 0 ? (c.productCount as number) : 0
  const shown = subs.slice(0, 3).join('·')
  const parts = [name]
  if (shown && subTotal > 0) parts.push(`${shown}${subTotal > subs.slice(0, 3).length ? ' 등' : ''} 하위 ${subTotal}개`)
  else if (subTotal > 0) parts.push(`하위 ${subTotal}개`)
  if (count > 0) parts.push(`상품 ${count.toLocaleString('ko-KR')}개`)
  return { path, base, query, title, description: parts.join(', ') }
}

/** 6-8: gallery alt = product name + live option values + position. Option
 *  values come from the SKUs on sale; nothing is invented for unmapped images. */
export function galleryAltOf(title: unknown, skus: any[], index: number, total: number): string {
  const name = String(title || '').trim() || '상품'
  const values: string[] = []
  for (const s of Array.isArray(skus) ? skus : []) {
    try {
      const obj = JSON.parse(String(s?.option_combination_json || '{}'))
      for (const v of Object.values(obj)) {
        const t = String(v || '').trim()
        if (t && !values.includes(t)) values.push(t)
      }
    } catch { /* malformed combo contributes nothing */ }
  }
  const shown = values.slice(0, 3).join('·')
  const extra = values.length > 3 ? ` 외 ${values.length - 3}종` : ''
  const opts = shown ? ` ${shown}${extra}` : ''
  const pos = Number(total) > 1 ? ` ${Number(index) + 1}` : ''
  return `${name}${opts}${pos}`
}

/** Product + Offer (+rating when reviewed) + BreadcrumbList @graph. */
export function productJsonLdOf(p: any, canonical: string, opts: { windowDays?: number } = {}) {
  const price = lowestPriceOf(p)
  const reviewCount = Number(p?.review_count || 0)
  const avgRating = Number(p?.avg_rating)
  const updated = String(p?.updated_at || '').slice(0, 10)
  const product: Record<string, unknown> = {
    '@type': 'Product',
    name: String(p?.title || '상품'),
    url: canonical,
    image: [String(p?.thumbnail_url || '')].filter(Boolean)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(updated)) product.dateModified = updated
  // 6-3: same seller description the page renders (plain text, capped like meta).
  const desc = plainText(p?.description_html, 1000)
  if (desc) product.description = desc
  product.sku = String(p?.id || '')
  const brand = String(p?.brand || '').trim()
  if (brand) product.brand = { '@type': 'Brand', name: brand }
  const mfr = String(p?.manufacturer || '').trim()
  if (mfr) product.manufacturer = { '@type': 'Organization', name: mfr }
  const model = String(p?.model_name || '').trim()
  if (model) product.mpn = model
  const digits = String(p?.primary_gtin || '').replace(/\D/g, '')
  const gtinProp: Record<number, string> = { 8: 'gtin8', 12: 'gtin12', 13: 'gtin13', 14: 'gtin14' }
  if (gtinProp[digits.length]) product[gtinProp[digits.length]] = digits
  if (price !== null) {
    const offer: Record<string, unknown> = {
      '@type': 'Offer', priceCurrency: 'KRW', price,
      availability: inStockOf(p) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: canonical
    }
    const policy = p?.shipping_policy
    if (policy && String(policy.fee_type || '').toUpperCase() !== '') {
      const rate = String(policy.fee_type).toUpperCase() === 'FREE' ? 0 : Number(policy.base_fee ?? 0)
      const details: Record<string, unknown> = {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: Number.isSafeInteger(rate) && rate >= 0 ? rate : 0, currency: 'KRW' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'KR' }
      }
      if (Number.isSafeInteger(Number(policy.processing_days)) && Number(policy.processing_days) > 0) {
        details.deliveryTime = { '@type': 'ShippingDeliveryTime', handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: Number(policy.processing_days), unitCode: 'DAY' } }
      }
      offer.shippingDetails = details
      offer.hasMerchantReturnPolicy = returnPolicyNodeOf(policy, opts.windowDays ?? 7)
    }
    product.offers = offer
  }
  if (reviewCount > 0 && Number.isFinite(avgRating)) {
    product.aggregateRating = { '@type': 'AggregateRating', reviewCount, ratingValue: avgRating }
  }
  const liveReviews = (Array.isArray(p?.reviews_preview) ? p.reviews_preview : [])
    .filter((r: any) => r && String(r.body || '').trim() && Number.isFinite(Number(r.rating))).slice(0, 5)
  if (liveReviews.length) {
    product.review = liveReviews.map((r: any) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: String(r.author || '구매자') },
      reviewRating: { '@type': 'Rating', ratingValue: Number(r.rating) },
      reviewBody: plainText(r.body, 500),
      ...(r.date ? { datePublished: String(r.date).slice(0, 10) } : {})
    }))
  }
  const crumbs: Record<string, unknown>[] = [{ '@type': 'ListItem', position: 1, name: '홈', item: canonical.split('/product/')[0] + '/' }]
  if (p?.category_slug) crumbs.push({ '@type': 'ListItem', position: 2, name: String(p.category_name || p.category_slug), item: `${canonical.split('/product/')[0]}/category/${p.category_slug}` })
  crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: String(p?.title || '상품'), item: canonical })
  return { '@context': 'https://schema.org', '@graph': [product, { '@type': 'BreadcrumbList', itemListElement: crumbs }] }
}

/** MerchantReturnPolicy from a seller shipping policy + the effective window. */
export function returnPolicyNodeOf(policy: any, windowDays = 7): Record<string, unknown> | null {
  if (!policy) return null
  const fee = Number(policy.return_fee ?? 0)
  const node: Record<string, unknown> = {
    '@type': 'MerchantReturnPolicy',
    returnPolicyCountry: 'KR',
    merchantReturnDays: Number.isSafeInteger(windowDays) && windowDays > 0 ? windowDays : 7,
    returnFees: fee > 0 ? 'https://schema.org/ReturnFeesCustomer' : 'https://schema.org/FreeReturn',
    returnMethod: 'https://schema.org/ReturnByMail'
  }
  if (fee > 0) node.customerRemorseReturnFees = { '@type': 'MonetaryAmount', value: fee, currency: 'KRW' }
  return node
}

/** QAPage from brief-style [{ q, a }]; null when empty (caller skips injection). */
export function qaPageJsonLdOf(canonical: string, qna: any[]): Record<string, unknown> | null {
  const items = (Array.isArray(qna) ? qna : []).filter((r: any) => r && String(r.q || '').trim() && String(r.a || '').trim()).slice(0, 10)
  if (!items.length) return null
  return {
    '@context': 'https://schema.org', '@type': 'QAPage', url: canonical,
    mainEntity: items.map((r: any) => ({
      '@type': 'Question', name: String(r.q),
      acceptedAnswer: { '@type': 'Answer', text: plainText(r.a, 1000) }
    }))
  }
}

/** Store graph with the default policy's return terms (null without a policy). */
export function storeJsonLdOf(store: any, canonical: string, windowDays = 7): Record<string, unknown> | null {
  const policy = store?.shipping_policy
  if (!policy) return null
  const partner = store?.partner || {}
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: String(partner.company_name || partner.business_name || 'OLMOA 스토어'),
    url: canonical,
    hasMerchantReturnPolicy: returnPolicyNodeOf(policy, windowDays)
  }
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
