// tests/ui/detail_sections.test.mjs
// Work order 3-4: product detail layout, buy panel, options, highlights.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Detail sections (3-4)');
const read = (p) => readFileSync(p, 'utf8');
const view = () => read('apps/storefront/src/views/ProductDetailView.vue');
const panel = () => read('apps/storefront/src/components/product/BuyPanel.vue');

await t.test('D41 seven-five split with gallery, strip, sticky tabs and sections', async () => {
  const v = view();
  assert.ok(v.includes('lg:grid-cols-[7fr_5fr]'), '7:5 desktop split');
  assert.ok(v.includes('OmImageGallery'), 'gallery reused');
  assert.ok(v.includes('photos_only=true&per_page=8'), 'photo strip from photo reviews');
  assert.ok(v.includes('OmStickyTabs'), 'sticky section tabs');
  for (const id of ['sec-info', 'sec-reviews', 'sec-qna', 'sec-shipping']) {
    assert.ok(v.includes(`id="${id}"`), `section ${id} anchored`);
  }
  assert.ok(v.includes('max-h-[1200px]'), 'description folds at 1200px');
});

await t.test('D42 buy panel orders store, price, coupon, benefits and seller', async () => {
  const v = panel();
  const order = ['/store/', 'text-3xl', 'coupon-open', '출고 예정', '수량 할인', '적립 예정', 'OmSellerCard'];
  let at = -1;
  for (const s of order) {
    const i = v.indexOf(s, at + 1);
    assert.ok(i > at, `${s} follows in panel order`);
    at = i;
  }
  assert.ok(v.includes('surgeHidden'), 'fake-discount guard gates the rate');
  assert.ok(v.includes("locale.t('addToCart')") && v.includes("locale.t('buyNow')"), 'cart and buy-now actions');
});

await t.test('D43 stepped options add lines and duplicates bump quantity', async () => {
  const v = read('apps/storefront/src/components/product/useBuySelection.ts');
  assert.ok(v.includes('stepUnlocked'), 'sequential unlocking');
  assert.ok(v.includes('valueExtra'), 'per-value surcharge');
  assert.ok(v.includes('qty + 1') || v.includes('line.qty + 1'), 'duplicate combos bump quantity');
  assert.ok(v.includes('PRICE_SURGE_LOOKBACK_DAYS = 20'), '20-day lookback named');
  assert.ok(v.includes('restock-subscriptions'), 'sold-out lines offer restock alerts');
  const l = read('apps/storefront/src/components/product/SelectedOptionList.vue');
  assert.ok(l.includes('재입고 알림 받기'), 'restock button on sold-out lines');
});

await t.test('D44 notice follows template order with reference fallback', async () => {
  const v = view();
  assert.ok(v.includes('notice_template'), 'template order used');
  assert.ok(v.includes('상세페이지 참조'), 'blank items fall back');
});

await t.test('D45 shipping table reads the template, highlights read the summary', async () => {
  const v = view();
  for (const k of ['배송방법', '도서산간 추가비', '출고 소요일', '반품지', '청약철회 제한']) {
    assert.ok(v.includes(k), `shipping row ${k}`);
  }
  assert.ok(v.includes('ReviewHighlights'), 'server highlights above reviews');
  const h = read('apps/storefront/src/components/product/ReviewHighlights.vue');
  assert.ok(h.includes('distribution') && h.includes('photo_count') && h.includes('fit'), 'summary fields rendered');
});

await t.test('D46 mobile bar opens the shared-state buy sheet', async () => {
  const v = view();
  assert.ok(v.includes('data-testid="mobile-buy"'), 'mobile buy entry');
  assert.ok(v.includes('MobileBuySheet'), 'sheet mounted');
  const m = read('apps/storefront/src/components/product/MobileBuySheet.vue');
  assert.ok(m.includes('OmBottomSheet'), 'bottom-sheet surface');
  assert.ok(m.includes('SelectedOptionList'), 'shared lines reused');
});

await t.test('D47 6-11 buy panel and PLP render the server shipping text', async () => {
  const b = read('apps/storefront/src/components/product/BuyPanel.vue');
  assert.ok(b.includes('product?.shipping_text'), 'detail shows the server string');
  assert.ok(!b.includes('base_shipping_fee'), 'no seller-fee fallback');
  const p = read('apps/storefront/src/components/plp/PlpLayout.vue');
  assert.ok(p.includes('p.shipping_text'), 'cards show the server string');
  const c = read('apps/storefront/src/views/CheckoutView.vue');
  assert.ok(c.includes('shipping_groups'), 'order sheet shows quote group texts');
});

await t.test('D48 6-1 detail renders the shared brief blocks', async () => {
  const v = view();
  assert.ok(v.includes('product.brief'), 'brief bound from the detail API');
  assert.ok(v.includes('OmKeyTakeaways') && v.includes('핵심 정보'), 'key facts block');
  assert.ok(v.includes('OmSpecTable') && v.includes('product.brief.specs'), 'spec table block');
  assert.ok(v.includes('<OmFaq') && v.includes('product.brief.qna'), 'Q&A summary block');
});

await t.test('D49 6-3 detail injects product and QAPage graphs from live rows', async () => {
  const v = view();
  assert.ok(v.includes('olmoa-jsonld-qa') && v.includes('qaPageJsonLdOf'), 'QAPage injected from brief Q&A');
  assert.ok(v.includes('RETURN_WINDOW_DAYS'), 'return window from the pinned policy module');
  const lib = read('apps/storefront/src/lib/productSeo.ts');
  assert.ok(lib.includes('hasMerchantReturnPolicy') && lib.includes('returnPolicyNodeOf'), 'Offer carries the return policy');
  assert.ok(lib.includes('primary_gtin'), 'GTIN from the agreed SKU value');
  assert.ok(lib.includes('reviews_preview'), 'Review nodes from live previews');
  assert.ok(lib.includes('storeJsonLdOf'), 'store graph builder present');
  const s = read('apps/storefront/src/views/SellerStoreView.vue');
  assert.ok(s.includes('olmoa-jsonld-store') && s.includes('storeJsonLdOf'), 'store page injects its graph');
});

await t.test('D50 6-4 detail renders the server key-facts table', async () => {
  const v = view();
  assert.ok(v.includes('product.key_facts_html'), 'shared markup injected verbatim');
  assert.ok(v.includes('핵심 정보'), 'answer table headed');
});

t.finish();
