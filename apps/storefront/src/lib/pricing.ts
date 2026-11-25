// apps/storefront/src/lib/pricing.ts
// Buyer-side price estimate that mirrors the server exactly (apps/cloudflare-gateway/src/services/orders.js):
//   volumeDiscountPct(qty) = qty >= 10 ? 15 : qty >= 5 ? 10 : qty >= 3 ? 5 : 0
//   unitPrice = sale_price - applyBps(sale_price, pct * 100)      (applyBps rounds half-up, per unit)
//   group shipping follows the product's own shipping policy snapshot (6-11:
//   no fee defaults anywhere; the server quote stays the price authority).
// The server re-computes everything at checkout; this only keeps the cart and product page from showing a
// different number than the order sheet will.

export const VOLUME_TIERS = [
  { min: 3, pct: 5 },
  { min: 5, pct: 10 },
  { min: 10, pct: 15 }
] as const

export function volumeDiscountPct(qty: number): number {
  return qty >= 10 ? 15 : qty >= 5 ? 10 : qty >= 3 ? 5 : 0
}

function applyBps(amount: number, bps: number): number {
  return Math.floor((amount * bps + 5000) / 10000)
}

/** Unit price after the quantity tier, rounded per unit like the server. */
export function volumeUnitPrice(salePrice: number, qty: number): number {
  const pct = volumeDiscountPct(qty)
  return salePrice - applyBps(salePrice, pct * 100)
}

export function lineTotal(salePrice: number, qty: number): number {
  return volumeUnitPrice(salePrice, qty) * qty
}

export interface ShippingPolicyLike {
  fee_type?: string | null
  base_fee?: number | null
  free_threshold?: number | null
  qty_unit?: number | null
  remote_surcharge?: number | null
}

/** Group base fee from the seller-chosen policy (mirrors server groupShipFee, zone surcharge excluded). */
export function policyShipFee(policy: ShippingPolicyLike | null | undefined, goods: number, qty: number): number {
  if (!policy) return 0
  switch (String(policy.fee_type || '').toUpperCase()) {
    case 'FREE':
      return 0
    case 'CONDITIONAL': {
      const th = policy.free_threshold
      if (th === null || th === undefined) return Number(policy.base_fee ?? 0)
      return goods >= Number(th) ? 0 : Number(policy.base_fee ?? 0)
    }
    case 'PER_QTY': {
      const unit = Number(policy.qty_unit) > 0 ? Math.trunc(Number(policy.qty_unit)) : 1
      return Number(policy.base_fee ?? 0) * Math.ceil(qty / unit)
    }
    case 'PAID':
    default:
      return Number(policy.base_fee ?? 0)
  }
}
