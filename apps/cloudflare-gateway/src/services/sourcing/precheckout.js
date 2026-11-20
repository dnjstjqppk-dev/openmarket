// apps/cloudflare-gateway/src/services/sourcing/precheckout.js
// Pre-Checkout defense hook: re-verify provider stock right before payment.
// Hard 500ms budget — timeouts and errors become RECHECK (block checkout,
// ask for retry), never silent ALLOW and never guessed stock.
//
// Decision matrix: ok=true -> ALLOW | ok=false -> DENY (sold out) |
// timeout/shape-error/exception -> RECHECK (retry, stock unknown).
// Every verdict is audit-logged to sourcing_precheck_log by the caller.

export const PRECHECKOUT_TIMEOUT_MS = 500;

/**
 * @typedef {'ALLOW'|'DENY'|'RECHECK'} PrecheckDecision
 * @typedef {{decision: PrecheckDecision, stockQty: number|null, reason: string}} PrecheckVerdict
 */

const RETRYABLE = new Set(['PROVIDER_TIMEOUT', 'PROVIDER_ERROR', 'UPSTREAM_BAD_SHAPE']);

/** RECHECK reasons worth an automatic retry; DENY and INVALID_QTY are not. */
export function isRetryable(reason) {
  return RETRYABLE.has(String(reason));
}

/**
 * @param provider {{checkAvailability(env, externalId, qty): Promise<{ok, stockQty}>}}
 * @returns {Promise<{decision: 'ALLOW'|'DENY'|'RECHECK', stockQty: number|null, reason: string}>}
 */
export async function preCheckoutGuard(provider, externalId, qty, { env = {}, timeoutMs = PRECHECKOUT_TIMEOUT_MS } = {}) {
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    return { decision: 'DENY', stockQty: null, reason: 'INVALID_QTY' };
  }
  let timer;
  try {
    const verdict = await Promise.race([
      provider.checkAvailability(env, externalId, qty),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('PRECHECKOUT_TIMEOUT')), timeoutMs);
      })
    ]);
    if (!verdict || typeof verdict.ok !== 'boolean') {
      return { decision: 'RECHECK', stockQty: null, reason: 'UPSTREAM_BAD_SHAPE' };
    }
    if (verdict.ok) return { decision: 'ALLOW', stockQty: verdict.stockQty ?? null, reason: 'IN_STOCK' };
    return { decision: 'DENY', stockQty: verdict.stockQty ?? 0, reason: 'OUT_OF_STOCK' };
  } catch (e) {
    const timeout = e && /TIMEOUT|abort/i.test(e.message || '');
    return { decision: 'RECHECK', stockQty: null, reason: timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR' };
  } finally {
    clearTimeout(timer);
  }
}
