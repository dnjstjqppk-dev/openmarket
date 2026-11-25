// tests/p2_wave_h_test.mjs
// Wave H: ranked product search (H-1), push pipeline (H-2), recommendations (H-3).
// Each behavior ships its failing test first; the suite joins `test:p1`.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { buildFtsMatch, shortSearchTerms, escapeLike } from '../apps/cloudflare-gateway/src/routes/catalog.js';

const t = createRunner('P2 Wave H (search, push, recommend)');

async function newGateway(env = {}) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      ...env
    }
  });
}

function seedRefs(g) {
  const pt = g.db.prepare("SELECT id FROM partners WHERE status = 'APPROVED' LIMIT 1").get();
  const cat = g.db.prepare('SELECT id FROM categories LIMIT 1').get();
  assert.ok(pt && cat, 'seed partner and category exist');
  return { partnerId: pt.id, categoryId: cat.id };
}

function insertProduct(g, partnerId, categoryId, row) {
  // 6-11: search only exposes products that name a live policy.
  const pol = g.db.prepare("SELECT id FROM shipping_policies WHERE partner_id = ? AND status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1").get(partnerId);
  assert.ok(pol, 'seller owns a shipping policy');
  g.db.prepare(
    `INSERT INTO products (id, partner_id, category_id, title, thumbnail_url, description_html,
      lowest_original_price, lowest_sale_price, total_sold_count, status, shipping_policy_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`
  ).run(
    row.id, partnerId, categoryId, row.title, 'https://img.test/x.jpg',
    row.desc || '<p>설명</p>', row.orig || 20000, row.sale || 10000,
    row.sold === undefined ? 0 : row.sold, pol.id
  );
}

const ownIds = (data, prefix) => data.filter((r) => String(r.id).startsWith(prefix)).map((r) => r.id);

// ---------- H-1: ranked search ----------

await t.test('H-1.1 FTS index is backfilled and trigger-maintained', async () => {
  const g = await newGateway();
  const tables = g.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_search_fts'").get();
  assert.ok(tables, 'product_search_fts exists');
  const n = g.db.prepare('SELECT COUNT(*) AS c FROM product_search_fts').get().c;
  const p = g.db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  assert.equal(n, p, 'backfill covers every product row');
  const trig = g.db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_product_fts_%'").get().c;
  assert.equal(trig, 3, 'insert/update/delete triggers exist');
  const { partnerId, categoryId } = seedRefs(g);
  insertProduct(g, partnerId, categoryId, { id: 'h1t1', title: '트리거유지확인용 상품' });
  assert.equal(g.db.prepare("SELECT COUNT(*) AS c FROM product_search_fts WHERE product_id = 'h1t1'").get().c, 1);
  g.db.prepare("UPDATE products SET title = '트리거유지확인용 수정상품' WHERE id = 'h1t1'").run();
  assert.ok(g.db.prepare("SELECT title AS t FROM product_search_fts WHERE product_id = 'h1t1'").get().t.includes('수정'));
  g.db.prepare("DELETE FROM products WHERE id = 'h1t1'").run();
  assert.equal(g.db.prepare("SELECT COUNT(*) AS c FROM product_search_fts WHERE product_id = 'h1t1'").get().c, 0);
});

await t.test('H-1.2 keyword search defaults to relevance, not sold count', async () => {
  const g = await newGateway();
  const { partnerId, categoryId } = seedRefs(g);
  insertProduct(g, partnerId, categoryId, { id: 'h1a', title: '이어폰', sold: 5 });
  insertProduct(g, partnerId, categoryId, { id: 'h1b', title: '고급 가죽 이어폰 케이스 파우치 대형', sold: 99999 });
  const r = await g.call('/api/v1/products?q=%EC%9D%B4%EC%96%B4%ED%8F%B0&per_page=100');
  assert.equal(r.status, 200);
  assert.deepEqual(ownIds(r.json.data, 'h1'), ['h1a', 'h1b'], 'exact short title outranks the sales leader');
  const pop = await g.call('/api/v1/products?q=%EC%9D%B4%EC%96%B4%ED%8F%B0&per_page=100&sort=popular');
  assert.deepEqual(ownIds(pop.json.data, 'h1'), ['h1b', 'h1a'], 'explicit popular keeps sold-count order');
});

await t.test('H-1.3 multi-term queries AND across positions', async () => {
  const g = await newGateway();
  const { partnerId, categoryId } = seedRefs(g);
  insertProduct(g, partnerId, categoryId, { id: 'h1c', title: '무선 이어폰' });
  insertProduct(g, partnerId, categoryId, { id: 'h1d', title: '무선 충전기' });
  insertProduct(g, partnerId, categoryId, { id: 'h1e', title: '이어폰 무선 거치대' });
  insertProduct(g, partnerId, categoryId, { id: 'h1x', title: '유선 이어폰 케이스' });
  const r = await g.call('/api/v1/products?q=%EB%AC%B4%EC%84%A0%20%EC%9D%B4%EC%96%B4%ED%8F%B0&per_page=100');
  assert.equal(r.status, 200);
  assert.deepEqual(new Set(ownIds(r.json.data, 'h1')), new Set(['h1c', 'h1e']), 'both terms anywhere, in any order');
});

await t.test('H-1.4 short queries fall back to LIKE without an FTS error', async () => {
  const g = await newGateway();
  const { partnerId, categoryId } = seedRefs(g);
  insertProduct(g, partnerId, categoryId, { id: 'h1f', title: '진주귀걸이' });
  const r = await g.call('/api/v1/products?q=%EA%B7%80&per_page=100');
  assert.equal(r.status, 200);
  assert.ok(ownIds(r.json.data, 'h1f').includes('h1f'), 'single-char query still finds the product');
});

await t.test('H-1.5 hostile input never 500s and injects nothing', async () => {
  const g = await newGateway();
  for (const q of ['" OR "1"="1', '*', '이어폰"', 'NEAR(이어폰 케이스)', 'a:b:c', '(((']) {
    const r = await g.call(`/api/v1/products?q=${encodeURIComponent(q)}&per_page=5`);
    assert.equal(r.status, 200, `hostile query must not 500: ${q}`);
    assert.equal(r.json.success, true);
  }
  const all = await g.call('/api/v1/products?per_page=1');
  assert.ok(all.json.pagination.total >= 0, 'catalog intact after hostile queries');
});

await t.test('H-1.6 description-only matches are recalled below title hits', async () => {
  const g = await newGateway();
  const { partnerId, categoryId } = seedRefs(g);
  insertProduct(g, partnerId, categoryId, { id: 'h1g', title: '노이즈차단 헤드셋', desc: '<p>출퇴근용</p>' });
  insertProduct(g, partnerId, categoryId, { id: 'h1h', title: '출퇴근용 가방', desc: '<p>노이즈차단 이어플러그 동봉</p>' });
  const r = await g.call('/api/v1/products?q=%EB%85%B8%EC%9D%B4%EC%A6%88%EC%B0%A8%EB%8B%A8&per_page=100');
  assert.equal(r.status, 200);
  assert.deepEqual(ownIds(r.json.data, 'h1'), ['h1g', 'h1h'], 'title hit first, description-only hit recalled after');
});

await t.test('H-1.7 synonyms still resolve to the canonical keyword', async () => {
  const g = await newGateway();
  const { partnerId, categoryId } = seedRefs(g);
  insertProduct(g, partnerId, categoryId, { id: 'h1i', title: '블루투스 이어폰' });
  g.db.prepare('INSERT INTO search_synonyms (term, canonical_keyword) VALUES (?, ?)').run('버즈', '이어폰');
  const r = await g.call('/api/v1/products?q=%EB%B2%84%EC%A6%88&per_page=100');
  assert.equal(r.status, 200);
  assert.ok(ownIds(r.json.data, 'h1i').includes('h1i'), 'synonym term finds canonical matches');
});

await t.test('H-1.8 response shape has no rank internals and totals agree', async () => {
  const g = await newGateway();
  const r = await g.call('/api/v1/products?q=%EC%9D%B4%EC%96%B4%ED%8F%B0&per_page=100');
  assert.equal(r.status, 200);
  for (const row of r.json.data) {
    assert.ok(!('rank' in row) && !('_rank' in row) && !('__rank' in row), 'no rank internals leak');
  }
  assert.equal(r.json.pagination.total, r.json.data.length, 'total agrees when everything fits one page');
});

await t.test('H-1.9 explicit sorts keep working with a keyword', async () => {
  const g = await newGateway();
  const { partnerId, categoryId } = seedRefs(g);
  insertProduct(g, partnerId, categoryId, { id: 'h1j', title: '정렬확인 이어폰', sale: 30000, orig: 30000 });
  insertProduct(g, partnerId, categoryId, { id: 'h1k', title: '정렬확인 이어폰 케이스', sale: 5000, orig: 5000 });
  const asc = await g.call('/api/v1/products?q=%EC%A0%95%EB%A0%AC%ED%99%95%EC%9D%B8&per_page=100&sort=price_asc');
  assert.deepEqual(ownIds(asc.json.data, 'h1'), ['h1k', 'h1j']);
  const desc = await g.call('/api/v1/products?q=%EC%A0%95%EB%A0%AC%ED%99%95%EC%9D%B8&per_page=100&sort=price_desc');
  assert.deepEqual(ownIds(desc.json.data, 'h1'), ['h1j', 'h1k']);
});

await t.test('H-1.10 MATCH builder quotes terms and ANDs them', async () => {
  assert.equal(buildFtsMatch('무선이어폰 블루투스', '무선이어폰 블루투스'), '"무선이어폰" AND "블루투스"');
  assert.equal(buildFtsMatch('무선 이어폰', '무선 이어폰'), '"이어폰"', '2-char terms skip FTS (LIKE-ANDed separately)');
  assert.deepEqual(shortSearchTerms('무선 이어폰'), ['무선']);
  assert.equal(buildFtsMatch('귀', '귀'), null, 'sub-trigram queries stay on LIKE');
  assert.equal(buildFtsMatch('버즈', '이어폰'), '"이어폰"', 'canonical rescues short raw terms');
  assert.equal(buildFtsMatch('버즈', '버즈'), null);
  assert.equal(buildFtsMatch('" OR "1"="1', '" OR "1"="1'), '"1=1"', 'operators and quotes become an inert literal');
  assert.equal(buildFtsMatch('*', '*'), null);
  assert.equal(escapeLike('100%_\\'), '100\\%\\_\\\\');
  assert.equal(
    buildFtsMatch('무선이어폰', '이어폰'),
    '"무선이어폰" OR ("이어폰")',
    'differing canonical ORs in'
  );
});

// ---------- H-2: push pipeline ----------

const H2_PW = 'DevPass!2026#';
const H2_ADDR = { recipient_name: '홍길동', recipient_phone: '010-1234-5678', shipping_address_line1: '서울특별시 강남구 테헤란로 1', shipping_postal_code: '06236' };

async function h2boot(env = {}) {
  const g = await newGateway({ ...env, PAYMENT_MODE: 'sandbox', PAYMENT_WEBHOOK_SECRET: 'wh-secret-0123456789abcdef' });
  const one = (sql, ...p) => { const r = g.db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const login = async (email, role = 'CUSTOMER') => {
    const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: H2_PW, role } });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.json.token;
  };
  return { ...g, one, login };
}

async function h2paidSubOrder(g, cust, ptEmail, skuId) {
  const o = (await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...H2_ADDR, items: [{ sku_id: skuId, quantity: 1 }] } })).json;
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  const pt = await g.login(ptEmail, 'PARTNER');
  const sub = g.one("SELECT id FROM sub_orders WHERE parent_order_id = ? AND status IN ('PAYMENT_CONFIRMED','PREPARING')", o.order_id);
  assert.ok(sub, 'shippable sub-order exists');
  return { order: o, subId: sub.id, pt };
}

await t.test('H-2.1 token register upserts sealed and unregisters by owner', async () => {
  const g = await h2boot();
  const cust = await g.login('customer@example.com');
  const token = `fcm-test-token-${'a'.repeat(40)}`;
  const first = await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token, platform: 'ANDROID' } });
  assert.equal(first.status, 201, first.text);
  assert.equal(first.json.success, true);
  const { createHash } = await import('node:crypto');
  const row = g.one('SELECT * FROM push_device_tokens WHERE token_hash = ?', createHash('sha256').update(token, 'utf8').digest('hex'));
  assert.ok(row, 'token row stored');
  assert.ok(String(row.token_sealed).startsWith('enc:v1:'), 'token sealed at rest');
  assert.equal(row.app, 'CUSTOMER');
  assert.equal(row.platform, 'ANDROID');
  const again = await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token, platform: 'ANDROID' } });
  assert.equal(again.status, 200, 're-register upserts');
  assert.equal(g.one('SELECT COUNT(*) AS c FROM push_device_tokens WHERE token_hash = ?', row.token_hash).c, 1);
  const badPlatform = await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token: `${token}-other`, platform: 'PAGER' } });
  assert.equal(badPlatform.status, 400);
  const short = await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token: 'tiny', platform: 'IOS' } });
  assert.equal(short.status, 400);
  const pt = await g.login('seller@temu-supply.com', 'PARTNER');
  const mismatch = await g.call('/api/v1/push/tokens', { method: 'POST', token: pt, body: { token: `${token}-pt`, platform: 'ANDROID', app: 'CUSTOMER' } });
  assert.equal(mismatch.status, 400, 'app must match the authenticated role');
  const del = await g.call('/api/v1/push/tokens', { method: 'DELETE', token: cust, body: { token } });
  assert.equal(del.status, 200);
  assert.equal(del.json.deleted, 1);
  assert.equal(g.one('SELECT COUNT(*) AS c FROM push_device_tokens WHERE token_hash = ?', row.token_hash).c, 0);
  const delAgain = await g.call('/api/v1/push/tokens', { method: 'DELETE', token: cust, body: { token } });
  assert.equal(delAgain.json.deleted, 0);
});

await t.test('H-2.2 shipment with no token logs NO_TOKENS and calls no fetch', async () => {
  const g = await h2boot();
  const cust = await g.login('customer@example.com');
  const { subId, pt } = await h2paidSubOrder(g, cust, 'seller@temu-supply.com', 'sku_001_w');
  const realFetch = globalThis.fetch;
  let googleCalls = 0;
  globalThis.fetch = async (...a) => {
    if (String(a[0]).includes('googleapis.com') || String(a[0]).includes('google.com')) googleCalls++;
    return realFetch(...a);
  };
  try {
    const ok = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'TRKH2000001' } });
    assert.equal(ok.status, 200, ok.text);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(googleCalls, 0, 'no provider call without tokens');
  const rows = g.db.prepare("SELECT * FROM notification_delivery_logs WHERE channel = 'PUSH' AND template_code = 'ORDER_SHIPPED'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'NO_TOKENS');
});

await t.test('H-2.3 token without FCM credentials logs PUSH_NOT_CONFIGURED', async () => {
  const g = await h2boot();
  const cust = await g.login('customer@example.com');
  const token = `fcm-test-token-${'b'.repeat(40)}`;
  await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token, platform: 'IOS' } });
  const { subId, pt } = await h2paidSubOrder(g, cust, 'seller@temu-supply.com', 'sku_001_b');
  const ok = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'TRKH2000002' } });
  assert.equal(ok.status, 200, ok.text);
  const rows = g.db.prepare("SELECT * FROM notification_delivery_logs WHERE channel = 'PUSH' AND template_code = 'ORDER_SHIPPED'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'PUSH_NOT_CONFIGURED');
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM push_device_tokens').get().c, 1, 'token kept for later');
});

async function h2fcmEnv() {
  const pair = await globalThis.crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = Buffer.from(await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  return { FCM_PROJECT_ID: 'olmoa-test', FCM_CLIENT_EMAIL: 'fcm@test.iam.gserviceaccount.com', FCM_PRIVATE_KEY: pkcs8 };
}

function h2mockFetch(handler) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => handler(String(url), init, realFetch);
  return () => { globalThis.fetch = realFetch; };
}

const h2fcmOk = (calls) => async (url, init, realFetch) => {
  if (url === 'https://oauth2.googleapis.com/token') {
    calls.token++;
    return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
  }
  if (url === 'https://fcm.googleapis.com/v1/projects/olmoa-test/messages:send') {
    calls.send++;
    return new Response(JSON.stringify({ name: `projects/olmoa-test/messages/msg-${calls.send}` }), { status: 200 });
  }
  return realFetch(url, init);
};

await t.test('H-2.4 configured FCM sends, caches the token, and prunes UNREGISTERED', async () => {
  const g = await h2boot(await h2fcmEnv());
  const cust = await g.login('customer@example.com');
  const tokA = `fcm-test-token-${'c'.repeat(40)}`;
  const tokB = `fcm-test-token-${'d'.repeat(40)}`;
  await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token: tokA, platform: 'ANDROID' } });
  await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token: tokB, platform: 'IOS' } });
  const calls = { token: 0, send: 0 };
  const restore = h2mockFetch(h2fcmOk(calls));
  try {
    const adm = await g.login('admin@openmarket.com', 'ADMIN');
    const bc = await g.call('/api/v1/admin/push/broadcast', { method: 'POST', token: adm, body: { title: '테스트 공지', body: '푸시 본문' } });
    assert.equal(bc.status, 200, bc.text);
    assert.equal(bc.json.sent, 2);
    assert.equal(bc.json.failed, 0);
  } finally {
    restore();
  }
  assert.equal(calls.token, 1, 'service-account token fetched once and cached');
  assert.equal(calls.send, 2);
  const sent = g.db.prepare("SELECT * FROM notification_delivery_logs WHERE channel = 'PUSH' AND status = 'SENT'").all();
  assert.equal(sent.length, 2);
  assert.ok(String(sent[0].provider_msg_id).includes('msg-'), 'provider message id recorded');
  const restore2 = h2mockFetch(async (url, init, realFetch) => {
    if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
    if (url.includes('messages:send')) {
      return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.' } }), { status: 404 });
    }
    return realFetch(url, init);
  });
  try {
    const adm = await g.login('admin@openmarket.com', 'ADMIN');
    await g.call('/api/v1/admin/push/broadcast', { method: 'POST', token: adm, body: { title: 't', body: 'b' } });
  } finally {
    restore2();
  }
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM push_device_tokens').get().c, 0, 'dead tokens pruned');
});

await t.test('H-2.5 delivered and refund triggers notify the customer', async () => {
  const g = await h2boot(await h2fcmEnv());
  const cust = await g.login('customer@example.com');
  await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token: `fcm-test-token-${'e'.repeat(40)}`, platform: 'ANDROID' } });
  const { order, subId, pt } = await h2paidSubOrder(g, cust, 'seller@temu-supply.com', 'sku_001_w');
  const calls = { token: 0, send: 0 };
  const restore = h2mockFetch(h2fcmOk(calls));
  try {
    const adm = await g.login('admin@openmarket.com', 'ADMIN');
    await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'TRKH2000003' } });
    const dlv = await g.call(`/api/v1/admin/sub-orders/${subId}/delivered`, { method: 'POST', token: adm, body: { evidence: '택배사 조회 확인' } });
    assert.equal(dlv.status, 200, dlv.text);
    const item = g.one('SELECT id, quantity FROM order_items WHERE sub_order_id = ?', subId);
    const rf = await g.call(`/api/v1/admin/orders/${order.order_id}/refund`, { method: 'POST', token: adm, body: { reason: '테스트 환불', lines: [{ order_item_id: item.id, quantity: item.quantity }] } });
    assert.equal(rf.status, 200, rf.text);
  } finally {
    restore();
  }
  const codes = g.db.prepare("SELECT template_code AS c FROM notification_delivery_logs WHERE channel = 'PUSH' AND app = 'CUSTOMER' ORDER BY sent_at").all().map((r) => r.c);
  assert.deepEqual(codes, ['ORDER_SHIPPED', 'ORDER_DELIVERED', 'REFUND_COMPLETED']);
  const seller = g.db.prepare("SELECT status FROM notification_delivery_logs WHERE channel = 'PUSH' AND app = 'PARTNER' AND template_code = 'SELLER_NEW_ORDER'").all();
  assert.equal(seller.length, 1, 'capture also addressed the selling partner');
  assert.equal(seller[0].status, 'NO_TOKENS');
});

await t.test('H-2.6 broadcast is capped, counted, and admin-only', async () => {
  const g = await h2boot(await h2fcmEnv());
  const cust = await g.login('customer@example.com');
  await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token: `fcm-test-token-${'f'.repeat(40)}`, platform: 'WEB' } });
  const calls = { token: 0, send: 0 };
  const restore = h2mockFetch(h2fcmOk(calls));
  try {
    const denied = await g.call('/api/v1/admin/push/broadcast', { method: 'POST', token: cust, body: { title: 't', body: 'b' } });
    assert.equal(denied.status, 403);
    const anon = await g.call('/api/v1/admin/push/broadcast', { method: 'POST', body: { title: 't', body: 'b' } });
    assert.ok([401, 403, 404].includes(anon.status), `unauthenticated refused, got ${anon.status}`);
    const adm = await g.login('admin@openmarket.com', 'ADMIN');
    const empty = await g.call('/api/v1/admin/push/broadcast', { method: 'POST', token: adm, body: { title: ' ', body: 'b' } });
    assert.equal(empty.status, 400);
    const bc = await g.call('/api/v1/admin/push/broadcast', { method: 'POST', token: adm, body: { title: '공지', body: '내용', limit: 5000 } });
    assert.equal(bc.status, 200, bc.text);
    assert.equal(bc.json.limit_applied, 200, 'fan-out capped');
    assert.equal(bc.json.sent + bc.json.failed + bc.json.skipped, 1);
  } finally {
    restore();
  }
});

await t.test('H-2.7 push stats expose counts without token contents', async () => {
  const g = await h2boot();
  const cust = await g.login('customer@example.com');
  await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token: `fcm-test-token-${'g'.repeat(40)}`, platform: 'ANDROID' } });
  const forbidden = await g.call('/api/v1/admin/push/stats', { token: cust });
  assert.equal(forbidden.status, 403);
  const adm = await g.login('admin@openmarket.com', 'ADMIN');
  const st = await g.call('/api/v1/admin/push/stats', { token: adm });
  assert.equal(st.status, 200, st.text);
  assert.equal(st.json.data.CUSTOMER.ANDROID, 1);
  assert.ok(!JSON.stringify(st.json).includes('fcm-test-token'), 'no token material in stats');
});

await t.test('H-2.8 a failing provider never breaks the order operation', async () => {
  const g = await h2boot(await h2fcmEnv());
  const cust = await g.login('customer@example.com');
  await g.call('/api/v1/push/tokens', { method: 'POST', token: cust, body: { token: `fcm-test-token-${'h'.repeat(40)}`, platform: 'ANDROID' } });
  const { subId, pt } = await h2paidSubOrder(g, cust, 'seller@temu-supply.com', 'sku_001_w');
  const restore = h2mockFetch(async (url, init, realFetch) => {
    if (url.includes('googleapis.com')) throw new Error('provider down');
    return realFetch(url, init);
  });
  try {
    const ok = await g.call(`/api/v1/partner/orders/${subId}/shipment`, { method: 'PUT', token: pt, body: { carrier: 'CJ대한통운', tracking_number: 'TRKH2000004' } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(g.one('SELECT status FROM sub_orders WHERE id = ?', subId).status, 'SHIPPED');
  } finally {
    restore();
  }
  const rows = g.db.prepare("SELECT * FROM notification_delivery_logs WHERE channel = 'PUSH' AND app = 'CUSTOMER'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'FAILED');
  const seller = g.db.prepare("SELECT status FROM notification_delivery_logs WHERE channel = 'PUSH' AND app = 'PARTNER'").all();
  assert.equal(seller.length, 1, 'partner leg logged separately');
  assert.equal(seller[0].status, 'NO_TOKENS');
});

// ---------- H-3: recommendations ----------

async function h3trio(g) {
  const rows = g.db.prepare(
    `SELECT s.id AS sku, s.product_id AS pid FROM product_skus s
     JOIN products p ON p.id = s.product_id WHERE p.status = 'ACTIVE' ORDER BY s.product_id LIMIT 30`
  ).all();
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.pid)) seen.set(r.pid, r.sku);
  assert.ok(seen.size >= 4, 'seed has enough products');
  return [...seen.entries()].map(([pid, sku]) => ({ pid, sku }));
}

async function h3order(g, cust, skus) {
  const o = (await g.call('/api/v1/orders/checkout', { method: 'POST', token: cust, body: { ...H2_ADDR, items: skus.map((sku_id) => ({ sku_id, quantity: 1 })) } })).json;
  assert.ok(o.order_id, `checkout ok: ${JSON.stringify(o).slice(0, 200)}`);
  const pay = await g.call('/api/v1/payments/confirm', { method: 'POST', token: cust, body: { order_id: o.order_id, payment_key: `sandbox_${o.order_id.slice(-8)}xx`, amount: o.total_pay_amount } });
  assert.equal(pay.status, 200, pay.text);
  return o;
}

async function h3register(g, email) {
  const r = await g.call('/api/v1/auth/register', { method: 'POST', body: { email, password: 'RecTest!2026#', full_name: '추천테스터', phone: '010-5555-6666', agree_terms: true, agree_privacy: true } });
  assert.equal(r.status, 201, r.text);
  return r.json.token;
}

await t.test('H-3.1 product views log once per user, product, and day', async () => {
  const g = await h2boot();
  const cust = await g.login('customer@example.com');
  const [{ pid }] = await h3trio(g);
  const first = await g.call(`/api/v1/products/${pid}/view`, { method: 'POST', token: cust });
  assert.equal(first.status, 200, first.text);
  const again = await g.call(`/api/v1/products/${pid}/view`, { method: 'POST', token: cust });
  assert.equal(again.status, 200);
  const me = g.one('SELECT id FROM users WHERE email = ?', 'customer@example.com');
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM product_views WHERE user_id = ? AND product_id = ?').get(me.id, pid).c, 1);
  const guest = await g.call(`/api/v1/products/${pid}/view`, { method: 'POST' });
  assert.equal(guest.status, 401);
  const missing = await g.call('/api/v1/products/prod_no_such/view', { method: 'POST', token: cust });
  assert.equal(missing.status, 404);
});

await t.test('H-3.2 related ranks co-purchase, co-view, then popular fill', async () => {
  const g = await h2boot();
  const cust = await g.login('customer@example.com');
  const other = await h3register(g, 'h3viewer@example.com');
  const [A, B, C, D] = await h3trio(g);
  await h3order(g, cust, [A.sku, B.sku]);
  await h3order(g, cust, [A.sku, B.sku]);
  await h3order(g, cust, [A.sku, C.sku]);
  await g.call(`/api/v1/products/${A.pid}/view`, { method: 'POST', token: cust });
  await g.call(`/api/v1/products/${D.pid}/view`, { method: 'POST', token: cust });
  await g.call(`/api/v1/products/${A.pid}/view`, { method: 'POST', token: other });
  await g.call(`/api/v1/products/${D.pid}/view`, { method: 'POST', token: other });
  const r = await g.call(`/api/v1/recommendations/related?product_id=${A.pid}&limit=5`);
  assert.equal(r.status, 200, r.text);
  const ids = r.json.data.map((p) => p.id);
  assert.deepEqual(ids.slice(0, 3), [B.pid, C.pid, D.pid], 'co-purchase by pair count, then co-view');
  assert.ok(!ids.includes(A.pid), 'self excluded');
  assert.equal(ids.length, 5, 'popular fill completes the page');
  assert.deepEqual(r.json.signals, { co_purchase: 2, co_view: 1, popular_fill: 2 });
  const card = r.json.data[0];
  for (const k of ['id', 'slug', 'title', 'thumbnail_url', 'lowest_sale_price', 'lowest_original_price', 'total_sold_count', 'avg_rating', 'review_count', 'brand', 'category_slug']) {
    assert.ok(k in card, `card carries ${k}`);
  }
  const missing = await g.call('/api/v1/recommendations/related?product_id=prod_no_such');
  assert.equal(missing.status, 404);
});

await t.test('H-3.3 inactive products are never recommended', async () => {
  const g = await h2boot();
  const cust = await g.login('customer@example.com');
  const [A, B] = await h3trio(g);
  await h3order(g, cust, [A.sku, B.sku]);
  g.db.prepare("UPDATE products SET status = 'DRAFT' WHERE id = ?").run(B.pid);
  const r = await g.call(`/api/v1/recommendations/related?product_id=${A.pid}&limit=10`);
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.json.data.some((p) => p.id === B.pid), 'draft pair excluded');
  assert.ok(r.json.data.every((p) => p.id !== A.pid), 'self excluded');
});

await t.test('H-3.4 for-you serves affinity for buyers, popular for guests', async () => {
  const g = await h2boot();
  const guest = await g.call('/api/v1/recommendations/for-you?limit=3');
  assert.equal(guest.status, 200, guest.text);
  const top = g.db.prepare("SELECT id FROM products WHERE status = 'ACTIVE' ORDER BY total_sold_count DESC LIMIT 1").get();
  assert.equal(guest.json.data[0].id, top.id, 'guests get global popular');
  const buyer = await h3register(g, 'h3buyer@example.com');
  const trio = await h3trio(g);
  const catOf = (pid) => g.one('SELECT c.slug AS s FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?', pid).s;
  const pick = trio.find((x) => catOf(x.pid));
  await h3order(g, buyer, [pick.sku]);
  const me = await g.call('/api/v1/recommendations/for-you?limit=5', { token: buyer });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.data[0].category_slug, catOf(pick.pid), 'buyer affinity category leads');
});

await t.test('H-3.5 cart bundles co-purchased items excluding the cart', async () => {
  const g = await h2boot();
  const cust = await g.login('customer@example.com');
  const [A, B, C] = await h3trio(g);
  await h3order(g, cust, [A.sku, C.sku]);
  await h3order(g, cust, [A.sku, C.sku]);
  await h3order(g, cust, [B.sku, C.sku]);
  const r = await g.call(`/api/v1/recommendations/cart-bundle?ids=${A.pid},${B.pid}&limit=5`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.data[0].id, C.pid, 'strongest co-purchase leads');
  assert.ok(!r.json.data.some((p) => p.id === A.pid || p.id === B.pid), 'cart ids excluded');
  const unknown = await g.call(`/api/v1/recommendations/cart-bundle?ids=${A.pid},prod_no_such&limit=5`);
  assert.equal(unknown.status, 200, 'unknown ids ignored, not fatal');
  const empty = await g.call('/api/v1/recommendations/cart-bundle?ids=&limit=5');
  assert.equal(empty.status, 400);
});

await t.test('H-3.6 limits clamp to 1..20', async () => {
  const g = await h2boot();
  const [{ pid }] = await h3trio(g);
  const hi = await g.call(`/api/v1/recommendations/related?product_id=${pid}&limit=99`);
  assert.equal(hi.status, 200, hi.text);
  assert.ok(hi.json.data.length <= 20);
  const lo = await g.call(`/api/v1/recommendations/related?product_id=${pid}&limit=0`);
  assert.equal(lo.status, 200, lo.text);
  assert.equal(lo.json.data.length, 8, 'invalid limit falls back to the default page');
});

// ---------- H-4: images + ops ----------

await t.test('H-4.1 /health reports the media storage backend honestly', async () => {
  const bare = await newGateway();
  const r = await bare.call('/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.readiness.media_storage, 'D1_FALLBACK', 'no binding means the D1 fallback');
  const bound = await createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      STORAGE_BUCKET: { put: async () => {}, get: async () => null }
    }
  });
  const r2 = await bound.call('/health');
  assert.equal(r2.json.readiness.media_storage, 'R2_BOUND', 'binding presence reported (bucket existence is a human check)');
});

t.finish();
