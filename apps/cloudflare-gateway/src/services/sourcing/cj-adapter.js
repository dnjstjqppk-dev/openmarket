// apps/cloudflare-gateway/src/services/sourcing/cj-adapter.js
// CJ Dropshipping adapter skeleton. Live REST spec shape (OAuth access
// token); requires CJ_API_KEY (+ CJ_API_SECRET for refresh) — fail closed.
//
// Spec map (developers.cjdropshipping.com, api2.0):
// - Auth: CJ-Access-Token header; token obtained via OAuth code flow and
//   refreshed with CJ_API_SECRET (Phase 2: token cache + refresh worker).
// - GET /product/query?pid=     product detail (data object on code 200)
// - GET /product/stock/query    live inventory (data.stock integer)
// - Phase 3: POST /shopping/order/createOrderV2 + GET /logistics/order/trackInfo.
// - Currency is USD at the source; normalize converts to KRW via lib/fx.js
//   before writing cost_krw (never store foreign-currency costs).
// - Error mapping: code 401/token-expired -> refresh once then RECHECK,
//   missing pid -> offer REJECTED.

import { requireEnv, registerProvider, fetchWithTimeout } from './provider.js';

const API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const ENV_KEYS = ['CJ_API_KEY'];

async function api(env, path, { timeoutMs = 5000, method = 'GET', body } = {}) {
  const { CJ_API_KEY: token } = requireEnv(env, 'cj-dropshipping', ENV_KEYS);
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method, headers: { 'CJ-Access-Token': token, Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }, timeoutMs);
  return res.json();
}

async function fetchOffer(env, externalId) {
  if (!externalId) throw new Error('INVALID_OFFER: externalId required');
  const data = await api(env, `/product/query?pid=${encodeURIComponent(externalId)}`);
  if (data?.code !== 200 && data?.result !== true && data?.success !== true && data?.data === undefined) {
    if (data?.code !== undefined && data.code !== 200) throw new Error(`UPSTREAM_${data.code}: cj product`);
  }
  return { provider: 'cj-dropshipping', externalId, raw: data };
}

async function checkAvailability(env, externalId, qty) {
  const data = await api(env, `/product/stock/query?pid=${encodeURIComponent(externalId)}`, { timeoutMs: 500 });
  const stockQty = Number(data?.data?.stock ?? data?.stockQty ?? NaN);
  if (!Number.isSafeInteger(stockQty) || stockQty < 0) throw new Error('UPSTREAM_BAD_SHAPE: cj stock');
  return { ok: stockQty >= qty, stockQty };
}

async function placeOrder(env, po) {
  const data = await api(env, '/shopping/order/createOrderV2', { method: 'POST', timeoutMs: 8000, body: { ref_id: po.poId, items: po.items } });
  const externalPoId = String(data?.data?.orderId ?? data?.orderId ?? '').trim();
  if (!externalPoId) throw new Error('UPSTREAM_BAD_SHAPE: cj order');
  return { externalPoId };
}

async function fetchTracking(env, externalPoId) {
  const data = await api(env, `/logistics/order/trackInfo?orderId=${encodeURIComponent(externalPoId)}`);
  const trackingNo = String(data?.data?.trackingNo ?? data?.trackingNo ?? '').trim();
  if (!trackingNo) throw new Error('UPSTREAM_BAD_SHAPE: cj tracking');
  return { trackingNo, carrier: data?.data?.carrier || null };
}

export const SPEC = {
  auth: 'oauth-access-token',
  endpoints: ['GET /product/query', 'GET /product/stock/query', 'POST /shopping/order/createOrderV2', 'GET /logistics/order/trackInfo'],
  envKeys: ENV_KEYS
};

/** Honest key status for the admin endpoint (never leaks values). */
export function keyStatus(env) {
  const missing = ENV_KEYS.filter((k) => !String(env?.[k] ?? '').trim());
  return missing.length ? { configured: false, missing } : { configured: true, missing: [] };
}

registerProvider('cj-dropshipping', { fetchOffer, checkAvailability, placeOrder, fetchTracking, keyStatus });
export { fetchOffer, checkAvailability, placeOrder, fetchTracking };
