// tests/seo_brief_6_1_test.mjs
// Phase 6 task 6-1: PDP brief (Title -> Key Facts -> Description ->
// Specifications -> Q&A) shared by the storefront section and the crawl
// endpoint, plus the PLP hub data contract.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { renderPdpText } from '../apps/cloudflare-gateway/src/services/seo/pdp-brief.js';

const t = createRunner('SEO brief (6-1)');

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

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const normNum = (s) => s.replace(/,/g, '');
function numbersOf(...texts) {
  const out = new Set();
  for (const text of texts) {
    for (const m of String(text ?? '').match(NUM_RE) || []) out.add(normNum(m));
  }
  return out;
}

// 1. Machine and human read the same brief, byte for byte.
await t.test('1. crawl text equals the detail brief text', async () => {
  const g = await newGateway();
  for (const id of ['prod_001', 'prod_004']) {
    const detail = await g.call(`/api/v1/products/${id}`);
    assert.equal(detail.status, 200, detail.text);
    assert.ok(detail.json.data.brief, 'detail carries the structured brief');
    assert.ok(detail.json.data.brief_text, 'detail carries the rendered text');
    const crawl = await g.call(`/api/crawl/product/${id}`);
    assert.equal(crawl.status, 200, crawl.text);
    assert.equal(crawl.text, detail.json.data.brief_text, `${id} byte-identical`);
    assert.equal(renderPdpText(detail.json.data.brief), crawl.text, 'shared renderer');
  }
});

// 2. Fixed composition order, empty sections skipped.
await t.test('2. brief composes title, facts, description, specs, Q&A in order', async () => {
  const g = await newGateway();
  const crawl = await g.call('/api/crawl/product/prod_001');
  const text = crawl.text;
  const at = (s) => text.indexOf(s);
  assert.ok(at('핵심 정보') > 0 && at('핵심 정보') < at('상품 설명'), 'facts before description');
  const specAt = at('스펙');
  const descAt = at('상품 설명');
  if (specAt >= 0) assert.ok(specAt > descAt, 'specs after description');
  const qnaAt = at('Q&A');
  if (qnaAt >= 0) assert.ok(qnaAt > Math.max(descAt, specAt), 'Q&A last');
  const detail = await g.call('/api/v1/products/prod_001');
  assert.ok(detail.json.data.title && text.startsWith(detail.json.data.title), 'title leads');
  for (const f of detail.json.data.brief.facts) {
    assert.ok(text.includes(`${f.label}: ${f.value}`), `fact rendered: ${f.label}`);
  }
});

// 3. Red-line mapping: every number traces to source rows or the discount formula.
await t.test('3. every number in the brief traces to source data', async () => {
  const g = await newGateway();
  for (const id of ['prod_001', 'prod_004', 'prod_002']) {
    const detail = await g.call(`/api/v1/products/${id}`);
    if (detail.status !== 200) continue;
    const text = detail.json.data.brief_text;
    const p = g.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    const pol = g.db.prepare('SELECT * FROM shipping_policies WHERE id = ?').get(p.shipping_policy_id);
    const qna = g.db.prepare('SELECT question, answer FROM product_qna WHERE product_id = ?').all(id);
    const allowed = numbersOf(
      p.title,
      p.lowest_sale_price, p.lowest_original_price, p.total_sold_count,
      detail.json.data.review_count, detail.json.data.avg_rating,
      pol.base_fee, pol.free_threshold, pol.remote_surcharge, pol.qty_unit,
      p.notice_info_json, p.description_html, p.brand, p.manufacturer, p.model_name,
      detail.json.data.seller_name || detail.json.data.partner_name,
      detail.json.data.category_name,
      ...qna.flatMap((r) => [r.question, r.answer])
    );
    // Named formula: discount_pct = round((orig - sale) / orig * 100).
    if (Number(p.lowest_original_price) > Number(p.lowest_sale_price)) {
      allowed.add(String(Math.round(((p.lowest_original_price - p.lowest_sale_price) / p.lowest_original_price) * 100)));
    }
    const tpl = g.db.prepare('SELECT items_json FROM notice_templates WHERE id = ?')
      .get(p.notice_template_id || detail.json.data.category_notice_template_id || '__none__');
    if (tpl) for (const n of numbersOf(tpl.items_json)) allowed.add(n);
    const found = [...String(text).matchAll(NUM_RE)].map((m) => normNum(m[0]));
    assert.ok(found.length > 0, `${id} brief carries priced facts`);
    for (const n of found) assert.ok(allowed.has(n), `${id}: ${n} traces to source (allowed: ${[...allowed].sort().join(',')})`);
  }
});

// 4. Crawl stays 404 off the indexable set.
await t.test('4. crawl 404s drafts, unassigned and missing products', async () => {
  const g = await newGateway();
  const missing = await g.call('/api/crawl/product/prod_missing');
  assert.equal(missing.status, 404);
  const draft = g.db.prepare("SELECT id FROM products WHERE status != 'ACTIVE' LIMIT 1").get();
  if (draft) {
    const r = await g.call(`/api/crawl/product/${draft.id}`);
    assert.equal(r.status, 404, 'drafts are not crawlable');
  }
  const target = g.db.prepare("SELECT id FROM products WHERE status = 'ACTIVE' AND review_status = 'APPROVED' LIMIT 1").get();
  g.db.prepare('UPDATE products SET shipping_policy_id = NULL WHERE id = ?').run(target.id);
  const r = await g.call(`/api/crawl/product/${target.id}`);
  assert.equal(r.status, 404, 'policy-less rows are not crawlable');
});

// 5. PLP hub data: subcategories, measured top 8, FAQ link target.
await t.test('5. category hubs read subcategories, measured picks and FAQ', async () => {
  const g = await newGateway();
  const cats = await g.call('/api/v1/categories');
  assert.equal(cats.status, 200, cats.text);
  const parent = cats.json.data.find((c) => (cats.json.data || []).some((k) => k.parent_id === c.id));
  assert.ok(parent, 'a parent category exists');
  const subs = cats.json.data.filter((k) => k.parent_id === parent.id);
  assert.ok(subs.length > 0, 'subcategories listed');
  const picks = await g.call(`/api/v1/products?category=${encodeURIComponent(parent.slug)}&sort=popular&per_page=8`);
  assert.equal(picks.status, 200, picks.text);
  assert.ok(picks.json.data.length <= 8);
  const sold = picks.json.data.map((p) => Number(p.total_sold_count) || 0);
  assert.deepEqual([...sold].sort((a, b) => b - a), sold, 'picks are measured bestsellers');
  const faq = await g.call('/api/v1/support/faq');
  assert.equal(faq.status, 200);
  assert.ok(faq.json.categories.length > 0, 'FAQ hub link target alive');
});

// 6. Later-task contracts stay present: 6-3 identifiers, 6-4 facts, 6-13 FAQ.
await t.test('6. downstream contracts stay attached', async () => {
  const g = await newGateway();
  const detail = await g.call('/api/v1/products/prod_001');
  const d = detail.json.data;
  assert.ok('brand' in d && 'manufacturer' in d && 'model_name' in d, '6-3 identifier fields present');
  assert.ok(Array.isArray(d.skus), '6-3 SKU barcodes reachable');
  assert.ok(Array.isArray(d.brief.facts) && d.brief.facts.length > 0, '6-4 key-facts table fed');
  assert.ok(d.brief.facts.every((f) => f.label && f.value !== undefined && f.value !== null), 'facts are label/value pairs');
  assert.ok(Array.isArray(d.brief.specs) && Array.isArray(d.brief.qna), 'specs and Q&A arrays present');
  const faq = await g.call('/api/v1/support/faq');
  assert.ok(faq.json.data.length > 0, '6-13 FAQ rows feed future blocks');
});

t.finish();
