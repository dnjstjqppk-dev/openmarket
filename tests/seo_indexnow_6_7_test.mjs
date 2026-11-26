// tests/seo_indexnow_6_7_test.mjs
// Phase 6 task 6-7: the IndexNow key file is served from env (never static),
// and product writes land in the submission queue exactly when a product
// enters, changes or leaves the indexed set.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('IndexNow key and queue (6-7)');
const PW = 'DevPass!2026#';
const KEY = '0f26d5e892544f74b806ec5c5522e6a1';

async function newGateway(extra = {}) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      PUBLIC_STOREFRONT_URL: 'https://olmoa.com',
      ...extra
    }
  });
}

async function partnerToken(g) {
  const r = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'seller@temu-supply.com', password: PW, role: 'PARTNER' }
  });
  assert.equal(r.status, 200, `partner login: ${r.text}`);
  return r.json.token;
}

async function adminToken(g) {
  const r = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'admin@openmarket.com', password: PW, role: 'ADMIN' }
  });
  assert.equal(r.status, 200, `admin login: ${r.text}`);
  return r.json.token;
}

async function createDraft(g, token, title) {
  const r = await g.call('/api/v1/partner/products', {
    method: 'POST',
    token,
    body: {
      title, sale_price: 25000, original_price: 30000, stock_quantity: 10,
      category_slug: 'womens-clothing', thumbnail_url: 'https://cdn.example/f.png',
      shipping_policy_id: 'sp_dev_pt_001', brand: 'IX', gtin: '5901234123457'
    }
  });
  assert.equal(r.status, 201, `create: ${r.text}`);
  return r.json.product_id;
}

const queuedAs = (g, id) => g.db.prepare("SELECT status FROM indexnow_queue WHERE url LIKE ? ORDER BY rowid DESC LIMIT 1")
  .get(`https://olmoa.com/ko/krw/p/${id}%`);

// 1. Key file: byte-exact when the key exists; exact .txt routes still win.
await t.test('1. /<key>.txt serves the key, impostors 404', async () => {
  const g = await newGateway({ INDEXNOW_KEY: KEY });
  const r = await g.call(`/${KEY}.txt`);
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('Content-Type'), /text\/plain/);
  assert.equal(r.text, KEY, 'byte-exact, no trailing newline');
  assert.equal((await g.call('/llms-full.txt')).status, 200, 'exact routes win over the key shape');
  assert.equal((await g.call('/robots.txt')).status, 200);
  assert.equal((await g.call('/DeadBeefCafeBabe99.txt')).status, 404, 'wrong name');
  assert.equal((await g.call('/abc.txt')).status, 404, 'too short for a key');
});

// 2. No key: the file 404s and the drain stays degraded with rows PENDING.
await t.test('2. without a key the file 404s and the drain degrades', async () => {
  const g = await newGateway({});
  assert.equal((await g.call(`/${KEY}.txt`)).status, 404);
  const adm = await adminToken(g);
  const q = await g.call('/api/v1/admin/seo/indexnow/enqueue', {
    method: 'POST', token: adm, body: { urls: ['https://olmoa.com/product/p1'] }
  });
  assert.equal(q.json.queued, 1);
  const d = await g.call('/api/v1/admin/seo/indexnow/drain', { method: 'POST', token: adm, body: {} });
  assert.equal(d.json.degraded, 'INDEXNOW_NOT_CONFIGURED');
  assert.equal(g.db.prepare("SELECT status FROM indexnow_queue WHERE url = ?").get('https://olmoa.com/product/p1').status, 'PENDING');
});

// 3. Editing an indexable product queues its URL.
await t.test('3. edit of an ACTIVE/APPROVED product queues', async () => {
  const g = await newGateway({});
  const tok = await partnerToken(g);
  const id = await createDraft(g, tok, '큐 적재 편집 상품');
  g.db.prepare("UPDATE products SET status = 'ACTIVE', review_status = 'APPROVED' WHERE id = ?").run(id);
  const r = await g.call(`/api/v1/partner/products/${id}`, {
    method: 'PUT', token: tok, body: { bundle_group_key: 'IX7A' }
  });
  assert.equal(r.status, 200, `edit: ${r.text}`);
  assert.equal(queuedAs(g, id).status, 'PENDING');
});

// 4. Editing a never-indexable draft queues nothing.
await t.test('4. edit of a DRAFT queues nothing', async () => {
  const g = await newGateway({});
  const tok = await partnerToken(g);
  const id = await createDraft(g, tok, '큐 미적재 초안');
  const r = await g.call(`/api/v1/partner/products/${id}`, {
    method: 'PUT', token: tok, body: { bundle_group_key: 'IX7B' }
  });
  assert.equal(r.status, 200, `edit: ${r.text}`);
  assert.equal(queuedAs(g, id), undefined);
});

// 5. Taking an indexable product off sale queues the removal signal.
await t.test('5. delist of an ACTIVE product queues', async () => {
  const g = await newGateway({});
  const tok = await partnerToken(g);
  const id = await createDraft(g, tok, '판매중지 신호 상품');
  g.db.prepare("UPDATE products SET status = 'ACTIVE', review_status = 'APPROVED' WHERE id = ?").run(id);
  const r = await g.call('/api/v1/partner/products/bulk-update', {
    method: 'PUT', token: tok, body: { updates: [{ product_id: id, status: 'HIDDEN' }] }
  });
  assert.equal(r.status, 200, `delist: ${r.text}`);
  assert.equal(queuedAs(g, id).status, 'PENDING');
});

// 6. Approval is the index entry point; rejection of a draft is silent.
await t.test('6. APPROVE queues, REJECT of a draft does not', async () => {
  const g = await newGateway({});
  const pt = await partnerToken(g);
  const adm = await adminToken(g);
  const okId = await createDraft(g, pt, '승인 진입 상품');
  const ok = await g.call(`/api/v1/admin/products/${okId}/review`, {
    method: 'POST', token: adm, body: { decision: 'APPROVE' }
  });
  assert.equal(ok.status, 200, `approve: ${ok.text}`);
  assert.equal(queuedAs(g, okId).status, 'PENDING');
  const noId = await createDraft(g, pt, '반려 무음 상품');
  const no = await g.call(`/api/v1/admin/products/${noId}/review`, {
    method: 'POST', token: adm, body: { decision: 'REJECT', note: '테스트 반려' }
  });
  assert.equal(no.status, 200, `reject: ${no.text}`);
  assert.equal(queuedAs(g, noId), undefined);
});

// 7. A price change on an indexable product queues.
await t.test('7. price edit of an ACTIVE product queues', async () => {
  const g = await newGateway({});
  const tok = await partnerToken(g);
  const id = await createDraft(g, tok, '가격 변경 신호 상품');
  g.db.prepare("UPDATE products SET status = 'ACTIVE', review_status = 'APPROVED' WHERE id = ?").run(id);
  const r = await g.call(`/api/v1/partner/products/${id}/price`, {
    method: 'PUT', token: tok, body: { sale_price: 23000, original_price: 30000 }
  });
  assert.equal(r.status, 200, `price: ${r.text}`);
  assert.equal(queuedAs(g, id).status, 'PENDING');
});

t.finish();
