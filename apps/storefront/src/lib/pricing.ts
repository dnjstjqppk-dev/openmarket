// apps/storefront/src/lib/pricing.ts
// Buyer-side price estimate that mirrors the server exactly (apps/cloudflare-gateway/src/services/orders.js):
//   volumeDiscountPct(qty) = qty >= 10 ? 15 : qty >= 5 ? 10 : qty >= 3 ? 5 : 0
//   unitPrice = sale_price - applyBps(sale_price, pct * 100)      (applyBps rounds half-up, per unit)
//   sub-order shipping = threshold > 0 && goods >= threshold ? 0 : base fee   (defaults 3,000 / 30,000)
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

export const DEFAULT_SHIPPING_FEE = 3000
export const DEFAULT_FREE_THRESHOLD = 30000

export function shippingFee(goods: number, baseFee?: number | null, threshold?: number | null): number {
  const fee = baseFee ?? DEFAULT_SHIPPING_FEE
  const t = threshold ?? DEFAULT_FREE_THRESHOLD
  return t > 0 && goods >= t ? 0 : fee
}
