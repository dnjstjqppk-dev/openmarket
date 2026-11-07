// apps/cloudflare-gateway/src/lib/fx.js
// Single source for foreign-currency -> KRW conversion.
// Live values come from the operator-maintained exchange_rates table
// (base KRW; inverse_rate = KRW per 1 unit of the target currency).
// FALLBACK_KRW_PER_UNIT is the offline/empty-table reference — the ONLY
// hardcoded rate map in the gateway. Pure calculators default to it;
// request handlers resolve live values through krwPerUnit*.

export const FALLBACK_KRW_PER_UNIT = Object.freeze({
  KRW: 1.0,
  USD: 1380.0,
  CNY: 192.0,
  JPY: 9.0,
  EUR: 1490.0,
  SGD: 1045.0
});

/** KRW per 1 unit of `currency`, preferring the operator table. Never throws. */
export async function krwPerUnit(env, currency) {
  const c = String(currency || 'KRW').toUpperCase();
  if (c === 'KRW') return { rate: 1.0, source: 'IDENTITY', updated_at: null };
  try {
    const row = await env.DB.prepare(
      "SELECT inverse_rate, updated_at FROM exchange_rates WHERE base_currency = 'KRW' AND target_currency = ?"
    ).bind(c).first();
    const r = Number(row && row.inverse_rate);
    if (r > 0) return { rate: r, source: 'OPERATOR_TABLE', updated_at: row.updated_at || null };
  } catch (_) { /* fall through to the reference table */ }
  return { rate: FALLBACK_KRW_PER_UNIT[c] || 1.0, source: 'FALLBACK', updated_at: null };
}

/** { CUR: KRW-per-unit } for the requested (or all reference) currencies. */
export async function krwPerUnitMap(env, currencies) {
  const out = {};
  for (const c of currencies || Object.keys(FALLBACK_KRW_PER_UNIT)) {
    out[String(c).toUpperCase()] = (await krwPerUnit(env, c)).rate;
  }
  return out;
}
