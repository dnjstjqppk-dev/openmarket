// tests/ui/order_sections.test.mjs
// Work order 3-8: order list tabs/paging/cards plus detail locked options,
// scheduled dates, claim pickup/photos, and the pre-change cancel confirm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Order sections (3-8)');
const read = (p) => readFileSync(p, 'utf8');
const list = () => read('apps/storefront/src/views/OrdersView.vue');
const detail = () => read('apps/storefront/src/views/OrderDetailView.vue');

await t.test('T61 list has upcoming/purchasing/completed tabs off sub-order state', async () => {
  const v = list();
  assert.ok(v.includes('예정') && v.includes('구매중') && v.includes('완료'), 'three phase tabs');
  assert.ok(v.includes('role="tablist"'), 'tab semantics');
  assert.ok(v.includes('PAYMENT_PENDING') && v.includes('PURCHASE_CONFIRMED'), 'phases derive from sub-order status');
  assert.ok(!v.includes('vendor') && !v.includes('nickname'), 'no partner-style search on the buyer list');
});

await t.test('T62 list pages 20 at a time with a 20-more button', async () => {
  const v = list();
  assert.ok(v.includes('per_page=20'), '20 per request');
  assert.ok(v.includes('더보기 (20개씩)'), 'more button states the step');
  assert.ok(v.includes('total_pages'), 'server page count drives the button');
});

await t.test('T63 one card per order with image rows, links, tracking and repurchase', async () => {
  const v = list();
  assert.ok(v.includes('v-for="order in filteredOrders"'), 'one card per order');
  assert.ok(v.includes('OmImage') && v.includes('item.thumbnail_url'), 'image per item row');
  assert.ok(v.includes('/product/${item.product_id}'), 'title links to the product page');
  assert.ok(v.includes('배송추적'), 'tracking link per tracked item');
  assert.ok(v.includes('SAME_OPTIONS') && v.includes('cart.addItem'), 'repurchase re-adds the same options via the cart store');
  assert.ok(v.includes("router.push('/cart')"), 'repurchase lands on the cart');
});

await t.test('T64 list cancel is neutral and unpaid-only', async () => {
  const v = list();
  const btn = v.split('주문 취소')[0].split('<button').pop();
  assert.ok(!/red|rose|E60023|danger/i.test(btn), 'cancel button carries no warning color');
  assert.ok(v.includes('v-if="allUnpaid(order)"'), 'cancel shows only when every sub-order is unpaid');
});

await t.test('T65 detail locks options and shows the scheduled arrival', async () => {
  const v = detail();
  assert.ok(v.includes('data-testid="locked-options"') && v.includes('주문 후 변경 불가'), 'options render read-only with a locked marker');
  assert.ok(!v.includes('옵션 변경'), 'no option editing on a placed order');
  assert.ok(v.includes('data-testid="scheduled-arrival"') && v.includes('estimated_delivery_date'), 'scheduled arrival date per shipment');
});

await t.test('T66 claim form takes a scheduled pickup day and storage photos', async () => {
  const v = detail();
  assert.ok(v.includes('data-testid="claim-pickup-date"') && v.includes('type="date"'), 'scheduled pickup date input');
  assert.ok(v.includes(':min="pickupMin"') && v.includes(':max="pickupMax"'), 'pickup window bounded to tomorrow..+3d');
  assert.ok(v.includes('data-testid="claim-photo-input"') && v.includes('/api/v1/storage/upload'), 'photo upload through storage');
  assert.ok(v.includes('pickup_date:') && v.includes('photos:'), 'claim submit sends pickup date and photos');
});

await t.test('T67 cancel confirm is dangerous and shows the pre-change amount', async () => {
  const v = detail();
  const seg = v.split('async function handleCancelOrder')[1].split('async function handleCancelQty')[0];
  assert.ok(seg.includes('danger: true'), 'danger flag');
  assert.ok(seg.includes('amounts:'), 'bold pre-change amount');
  assert.ok(seg.includes('/cancel'), 'confirms before the cancel call');
});

await t.test('T68 no SNS share on order screens', async () => {
  for (const [name, v] of [['list', list()], ['detail', detail()]]) {
    assert.ok(!/kakao|kakaotalk|공유하기|친구에게 보내기/i.test(v), `${name} has no SNS share entry`);
  }
});

t.finish();
