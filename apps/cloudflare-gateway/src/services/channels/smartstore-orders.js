// apps/cloudflare-gateway/src/services/channels/smartstore-orders.js
// SmartStore order-side calls (SRP split from the listing adapter):
// paid-order poll for the unified intake + tracking push-back for the
// invoice backfeed. Uses the sibling adapter's authenticated `api`
// transport at call time only. Zero-Mock: rows come from live platform
// responses; absent keys fail closed inside `api`; empty stays empty.

import { api } from './smartstore-adapter.js';

/** Platform paths (verify against the issued Commerce API docs). */
const ORDERS_PAID_PATH = '/external/v1/orders/paid';
const trackingPath = (id) => `/external/v1/orders/${encodeURIComponent(id)}/tracking`;

/** Normalize one paid-order row to the intake shape (no invention). */
function normalizePaidOrder(o) {
  return {
    externalOrderId: String(o?.orderId ?? ''),
    totalKrw: Number(o?.totalAmount ?? NaN),
    paidAt: o?.paidAt || null,
    items: Array.isArray(o?.items) ? o.items : []
  };
}

/** Map a raw order list; rows without an id are dropped, never guessed. */
function mapPaidOrders(list) {
  return list.map(normalizePaidOrder).filter((o) => o.externalOrderId);
}

/** Tracking push-back body; blank tracking numbers are rejected. */
function trackingBody({ carrier, trackingNo } = {}) {
  const no = String(trackingNo || '').trim();
  if (!no) throw new Error('INVALID_TRACKING: tracking number required');
  return { carrier_code: carrier || null, tracking_number: no };
}

/**
 * Poll paid orders.
 * @param {object} env worker env (credentials)
 * @param {object} [opts] { since } incremental cursor
 * @returns {Promise<Array>} normalized paid-order rows
 */
export async function fetchPaidOrders(env, { since } = {}) {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const data = await api(env, `${ORDERS_PAID_PATH}${qs}`);
  const list = Array.isArray(data?.orders) ? data.orders : [];
  return mapPaidOrders(list);
}

/**
 * Push carrier + tracking number back to the channel order.
 * @returns {Promise<{ok:boolean}>} ok on live platform acceptance
 */
export async function pushTracking(env, externalOrderId, opts = {}) {
  await api(env, trackingPath(externalOrderId), { method: 'POST', body: trackingBody(opts) });
  return { ok: true };
}
