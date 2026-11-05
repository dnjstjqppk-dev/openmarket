// apps/cloudflare-gateway/src/services/crawler/option-extractor.js
// Multi-dimensional Option Matrix & SKU Synthesizer.
// Takes raw option axes (e.g. Color: [Black, White], Size: [250, 260])
// and synthesizes the exact Cartesian product of valid variants with pricing & stock states.

export function generateVariantCombinations({
  baseSkuPrefix = 'SKU',
  basePrice = 19900,
  options = [], // [{ name: 'Color', values: ['Black', 'White'] }, { name: 'Size', values: ['250', '260'] }]
  knownVariants = [] // If raw page provided actual variant objects with specific prices/stock
}) {
  // If known variants exist with IDs, map them directly
  if (Array.isArray(knownVariants) && knownVariants.length > 0) {
    return knownVariants.map((v, i) => {
      const optMap = v.options || {};
      const summary = Object.entries(optMap).map(([k, val]) => `${k}: ${val}`).join(' / ') || v.title || `옵션 ${i + 1}`;
      return {
        variant_code: v.sku || `${baseSkuPrefix}_VAR_${i + 1}`,
        option_values: optMap,
        option_summary: summary,
        price: Number(v.price || basePrice),
        original_price: Number(v.compare_at_price || v.original_price || Math.round(v.price * 1.3)),
        stock_quantity: v.inventory_quantity !== undefined ? Number(v.inventory_quantity) : 50,
        stock_status: v.available === false ? 'OUT_OF_STOCK' : (v.inventory_quantity !== undefined ? 'KNOWN' : 'UNKNOWN'),
        image_url: v.image_url || null,
        is_available: v.available !== false
      };
    });
  }

  // If no option axes provided, return a single default variant
  if (!options || !Array.isArray(options) || options.length === 0) {
    return [{
      variant_code: `${baseSkuPrefix}_DEF`,
      option_values: { Standard: 'Default' },
      option_summary: '기본 단품 구성',
      price: basePrice,
      original_price: Math.round(basePrice * 1.35),
      stock_quantity: 100,
      stock_status: 'UNKNOWN',
      image_url: null,
      is_available: true
    }];
  }

  // Compute Cartesian product across all option axes
  function cartesian(axes) {
    return axes.reduce((acc, curr) => {
      const name = curr.name || 'Option';
      const vals = Array.isArray(curr.values) && curr.values.length > 0 ? curr.values : ['Standard'];
      return acc.flatMap((prev) => vals.map((v) => ({ ...prev, [name]: String(v) })));
    }, [{}]);
  }

  const combinations = cartesian(options);

  return combinations.map((combo, index) => {
    const summary = Object.entries(combo).map(([k, val]) => `${k}: ${val}`).join(' / ');
    const codeSuffix = Object.values(combo).map((v) => String(v).replace(/[^a-zA-Z0-9가-힣]/g, '').slice(0, 4).toUpperCase()).join('_');
    return {
      variant_code: `${baseSkuPrefix}_${codeSuffix || (index + 1)}`,
      option_values: combo,
      option_summary: summary,
      price: basePrice,
      original_price: Math.round(basePrice * 1.35),
      stock_quantity: 50,
      stock_status: 'UNKNOWN',
      image_url: null,
      is_available: true
    };
  });
}

