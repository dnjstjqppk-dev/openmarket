// tests/ui/cart_sections.test.mjs
// Work order 3-5: seller boxes, gauge, summary, repricing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Cart sections (3-5)');
const read = (p) => readFileSync(p, 'utf8');
const view = () => read('apps/storefront/src/views/CartView.vue');

await t.test('T51 top bar selects, deletes and clears sold-out lines', async () => {
  const v = view();
  assert.ok(v.includes('전체 선택'), 'select-all control');
  assert.ok(v.includes('removeSelected'), 'delete-selected action');
  assert.ok(v.includes('removeSoldout') && v.includes('품절 삭제'), 'sold-out purge');
  assert.ok(v.includes('stock_quantity === 0'), 'explicit stockout only');
});

await t.test('T52 seller boxes carry select, link, badge and footer math', async () => {
  const g = read('apps/storefront/src/components/cart/SellerCartGroup.vue');
  assert.ok(g.includes('전체 선택') || g.includes('상품 전체 선택'), 'group select');
  assert.ok(g.includes('/store/'), 'store link');
  assert.ok(g.includes('kind="direct"'), 'direct badge');
  assert.ok(g.includes('스토어 쿠폰 받기'), 'coupon entry');
  assert.ok(g.includes('옵션 변경'), 'option change per line');
  assert.ok(g.includes('goods_amount') && g.includes('shipping_fee'), 'goods + shipping = order footer');
  assert.ok(vIncludesQuickSheetReplace(), 'option change replaces the line');
});

function vIncludesQuickSheetReplace() {
  return read('apps/storefront/src/components/QuickOptionSheet.vue').includes('replaceSkuId');
}

await t.test('T53 gauge shows only with a threshold and states the gap', async () => {
  const v = read('apps/storefront/src/components/cart/FreeShipGauge.vue');
  assert.ok(v.includes('v-if="threshold > 0"'), 'threshold-gated');
  assert.ok(v.includes('무료배송 조건 달성'), 'achieved copy');
  assert.ok(v.includes('더 담으면 이 스토어 무료배송'), 'gap copy');
  assert.ok(v.includes('first_min='), 'spotlight link carries the gap');
  assert.ok(v.includes('role="progressbar"'), 'progress semantics');
  assert.ok(v.includes('Math.max(0, props.threshold - props.goods)'), 'at-threshold clamps to zero, never negative');
});

await t.test('T54 summary itemizes coupons, earn and a 20px total', async () => {
  const v = view();
  assert.ok(v.includes('스토어 쿠폰(예상)') && v.includes('플랫폼 쿠폰(예상)'), 'coupon estimates labelled');
  assert.ok(v.includes('/api/v1/coupons/best'), 'best-combination source');
  assert.ok(v.includes('적립 예정'), 'earn row when policy exists');
  assert.ok(v.includes('text-xl font-bold'), '20px pay total');
  assert.ok(v.includes('data-testid="cart-total"'), 'stable total selector');
  assert.ok(v.includes('예상 금액'), 'anonymous estimate label');
});

await t.test('T55 repriced lines state the old-to-new move', async () => {
  const v = view();
  assert.ok(v.includes('repriced'), 'reprice map kept');
  const g = read('apps/storefront/src/components/cart/SellerCartGroup.vue');
  assert.ok(g.includes('이전') && g.includes('→'), 'old -> new copy');
  const s = read('apps/storefront/src/stores/cart.ts');
  assert.ok(s.includes('from: it.price, to: Number(p)'), 'store reports the move');
});

await t.test('T56 6-11 cart snapshots the policy, never fee defaults', async () => {
  const s = read('apps/storefront/src/stores/cart.ts');
  assert.ok(s.includes('policyShipFee'), 'estimate uses the policy snapshot');
  assert.ok(s.includes('shipping_policy: product.shipping_policy'), 'line snapshots the policy');
  assert.ok(!s.includes('DEFAULT_SHIPPING_FEE') && !s.includes('DEFAULT_FREE_THRESHOLD'), 'no fee defaults');
  const p = read('apps/storefront/src/lib/pricing.ts');
  assert.ok(!p.includes('DEFAULT_SHIPPING_FEE') && !p.includes('DEFAULT_FREE_THRESHOLD'), 'pricing keeps no defaults');
});

t.finish();
