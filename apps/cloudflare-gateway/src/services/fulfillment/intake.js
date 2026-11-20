// apps/cloudflare-gateway/src/services/fulfillment/intake.js
// Unified channel-order intake: validates raw channel payloads and upserts
// them into unified_orders, idempotent on (channel, external_order_id).
// Storefront rows are mirrored from the verified PG webhook only ??never
// from the unverified webhook body and never invented.

import { newId } from '../../lib/ids.js';

export const INTAKE_CHANNELS = ['storefront', 'smartstore', 'coupang'];
const PROVIDERS = ['domeme', 'ownerclan', 'onchannel', 'cj-dropshipping'];

/** Validate one raw order; throws INVALID_CHANNEL_ORDER, invents nothing. */
export function normalizeChannelOrder(channel, raw = {}) {
  if (!INTAKE_CHANNELS.includes(channel)) throw new Error('INVALID_CHANNEL_ORDER: unknown channel');
  const externalOrderId = String(raw.externalOrderId || raw.external_order_id || '').trim();
  if (!externalOrderId || externalOrderId.length > 120) throw new Error('INVALID_CHANNEL_ORDER: external id required');
  const totalKrw = Number(raw.totalKrw ?? raw.total_krw);
  if (!Number.isSafeInteger(totalKrw) || totalKrw < 0) throw new Error('INVALID_CHANNEL_ORDER: total_krw must be a safe non-negative integer');
  const provider = raw.provider === undefined || raw.provider === null ? null : String(raw.provider);
  if (provider !== null && !PROVIDERS.includes(provider)) throw new Error('INVALID_CHANNEL_ORDER: unknown provider');
  const paid = raw.paid === true || raw.status === 'PAID';
  return {
    id: newId('co'), channel, external_order_id: externalOrderId,
    status: paid ? 'PAID' : 'NEW', total_krw: totalKrw, provider,
    items_json: JSON.stringify(Array.isArray(raw.items) ? raw.items.slice(0, 200) : []),
    paid_at: paid ? (raw.paidAt || new Date().toISOString().slice(0, 19).replace('T', ' ')) : null
  };
}

/** Insert or refresh one intake row; re-polls return { created: false }. */
export async function upsertChannelOrder(env, channel, raw) {
  const row = normalizeChannelOrder(channel, raw);
  const prev = await env.DB.prepare(
    'SELECT id, status FROM unified_orders WHERE channel = ? AND external_order_id = ?'
  ).bind(channel, row.external_order_id).first();
  if (!prev) {
    await env.DB.prepare(
      `INSERT INTO unified_orders (id, channel, external_order_id, status, total_krw, provider, items_json, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(row.id, row.channel, row.external_order_id, row.status, row.total_krw,
      row.provider, row.items_json, row.paid_at).run();
    return { id: row.id, created: true };
  }
  await env.DB.prepare(
    `UPDATE unified_orders SET status = CASE WHEN ? = 'PAID' THEN 'PAID' ELSE status END,
     total_krw = ?, items_json = ?, paid_at = COALESCE(paid_at, ?), updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(row.status, row.total_krw, row.items_json, row.paid_at, prev.id).run();
  return { id: prev.id, created: false };
}

/** Mirror a captured storefront order into the unified intake (webhook + customer confirm). */
export async function recordStorefrontPayment(env, order) {
  return upsertChannelOrder(env, 'storefront', {
    externalOrderId: order.order_no, totalKrw: order.total_pay_amount, paid: true
  });
}
