// apps/cloudflare-gateway/src/services/sourcing/domeme-adapter.js
// 도매매 (Domeme) B2B adapter skeleton. Live REST spec shape; every call
// requires DOMEME_API_KEY + DOMEME_API_SECRET — absent keys fail closed.
//
// Spec map (to verify against the issued partner docs before go-live):
// - Auth: static key pair in X-API-KEY / X-API-SECRET headers (no OAuth).
// - GET /goods/{id}            single product (name, supply price, images)
// - GET /goods/{id}/stock      live inventory (stock_qty integer)
// - Phase 3: POST /orders place + GET /orders/{id}/tracking invoice.
// - List/search endpoints are paged (page, per_page); sync workers must
//   walk pages and upsert via ON CONFLICT (provider, external_id).
// - Rate limit per partner key (TBD from docs) — sync must back off on 429.
// - Error mapping: 401/403 -> key rotation alert, 404 -> offer REJECTED.

import { requireEnv, registerProvider, fetchWithTimeout } from './provider.js';

const API_BASE = 'https://api.domeme.co.kr/v1';
const ENV_KEYS = ['DOMEME_API_KEY', 'DOMEME_API_SECRET'];

async function api(env, path, { timeoutMs = 5000, method = 'GET', body } = {}) {
  const { DOMEME_API_KEY: key, DOMEME_API_SECRET: secret } = requireEnv(env, 'domeme', ENV_KEYS);
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method, headers: { 'X-API-KEY': key, 'X-API-SECRET': secret, Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, timeoutMs);
  return res.json();
}

async function fetchOffer(env, externalId) {
  if (!externalId) throw new Error('INVALID_OFFER: externalId required');
  const data = await api(env, `/goods/${encodeURIComponent(externalId)}`);
  return { provider: 'domeme', externalId, raw: data };
}

async function checkAvailability(env, externalId, qty) {
  const data = await api(env, `/goods/${encodeURIComponent(externalId)}/stock`, { timeoutMs: 500 });
  const stockQty = Number(data?.stock_qty ?? data?.stockQty ?? NaN);
  if (!Number.isSafeInteger(stockQty) || stockQty < 0) throw new Error('UPSTREAM_BAD_SHAPE: domeme stock');
  return { ok: stockQty >= qty, stockQty };
}

async function placeOrder(env, po) {
  const data = await api(env, '/orders', { method: 'POST', timeoutMs: 8000, body: { ref_id: po.poId, items: po.items, total_krw: po.totalKrw } });
  const externalPoId = String(data?.order_id ?? data?.orderId ?? '').trim();
  if (!externalPoId) throw new Error('UPSTREAM_BAD_SHAPE: domeme order');
  return { externalPoId };
}

async function fetchTracking(env, externalPoId) {
  const data = await api(env, `/orders/${encodeURIComponent(externalPoId)}/tracking`);
  const trackingNo = String(data?.tracking_no ?? data?.trackingNo ?? '').trim();
  if (!trackingNo) throw new Error('UPSTREAM_BAD_SHAPE: domeme tracking');
  return { trackingNo, carrier: data?.carrier_code || data?.carrier || null };
}

export const SPEC = {
  auth: 'static-key-pair',
  endpoints: ['GET /goods/{id}', 'GET /goods/{id}/stock', 'POST /orders', 'GET /orders/{id}/tracking'],
  envKeys: ENV_KEYS
};

/** Honest key status for the admin endpoint (never leaks values). */
export function keyStatus(env) {
  const missing = ENV_KEYS.filter((k) => !String(env?.[k] ?? '').trim());
  return missing.length ? { configured: false, missing } : { configured: true, missing: [] };
}

registerProvider('domeme', { fetchOffer, checkAvailability, placeOrder, fetchTracking, keyStatus });
export { fetchOffer, checkAvailability, placeOrder, fetchTracking };
