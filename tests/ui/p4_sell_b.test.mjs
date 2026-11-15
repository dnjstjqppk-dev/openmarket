// tests/ui/p4_sell_b.test.mjs
// Work order 4-4..4-6: seller shipments, claims, settlement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Seller B (4-4..4-6)');
const read = (p) => readFileSync(p, 'utf8');
const ship = () => read('apps/partner/src/views/ShipmentView.vue');

await t.test('B1 shipment tabs map to server statuses with deep links', async () => {
  const v = ship();
  for (const [key, status] of [['new', 'PAYMENT_CONFIRMED'], ['confirmed', 'PREPARING'], ['waiting', 'PREPARING'], ['shipping', 'SHIPPED,IN_TRANSIT'], ['delivered', 'DELIVERED'], ['done', 'PURCHASE_CONFIRMED']]) {
    assert.ok(v.includes(`value: '${key}'`) && v.includes(status), `tab ${key} filters ${status}`);
  }
  assert.ok(v.includes('route.query.tab'), 'tab deep-linkable');
  assert.ok(v.includes('due_before'), 'waiting tab uses the due filter');
});

await t.test('B2 shipment search covers keyword, dates and carrier', async () => {
  const v = ship();
  assert.ok(v.includes("params.set('q'") && v.includes("params.set('from'") && v.includes("params.set('to'"), 'keyword and dates sent');
  assert.ok(v.includes("params.set('date_field'") && v.includes("params.set('carrier'"), 'field and carrier sent');
  assert.ok(v.includes('/contact?reason='), 'reveal carries a reason');
  assert.ok(v.includes('감사 로그'), 'logging disclosed');
});

await t.test('B3 shipment confirms, ships and delays loudly', async () => {
  const v = ship();
  assert.ok(v.includes('/orders/confirm'), 'bulk confirm wired');
  assert.ok(v.includes('bulk-shipment'), 'bulk shipment wired');
  assert.ok(v.includes('/logistics/carriers'), 'carriers come from the server');
  assert.ok(v.includes('6,40'), 'tracking format enforced');
  assert.ok(v.includes('maxlength="500"'), 'delay reason capped');
  assert.ok(v.includes('csvCell('), 'CSV escapes cells');
});

await t.test('B4 three claim screens split cancel, return and exchange', async () => {
  const r = read('apps/partner/src/router/index.ts');
  for (const p of ['/claims/cancel', '/claims/return', '/claims/exchange']) {
    assert.ok(r.includes(`path: '${p}'`), `route ${p} exists`);
  }
  assert.ok(r.includes("path: '/returns', redirect: '/claims/return'"), 'legacy returns redirects');
  const ret = read('apps/partner/src/views/claims/ReturnListView.vue');
  assert.ok(ret.includes('/pickup') && ret.includes('/inspect'), 'pickup and inspection wired');
  assert.ok(ret.includes('returnless'), 'returnless option present');
  const exc = read('apps/partner/src/views/claims/ExchangeListView.vue');
  assert.ok(exc.includes('/reship') && exc.includes('AWAITING_RESHIPMENT'), 'reship flow wired');
  const can = read('apps/partner/src/views/claims/CancelListView.vue');
  assert.ok(can.includes('자동 처리'), 'instant-cancel design disclosed');
});

await t.test('B5 settlement overview, deposits and payout modal', async () => {
  const v = read('apps/partner/src/views/settlements/SettlementOverviewView.vue');
  assert.ok(v.includes('/api/v1/partner/settlements'), 'statement read');
  assert.ok(v.includes('PayoutRequestModal'), 'payout modal composed');
  assert.ok(v.includes('/api/v1/partner/tax-invoices'), 'tax invoices read');
  assert.ok(v.includes('출금 신청제'), 'on-request payout disclosed');
  const d = read('apps/partner/src/views/settlements/WithdrawableDepositsView.vue');
  assert.ok(d.includes('ELIGIBLE_FOR_PAYOUT'), 'deposits filter eligible');
  assert.ok(d.includes('next_reserve_release'), 'release date shown');
  const m = read('apps/partner/src/components/settlement/PayoutRequestModal.vue');
  assert.ok(m.includes('X-Idempotency-Key'), 'payout idempotent');
  assert.ok(m.includes('accountVerified'), 'unverified accounts gated');
});

t.finish();
