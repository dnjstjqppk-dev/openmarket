// apps/cloudflare-gateway/src/services/channels/smartstore-adapter.js
// Naver SmartStore (Commerce API) outbound adapter skeleton. Every call is a
// live platform call and requires SMARTSTORE_CLIENT_ID + SMARTSTORE_CLIENT_SECRET.
// Absent keys fail closed — no simulated listings, no dummy external ids.
//
// Spec map (verify against the issued Naver Commerce API docs before go-live):
// - Auth: OAuth2 client-credentials grant, then Bearer access token per call.
// - POST /external/v1/products        create a channel listing
// - PUT  /external/v1/products/{id}/stock  stock sync (delta worker)
// - DELETE /external/v1/products/{id} retire a rotated-out listing
// - Phase 3: GET /external/v1/orders/paid poll + POST .../orders/{id}/tracking push-back.
// - 429 means the daily quota is spent — the delta worker backs off, no retry storm.

import { requireChannelEnv, registerChannel, channelFetch } from './channel.js';

const API_BASE = 'https://api.commerce.naver.com';
const ENV_KEYS = ['SMARTSTORE_CLIENT_ID', 'SMARTSTORE_CLIENT_SECRET'];

async function accessToken(env) {
  const { SMARTSTORE_CLIENT_ID: id, SMARTSTORE_CLIENT_SECRET: secret } =
    requireChannelEnv(env, 'smartstore', ENV_KEYS);
  const res = await channelFetch(`${API_BASE}/external/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret })
  });
  const data = await res.json();
  if (!data?.access_token) throw new Error('CHANNEL_AUTH: smartstore token missing');
  return data.access_token;
}

async function api(env, path, { method = 'GET', body } = {}) {
  const token = await accessToken(env);
  const res = await channelFetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return res.json();
}

async function publish(env, payload) {
  const data = await api(env, '/external/v1/products', { method: 'POST', body: payload });
  const externalId = String(data?.id ?? data?.productId ?? '').trim();
  if (!externalId) throw new Error('UPSTREAM_BAD_SHAPE: smartstore publish');
  return { externalId };
}

async function updateStock(env, externalId, qty) {
  await api(env, `/external/v1/products/${encodeURIComponent(externalId)}/stock`, {
    method: 'PUT', body: { stock_quantity: qty }
  });
  return { ok: true };
}

async function retire(env, externalId) {
  await api(env, `/external/v1/products/${encodeURIComponent(externalId)}`, { method: 'DELETE' });
  return { ok: true };
}

async function fetchPaidOrders(env, { since } = {}) {
  const data = await api(env, `/external/v1/orders/paid${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  const list = Array.isArray(data?.orders) ? data.orders : [];
  return list.map((o) => ({
    externalOrderId: String(o?.orderId ?? ''), totalKrw: Number(o?.totalAmount ?? NaN),
    paidAt: o?.paidAt || null, items: Array.isArray(o?.items) ? o.items : []
  })).filter((o) => o.externalOrderId);
}

async function pushTracking(env, externalOrderId, { carrier, trackingNo } = {}) {
  if (!String(trackingNo || '').trim()) throw new Error('INVALID_TRACKING: tracking number required');
  await api(env, `/external/v1/orders/${encodeURIComponent(externalOrderId)}/tracking`, {
    method: 'POST', body: { carrier_code: carrier || null, tracking_number: trackingNo }
  });
  return { ok: true };
}

export const SPEC = {
  auth: 'oauth2-client-credentials',
  endpoints: ['POST /external/v1/products', 'PUT /external/v1/products/{id}/stock', 'DELETE /external/v1/products/{id}',
    'GET /external/v1/orders/paid', 'POST /external/v1/orders/{id}/tracking'],
  envKeys: ENV_KEYS
};

/** Honest key status for the admin endpoint (never leaks values). */
export function keyStatus(env) {
  const missing = ENV_KEYS.filter((k) => !String(env?.[k] ?? '').trim());
  return missing.length ? { configured: false, missing } : { configured: true, missing: [] };
}

registerChannel('smartstore', { publish, updateStock, retire, fetchPaidOrders, pushTracking, keyStatus });
export { publish, updateStock, retire, fetchPaidOrders, pushTracking };
