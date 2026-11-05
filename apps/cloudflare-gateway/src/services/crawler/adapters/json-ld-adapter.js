// apps/cloudflare-gateway/src/services/crawler/adapters/json-ld-adapter.js
// Extracts structured Schema.org/Product data from HTML <script type="application/ld+json">.

export function extractJsonLd(html) {
  if (!html || typeof html !== 'string') return null;

  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    const rawContent = match[1].trim();
    if (!rawContent) continue;

    try {
      const data = JSON.parse(rawContent);
      const productObj = findProductNode(data);
      if (productObj) {
        return normalizeJsonLdProduct(productObj);
      }
    } catch {
      // Continue to next script tag if parse fails
    }
  }

  return null;
}

function findProductNode(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    const type = node['@type'];
    if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
      return node;
    }
    if (node['@graph'] && Array.isArray(node['@graph'])) {
      return findProductNode(node['@graph']);
    }
  }
  return null;
}

function normalizeJsonLdProduct(p) {
  const title = p.name || p.headline || '';
  const description = p.description || '';
  const brand = typeof p.brand === 'string' ? p.brand : (p.brand?.name || '');
  const model = p.model || p.mpn || '';
  const sku = p.sku || p.productID || '';

  // Images
  let images = [];
  if (typeof p.image === 'string') images.push(p.image);
  else if (Array.isArray(p.image)) {
    images = p.image.map((im) => (typeof im === 'string' ? im : im?.url)).filter(Boolean);
  } else if (p.image?.url) {
    images.push(p.image.url);
  }

  // Offers & Price
  let price = 0;
  let currency = 'KRW';
  let availability = 'InStock';

  const offers = p.offers;
  if (offers) {
    const firstOffer = Array.isArray(offers) ? offers[0] : (offers.offers?.[0] || offers);
    if (firstOffer) {
      price = Number(firstOffer.price || firstOffer.lowPrice || 0);
      currency = String(firstOffer.priceCurrency || 'KRW').toUpperCase();
      availability = String(firstOffer.availability || 'InStock');
    }
  }

  return {
    source_type: 'JSON_LD',
    title: title.trim(),
    description: description.trim(),
    brand: brand.trim(),
    model: model.trim(),
    sku: sku.trim(),
    price,
    currency,
    is_available: !availability.includes('OutOfStock'),
    images,
    raw_schema: p
  };
}
