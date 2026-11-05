// apps/cloudflare-gateway/src/services/crawler/adapters/shopify-adapter.js
// Extracts product and multi-variant data from Shopify stores.

export function extractShopify(html) {
  if (!html || typeof html !== 'string') return null;

  // Pattern 1: Embedded var meta = {"product":{...}} or window.ShopifyAnalytics.meta
  const scriptRegex = /var\s+meta\s*=\s*(\{[\s\S]*?\});/i;
  const match = html.match(scriptRegex);

  let productObj = null;
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      productObj = parsed.product || parsed;
    } catch {}
  }

  // Pattern 2: JSON in script tag id="ProductJson-..." or class="product-json"
  if (!productObj) {
    const jsonTagMatch = html.match(/<script\b[^>]*id=["'](?:ProductJson|product-json)[^"']*["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonTagMatch) {
      try {
        productObj = JSON.parse(jsonTagMatch[1]);
      } catch {}
    }
  }

  if (!productObj || !productObj.title) return null;

  const title = productObj.title || '';
  const brand = productObj.vendor || '';
  const description = productObj.description || '';

  // Options
  const options = (productObj.options || []).map((opt) => ({
    name: typeof opt === 'string' ? opt : (opt.name || 'Option'),
    values: Array.isArray(opt.values) ? opt.values : []
  }));

  // Variants
  const knownVariants = (productObj.variants || []).map((v) => {
    // In Shopify, prices are in cents or standard decimal string
    const p = typeof v.price === 'number' ? (v.price > 10000 && v.price % 100 === 0 ? v.price / 100 : v.price) : Number(v.price || 0);
    const cp = typeof v.compare_at_price === 'number' ? (v.compare_at_price > 10000 && v.compare_at_price % 100 === 0 ? v.compare_at_price / 100 : v.compare_at_price) : Number(v.compare_at_price || 0);
    return {
      id: String(v.id),
      sku: v.sku || `SHOPIFY_VAR_${v.id}`,
      title: v.title || v.name,
      price: p,
      compare_at_price: cp > p ? cp : null,
      available: v.available !== false,
      inventory_quantity: v.inventory_quantity !== undefined ? v.inventory_quantity : 50,
      options: {
        ...(v.option1 ? { [options[0]?.name || 'Option1']: v.option1 } : {}),
        ...(v.option2 ? { [options[1]?.name || 'Option2']: v.option2 } : {}),
        ...(v.option3 ? { [options[2]?.name || 'Option3']: v.option3 } : {})
      }
    };
  });

  const basePrice = knownVariants[0]?.price || 0;
  const images = (productObj.images || []).map((im) => (typeof im === 'string' ? im : im?.src)).filter(Boolean);

  return {
    source_type: 'SHOPIFY',
    title: title.trim(),
    brand: brand.trim(),
    description: description.trim(),
    price: basePrice,
    currency: 'USD',
    images,
    options,
    known_variants: knownVariants,
    is_available: knownVariants.some((v) => v.available)
  };
}
