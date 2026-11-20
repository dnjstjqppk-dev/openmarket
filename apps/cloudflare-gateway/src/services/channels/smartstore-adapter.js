// apps/cloudflare-gateway/src/services/channels/smartstore-adapter.js
// Naver SmartStore listing side: publish, stock sync, retire (live calls,
// SMARTSTORE_CLIENT_ID + SMARTSTORE_CLIENT_SECRET required, fail closed).
// Order side lives in ./smartstore-orders.js. Spec map: OAuth2
// client-credentials; POST /external/v1/products; PUT .../{id}/stock;
// DELETE .../{id}; sibling polls .../orders/paid + pushes .../tracking.

import { requireChannelEnv, registerChannel, channelFetch } from './channel.js';
import { fetchPaidOrders, pushTracking } from './smartstore-orders.js';

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

/** Authenticated transport (exported for the sibling order module). */
export async function api(env, path, { method = 'GET', body } = {}) {
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
