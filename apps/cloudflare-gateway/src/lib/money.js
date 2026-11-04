// apps/cloudflare-gateway/src/lib/money.js
// All money is integer KRW (원). No floating point is ever stored or summed.

export function assertWon(n, label = 'amount') {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`MONEY_INVARIANT: ${label} must be a non-negative integer, got ${n}`);
  return n;
}

/** amount * bps / 10000, rounded half-up, integer-only. */
export function applyBps(amount, bps) {
  assertWon(amount, 'amount');
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10000) throw new Error(`MONEY_INVARIANT: bps out of range ${bps}`);
  return Math.floor((amount * bps + 5000) / 10000);
}

/**
 * Split `total` across `weights` so that the parts sum to exactly `total` (largest-remainder method).
 * Deterministic: ties go to the lower index.
 */
export function allocate(total, weights) {
  assertWon(total, 'total');
  const w = weights.map((x) => assertWon(x, 'weight'));
  const sum = w.reduce((a, b) => a + b, 0);
  if (total === 0 || w.length === 0) return w.map(() => 0);
  if (sum === 0) throw new Error('MONEY_INVARIANT: cannot allocate a positive total over zero weights');
  if (total > sum) throw new Error('MONEY_INVARIANT: allocation exceeds weight sum');
  const parts = w.map((x) => Math.floor((total * x) / sum));
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = w
    .map((x, i) => ({ i, rem: (total * x) % sum }))
    .sort((a, b) => (b.rem - a.rem) || (a.i - b.i));
  for (let k = 0; rest > 0; k = (k + 1) % order.length) {
    const idx = order[k].i;
    if (parts[idx] < w[idx]) { parts[idx] += 1; rest -= 1; }
  }
  return parts;
}

/** Portion of an allocated amount for `qty` of `totalQty`, where `alreadyRefunded` has been taken before. */
export function proportionalPortion(allocated, refundedSoFar, qty, totalQty, refundedQtySoFar) {
  const remainingQty = totalQty - refundedQtySoFar;
  if (qty === remainingQty) return allocated - refundedSoFar; // last refund takes the exact remainder
  return Math.min(allocated - refundedSoFar, Math.floor((allocated * qty) / totalQty));
}
