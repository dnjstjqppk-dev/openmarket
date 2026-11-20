// apps/cloudflare-gateway/src/services/sourcing/ownerclan-adapter.js
// 오너클랜 (OwnerClan) B2B adapter skeleton. Live REST spec shape; every
// call requires OWNERCLAN_API_KEY — absent keys fail closed (Zero-Mock).
//
// Spec map (to verify against the issued partner docs before go-live):
// - Auth: Bearer token in Authorization header, issued per seller account.
// - GET /items/{id}             single item (title, cost, option matrix)
// - GET /items/{id}/inventory   live inventory (inventory integer)
// - Phase 3: POST /orders place + GET /orders/{id}/shipment invoice.
// - Option/SKU variants arrive nested; normalize must flatten one row per
//   sellable SKU with external_id = `${itemId}:${skuId}`.
// - Webhook (optional, Phase 2): stock-change push; until then the 500ms
//   pre-checkout guard is the only freshness defense.
// - Error mapping: 401 -> key rotation alert, 404 -> offer REJECTED.

import { requireEnv, registerProvider, fetchWithTimeout } from './provider.js';

const API_BASE = 'https://api.ownerclan.com/v1';
const ENV_KEYS = ['OWNERCLAN_API_KEY'];

async function api(env, path, { timeoutMs = 5000, method = 'GET', body } = {}) {
  const { OWNERCLAN_API_KEY: key } = requireEnv(env, 'ownerclan', ENV_KEYS);
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, timeoutMs);
  return res.json();
}

async function fetchOffer(env, externalId) {
  if (!externalId) throw new Error('INVALID_OFFER: externalId required');
  const data = await api(env, `/items/${encodeURIComponent(externalId)}`);
  return { provider: 'ownerclan', externalId, raw: data };
}

async function checkAvailability(env, externalId, qty) {
  const data = await api(env, `/items/${encodeURIComponent(externalId)}/inventory`, { timeoutMs: 500 });
  const stockQty = Number(data?.inventory ?? data?.stockQty ?? NaN);
  if (!Number.isSafeInteger(stockQty) || stockQty < 0) throw new Error('UPSTREAM_BAD_SHAPE: ownerclan stock');
  return { ok: stockQty >= qty, stockQty };
}

async function placeOrder(env, po) {
  const data = await api(env, '/orders', { method: 'POST', timeoutMs: 8000, body: { ref_id: po.poId, items: po.items, total_krw: po.totalKrw } });
  const externalPoId = String(data?.order_id ?? data?.orderId ?? '').trim();
  if (!externalPoId) throw new Error('UPSTREAM_BAD_SHAPE: ownerclan order');
  return { externalPoId };
}

async function fetchTracking(env, externalPoId) {
  const data = await api(env, `/orders/${encodeURIComponent(externalPoId)}/shipment`);
  const trackingNo = String(data?.tracking_no ?? data?.trackingNo ?? '').trim();
  if (!trackingNo) throw new Error('UPSTREAM_BAD_SHAPE: ownerclan tracking');
  return { trackingNo, carrier: data?.carrier_code || data?.carrier || null };
}

export const SPEC = {
  auth: 'bearer-token',
  endpoints: ['GET /items/{id}', 'GET /items/{id}/inventory', 'POST /orders', 'GET /orders/{id}/shipment'],
  envKeys: ENV_KEYS
};

/** Honest key status for the admin endpoint (never leaks values). */
export function keyStatus(env) {
  const missing = ENV_KEYS.filter((k) => !String(env?.[k] ?? '').trim());
  return missing.length ? { configured: false, missing } : { configured: true, missing: [] };
}

registerProvider('ownerclan', { fetchOffer, checkAvailability, placeOrder, fetchTracking, keyStatus });
export { fetchOffer, checkAvailability, placeOrder, fetchTracking };
