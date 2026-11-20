// apps/cloudflare-gateway/src/services/sourcing/onchannel-adapter.js
// 온채널 (OnChannel) B2B adapter skeleton. Live REST spec shape; every call
// requires ONCHANNEL_API_KEY + ONCHANNEL_SHOP_ID — absent keys fail closed.
//
// Spec map (to verify against the issued partner docs before go-live):
// - Auth: X-API-KEY plus X-SHOP-ID scoping (multi-shop seller accounts).
// - GET /products/{id}         single product (name, supply price, images)
// - GET /products/{id}/stock   live inventory (stock integer)
// - Phase 3: POST /orders place + GET /orders/{id}/tracking invoice.
// - Shop scope means one credential set per shop; multi-shop operators
//   register one provider entry per (key, shop) pair in Phase 2.
// - Bulk sync uses cursor pagination (next_cursor); empty cursor ends sync.
// - Error mapping: 401/403 -> key rotation alert, 404 -> offer REJECTED.

import { requireEnv, registerProvider, fetchWithTimeout } from './provider.js';

const API_BASE = 'https://api.onchannel.co.kr/openapi/v1';
const ENV_KEYS = ['ONCHANNEL_API_KEY', 'ONCHANNEL_SHOP_ID'];

async function api(env, path, { timeoutMs = 5000, method = 'GET', body } = {}) {
  const { ONCHANNEL_API_KEY: key, ONCHANNEL_SHOP_ID: shop } = requireEnv(env, 'onchannel', ENV_KEYS);
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method, headers: { 'X-API-KEY': key, 'X-SHOP-ID': shop, Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, timeoutMs);
  return res.json();
}

async function fetchOffer(env, externalId) {
  if (!externalId) throw new Error('INVALID_OFFER: externalId required');
  const data = await api(env, `/products/${encodeURIComponent(externalId)}`);
  return { provider: 'onchannel', externalId, raw: data };
}

async function checkAvailability(env, externalId, qty) {
  const data = await api(env, `/products/${encodeURIComponent(externalId)}/stock`, { timeoutMs: 500 });
  const stockQty = Number(data?.stock ?? data?.stockQty ?? NaN);
  if (!Number.isSafeInteger(stockQty) || stockQty < 0) throw new Error('UPSTREAM_BAD_SHAPE: onchannel stock');
  return { ok: stockQty >= qty, stockQty };
}

async function placeOrder(env, po) {
  const data = await api(env, '/orders', { method: 'POST', timeoutMs: 8000, body: { ref_id: po.poId, items: po.items, total_krw: po.totalKrw } });
  const externalPoId = String(data?.order_id ?? data?.orderId ?? '').trim();
  if (!externalPoId) throw new Error('UPSTREAM_BAD_SHAPE: onchannel order');
  return { externalPoId };
}

async function fetchTracking(env, externalPoId) {
  const data = await api(env, `/orders/${encodeURIComponent(externalPoId)}/tracking`);
  const trackingNo = String(data?.tracking_no ?? data?.trackingNo ?? '').trim();
  if (!trackingNo) throw new Error('UPSTREAM_BAD_SHAPE: onchannel tracking');
  return { trackingNo, carrier: data?.carrier_code || data?.carrier || null };
}

export const SPEC = {
  auth: 'api-key-plus-shop',
  endpoints: ['GET /products/{id}', 'GET /products/{id}/stock', 'POST /orders', 'GET /orders/{id}/tracking'],
  envKeys: ENV_KEYS
};

/** Honest key status for the admin endpoint (never leaks values). */
export function keyStatus(env) {
  const missing = ENV_KEYS.filter((k) => !String(env?.[k] ?? '').trim());
  return missing.length ? { configured: false, missing } : { configured: true, missing: [] };
}

registerProvider('onchannel', { fetchOffer, checkAvailability, placeOrder, fetchTracking, keyStatus });
export { fetchOffer, checkAvailability, placeOrder, fetchTracking };
