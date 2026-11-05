// apps/cloudflare-gateway/src/services/crawler/adapters/meta-og-adapter.js
// Extracts product metadata from HTML <meta> tags (OpenGraph, Twitter Cards, standard meta).

export function extractMetaOg(html) {
  if (!html || typeof html !== 'string') return null;

  const metaMap = {};
  const metaRegex = /<meta\b[^>]*>/gi;
  let match;

  while ((match = metaRegex.exec(html)) !== null) {
    const tag = match[0];
    const nameMatch = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i);
    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (nameMatch && contentMatch) {
      metaMap[nameMatch[1].toLowerCase()] = contentMatch[1].trim();
    }
  }

  // Extract <title> if og:title missing
  let title = metaMap['og:title'] || metaMap['twitter:title'] || metaMap['title'] || '';
  if (!title) {
    const titleTagMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (titleTagMatch) title = titleTagMatch[1].replace(/\s+/g, ' ').trim();
  }

  const description = metaMap['og:description'] || metaMap['twitter:description'] || metaMap['description'] || '';
  const brand = metaMap['product:brand'] || metaMap['brand'] || metaMap['og:site_name'] || '';

  // Images
  const images = [];
  if (metaMap['og:image']) images.push(metaMap['og:image']);
  if (metaMap['og:image:secure_url'] && !images.includes(metaMap['og:image:secure_url'])) {
    images.push(metaMap['og:image:secure_url']);
  }
  if (metaMap['twitter:image'] && !images.includes(metaMap['twitter:image'])) {
    images.push(metaMap['twitter:image']);
  }

  // Price & Currency
  let price = Number(metaMap['product:price:amount'] || metaMap['price'] || metaMap['og:price:amount'] || 0);
  let currency = String(metaMap['product:price:currency'] || metaMap['og:price:currency'] || 'KRW').toUpperCase();

  // If price wasn't in meta, check for common price regex in HTML
  if (!price) {
    const krwMatch = html.match(/(?:₩|&#8361;|원)\s*([0-9,]{3,10})/);
    if (krwMatch) {
      price = Number(krwMatch[1].replace(/,/g, ''));
      currency = 'KRW';
    } else {
      const usdMatch = html.match(/\$\s*([0-9]+\.?[0-9]*)/);
      if (usdMatch) {
        price = Number(usdMatch[1]);
        currency = 'USD';
      }
    }
  }

  if (!title && images.length === 0) return null;

  return {
    source_type: 'META_OG',
    title: title.trim(),
    description: description.trim(),
    brand: brand.trim(),
    price,
    currency,
    images,
    is_available: true
  };
}

