// apps/cloudflare-gateway/src/services/channels/coupang-adapter.js
// Coupang Wing listing side: publish, stock sync, retire (live HMAC-signed
// calls; COUPANG_ACCESS_KEY + COUPANG_SECRET_KEY + COUPANG_VENDOR_ID
// required, fail closed). Order side lives in ./coupang-orders.js.
// Spec map: CEA HMAC-SHA256; seller-products POST/PUT/DELETE; sibling
// polls marketplace/orders + pushes .../{id}/tracking.

import { requireChannelEnv, registerChannel, channelFetch } from './channel.js';
import { fetchPaidOrders, pushTracking } from './coupang-orders.js';

const API_BASE = 'https://api-gateway.coupang.com';
const ENV_KEYS = ['COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY', 'COUPANG_VENDOR_ID'];

/** CEA authorization header: HmacSHA256(signed-date + METHOD + path + query). */
export async function ceaHeader(secretKey, accessKey, method, path, query = '') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const datetime = `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const message = `${datetime}${method.toUpperCase()}${path}${query}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${hex}`;
}

/** HMAC-signed transport (exported for the sibling order module). */
export async function api(env, path, { method = 'GET', query = '', body } = {}) {
  const { COUPANG_ACCESS_KEY: ak, COUPANG_SECRET_KEY: sk } = requireChannelEnv(env, 'coupang', ENV_KEYS);
  const auth = await ceaHeader(sk, ak, method, path, query);
  const res = await channelFetch(`${API_BASE}${path}${query ? `?${query}` : ''}`, {
    method, headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return res.json();
}

async function publish(env, payload) {
  const data = await api(env, '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products', { method: 'POST', body: payload });
  const externalId = String(data?.data ?? data?.sellerProductId ?? '').trim();
  if (!externalId) throw new Error('UPSTREAM_BAD_SHAPE: coupang publish');
  return { externalId };
}

async function updateStock(env, externalId, qty) {
  await api(env, `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${encodeURIComponent(externalId)}/stock`, {
    method: 'PUT', body: { stock_quantity: qty }
  });
  return { ok: true };
}

async function retire(env, externalId) {
  await api(env, `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${encodeURIComponent(externalId)}`, { method: 'DELETE' });
  return { ok: true };
}

export const SPEC = { auth: 'cea-hmac-sha256', baseUrl: API_BASE, envKeys: ENV_KEYS };

/** Honest key status for the admin endpoint (never leaks values). */
export function keyStatus(env) {
  const missing = ENV_KEYS.filter((k) => !String(env?.[k] ?? '').trim());
  return missing.length ? { configured: false, missing } : { configured: true, missing: [] };
}

registerChannel('coupang', { publish, updateStock, retire, fetchPaidOrders, pushTracking, keyStatus });
export { publish, updateStock, retire, fetchPaidOrders, pushTracking };
