// tests/import_publish_test.mjs
// URL-import publish must behave like normal seller registration: validated
// fields, DRAFT/PENDING so an operator reviews before sale — never a direct
// ACTIVE/APPROVED insert with invented prices, Unsplash thumbs or default copy.
// Job rows are inserted as fixtures (the crawl pipeline has its own coverage).

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Import Publish Review Gate');

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox'
    }
  });
}

async function setup(g) {
  const login = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'seller@temu-supply.com', password: 'DevPass!2026#', role: 'PARTNER' }
  });
  assert.equal(login.status, 200);
  const partnerId = login.json.partner?.id
    || g.db.prepare("SELECT partner_id AS id FROM partner_users WHERE user_id = (SELECT id FROM users WHERE email = 'seller@temu-supply.com')").get().id;
  let n = 0;
  const jobId = () => `imp_test_${++n}`;
  function insertJob(preview, status = 'ANALYZED') {
    const id = jobId();
    g.db.prepare(`INSERT INTO product_import_jobs (id, partner_id, source_url, domain, status, preview_data_json)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, partnerId, 'https://supply.example/p/1', 'supply.example', status, JSON.stringify(preview));
    return id;
  }
  return { token: login.json.token, partnerId, insertJob };
}

const GOOD_PREVIEW = {
  product: { title: '수집 테스트 상품', brand: 'TEST', thumbnail_url: 'https://cdn.example/t.png', description_html: '<p>설명</p>' },
  pricing: { calculated_sale_price: 19900, calculated_original_price: 29900, wholesale_cost_krw: 12000 },
  variants: [{ variant_code: 'V1', price: 19900, original_price: 29900, stock_quantity: 5, option_values: { 색상: '블랙' } }]
};

const GOOD_BODY = {
  title: '수집 테스트 상품',
  category_slug: 'womens-clothing',
  thumbnail_url: 'https://cdn.example/t.png',
  sale_price: 19900,
  original_price: 29900
};

await t.test('1. publish lands DRAFT/PENDING for operator review', async () => {
  const g = await newGateway();
  const { token, insertJob } = await setup(g);
  const id = insertJob(GOOD_PREVIEW);
  const r = await g.call(`/api/v1/imports/${id}/publish`, { method: 'POST', token, body: GOOD_BODY });
  assert.equal(r.status, 201);
  const row = g.db.prepare('SELECT status, review_status, title, lowest_sale_price FROM products WHERE id = ?').get(r.json.product_id);
  assert.equal(row.status, 'DRAFT');
  assert.equal(row.review_status, 'PENDING');
  assert.equal(row.lowest_sale_price, 19900);
  assert.equal(g.db.prepare('SELECT status FROM product_import_jobs WHERE id = ?').get(id).status, 'PUBLISHED');
  assert.equal(g.db.prepare('SELECT COUNT(*) AS c FROM product_skus WHERE product_id = ?').get(r.json.product_id).c, 1);
});

await t.test('2. publish validates like seller registration', async () => {
  const g = await newGateway();
  const { token, insertJob } = await setup(g);
  const cases = [
    [{ ...GOOD_BODY, title: '' }, 400],
    [{ ...GOOD_BODY, sale_price: 0 }, 400],
    [{ ...GOOD_BODY, sale_price: -5 }, 400],
    [{ ...GOOD_BODY, sale_price: 'cheap' }, 400],
    [{ ...GOOD_BODY, category_slug: 'no-such-cat' }, 400],
    [{ ...GOOD_BODY, thumbnail_url: 'http://insecure/x.png' }, 400],
    [{}, 400]
  ];
  for (const [body, want] of cases) {
    const id = insertJob({ product: {}, pricing: {}, variants: [] });
    const r = await g.call(`/api/v1/imports/${id}/publish`, { method: 'POST', token, body });
    assert.equal(r.status, want, JSON.stringify(body));
  }
  assert.equal(g.db.prepare("SELECT COUNT(*) AS c FROM products WHERE title = ''").get().c, 0);
});

await t.test('3. republish and foreign jobs are rejected', async () => {
  const g = await newGateway();
  const { token, insertJob } = await setup(g);
  const id = insertJob(GOOD_PREVIEW);
  assert.equal((await g.call(`/api/v1/imports/${id}/publish`, { method: 'POST', token, body: GOOD_BODY })).status, 201);
  const again = await g.call(`/api/v1/imports/${id}/publish`, { method: 'POST', token, body: GOOD_BODY });
  assert.equal(again.status, 400);
  assert.equal(again.json.code, 'ALREADY_PUBLISHED');
  assert.equal((await g.call('/api/v1/imports/imp_test_nope/publish', { method: 'POST', token, body: GOOD_BODY })).status, 404);
});

t.finish();
