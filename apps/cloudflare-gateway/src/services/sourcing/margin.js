// apps/cloudflare-gateway/src/services/sourcing/margin.js
// Channel price/margin engine. Integer KRW only (lib/money.js); channel
// margins come from the sourcing_channel_policy table — never hardcoded.
//
// Quote formula: sale = cost + round_half_up(cost * margin_bps / 10000).
// No policy row -> POLICY_MISSING (fail closed, never a default margin).
// Quotes persist as JSON on the offer for the pricing audit trail.

import { assertWon } from '../../lib/money.js';

/**
 * Quote per-channel sale prices: cost + marginBps per channel.
 * @param {number} costKrw - normalized supply cost (int KRW)
 * @param {Object<string,number>} policyBps - channel -> margin bps
 */
export function quoteChannelPrices(costKrw, policyBps) {
  assertWon(costKrw, 'costKrw');
  const channels = Object.keys(policyBps || {});
  if (!channels.length) throw new Error('POLICY_MISSING: no channel margin policy');
  const quotes = {};
  for (const ch of channels) {
    const bps = policyBps[ch];
    if (!Number.isSafeInteger(bps) || bps < 0 || bps > 100000) {
      throw new Error(`POLICY_INVALID: margin bps out of range for ${ch}`);
    }
    // Half-up integer math; margins above 100% are allowed (bps <= 100000).
    quotes[ch] = assertWon(costKrw + Math.floor((costKrw * bps + 5000) / 10000), `quote:${ch}`);
  }
  return quotes;
}

/** Per-channel {cost, margin, sale} breakdown for the admin UI. */
export function quoteBreakdown(costKrw, policyBps) {
  const quotes = quoteChannelPrices(costKrw, policyBps);
  const out = {};
  for (const [ch, sale] of Object.entries(quotes)) {
    out[ch] = { cost: costKrw, margin: sale - costKrw, sale };
  }
  return out;
}

/** Load active channel margins (bps) from D1; empty when unconfigured. */
export async function loadChannelPolicy(env) {
  const { results } = await env.DB.prepare(
    'SELECT channel, margin_bps FROM sourcing_channel_policy WHERE is_active = 1'
  ).all();
  const policy = {};
  for (const r of results || []) policy[r.channel] = Number(r.margin_bps);
  return policy;
}

/** Persist quotes JSON onto the offer row (audit trail for pricing). */
export async function saveQuotes(env, offerId, quotes) {
  await env.DB.prepare(
    'UPDATE sourcing_offers SET channel_quotes_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(JSON.stringify(quotes), offerId).run();
}
