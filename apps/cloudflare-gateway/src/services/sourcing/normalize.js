// apps/cloudflare-gateway/src/services/sourcing/normalize.js
// Normalization: raw provider payloads -> canonical sourcing_offers D1 row.
// Strict validation; never invents prices, stock, or copy (Zero-Mock).
//
// Canonical field contract (sourcing_offers):
// - provider: one of domeme|ownerclan|onchannel|cj-dropshipping
// - external_id: provider-side SKU key (UNIQUE with provider)
// - cost_krw: integer KRW supply cost (FX-converted before insert)
// - stock_qty: last observed sellable quantity (stale until precheck)
// - status: PENDING -> APPROVED|REJECTED -> PUBLISHED (operator-gated)

import { assertWon } from '../../lib/money.js';
import { newId } from '../../lib/ids.js';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PUBLISHED'];
const PROVIDERS = ['domeme', 'ownerclan', 'onchannel', 'cj-dropshipping'];

/**
 * Validate a canonical offer and build a D1 insert row.
 * Required: externalId, title, costKrw (int KRW), currency, stockQty.
 */
export function normalizeOffer(provider, input) {
  if (!PROVIDERS.includes(provider)) throw new Error(`INVALID_OFFER: unknown provider ${provider}`);
  const title = String(input?.title ?? '').trim();
  const externalId = String(input?.externalId ?? '').trim();
  if (!externalId || !title) throw new Error('INVALID_OFFER: externalId and title required');
  let costKrw;
  try {
    costKrw = assertWon(input?.costKrw, 'costKrw');
  } catch {
    throw new Error('INVALID_OFFER: costKrw must be a non-negative integer');
  }
  const stockQty = Number(input?.stockQty ?? 0);
  if (!Number.isSafeInteger(stockQty) || stockQty < 0) throw new Error('INVALID_OFFER: stockQty invalid');
  const currency = String(input?.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('INVALID_OFFER: currency must be ISO-4217');
  return {
    id: newId('src'), provider, external_id: externalId, title,
    cost_krw: costKrw, currency, stock_qty: stockQty, status: 'PENDING',
    image_r2_key: null, channel_quotes_json: null
  };
}

export function assertStatusTransition(from, to) {
  const allowed = { PENDING: ['APPROVED', 'REJECTED'], APPROVED: ['PUBLISHED', 'REJECTED'], REJECTED: ['PENDING'], PUBLISHED: [] };
  if (!STATUSES.includes(to) || !(allowed[from] || []).includes(to)) {
    throw new Error(`INVALID_STATUS: ${from} -> ${to}`);
  }
}

export { STATUSES, PROVIDERS };
