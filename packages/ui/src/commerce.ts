// Pure display logic for the commerce components (work order 1-4).
// Erasable TypeScript only: this module is unit-tested directly by node.

export interface PriceLines { list: number | null; rate: number | null; final: number }

/** Display lines: list price struck above, then rate + final. Rate shows only when the list price is really higher. */
export function priceDisplayLines(original: number | null | undefined, sale: number | null | undefined): PriceLines {
  const o = Number(original); const s = Number(sale)
  const fin = Number.isFinite(s) ? s : 0
  if (!Number.isFinite(o) || o <= 0 || s >= o) return { list: null, rate: null, final: fin }
  return { list: o, rate: Math.floor(((o - s) * 100) / o), final: fin }
}

/** Stepper value clamped to 1..stock (fractional and empty input fold to 1). */
export function clampQuantity(qty: number | null | undefined, stock: number | null | undefined): number {
  const max = Number.isFinite(Number(stock)) && Number(stock) >= 1 ? Math.floor(Number(stock)) : 1
  const q = Number.isFinite(Number(qty)) ? Math.floor(Number(qty)) : 1
  return Math.min(Math.max(1, q), max)
}

export interface Countdown { d: number; h: number; m: number; s: number; expired: boolean }

/** Remaining time split for the countdown; expired once the end passes. */
export function countdownParts(endsAtMs: number, nowMs: number): Countdown {
  const rest = Math.floor((endsAtMs - nowMs) / 1000)
  if (rest <= 0) return { d: 0, h: 0, m: 0, s: 0, expired: true }
  return {
    d: Math.floor(rest / 86400),
    h: Math.floor((rest % 86400) / 3600),
    m: Math.floor((rest % 3600) / 60),
    s: rest % 60,
    expired: false
  }
}

/** Rating row shows only with at least one review. */
export function ratingVisible(reviewCount: number | null | undefined): boolean {
  return Number(reviewCount) > 0
}

/** Page count for server-paged tables (at least one page). */
export function tablePages(total: number, perPage: number): number {
  return Math.max(1, Math.ceil((Number(total) || 0) / (Number(perPage) > 0 ? Number(perPage) : 50)))
}

/** Sell-through percent for progress bars; null when there is nothing measured (caller hides the bar). */
export function soldoutPct(sold: number | null | undefined, allocated: number | null | undefined): number | null {
  const a = Number(allocated); const s = Number(sold)
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(s)) return null
  return Math.min(100, Math.max(0, Math.round((s * 100) / a)))
}
