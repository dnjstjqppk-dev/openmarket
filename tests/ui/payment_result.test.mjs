// tests/ui/payment_result.test.mjs
// Work order 3-7: receipt page, card masking, URL cleanup, fail links.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Payment result (3-7)');
const read = (p) => readFileSync(p, 'utf8');
const view = () => read('apps/storefront/src/views/PaymentResultView.vue');

await t.test('R71 receipt shows orderer, address, items and payment facts', async () => {
  const v = view();
  assert.ok(v.includes('주문·배송 정보') && v.includes('주문 상품') && v.includes('결제 정보'), 'three receipt sections');
  assert.ok(v.includes('receipt.recipient_name') && v.includes('receipt.shipping_memo'), 'recipient facts rendered');
  assert.ok(v.includes('receipt.sub_orders'), 'per-seller lines rendered');
  assert.ok(v.includes('receipt.payment_card') && v.includes('data-testid="pay-card"'), 'masked card rendered');
  assert.ok(v.includes('receipt.paid_at'), 'payment time rendered');
  assert.ok(!v.includes('setTimeout(() => router.replace(`/orders/'), 'no auto-redirect off the receipt');
});

await t.test('R72 address bar is cleaned and orders sort latest-first', async () => {
  const v = view();
  assert.ok(v.includes('history.replaceState'), 'PG params dropped after confirm');
  const ord = read('apps/cloudflare-gateway/src/routes/orders.js');
  assert.ok(ord.includes('ORDER BY created_at DESC, order_no DESC'), 'latest-first listing with stable ties');
});

await t.test('R73 fail keeps the reason, retry and order links', async () => {
  const v = view();
  assert.ok(v.includes('결제하지 못했습니다'), 'fail headline kept');
  assert.ok(v.includes('data-testid="retry-payment"'), 'retry kept');
  assert.ok(v.includes('주문 내역'), 'order-list fallback kept');
});

await t.test('R74 receipt buttons are home, detail and continue only', async () => {
  const v = view();
  assert.ok(v.includes('스토어 홈') && v.includes('주문 상세 보기') && v.includes('쇼핑 계속하기'), 'three buttons');
  assert.ok(!v.toLowerCase().includes('sns') && !v.includes('공유하기'), 'no share buttons on the receipt');
});

t.finish();
