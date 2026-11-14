// tests/ui/plp_sections.test.mjs
// Work order 3-2: shared PLP layout, filters, URL roundtrip, zero state.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('PLP sections (3-2)');
const read = (p) => readFileSync(p, 'utf8');
const plp = () => read('apps/storefront/src/components/plp/PlpLayout.vue');

await t.test('P31 layout hosts sidebar, sheet, chips, sort, view and infinite grid', async () => {
  const v = plp();
  assert.ok(v.includes('OmFilterPanel'), 'shared filter panel reused');
  assert.ok(v.includes("mode=\"sheet\""), 'mobile sheet instance');
  assert.ok(v.includes('OmFilterChips'), 'applied chips row');
  assert.ok(v.includes('OmViewToggle'), 'grid/list switch');
  assert.ok(v.includes('OmBreadcrumb'), 'breadcrumb trail');
  assert.ok(v.includes('IntersectionObserver'), 'infinite scroll observer');
  assert.ok(v.includes('per_page'), 'page-based fetching');
  assert.ok(!v.includes('limit=200') && !v.includes('LIMIT = 200'), '200 cap gone');
});

await t.test('P32 seven server sorts with no client ordering', async () => {
  const v = plp();
  for (const s of ['recommend', 'popular', 'newest', 'price_asc', 'price_desc', 'reviews', 'rating']) {
    assert.ok(v.includes(`'${s}'`), `sort ${s} offered`);
  }
  assert.ok(!v.includes('.sort((a, b)'), 'no client-side ordering');
});

await t.test('P33 filters cover tree, price, brand, benefits, shipping, seller and rating', async () => {
  const v = plp();
  assert.ok(v.includes('treeNodes'), 'category tree fed');
  assert.ok(v.includes('priceBounds'), 'price bounds fed');
  assert.ok(v.includes('brandGroup'), 'brand group fed');
  for (const k of ['free_shipping', 'coupon_eligible', 'has_discount', 'today_shipment', 'exclude_overseas', 'rating4']) {
    assert.ok(v.includes(k), `toggle ${k} wired`);
  }
  assert.ok(v.includes('DIRECT') && v.includes('MARKETPLACE'), 'seller types wired');
  assert.ok(v.includes('searchable: true'), 'brand search enabled');
});

await t.test('P34 filters, sort and view roundtrip through the URL', async () => {
  const v = plp();
  assert.ok(v.includes('router.replace'), 'URL mirrors state');
  for (const k of ['category:', 'brand:', 'min_price:', 'max_price:', 'sort:', 'view:', 'min_rating:']) {
    assert.ok(v.includes(k), `URL carries ${k}`);
  }
  assert.ok(v.includes('sessionStorage'), 'scroll position persisted for back-navigation');
});

await t.test('P35 list rows show thumb, price, badges, seller and shipping', async () => {
  const v = plp();
  assert.ok(v.includes('h-40 w-40'), '160px thumbnails');
  assert.ok(v.includes('OmPrice'), 'shared price display');
  assert.ok(v.includes('partner_name'), 'seller shown');
  assert.ok(v.includes('shippingText'), 'shipping guidance shown');
});

await t.test('P36 zero state stays honest with suggestions and popular fill', async () => {
  const v = plp();
  assert.ok(v.includes('autocomplete'), 'synonym suggestions fetched');
  assert.ok(v.includes('sort=popular&per_page=8'), 'popular fill fetched');
  const s = read('apps/storefront/src/views/SearchView.vue');
  assert.ok(s.includes('<OmEmptyState'), 'search keeps the shared empty state');
  assert.ok(!s.split('<OmEmptyState')[1].split('</OmEmptyState>')[0].includes('등록'), 'no registration prompt');
});

t.finish();
