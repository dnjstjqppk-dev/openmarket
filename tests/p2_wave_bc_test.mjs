// tests/p2_wave_bc_test.mjs
// P2 Wave B (docs) + Wave C (gateway) suite:
// D-N01, D-N03, SEC-01/02/04/05/06/07 (+ tracking lock-in for the already-fixed SEC-04 leg).
// Run: node tests/p2_wave_bc_test.mjs   (requires: node scripts/gen-dev-seed.mjs once)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, createRunner, ROOT } from './lib/harness.mjs';
import { classify } from '../apps/cloudflare-gateway/src/lib/ratelimit.js';
import { crawlAndExtractProduct } from '../apps/cloudflare-gateway/src/services/crawler/crawler-service.js';
import * as productImports from '../apps/cloudflare-gateway/src/routes/product-imports.js';

const mapWithConcurrency = (...args) => productImports.mapWithConcurrency(...args);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = {
  JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox',
  PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef',
  CARRIER_WEBHOOK_SECRET: 'carrier-secret-0123456789ab'
};
const ADDR = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };

async function boot(env = {}) {
  const g = await createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json;
  };
  return { ...g, one, login };
}

const t = createRunner('P2 Wave B+C (D-N01/D-N03, SEC-01/02/04/05/06/07)');

// ---------- D-N01: impl -> doc sweep + alias parity ----------
const INTENDED_ALIASES = new Set([
  '/api/v1/admin/ledgers', // alias of /api/v1/admin/ledger (same handler, admin.js)
  '/api/v1/admin/metrics' // alias of /api/v1/admin/dashboard (same handler, admin.js)
]);

await t.test('D-N01 every static gateway route is documented or an intended alias', async () => {
  const routesDir = path.join(ROOT, 'apps/cloudflare-gateway/src/routes');
  const impl = new Set();
  for (const f of fs.readdirSync(routesDir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(routesDir, f), 'utf8');
    const re = /(?:\bp\b|url\.pathname)\s*===\s*['"]((?:\/api\/v1\/[^'"]+))['"]/g;
    let m;
    while ((m = re.exec(src))) impl.add(m[1]);
  }
  assert.ok(impl.size > 100, `route extraction must find the surface, got ${impl.size}`);
  const docsDir = path.join(ROOT, 'docs/openapi/paths');
  let docs = '';
  for (const f of fs.readdirSync(docsDir)) docs += '\n' + fs.readFileSync(path.join(docsDir, f), 'utf8');
  const live = new Set([...docs.matchAll(/^  (\/api\/\S+):$/gm)].map((m) => m[1]));
  const missing = [...impl].filter((p) => !live.has(p) && !INTENDED_ALIASES.has(p)).sort();
  assert.deepEqual(missing, [], `undocumented routes: ${missing.join(', ')}`);
});

await t.test('D-N01 /api/v1/sync/logs answers like /api/v1/admin/sync/logs (admin only)', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const a = await g.call('/api/v1/admin/sync/logs', { token: adm.token });
  const b = await g.call('/api/v1/sync/logs', { token: adm.token });
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  assert.equal(b.json.count, a.json.count);
  assert.equal((await g.call('/api/v1/sync/logs')).status, 401);
});

// ---------- D-N03: legacy snapshot removed ----------
await t.test('D-N03 docs/api/OPENAPI.yaml is gone (maintained contract is docs/openapi)', async () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'docs/api/OPENAPI.yaml')), false);
});

// ---------- SEC-01: html_override cap ----------
await t.test('SEC-01 oversized html_override is rejected, small override still works', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const big = await g.call('/api/v1/imports/crawl', { method: 'POST', token: pt.token, body: { url: 'https://supply.example.com/p/1', html_override: 'x'.repeat(600 * 1024) } });
  assert.equal(big.status, 400, big.text);
  assert.equal(big.json.code, 'HTML_OVERRIDE_TOO_LARGE');
  const nonString = await g.call('/api/v1/imports/crawl', { method: 'POST', token: pt.token, body: { url: 'https://supply.example.com/p/1', html_override: 12345 } });
  assert.equal(nonString.status, 400, nonString.text);
});

await t.test('SEC-01 URL validation still runs when an override is supplied', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const r = await g.call('/api/v1/imports/crawl', { method: 'POST', token: pt.token, body: { url: 'http://169.254.169.254/x', html_override: '<html></html>' } });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.error_code, 'SSRF_OR_INVALID_URL');
});

// ---------- SEC-02: fetch caps + bounded bulk ----------
const OG_HTML = '<html><head><meta property="og:title" content="T" /><meta property="og:image" content="https://cdn.example.com/i.jpg" /><meta property="product:price:amount" content="10000" /></head></html>';

await t.test('SEC-02 page bodies over 2MB are refused', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('x'.repeat(3 * 1024 * 1024), { status: 200, headers: { 'content-type': 'text/html' } });
    const r = await crawlAndExtractProduct({ url: 'https://shop.example.com/items/1' });
    assert.equal(r.success, false);
    assert.equal(r.error_code, 'FETCH_TOO_LARGE');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t.test('SEC-02 huge Content-Length short-circuits before the body is read', async () => {
  const realFetch = globalThis.fetch;
  let bodyTouched = false;
  try {
    globalThis.fetch = async () => ({
      status: 200, ok: true, statusText: 'OK',
      headers: new Headers({ 'content-length': '99999999', 'content-type': 'text/html' }),
      body: null,
      text: async () => { bodyTouched = true; return 'x'; }
    });
    const r = await crawlAndExtractProduct({ url: 'https://shop.example.com/items/1' });
    assert.equal(r.success, false);
    assert.equal(r.error_code, 'FETCH_TOO_LARGE');
    assert.equal(bodyTouched, false, 'body must not be consumed after a huge Content-Length');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t.test('SEC-02 mapWithConcurrency caps parallelism and preserves order', async () => {
  let live = 0;
  let maxLive = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    live++;
    maxLive = Math.max(maxLive, live);
    await new Promise((r) => setTimeout(r, 30));
    live--;
    if (n === 4) throw new Error('boom-4');
    return n * 10;
  });
  assert.ok(maxLive <= 3, `parallelism capped at 3, saw ${maxLive}`);
  assert.deepEqual(out.map((r) => r.status), ['ok', 'ok', 'ok', 'error', 'ok', 'ok', 'ok']);
  assert.deepEqual(out.filter((r) => r.status === 'ok').map((r) => r.value), [10, 20, 30, 50, 60, 70]);
  assert.match(out[3].error, /boom-4/);
});

await t.test('SEC-02 bulk crawls at most 5 at a time and keeps input order', async () => {
  const g = await boot();
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  assert.equal((await g.call('/api/v1/admin/feature-flags/bulk_crawler/toggle', { method: 'POST', token: adm.token, body: { is_enabled: true } })).status, 200);
  const realFetch = globalThis.fetch;
  let live = 0;
  let maxLive = 0;
  const urls = Array.from({ length: 10 }, (_, i) => `https://shop-${i}.example.com/p/1`);
  try {
    globalThis.fetch = async () => {
      live++;
      maxLive = Math.max(maxLive, live);
      try {
        await new Promise((r) => setTimeout(r, 250));
        return new Response(OG_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      } finally {
        live--;
      }
    };
    const started = Date.now();
    const r = await g.call('/api/v1/imports/bulk', { method: 'POST', token: pt.token, body: { urls } });
    const elapsed = Date.now() - started;
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.total_requested, 10);
    assert.deepEqual(r.json.data.map((d) => d.url), urls, 'result order follows input order');
    assert.ok(maxLive <= 5, `bulk parallelism capped at 5, saw ${maxLive}`);
    assert.ok(maxLive >= 2, `bulk actually parallelizes, saw max ${maxLive}`);
    assert.ok(elapsed < 2200, `10 x 250ms sequential would take >=2500ms, took ${elapsed}ms`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t.test('SEC-02 bulk deadline marks the tail failed instead of hanging', async () => {
  const g = await boot({ BULK_CRAWL_DEADLINE_MS: '50' });
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  assert.equal((await g.call('/api/v1/admin/feature-flags/bulk_crawler/toggle', { method: 'POST', token: adm.token, body: { is_enabled: true } })).status, 200);
  const realFetch = globalThis.fetch;
  const urls = Array.from({ length: 8 }, (_, i) => `https://slow-${i}.example.com/p/1`);
  try {
    globalThis.fetch = async () => {
      await new Promise((r) => setTimeout(r, 300));
      return new Response(OG_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const r = await g.call('/api/v1/imports/bulk', { method: 'POST', token: pt.token, body: { urls } });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.data.length, 8);
    assert.ok(r.json.data.some((d) => d.status === 'FAILED' && /DEADLINE/.test(d.error || '')), `tail marked failed: ${r.text.slice(0, 400)}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- SEC-04: banner/product/tracking input validation ----------
await t.test('SEC-04 banner URLs must be https or site-relative, fields length-capped', async () => {
  const g = await boot();
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const evil = await g.call('/api/v1/admin/banners', { method: 'POST', token: adm.token, body: { title: 't', image_url: 'javascript:alert(1)', link_url: '/x' } });
  assert.equal(evil.status, 400, evil.text);
  assert.equal(evil.json.code, 'INVALID_URL');
  const evilLink = await g.call('/api/v1/admin/banners', { method: 'POST', token: adm.token, body: { title: 't', image_url: 'https://cdn.example.com/b.jpg', link_url: 'data:text/html,<script>alert(1)</script>' } });
  assert.equal(evilLink.status, 400, evilLink.text);
  const long = await g.call('/api/v1/admin/banners', { method: 'POST', token: adm.token, body: { title: 't'.repeat(3000), image_url: 'https://cdn.example.com/b.jpg', link_url: '/x' } });
  assert.equal(long.status, 400, long.text);
  assert.equal(long.json.code, 'TOO_LONG');
  const ok = await g.call('/api/v1/admin/banners', { method: 'POST', token: adm.token, body: { title: 'Winter sale', image_url: 'https://cdn.example.com/b.jpg', link_url: '/channel/lightning-deals' } });
  assert.equal(ok.status, 201, ok.text);
});

await t.test('SEC-04 wishlist product_id is length-capped', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const r = await g.call('/api/v1/wishlist', { method: 'POST', token: cust.token, body: { product_id: 'x'.repeat(200) } });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'TOO_LONG');
});

await t.test('SEC-04 shipment tracking stays format-validated (lock-in)', async () => {
  const g = await boot();
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const sku = g.db.prepare("SELECT s.id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get();
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust.token, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(co.status, 201, co.text);
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust.token, body: { order_id: co.json.order_id, payment_key: 'sandbox_wavebc_trk01', amount: co.json.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const sub = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(co.json.order_id);
  const badTrk = await g.call(`/api/v1/partner/orders/${sub.id}/shipment`, { method: 'PUT', token: pt.token, body: { carrier: 'CJ_LOGISTICS', tracking_number: 'ab!' } });
  assert.equal(badTrk.status, 400, badTrk.text);
  assert.equal(badTrk.json.code, 'INVALID_TRACKING');
  const goodTrk = await g.call(`/api/v1/partner/orders/${sub.id}/shipment`, { method: 'PUT', token: pt.token, body: { carrier: 'CJ_LOGISTICS', tracking_number: 'TRK12345678' } });
  assert.equal(goodTrk.status, 200, goodTrk.text);
});

// ---------- SEC-05: review image URLs ----------
async function deliveredOrder(g, tag) {
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const sku = g.db.prepare("SELECT s.id, s.product_id FROM product_skus s JOIN products p ON p.id = s.product_id WHERE p.partner_id = 'pt_001' AND s.stock_quantity > 5 LIMIT 1").get();
  const co = await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust.token, body: { ...ADDR, items: [{ sku_id: sku.id, quantity: 1 }] } });
  assert.equal(co.status, 201, co.text);
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust.token, body: { order_id: co.json.order_id, payment_key: `sandbox_wavebc_${tag}`, amount: co.json.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const sub = g.db.prepare('SELECT id FROM sub_orders WHERE parent_order_id = ?').get(co.json.order_id);
  assert.equal((await g.call(`/api/v1/partner/orders/${sub.id}/shipment`, { method: 'PUT', token: pt.token, body: { carrier: 'CJ_LOGISTICS', tracking_number: 'TRK12345678' } })).status, 200);
  assert.equal((await g.call(`/api/v1/orders/${co.json.order_id}/advance-tracking`, { method: 'POST', token: adm.token })).status, 200);
  assert.equal((await g.call(`/api/v1/orders/${co.json.order_id}/advance-tracking`, { method: 'POST', token: adm.token })).status, 200);
  return { cust, productId: sku.product_id };
}

await t.test('SEC-05 review images must be https or site-relative URLs', async () => {
  const g = await boot();
  const { cust, productId } = await deliveredOrder(g, 'revimg01');
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://cdn.example.com/a.jpg', '//evil.example.com/a.jpg', `https://cdn.example.com/${'a'.repeat(2100)}.jpg`]) {
    const r = await g.call(`/api/v1/products/${productId}/reviews`, { method: 'POST', token: cust.token, body: { rating: 5, content: '좋아요', images: ['https://cdn.example.com/ok.jpg', bad] } });
    assert.equal(r.status, 400, `${bad}: ${r.text}`);
    assert.equal(r.json.code, 'INVALID_IMAGE_URL');
  }
  const ok = await g.call(`/api/v1/products/${productId}/reviews`, { method: 'POST', token: cust.token, body: { rating: 5, content: '좋아요', images: ['https://cdn.example.com/ok.jpg', '/api/v1/storage/file/products/x.png'] } });
  assert.equal(ok.status, 201, ok.text);
});

// ---------- SEC-06: auth + rate-limit classes on oracle/calculator/write endpoints ----------
await t.test('SEC-06 search/log, validate-pccc and estimate-duty are RL_WRITE', async () => {
  assert.equal(classify('POST', '/api/v1/search/log'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/customs/validate-pccc'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/customs/estimate-duty'), 'RL_WRITE');
  assert.equal(classify('POST', '/api/v1/auth/refresh'), 'RL_AUTH');
  assert.equal(classify('GET', '/api/v1/search/autocomplete'), 'RL_API');
});

await t.test('SEC-06 validate-pccc requires a customer session', async () => {
  const g = await boot();
  const bare = await g.call('/api/v1/customs/validate-pccc', { method: 'POST', body: { pccc: 'P123456789012' } });
  assert.equal(bare.status, 401, bare.text);
  const cust = await g.login('customer@example.com', 'CUSTOMER');
  const authed = await g.call('/api/v1/customs/validate-pccc', { method: 'POST', token: cust.token, body: { pccc: 'P123456789012' } });
  assert.equal(authed.status, 200, authed.text);
  assert.equal(authed.json.verification_mode, 'FORMAT_ONLY');
});

await t.test('SEC-06 search/log and estimate-duty stay public (guest-safe)', async () => {
  const g = await boot();
  assert.equal((await g.call('/api/v1/search/log', { method: 'POST', body: { keyword: 'wavebc-probe' } })).status, 200);
  assert.equal((await g.call('/api/v1/customs/estimate-duty', { method: 'POST', body: { goods_amount_krw: 1000 } })).status, 200);
});

// ---------- SEC-07: short access tokens + rotating refresh ----------
function jwtLifetime(token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return payload.exp - payload.iat;
}

await t.test('SEC-07 login issues a 60-minute access token plus a refresh token', async () => {
  const g = await boot();
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'customer@example.com', password: PW, role: 'CUSTOMER' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.expiresIn, 3600);
  assert.equal(typeof r.json.refresh_token, 'string');
  assert.ok(r.json.refresh_token.length >= 32);
  assert.equal(jwtLifetime(r.json.token), 3600);
});

await t.test('SEC-07 refresh rotates; reuse of an old refresh revokes the family', async () => {
  const g = await boot();
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'customer@example.com', password: PW, role: 'CUSTOMER' } });
  const first = login.json.refresh_token;
  const r1 = await g.call('/api/v1/auth/refresh', { method: 'POST', body: { refresh_token: first } });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(typeof r1.json.token, 'string');
  assert.equal(typeof r1.json.refresh_token, 'string');
  assert.notEqual(r1.json.refresh_token, first);
  assert.equal(jwtLifetime(r1.json.token), 3600);
  const me = await g.call('/api/v1/auth/me', { token: r1.json.token });
  assert.equal(me.status, 200, me.text);
  const replay = await g.call('/api/v1/auth/refresh', { method: 'POST', body: { refresh_token: first } });
  assert.equal(replay.status, 401, replay.text);
  assert.equal(replay.json.code, 'REFRESH_REUSED');
  const afterTheft = await g.call('/api/v1/auth/refresh', { method: 'POST', body: { refresh_token: r1.json.refresh_token } });
  assert.equal(afterTheft.status, 401, afterTheft.text);
});

await t.test('SEC-07 logout-all invalidates refresh tokens via token_version', async () => {
  const g = await boot();
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'customer@example.com', password: PW, role: 'CUSTOMER' } });
  assert.equal((await g.call('/api/v1/auth/logout-all', { method: 'POST', token: login.json.token })).status, 200);
  const r = await g.call('/api/v1/auth/refresh', { method: 'POST', body: { refresh_token: login.json.refresh_token } });
  assert.equal(r.status, 401, r.text);
});

await t.test('SEC-07 missing, garbage and expired refresh tokens fail closed', async () => {
  const g = await boot();
  assert.equal((await g.call('/api/v1/auth/refresh', { method: 'POST', body: {} })).status, 400);
  const garbage = await g.call('/api/v1/auth/refresh', { method: 'POST', body: { refresh_token: 'not-a-real-token-0123456789abcdef' } });
  assert.equal(garbage.status, 401, garbage.text);
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email: 'customer@example.com', password: PW, role: 'CUSTOMER' } });
  g.db.prepare("UPDATE refresh_tokens SET expires_at = datetime('now', '-1 day') WHERE user_id = 'u_customer_001'").run();
  const expired = await g.call('/api/v1/auth/refresh', { method: 'POST', body: { refresh_token: login.json.refresh_token } });
  assert.equal(expired.status, 401, expired.text);
});

t.finish();
