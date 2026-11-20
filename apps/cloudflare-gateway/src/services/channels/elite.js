// apps/cloudflare-gateway/src/services/channels/elite.js
// Elite selection (정예선별): which APPROVED sourcing offers may be published
// to a channel. Three gates, in order:
//   1. margin >= 15% (1500 bps) from the operator-quoted channel price;
//   2. notice (상품정보제공고시) satisfied on the linked own-mall product;
//   3. best-first ordering by the linked product's cumulative sales.
// Unlinked offers surface with notice_ok=null — publish must attach a product.

export const ELITE_MIN_MARGIN_BPS = 1500;

/** Integer margin bps: (sale - cost) * 10000 / cost. Null when unknowable. */
export function marginBps(costKrw, saleKrw) {
  if (!Number.isSafeInteger(costKrw) || costKrw <= 0) return null;
  if (!Number.isSafeInteger(saleKrw) || saleKrw < 0) return null;
  return Math.floor(((saleKrw - costKrw) * 10000) / costKrw);
}

/** Margin for one channel from the offer's stored quotes JSON (null = no quote). */
export function quoteMarginBps(costKrw, quotesJson, channel) {
  let quotes = null;
  try {
    quotes = JSON.parse(quotesJson || 'null');
  } catch {
    return null;
  }
  const sale = quotes?.[channel];
  if (!Number.isSafeInteger(sale)) return null;
  return marginBps(costKrw, sale);
}

/**
 * Elite candidates for a channel: APPROVED offers with margin >= 15%,
 * best-sellers first. Notice status comes from the linked own-mall product.
 */
export async function selectEliteCandidates(env, channel, { limit = 50 } = {}) {
  const cap = Math.min(200, Math.max(1, Number(limit) || 50));
  const { results } = await env.DB.prepare(
    `SELECT o.*,
       (SELECT p.total_sold_count FROM sourcing_channel_listings cl
         JOIN products p ON p.id = cl.product_id
        WHERE cl.offer_id = o.id AND cl.product_id IS NOT NULL LIMIT 1) AS sold,
       (SELECT p.notice_template_id FROM sourcing_channel_listings cl
         JOIN products p ON p.id = cl.product_id
        WHERE cl.offer_id = o.id AND cl.product_id IS NOT NULL LIMIT 1) AS notice_tpl
     FROM sourcing_offers o WHERE o.status = 'APPROVED' LIMIT 500`
  ).all();
  return (results || [])
    .map((o) => {
      const bps = quoteMarginBps(o.cost_krw, o.channel_quotes_json, channel);
      const linked = o.sold !== null && o.sold !== undefined;
      return {
        offer_id: o.id, provider: o.provider, external_id: o.external_id, title: o.title,
        cost_krw: o.cost_krw, stock_qty: o.stock_qty, margin_bps: bps,
        notice_ok: linked ? o.notice_tpl !== null : null,
        sold: Number(o.sold || 0)
      };
    })
    .filter((c) => c.margin_bps !== null && c.margin_bps >= ELITE_MIN_MARGIN_BPS)
    .sort((a, b) => (b.sold - a.sold) || (b.margin_bps - a.margin_bps))
    .slice(0, cap);
}
