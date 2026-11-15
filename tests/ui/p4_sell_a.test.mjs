// tests/ui/p4_sell_a.test.mjs
// Work order 4-1..4-3: seller dashboard, product list, product edit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Seller A (4-1..4-3)');
const read = (p) => readFileSync(p, 'utf8');
const dash = () => read('apps/partner/src/views/DashboardView.vue');
const list = () => read('apps/partner/src/views/products/ProductListView.vue');
const edit = () => read('apps/partner/src/views/products/ProductEditView.vue');

await t.test('A1 dashboard shows the eight pipeline KPIs with list links', async () => {
  const v = dash();
  for (const f of ['new_orders', 'preparing', 'in_transit', 'cancel_requests', 'return_requests', 'exchange_requests', 'unanswered_qna', 'settlement']) {
    assert.ok(v.includes(f), `KPI binds ${f}`);
  }
  assert.equal((v.match(/OmKpiCard/g) || []).length >= 9, true, 'eight KPI cards rendered');
  for (const to of ['/shipments?tab=new', '/shipments?tab=waiting', '/shipments?tab=shipping', '/claims/cancel', '/claims/return', '/claims/exchange', '/qna?status=WAITING', '/settlements']) {
    assert.ok(v.includes(to), `card links ${to}`);
  }
  assert.ok(v.includes('/api/v1/partner/dashboard/pipeline'), 'counts come from the pipeline API');
});

await t.test('A2 dashboard trends 7/30 days with prior-period deltas', async () => {
  const v = dash();
  assert.ok(v.includes('weekly_gmv') && v.includes('monthly_gmv'), 'both series bound');
  assert.ok(v.includes('wow_pct') && v.includes('mom_pct'), 'both deltas bound');
  assert.ok(v.includes('7일') && v.includes('30일'), 'range toggle present');
  assert.ok(v.includes('ship_on_time_rate') && v.includes('avg_delivery_days') && v.includes('claim_rate_pct'), 'ops gauges bound');
  assert.ok(v.includes('penalty_count') && v.includes('grade_code'), 'penalty and grade bound');
});

await t.test('A3 dashboard lists due shipments and stale Q&A', async () => {
  const v = dash();
  assert.ok(v.includes('status=PAYMENT_CONFIRMED') && v.includes('status=PREPARING'), 'unshipped orders fetched');
  assert.ok(v.includes('ship_by_deadline'), 'sorted by the ship-by deadline');
  assert.ok(v.includes('/api/v1/partner/qna'), 'qna fetched');
  assert.ok(v.includes('24 * 3600 * 1000') || v.includes('86400000'), '24h overdue rule');
});

await t.test('A4 product list tabs, filters and server paging', async () => {
  const v = list();
  for (const s of ['ALL', 'ACTIVE', 'SOLDOUT', 'PENDING', 'REJECTED', 'HIDDEN']) {
    assert.ok(v.includes(`'${s}'`) || v.includes(`"${s}"`), `status tab ${s}`);
  }
  assert.ok(v.includes('stock_min') && v.includes('stock_max'), 'stock range filters');
  assert.ok(v.includes('per_page'), 'server paging requested');
  assert.ok(v.includes('OmDataTable'), 'shared table reused');
  assert.ok(v.includes('stock_sum'), 'summed stock shown');
});

await t.test('A5 product list edits, clones, suspends and exports', async () => {
  const v = list();
  assert.ok(v.includes('/products/${row.id}/edit') || v.includes('/products/new'), 'edit routes wired');
  assert.ok(v.includes('복제'), 'clone action present');
  assert.ok(v.includes('bulk-update') && v.includes('HIDDEN') && v.includes('ACTIVE'), 'suspend/resume through bulk-update');
  assert.ok(v.includes('price') && v.includes('stock_quantity'), 'price and stock bulk ops');
  assert.ok(v.includes('text/csv'), 'CSV export offered');
  assert.ok(v.includes('OmBulkActionBar'), 'shared bulk bar reused');
});

await t.test('A6 product edit covers basics, media, notice, KC, options and SKUs', async () => {
  const v = edit();
  assert.ok(v.includes('ProductImageUploader') && v.includes('OptionMatrixEditor') && v.includes('SkuTableEditor'), 'form components composed');
  assert.ok(v.includes('notice_rows') && v.includes('kc_cert_number'), 'notice and KC fields present');
  assert.ok(v.includes('/products/new') || v.includes("route.path.endsWith('/new')"), 'new/edit modes split');
  assert.ok(v.includes('DRAFT + PENDING'), 'review landing state stated');
  assert.ok(v.includes('작성 완성도'), 'quality meter present');
});

await t.test('A7 option matrix enforces kind, value and combo caps', async () => {
  const v = read('apps/partner/src/components/product-form/OptionMatrixEditor.vue');
  assert.ok(v.includes('>= 3') || v.includes('length >= 3'), 'kinds capped at 3');
  assert.ok(v.includes('100'), 'values capped at 100');
  assert.ok(v.includes('200'), 'combos capped at 200');
});

await t.test('A8 uploader posts raw FormData to own storage', async () => {
  const v = read('apps/partner/src/components/product-form/ProductImageUploader.vue');
  assert.ok(v.includes('new FormData()'), 'raw FormData posted');
  assert.ok(v.includes('getPartnerAuthHeaders()'), 'auth headers without JSON content type');
  assert.ok(v.includes('/api/v1/storage/upload'), 'storage endpoint used');
});

t.finish();
