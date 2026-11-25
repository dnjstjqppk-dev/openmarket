// tests/seo_structured_6_3_test.mjs
// Phase 6 task 6-3: expanded structured data — PDP graphs, QAPage, PLP
// siblings, coupon + return-policy feeds. Server reference builders and the
// live client builders must agree; every graph validates structurally.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { productGraph, qaPageGraph, faqGraph, itemListGraph, returnPolicyNode } from '../apps/cloudflare-gateway/src/lib/seo-jsonld.js';
import { productJsonLdOf, qaPageJsonLdOf, returnPolicyNodeOf, storeJsonLdOf, plpJsonLdOf } from '../apps/storefront/src/lib/productSeo.ts';

const t = createRunner('Structured data (6-3)');

async function newGateway(env = {}) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      PUBLIC_STOREFRONT_URL: 'https://olmoa.com',
      ...env
    }
  });
}

/** Structural schema.org check per @type (required props only, no invented fixups). */
function assertGraphValid(node, where) {
  assert.ok(node && typeof node === 'object', `${where}: object`);
  assert.equal(node['@context'], 'https://schema.org', `${where}: @context`);
  const need = (cond, what) => assert.ok(cond, `${where}: requires ${what}`);
  switch (node['@type']) {
    case 'Product':
      need(node.name, 'name');
      need(node.offers && node.offers.price !== undefined && node.offers.priceCurrency, 'offers{price,priceCurrency}');
      break;
    case 'QAPage':
      need(Array.isArray(node.mainEntity) && node.mainEntity.length, 'mainEntity[]');
      for (const q of node.mainEntity) {
        need(q['@type'] === 'Question' && q.name && q.acceptedAnswer, 'Question{name,acceptedAnswer}');
      }
      break;
    case 'ItemList':
      need(Array.isArray(node.itemListElement), 'itemListElement[]');
      break;
    case 'FAQPage':
      need(Array.isArray(node.mainEntity) && node.mainEntity.length, 'mainEntity[]');
      break;
    case 'MerchantReturnPolicy':
      need(node.returnPolicyCountry && node.merchantReturnDays, 'returnPolicyCountry+merchantReturnDays');
      break;
    case 'Store':
      need(node.name && node.hasMerchantReturnPolicy, 'name+hasMerchantReturnPolicy');
      break;
    case 'CollectionPage':
      need(node.mainEntity && node.mainEntity['@type'] === 'ItemList', 'mainEntity ItemList');
      break;
    default:
      assert.fail(`${where}: unexpected @type ${node['@type']}`);
  }
  JSON.parse(JSON.stringify(node));
}

const SHIP = { fee_type: 'CONDITIONAL', base_fee: 3000, free_threshold: 30000, processing_days: 2, return_fee: 3000, exchange_fee: 6000 };

// 1. PDP server graph carries every required node.
await t.test('1. product graph expands fully', async () => {
  const p = { id: 'p1', title: '이어폰', lowest_sale_price: 29900, thumbnail_url: 'https://x/img.jpg', brand: 'Acme', manufacturer: 'AW', model_name: 'AW-1' };
  const [g] = productGraph('https://olmoa.com', p, {
    shipping: SHIP, gtin: '5901234123457', description: '좋은 이어폰', rating: 4.8, reviewCount: 12,
    reviews: [{ author: '김구매', rating: 5, body: '좋아요', date: '2026-11-20 10:00:00' }],
    priceValidUntil: '2026-12-31', windowDays: 7
  });
  assert.equal(g.name, '이어폰');
  assert.equal(g.description, '좋은 이어폰');
  assert.equal(g.sku, 'p1');
  assert.equal(g.brand.name, 'Acme');
  assert.equal(g.manufacturer.name, 'AW');
  assert.equal(g.mpn, 'AW-1');
  assert.equal(g.gtin13, '5901234123457');
  assert.equal(g.aggregateRating.reviewCount, 12);
  assert.equal(g.review.length, 1);
  assert.equal(g.review[0].reviewRating.ratingValue, 5);
  assert.equal(g.offers.priceValidUntil, '2026-12-31');
  assert.equal(g.offers.shippingDetails.shippingRate.value, 3000);
  assert.equal(g.offers.shippingDetails.deliveryTime.handlingTime.maxValue, 2);
  assert.equal(g.offers.hasMerchantReturnPolicy.merchantReturnDays, 7);
  assert.equal(g.offers.hasMerchantReturnPolicy.customerRemorseReturnFees.value, 3000);
  assertGraphValid(g, 'product');
});

// 2. Empties omit, never invent.
await t.test('2. missing optionals omit their nodes', async () => {
  const [g] = productGraph('https://olmoa.com', { id: 'p2', title: 't', lowest_sale_price: 1000 }, {});
  assert.equal(g.description, undefined);
  assert.equal(g.brand, undefined);
  assert.equal(g.aggregateRating, undefined);
  assert.equal(g.review, undefined);
  assert.equal(g.offers.shippingDetails, undefined);
  assert.equal(g.offers.hasMerchantReturnPolicy, undefined);
  assert.equal(g.offers.priceValidUntil, undefined);
  assert.equal(g.sku, 'p2', 'product id is the stable merchant identifier');
  const [dated] = productGraph('https://olmoa.com', { id: 'p2', title: 't' }, { priceValidUntil: '내일모레' });
  assert.equal(dated.offers.priceValidUntil, undefined, 'bad dates stay out');
  assert.equal(qaPageGraph('https://olmoa.com', 'p2', []), null);
  assert.equal(returnPolicyNode(null), null);
  assertGraphValid(g, 'bare product');
});

// 3. Client builders agree with the server reference on one fixture.
await t.test('3. live client graphs match the server reference', async () => {
  const p = {
    id: 'p1', title: '이어폰', thumbnail_url: 'https://x/img.jpg', description_html: '<p>좋은 이어폰</p>',
    lowest_sale_price: 29900, lowest_original_price: 39900, brand: 'Acme', manufacturer: 'AW', model_name: 'AW-1',
    primary_gtin: '5901234123457', review_count: 12, avg_rating: 4.8,
    skus: [{ sale_price: 29900, stock_quantity: 3 }],
    shipping_policy: SHIP,
    reviews_preview: [{ author: '김구매', rating: 5, body: '좋아요', date: '2026-11-20 10:00:00' }],
    category_slug: 'audio', category_name: '오디오'
  };
  const client = productJsonLdOf(p, 'https://olmoa.com/product/p1', { windowDays: 7 });
  const cp = client['@graph'][0];
  const [sp] = productGraph('https://olmoa.com', p, {
    shipping: SHIP, gtin: p.primary_gtin, description: '좋은 이어폰', rating: 4.8, reviewCount: 12,
    reviews: p.reviews_preview, windowDays: 7
  });
  for (const [path, label] of [
    ['name', 'name'], ['description', 'description'], ['brand.name', 'brand'], ['mpn', 'mpn'],
    ['gtin13', 'gtin'], ['offers.price', 'price'], ['offers.shippingDetails.shippingRate.value', 'shipping rate'],
    ['offers.hasMerchantReturnPolicy.merchantReturnDays', 'return days'], ['aggregateRating.reviewCount', 'review count']
  ]) {
    const get = (o) => path.split('.').reduce((a, k) => a?.[k], o);
    assert.deepEqual(get(cp), get(sp), `${label} agrees`);
  }
  assert.equal(cp.offers.hasMerchantReturnPolicy.customerRemorseReturnFees.value, 3000);
  assert.equal(cp.review.length, 1);
  const qna = [{ q: '배송?', a: '3일' }];
  assert.deepEqual(qaPageJsonLdOf('https://olmoa.com/product/p1', qna), qaPageGraph('https://olmoa.com', 'p1', qna));
  assert.deepEqual(returnPolicyNodeOf(SHIP, 7), returnPolicyNode(SHIP, 7));
  assertGraphValid({ '@context': 'https://schema.org', ...cp }, 'client product');
});

// 4. Detail serves the graph inputs live.
await t.test('4. detail carries reviews preview and the agreed GTIN', async () => {
  const g = await newGateway();
  const d = await g.call('/api/v1/products/prod_001');
  assert.equal(d.status, 200, d.text);
  assert.ok(Array.isArray(d.json.data.reviews_preview), 'reviews preview present');
  assert.ok('primary_gtin' in d.json.data, 'primary GTIN present');
  assert.ok(d.json.data.brand !== undefined && d.json.data.manufacturer !== undefined, '6-12 identifiers visible (no seller shadowing)');
});

// 5. Coupon feed lists live claimable offers only.
await t.test('5. coupon feed requires fields and live rows', async () => {
  const g = await newGateway();
  g.db.prepare("INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, expires_at, is_active, issue_method) VALUES ('cpn_dead', 'DEAD', '끝난 쿠폰', 'FIXED_AMOUNT', 1000, 0, '2020-01-01 00:00:00', 1, 'DOWNLOAD')").run();
  g.db.prepare("INSERT INTO coupons (id, code, title, discount_type, discount_value, min_order_amount, expires_at, is_active, issue_method) VALUES ('cpn_auto', 'AUTO', '자동 쿠폰', 'FIXED_AMOUNT', 1000, 0, '2099-01-01 00:00:00', 1, 'AUTO')").run();
  const r = await g.call('/api/crawl/coupons');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.updated_at, 'feed timestamped');
  assert.ok(Array.isArray(r.json.coupons) && r.json.coupons.length > 0, 'live offers listed');
  for (const c of r.json.coupons) {
    for (const k of ['code', 'title', 'discount_type', 'discount_value', 'min_order_amount', 'expires_at']) {
      assert.ok(c[k] !== undefined && c[k] !== null, `coupon requires ${k}`);
    }
    assert.ok(!['DEAD', 'AUTO'].includes(c.code), 'expired and AUTO offers excluded');
  }
});

// 6. Return-policy feed mirrors seller policies per store.
await t.test('6. return-policy feed matches policy rows', async () => {
  const g = await newGateway();
  const r = await g.call('/api/crawl/return-policies');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json['@type'], 'ItemList');
  assert.ok(r.json.itemListElement.length > 0, 'stores listed');
  for (const el of r.json.itemListElement) {
    assert.equal(el['@type'], 'ListItem');
    assert.ok(el.url.startsWith('https://olmoa.com/store/'), 'store URL real');
    assertGraphValid({ '@context': 'https://schema.org', ...el.item }, `return policy ${el.name}`);
  }
  const first = r.json.itemListElement[0];
  const row = g.db.prepare(
    `SELECT sp.return_fee FROM shipping_policies sp JOIN partners pt ON pt.id = sp.partner_id
     WHERE pt.status = 'APPROVED' AND sp.is_default = 1 AND sp.status = 'ACTIVE' ORDER BY pt.id ASC LIMIT 1`).get();
  const expectFee = Number(row.return_fee ?? 0);
  if (expectFee > 0) {
    assert.equal(first.item.customerRemorseReturnFees.value, expectFee, 'fee mirrors the policy row');
  } else {
    assert.equal(first.item.returnFees, 'https://schema.org/FreeReturn');
  }
  const custom = await createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu', ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true', PAYMENT_MODE: 'sandbox', PUBLIC_STOREFRONT_URL: 'https://olmoa.com', RETURN_WINDOW_DAYS: '14'
    }
  });
  const r2 = await custom.call('/api/crawl/return-policies');
  assert.equal(r2.json.itemListElement[0].item.merchantReturnDays, 14, 'effective window honored');
});

// 7. Red fixtures: broken graphs fail validation loudly.
await t.test('7. broken graphs fail validation', async () => {
  const cases = [
    [{ '@context': 'https://schema.org', '@type': 'Product' }, 'nameless product'],
    [{ '@context': 'https://schema.org', '@type': 'Product', name: 'x', offers: { '@type': 'Offer' } }, 'priceless offer'],
    [{ '@context': 'https://schema.org', '@type': 'QAPage', mainEntity: [] }, 'empty QAPage'],
    [{ '@context': 'https://schema.org', '@type': 'MerchantReturnPolicy' }, 'dateless policy']
  ];
  for (const [graph, label] of cases) {
    assert.throws(() => assertGraphValid(graph, label), Error, `${label} is rejected`);
  }
  assert.equal(faqGraph([]), null, 'empty FAQ stays null');
  assert.equal(qaPageJsonLdOf('https://olmoa.com/product/p1', []), null, 'empty client QAPage stays null');
});

t.finish();
