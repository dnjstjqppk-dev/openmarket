// apps/cloudflare-gateway/src/lib/price-history.js
// Work order 2-8: per-SKU price audit rows. Statements join the caller's own
// batch so the history and the price move atomically.
import { newId } from './ids.js';

export function priceHistoryStatements(env, skuIds, { orig, sale, by }) {
  return skuIds.map((skuId) => env.DB.prepare(
    'INSERT INTO sku_price_history (id, sku_id, original_price, sale_price, changed_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(newId('ph'), skuId, orig, sale, by ?? null));
}

export async function skuIdsOfProduct(env, productId) {
  const { results } = await env.DB.prepare('SELECT id FROM product_skus WHERE product_id = ?').bind(productId).all();
  return results.map((r) => r.id);
}
