// apps/cloudflare-gateway/src/lib/fake-discount.js
// K-13 fake-discount rule, shared by the admin review queue (checker) and the
// K-06 price-drop job (sender) so the two can never disagree: a sale-price
// drop is suspect when the same SKU raised its original_price within the 7
// days before the drop. History rows must be in ascending (changed_at, rowid)
// order, each with { original_price, sale_price, changed_at }.

const WINDOW_DAYS = 7;
const DAY_MS = 86400000;

function daysBetween(earlier, later) {
  return (Date.parse(later) - Date.parse(earlier)) / DAY_MS;
}

/**
 * First flagged (hike, drop) pair in a SKU's history, or null.
 * Same search order the review queue always used: earliest hike first.
 */
export function findPriceHike(skuId, hist) {
  const rows = hist || [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (cur.original_price > prev.original_price) {
      for (let j = i + 1; j < rows.length; j++) {
        const later = rows[j];
        const days = daysBetween(cur.changed_at, later.changed_at);
        if (days > WINDOW_DAYS) break;
        if (later.sale_price < cur.sale_price) {
          return {
            sku_id: skuId,
            original_before: prev.original_price,
            original_raised: cur.original_price,
            sale_after: later.sale_price
          };
        }
      }
    }
  }
  return null;
}

/**
 * Whether the drop at hist[dropIndex] is fake-flagged: some earlier row
 * raised original_price within 7 days before it and sold higher then.
 * Mirrors the findPriceHike predicate for one fixed drop row.
 */
export function isDropFakeFlagged(hist, dropIndex) {
  const rows = hist || [];
  const drop = rows[dropIndex];
  if (!drop || dropIndex < 1) return false;
  for (let i = 1; i < dropIndex; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (!(cur.original_price > prev.original_price)) continue;
    if (daysBetween(cur.changed_at, drop.changed_at) > WINDOW_DAYS) continue;
    if (drop.sale_price < cur.sale_price) return true;
  }
  return false;
}
