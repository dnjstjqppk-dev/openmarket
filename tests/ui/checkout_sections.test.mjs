// tests/ui/checkout_sections.test.mjs
// Work order 3-6: order sheet zones, coupons, scheduled date, memo screen.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Checkout sections (3-6)');
const read = (p) => readFileSync(p, 'utf8');
const view = () => read('apps/storefront/src/views/CheckoutView.vue');

await t.test('O61 orderer reads from the account, memo presets scan clean', async () => {
  const v = view();
  assert.ok(v.includes('/api/v1/auth/me'), 'orderer fetched');
  assert.ok(v.includes('주문자'), 'orderer section headed');
  assert.ok(v.includes('MEMO_PRESETS') && v.includes('직접 입력'), 'memo presets plus direct input');
  assert.ok(v.includes('MEMO_FORBIDDEN') && v.includes('memo-guard.js'), 'client list linked to the server guard');
  assert.ok(v.includes('배송 메모에 사용할 수 없는 표현'), 'memo abuse blocks submit');
});

await t.test('O62 seller coupon modals default from the best combination', async () => {
  const v = view();
  assert.ok(v.includes('SellerCouponModal'), 'per-seller modal mounted');
  assert.ok(v.includes('/api/v1/coupons/best'), 'best combination fetched');
  assert.ok(v.includes('platformPick') && v.includes('storePicks'), 'platform + per-seller picks held');
  assert.ok(v.includes('store_coupon_ids'), 'store picks quoted and ordered');
  const m = read('apps/storefront/src/components/checkout/SellerCouponModal.vue');
  assert.ok(m.includes('사용 안 함'), 'explicit no-coupon choice');
});

await t.test('O63 credits, earn preview and scheduled date ride along', async () => {
  const v = view();
  assert.ok(v.includes('use_credit_amount') || v.includes('creditAmount'), 'credits quoted');
  assert.ok(v.includes('projected_credit_amount'), 'earn preview shown');
  assert.ok(v.includes('requested_delivery_date'), 'scheduled date ordered');
  assert.ok(v.includes('수령 희망일은 내일 이후여야 합니다'), 'date window enforced client-side');
});

await t.test('O64 two consents gate payment', async () => {
  const v = view();
  assert.ok(v.includes('agreeOrder') && v.includes('agreePay'), 'two consents held');
  assert.ok(v.includes('!agreeOrder.value || !agreePay.value'), 'both required to pay');
});

t.finish();
