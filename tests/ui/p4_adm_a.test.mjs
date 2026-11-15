// tests/ui/p4_adm_a.test.mjs
// Work order 4-12..4-15: admin dashboard, partner onboarding, product
// review and categories.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Admin A (4-12..4-15)');
const read = (p) => readFileSync(p, 'utf8');

await t.test('D1 dashboard compares days, queues and charts with per-card errors', async () => {
  const v = read('apps/admin/src/views/DashboardView.vue');
  for (const s of ['오늘 결제금액', '오늘 주문 수', '오늘 신규 회원', '오늘 입점 신청', '검수 대기 상품', '미처리 클레임', '분쟁', '지급 승인 대기액', '이상거래 검토']) {
    assert.ok(v.includes(s), `card ${s} present`);
  }
  assert.ok(v.includes('deltaText') && v.includes('어제'), 'yesterday deltas shown');
  assert.ok(v.includes('입점 심사 대기') && v.includes('상품 검수 대기') && v.includes('분쟁 대기'), 'three queues shown');
  assert.ok(v.includes('30일 결제금액') && v.includes('카테고리별 매출'), 'trend charts shown');
  assert.ok((v.match(/불러오지 못함/g) || []).length >= 9, 'every card reports its own failure');
  assert.ok(!v.includes('arbitrateDispute'), 'no tribunal on the dashboard');
});

await t.test('D2 application queue filters and links to detail rulings', async () => {
  const r = read('apps/admin/src/router/index.ts');
  assert.ok(r.includes("path: '/partner-applications'") && r.includes("path: '/partner-applications/:id'"), 'list and detail routed');
  const l = read('apps/admin/src/views/partners/ApplicationListView.vue');
  assert.ok(l.includes("params.set('from'") && l.includes("params.set('brn'"), 'period and brn sent');
  const d = read('apps/admin/src/views/partners/ApplicationDetailView.vue');
  assert.ok(d.includes('심사 점검표') && d.includes('checksDone'), 'checklist gates approval');
  assert.ok(d.includes('위험등급') && d.includes('/verify'), 'risk tier saved');
  assert.ok(d.includes('/review') && d.includes('REQUEST_RESUBMIT'), 'rulings wired');
});

await t.test('D3 seller detail covers account, commission, penalties and status', async () => {
  const r = read('apps/admin/src/router/index.ts');
  assert.ok(r.includes("path: '/partners'") && r.includes("path: '/partners/:id'"), 'list and detail routed');
  const v = read('apps/admin/src/views/partners/PartnerDetailView.vue');
  assert.ok(v.includes('/payout-account') && v.includes('실명 확인 근거'), 'account approval with evidence');
  assert.ok(v.includes('/commission') && v.includes('category_rates'), 'base commission plus category exceptions');
  assert.ok(v.includes('페널티 이력') && v.includes('최근 등급'), 'penalties and grade shown');
  assert.ok(v.includes("setStatus('SUSPENDED')") && v.includes("setStatus('APPROVED')"), 'suspend and release wired');
});

await t.test('D4 review queue flags checks and templates reject reasons', async () => {
  const r = read('apps/admin/src/router/index.ts');
  assert.ok(r.includes("path: '/products/review-queue'"), 'queue routed');
  const v = read('apps/admin/src/views/products/ReviewQueueView.vue');
  assert.ok(v.includes('/review-queue'), 'queue endpoint read');
  for (const s of ['checks.images', 'checks.notice', 'banned_words', 'exaggeration', 'price_hike']) {
    assert.ok(v.includes(s), `check ${s} rendered`);
  }
  assert.ok(v.includes('REJECT_TEMPLATES'), 'reject reasons templated');
  const p = read('apps/admin/src/views/products/ProductListView.vue');
  assert.ok(p.includes("params.set('partner_id'") && p.includes("params.set('category'"), 'seller and category sent');
  assert.ok(p.includes("params.set('min_price'") && p.includes("params.set('format', 'csv')"), 'price and csv sent');
});

await t.test('D5 categories tree, tabs and forward-only fee copy', async () => {
  const v = read('apps/admin/src/views/CategoriesView.vue');
  assert.ok(v.includes('draggable') && v.includes('persistOrder'), 'drag reorder persists');
  for (const s of ['기본', '고시 템플릿', '수수료율', '금칙어']) {
    assert.ok(v.includes(s), `tab ${s} present`);
  }
  assert.ok(v.includes('신규 주문부터 적용'), 'forward-only fee disclosed');
  assert.ok(v.includes('banned_words'), 'banned words saved');
});

t.finish();
