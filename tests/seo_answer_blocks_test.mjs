// tests/seo_answer_blocks_test.mjs
// Phase 6 task 6-4: answer-first blocks — the PDP key-facts table mirrors
// the database, empty rows vanish, and only answered public Q&A shows.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { renderKeyFactsHtml } from '../apps/cloudflare-gateway/src/services/seo/pdp-brief.js';

const t = createRunner('Answer blocks (6-4)');

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

function rowsOf(html) {
  const out = [];
  for (const m of String(html).matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)) out.push([m[1], m[2]]);
  return out;
}

// 1. Every key-facts row mirrors its source row.
await t.test('1. key-facts values match the database', async () => {
  const g = await newGateway();
  const d = await g.call('/api/v1/products/prod_001');
  assert.equal(d.status, 200, d.text);
  const html = d.json.data.key_facts_html;
  assert.ok(html.startsWith('<dl>') && html.endsWith('</dl>'), 'dl markup shared with the Edge');
  const rows = Object.fromEntries(rowsOf(html));
  const p = g.db.prepare('SELECT * FROM products WHERE id = ?').get('prod_001');
  const pol = g.db.prepare('SELECT * FROM shipping_policies WHERE id = ?').get(p.shipping_policy_id);
  assert.ok(rows['판매가'].includes('49,900원'), 'sale price live');
  assert.ok(rows['판매가'].includes('129,000원'), 'original beside it');
  assert.equal(rows['재고 상태'], '구매 가능');
  assert.ok(rows['배송비·출고 기간'].includes(d.json.data.shipping_text), '6-11 text reused verbatim');
  assert.ok(rows['반품 기간·반품 배송비'].includes('수령 후 7일 이내'), 'effective window');
  const fee = Number(pol.return_fee ?? 0);
  assert.ok(rows['반품 기간·반품 배송비'].includes(fee > 0 ? '원' : '무료'), 'return fee from the policy row');
  if (fee > 0) assert.ok(rows['반품 기간·반품 배송비'].includes(String(fee)), 'exact fee mirrored');
  assert.equal(rows['원산지'], p.country_origin);
  assert.equal(rows['판매자'], d.json.data.seller_name || d.json.data.partner_name);
  assert.equal(rows['정보 갱신일'], String(p.updated_at).slice(0, 10));
});

// 2. Missing values drop their rows (never empty, never invented).
await t.test('2. valueless rows vanish', async () => {
  const g = await newGateway();
  const bare = g.db.prepare("SELECT id FROM products WHERE brand IS NULL AND status = 'ACTIVE' LIMIT 1").get();
  assert.ok(bare, 'a brand-less fixture exists');
  const d = await g.call(`/api/v1/products/${bare.id}`);
  assert.equal(d.status, 200, d.text);
  const labels = rowsOf(d.json.data.key_facts_html).map(([k]) => k);
  assert.ok(!labels.includes('브랜드'), 'no brand row without a brand');
  assert.ok(labels.includes('판매가') && labels.includes('재고 상태'), 'core rows always present');
  assert.equal(renderKeyFactsHtml([]), '');
  assert.equal(renderKeyFactsHtml([{ label: '브랜드', value: '  ' }]), '', 'blank values filtered');
  assert.equal(renderKeyFactsHtml([{ label: '브랜드' }]), '', 'missing values filtered');
});

// 3. Only answered public Q&A reaches the brief.
await t.test('3. secret and unanswered Q&A stay out of the brief', async () => {
  const g = await newGateway();
  const prod = g.db.prepare("SELECT id, partner_id FROM products WHERE status = 'ACTIVE' LIMIT 1").get();
  const asker = g.db.prepare("SELECT id FROM users WHERE email = 'customer@example.com'").get().id;
  g.db.prepare(`INSERT INTO product_qna (id, product_id, partner_id, user_id, questioner_name, question, answer, is_secret, status, created_at)
    VALUES ('qna_pub_1', ?, ?, ?, '테스터', '공개 질문?', '공개 답변', 0, 'ANSWERED', '2026-11-20 10:00:00'),
           ('qna_sec_1', ?, ?, ?, '테스터', '비밀 질문?', '비밀 답변', 1, 'ANSWERED', '2026-11-21 10:00:00'),
           ('qna_wait_1', ?, ?, ?, '테스터', '대기 질문?', NULL, 0, 'WAITING', '2026-11-22 10:00:00')`)
    .run(prod.id, prod.partner_id, asker, prod.id, prod.partner_id, asker, prod.id, prod.partner_id, asker);
  const d = await g.call(`/api/v1/products/${prod.id}`);
  assert.equal(d.status, 200, d.text);
  const qna = d.json.data.brief.qna;
  assert.ok(qna.some((r) => r.q === '공개 질문?'), 'answered public row shown');
  assert.ok(qna.every((r) => !r.q.includes('비밀 질문?')), 'secret rows hidden');
  assert.ok(qna.every((r) => !r.q.includes('대기 질문?')), 'unanswered rows hidden');
  assert.ok(!d.json.data.brief_text.includes('비밀 답변'), 'crawl text clean too');
});

// 4. Markup escapes hostile values.
await t.test('4. key-facts markup escapes values', async () => {
  const html = renderKeyFactsHtml([
    { label: '브랜드', value: '<img src=x onerror=alert(1)>' },
    { label: '판매자', value: 'A&B "C"' }
  ]);
  assert.ok(!/<img/.test(html) && html.includes('&lt;img'), 'tags neutralized to entities');
  assert.ok(html.includes('A&amp;B &quot;C&quot;'), 'entities escaped');
  assert.ok(html.includes('<dt>브랜드</dt>'), 'labels intact');
});

// 5. Category counts come from the rolled-up tree.
await t.test('5. hub counts match the category rollup', async () => {
  const g = await newGateway();
  const cats = await g.call('/api/v1/categories');
  const all = cats.json.data;
  const parent = all.find((c) => all.some((k) => k.parent_id === c.id));
  assert.ok(parent);
  const subs = all.filter((k) => k.parent_id === parent.id);
  assert.ok(subs.length > 0);
  for (const s of subs) {
    assert.ok(Number.isInteger(s.product_count) && s.product_count >= 0, `${s.slug} carries a count`);
  }
  const direct = g.db.prepare('SELECT COUNT(*) AS c FROM products p WHERE p.category_id = ? AND p.status = ?').get(parent.id, 'ACTIVE').c;
  assert.ok(parent.product_count >= direct, 'rollup covers direct rows');
});

// 6. Downstream contracts stay attached: 6-1, 6-3, 6-11, 6-12, 6-13.
await t.test('6. earlier-task contracts stay present', async () => {
  const g = await newGateway();
  const d = await g.call('/api/v1/products/prod_001');
  const p = d.json.data;
  assert.ok(p.brief_text && p.brief, '6-1 brief + text');
  assert.ok(p.shipping_text && p.shipping_policy, '6-11 policy + text');
  assert.ok('brand' in p && 'manufacturer' in p && 'model_name' in p, '6-12 identifiers');
  assert.ok(Array.isArray(p.skus), '6-3/6-12 SKU barcodes reachable');
  assert.ok('primary_gtin' in p && Array.isArray(p.reviews_preview), '6-3 graph inputs');
  const faq = await g.call('/api/v1/support/faq');
  assert.ok(faq.json.data.length > 0 && faq.json.categories.length === 6, '6-13 FAQ feed');
  const crawl = await g.call('/api/crawl/product/prod_001');
  assert.equal(crawl.text, p.brief_text, '6-1 byte parity unbroken');
});

t.finish();
