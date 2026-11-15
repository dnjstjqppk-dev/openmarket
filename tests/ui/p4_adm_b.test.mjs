// tests/ui/p4_adm_b.test.mjs
// Work order 4-16..4-19: admin orders, disputes, finance, marketing, coupons.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Admin B (4-16..4-19)');
const read = (p) => readFileSync(p, 'utf8');

await t.test('E1 order list filters, pages and exports; detail bundles history', async () => {
  const r = read('apps/admin/src/router/index.ts');
  assert.ok(r.includes("path: '/orders'") && r.includes("path: '/orders/:id'"), 'list and detail routed');
  const l = read('apps/admin/src/views/orders/OrderListView.vue');
  assert.ok(l.includes("params.set('status'") && l.includes("params.set('q'"), 'status and keyword sent');
  assert.ok(l.includes("params.set('format', 'csv')"), 'csv export wired');
  const d = read('apps/admin/src/views/orders/OrderDetailView.vue');
  for (const s of ['sub_orders', 'payments', 'refunds', 'journal', 'settlement']) {
    assert.ok(d.includes(s), `detail shows ${s}`);
  }
  assert.ok(d.includes('pickedLines()') && d.includes('전액 환불'), 'partial and full refunds offered');
});

await t.test('E2 dispute tribunal rules three ways with confirmed amounts', async () => {
  const r = read('apps/admin/src/router/index.ts');
  assert.ok(r.includes("path: '/claims'"), 'claims routed');
  const v = read('apps/admin/src/views/claims/ClaimListView.vue');
  assert.ok(v.includes('구매자 환불') && v.includes('판매자 부담') && v.includes('분담'), 'three rulings offered');
  assert.ok(v.includes('returnless') && v.includes('lines'), 'seller-borne and split wired');
  assert.ok(v.includes('amounts:') && v.includes('danger: true'), 'money confirms carry amounts');
});

await t.test('E3 finance splits batches, payouts, policies and ledger views', async () => {
  const r = read('apps/admin/src/router/index.ts');
  for (const p of ['/finance/batches', '/finance/payout-requests', '/finance/policies', '/reconciliation']) {
    assert.ok(r.includes(`path: '${p}'`), `route ${p} exists`);
  }
  const b = read('apps/admin/src/views/finance/SettlementBatchView.vue');
  assert.ok(b.includes('settlement_cycle'), 'batches group by payout cycle');
  assert.ok(b.includes('/finance/payouts') && b.includes('amounts:'), 'confirmation pays per seller');
  const p = read('apps/admin/src/views/finance/PayoutApprovalView.vue');
  assert.ok(p.includes('APPROVE') && p.includes('REJECT') && p.includes('TRANSFER'), 'request lifecycle wired');
  assert.ok(p.includes('X-Idempotency-Key'), 'decisions carry idempotency keys');
  const y = read('apps/admin/src/views/finance/PolicyView.vue');
  assert.ok(y.includes('/platform-policies/history'), 'change history shown');
  assert.ok(y.includes('소급'), 'no-retroactivity disclosed');
});

await t.test('E4 marketing splits into four routed screens', async () => {
  const r = read('apps/admin/src/router/index.ts');
  for (const p of ['/marketing/banners', '/marketing/exhibitions', '/marketing/flash-sales', '/marketing/notifications']) {
    assert.ok(r.includes(`path: '${p}'`), `route ${p} exists`);
  }
  const b = read('apps/admin/src/views/marketing/BannerView.vue');
  assert.ok(b.includes('position') && b.includes('starts_at'), 'placement and window managed');
  assert.ok(b.includes('밝게') && b.includes('어둡게'), 'light/dark preview offered');
  assert.ok(!b.includes('bg_gradient'), 'legacy color field gone from the form');
  const f = read('apps/admin/src/views/marketing/FlashSaleView.vue');
  assert.ok(f.includes('decision') && f.includes('소진'), 'application review and sell-through shown');
  const n = read('apps/admin/src/views/marketing/NotificationSendView.vue');
  assert.ok(n.includes('미리보기') && n.includes('askConfirm'), 'preview and confirmation present');
});

await t.test('E5 coupon console covers platform issue and seller oversight', async () => {
  const v = read('apps/admin/src/views/CouponsView.vue');
  assert.ok(v.includes('platform_share_bps'), 'burden split set');
  assert.ok(v.includes('중복'), 'duplication rule disclosed');
  assert.ok(v.includes('SELLER') && v.includes('/suspend'), 'seller coupons overseen');
  assert.ok(v.includes('platform_seller_share'), 'split performance shown');
});

t.finish();
