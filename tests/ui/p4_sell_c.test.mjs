// tests/ui/p4_sell_c.test.mjs
// Work order 4-7..4-11: seller promotions, qna/reviews, store settings,
// onboarding and the converted expansion shells.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Seller C (4-7..4-11)');
const read = (p) => readFileSync(p, 'utf8');

await t.test('C1 promotion routes and menu entries exist', async () => {
  const r = read('apps/partner/src/router/index.ts');
  for (const p of ['/promotions/coupons', '/promotions/flash-sales', '/promotions/exhibitions']) {
    assert.ok(r.includes(`path: '${p}'`), `route ${p} exists`);
  }
  const app = read('apps/partner/src/App.vue');
  for (const s of ['스토어 쿠폰', '번개특가 신청', '기획전 현황']) {
    assert.ok(app.includes(`label: '${s}'`), `menu ${s} exists`);
  }
});

await t.test('C2 coupon list discloses the seller burden and totals', async () => {
  const v = read('apps/partner/src/views/promotions/CouponListView.vue');
  assert.ok(v.includes('판매자 100% 부담'), 'burden disclosed');
  assert.ok(v.includes('discount_total'), 'discount total shown');
  assert.ok(v.includes('/suspend'), 'suspend wired');
  assert.ok(v.includes("discount_type") && v.includes('FIXED_AMOUNT') && v.includes('PERCENT'), 'fixed and percent offered');
});

await t.test('C3 flash-sale apply sends sku, deal and allocation', async () => {
  const v = read('apps/partner/src/views/promotions/FlashSaleApplyView.vue');
  assert.ok(v.includes('/apply'), 'apply endpoint wired');
  assert.ok(v.includes('sku_id') && v.includes('deal_price') && v.includes('allocated_stock'), 'sku, deal and allocation sent');
  assert.ok(v.includes('REQUESTED') || v.includes('심사중'), 'application state shown');
});

await t.test('C4 qna covers secret, overdue and templates', async () => {
  const v = read('apps/partner/src/views/QnaManageView.vue');
  assert.ok(v.includes('미답변') && v.includes('답변완료'), 'waiting and answered tabs');
  assert.ok(v.includes('비밀글') && v.includes('is_secret'), 'secret badge');
  assert.ok(v.includes('24시간 경과'), 'overdue highlighted');
  assert.ok(v.includes('ANSWER_TEMPLATES'), 'answer templates');
});

await t.test('C5 reviews filter by rating and photo, reply and report', async () => {
  const v = read('apps/partner/src/views/ReviewManageView.vue');
  assert.ok(v.includes('min_rating'), 'rating filter sent');
  assert.ok(v.includes('has_photo') && v.includes('포토리뷰만'), 'photo filter sent');
  assert.ok(v.includes('/reply') && v.includes('/report'), 'reply and report wired');
});

await t.test('C6 shipping templates live on their own routed screen', async () => {
  const r = read('apps/partner/src/router/index.ts');
  assert.ok(r.includes("path: '/store/shipping-policies'"), 'route exists');
  const app = read('apps/partner/src/App.vue');
  assert.ok(app.includes("label: '배송·반품 정책'"), 'menu entry exists');
  const v = read('apps/partner/src/views/ShippingPolicyView.vue');
  for (const f of ['method', 'carrier_code', 'fee_type', 'base_fee', 'free_threshold', 'qty_unit',
    'remote_surcharge', 'return_fee', 'exchange_fee', 'processing_days', 'today_cutoff',
    'origin_address', 'return_address', 'is_default', 'status']) {
    assert.ok(v.includes(f), `field ${f} managed`);
  }
  assert.ok(v.includes('/api/v1/partner/shipping-policies'), 'server CRUD wired');
  const prof = read('apps/partner/src/views/ProfileManageView.vue');
  assert.ok(prof.includes('/store/shipping-policies'), 'profile links to the screen');
  assert.ok(!prof.includes('openPolicy('), 'no duplicate template editor in profile');
});

await t.test('C7 store decor covers logo, banner, copy and featured picks', async () => {
  const v = read('apps/partner/src/views/StoreProfileView.vue');
  assert.ok(v.includes('logo_url') && v.includes('banner_url'), 'logo and banner saved');
  assert.ok(v.includes('1920×400'), 'banner size guided');
  assert.ok(v.includes('maxlength="1000"') && v.includes('maxlength="2000"'), 'intro and notice capped');
  assert.ok(v.includes('featured_product_ids') && v.includes('< 8'), 'featured picks capped at 8');
});

await t.test('C8 onboarding shows steps, reasons and resubmission', async () => {
  const a = read('apps/partner/src/views/ApplyView.vue');
  for (const s of ['사업자', '대표자·통신판매업', '정산계좌', '서류', '약관', '제출']) {
    assert.ok(a.includes(s), `apply step ${s} shown`);
  }
  const v = read('apps/partner/src/views/ApplicationView.vue');
  assert.ok(v.includes('입점 진행 단계'), 'progress steps shown');
  assert.ok(v.includes('심사 의견') && v.includes('review_note'), 'review reason shown');
  assert.ok(v.includes('다시 올리기') && v.includes('심사 요청하기'), 'resubmission offered');
});

await t.test('C9 expansion shells stay converted and honest', async () => {
  const mc = read('apps/partner/src/views/MultiChannelListingView.vue');
  assert.ok(mc.includes('시뮬레이션'), 'simulation disclosed');
  assert.ok(mc.includes('실연동'), 'live channels labelled when present');
  const url = read('apps/partner/src/views/UrlImportView.vue');
  assert.ok(url.includes('AI 한국어 자동 번역'), 'translation-only label kept');
  assert.ok(!url.includes('마케팅 가공'), 'no marketing-rewrite claim remains');
  for (const f of ['BiddingView', 'BulkUploadView', 'UrlImportView', 'MultiChannelListingView']) {
    const src = read(`apps/partner/src/views/${f}.vue`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), `${f} has no hex literals`);
    assert.ok(!/\b(?:alert|confirm|prompt)\s*\(/.test(src), `${f} has no native dialogs`);
  }
});

t.finish();
