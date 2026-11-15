// tests/ui/store_sections.test.mjs
// Work order 3-10: store header/tabs, fill section, PLP reuse, lazy reviews,
// info disclosure and the follow toggle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Store sections (3-10)');
const read = (p) => readFileSync(p, 'utf8');
const view = () => read('apps/storefront/src/views/SellerStoreView.vue');

await t.test('S1 header shows banner, logo, grade, rating, followers and actions', async () => {
  const v = view();
  assert.ok(v.includes('profile.banner_url'), 'banner from the store profile');
  assert.ok(v.includes('bg-surface-2'), 'solid fallback without a banner');
  assert.ok(v.includes('profile.logo_url'), 'logo from the store profile');
  assert.ok(v.includes('stats.grade'), 'grade badge when set');
  assert.ok(v.includes('평점') && v.includes('후기') && v.includes('팔로워'), 'rating, reviews and followers shown');
  assert.ok(v.includes('data-testid="follow-toggle"'), 'follow button hooked for E2E');
  assert.ok(v.includes('문의하기') && v.includes('to="/support"'), 'inquiry links to support');
});

await t.test('S2 four tabs carry live counts', async () => {
  const v = view();
  assert.ok(v.includes('OmStatusTabs'), 'shared status tabs reused');
  for (const [value, label] of [['home', '홈'], ['products', '전체상품'], ['reviews', '리뷰'], ['info', '스토어 정보']]) {
    assert.ok(v.includes(`value: '${value}'`) && v.includes(`label: '${label}'`), `${label} tab present`);
  }
  assert.ok(v.includes('count: stats.product_count') && v.includes('count: m.review_count'), 'product and review counts bound');
});

await t.test('S3 home shows the notice and featured products', async () => {
  const v = view();
  assert.ok(v.includes('profile.notice'), 'notice rendered when set');
  assert.ok(v.includes('featured_product_ids_json'), 'featured ids resolved');
  assert.ok(v.includes('대표 상품'), 'featured section headed');
});

await t.test('S4 all-products reuses the PLP locked to this seller', async () => {
  const v = view();
  assert.ok(v.includes('<PlpLayout :locked-partner="partnerId"'), 'PLP reused with the partner lock');
  const plp = read('apps/storefront/src/components/plp/PlpLayout.vue');
  assert.ok(plp.includes('lockedPartner'), 'PLP accepts the lock');
  assert.ok(plp.includes("params.set('partner_id', props.lockedPartner)"), 'lock reaches the server query');
});

await t.test('S5 reviews load lazily with paging and replies', async () => {
  const v = view();
  assert.ok(v.includes('/api/v1/stores/${encodeURIComponent(partnerId.value)}/reviews'), 'store reviews endpoint read');
  assert.ok(v.includes('reviewsLoaded'), 'tab loads once on first open');
  assert.ok(v.includes('리뷰 더 보기'), 'more button pages');
  assert.ok(v.includes('판매자 답글'), 'replies shown');
});

await t.test('S6 info discloses legal identity, return address and policy', async () => {
  const v = view();
  for (const f of ['company_name', 'representative_name', 'business_number', 'mail_order_reg_number', 'business_address', 'customer_service_phone', 'cs_email']) {
    assert.ok(v.includes(f), `legal field ${f} shown`);
  }
  assert.ok(v.includes('반품지') && v.includes('return_address'), 'return address shown');
  for (const f of ['배송방법', '기본 배송비', '무료배송 기준', '도서산간 추가비', '반품 배송비', '교환 배송비', '출고 소요일', '오늘출발 마감']) {
    assert.ok(v.includes(f), `policy row ${f} shown`);
  }
});

await t.test('S7 follow sends guests to login and toggles truthfully', async () => {
  const v = view();
  assert.ok(v.includes("router.push({ path: '/login'"), 'guests redirect to login');
  assert.ok(v.includes('/api/v1/stores/${encodeURIComponent(partnerId.value)}/follow'), 'toggle hits the follow endpoint');
  assert.ok(v.includes("method: store.value.following ? 'DELETE' : 'POST'"), 'state decides the method');
  assert.ok(v.includes('await load()'), 'counts re-read from the server after a toggle');
  assert.ok(v.includes('followError'), 'failures shown, never silent');
});

await t.test('S8 fill entry surfaces qualifying products first', async () => {
  const v = view();
  assert.ok(v.includes('route.query.first_min'), 'cart fill amount read');
  assert.ok(v.includes('이 상품을 담으면 무료배송'), 'fill section headed');
  assert.ok(v.includes('lowest_sale_price) >= (fillMin.value'), 'only qualifying products listed');
  assert.ok(v.includes('원 이상 상품이 없습니다'), 'honest note when nothing qualifies');
});

await t.test('S9 store view carries no native dialogs', async () => {
  assert.ok(!/\b(?:window\.)?(?:alert|confirm)\s*\(\s*['"`]/.test(view()), 'no native dialog');
});

t.finish();
