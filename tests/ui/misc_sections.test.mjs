// tests/ui/misc_sections.test.mjs
// Work order 3-11: lightning/best/coupons/support/legal/auth buyer screens.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Misc sections (3-11)');
const read = (p) => readFileSync(p, 'utf8');
const view = (f) => read(`apps/storefront/src/views/${f}`);

await t.test('L1 lightning shows countdown, next round and measured sell-through', async () => {
  const v = view('LightningDealsView.vue');
  assert.ok(v.includes('OmCountdown') && v.includes(':ends-at="endsAtMs"'), 'hero counts to the live end');
  assert.ok(v.includes('next_campaign') && v.includes('다음 회차'), 'next round previewed when scheduled');
  assert.ok(v.includes('OmProgress') && v.includes(':allocated="d.allocated_stock"'), 'sell-through bars bound');
  assert.ok(v.includes('Number(d.allocated_stock) > 0'), 'figures show only with a measured allocation');
  assert.ok(v.includes('개 남음') && v.includes('소진됨'), 'remaining or sold-out stated');
});

await t.test('L2 best ranks day/week/month windows per category', async () => {
  const v = view('BestSellersView.vue');
  assert.ok(v.includes("value: 'day'") && v.includes("value: 'week'") && v.includes("value: 'month'"), 'three period tabs');
  assert.ok(v.includes('period: period.value') || v.includes("period: period"), 'period reaches the server query');
  assert.ok(v.includes('catalog.roots') || v.includes('categoryTabs'), 'category tabs from the catalog');
  assert.ok(v.includes('Number(p.period_sales) > 0'), 'only window sales rank');
  assert.ok(v.includes(':rank="i + 1"'), 'rank ribbons kept');
});

await t.test('L3 coupon wallet tabs holdings and states every card term', async () => {
  const v = view('CouponsView.vue');
  assert.ok(v.includes("value: 'usable'") && v.includes("value: 'claimable'") && v.includes('사용·만료'), 'three wallet tabs');
  assert.ok(v.includes('cJson.usable') && v.includes('cJson.claimable') && v.includes('cJson.used_expired'), 'real wallet groups parsed');
  for (const f of ['발급처', '적용 범위', '최소 주문', '최대 할인', 'D-']) {
    assert.ok(v.includes(f), `card states ${f}`);
  }
  assert.ok(v.includes('seller_name'), 'store issuer named');
  assert.ok(v.includes('쿠폰 받기'), 'claim affordance kept in Korean');
  assert.ok(!v.includes('Claim Coupon Now'), 'English CTA gone');
});

await t.test('L4 support centers on Korean FAQ tabs, search and honest topics', async () => {
  const v = view('SupportView.vue');
  assert.ok(v.includes('자주 묻는 질문'), 'FAQ headed in Korean');
  assert.ok(v.includes('faqTab') && v.includes('faqQuery'), 'category tabs plus search');
  assert.ok(v.includes('REFUND_RETURN') && v.includes('PARTNER_JOIN'), 'topics match the server allowlist');
  assert.ok(!v.includes('value="RETURN"') && !v.includes('value="PARTNER"'), 'rejected topics gone');
  assert.ok(v.includes('답변 완료') && v.includes('답변 대기'), 'statuses in Korean');
});

await t.test('L5 legal pages carry contents, dates and version history', async () => {
  for (const f of ['LegalTermsView.vue', 'LegalPrivacyView.vue', 'LegalRefundView.vue']) {
    const v = view(f);
    assert.ok(v.includes('aria-label="목차"'), `${f} has contents`);
    assert.ok(v.includes('시행일자'), `${f} states the effective date`);
    assert.ok(v.includes('이전 버전') && v.includes('VERSION'), `${f} shows version history`);
  }
});

await t.test('L6 registration shows its steps', async () => {
  const v = view('RegisterView.vue');
  assert.ok(v.includes('aria-label="가입 단계"'), 'steps labelled');
  assert.ok(v.includes('1 정보 입력') && v.includes('2 가입 완료'), 'both steps named');
  assert.ok(v.includes('aria-current'), 'current step exposed');
});

await t.test('L7 payment result renamed its confirm entry', async () => {
  const v = view('PaymentResultView.vue');
  assert.ok(v.includes('async function confirmPayment()'), 'confirm renamed');
  assert.ok(v.includes('@click="confirmPayment"'), 'simulator calls the renamed entry');
});

await t.test('L8 6-13 support renders admin FAQ via OmFaq, console manages rows', async () => {
  const v = view('SupportView.vue');
  assert.ok(v.includes('OmFaq') && v.includes(':html="true"'), 'expandable sanitized answers');
  assert.ok(v.includes("params.set('category'") && v.includes("params.set('q'"), 'server-side tab + search');
  const a = readFileSync('apps/admin/src/views/FaqView.vue', 'utf8');
  assert.ok(a.includes('/api/v1/admin/faqs'), 'console wired to the FAQ API');
  assert.ok(a.includes('is_published') && a.includes('/reorder'), 'publish toggle and reorder present');
  const r = readFileSync('apps/admin/src/router/index.ts', 'utf8');
  assert.ok(r.includes("path: '/faqs'"), 'console route registered');
});

await t.test('L9 6-4 policy and legal pages lead with questions', async () => {
  const p = view('PolicyView.vue');
  assert.ok(p.includes('배송비는 얼마인가요?') && p.includes('보상받을 수 있나요?'), 'policy headings ask');
  assert.ok(p.includes('언제 지급되나요?'), 'purchase-confirm heading asks');
  const l = readFileSync('apps/storefront/src/lib/legal.ts', 'utf8');
  assert.ok(l.includes('questionFor') && l.includes('반품은 언제까지 할 수 있나요?'), 'legal question map present');
  for (const f of ['LegalTermsView.vue', 'LegalPrivacyView.vue', 'LegalRefundView.vue']) {
    const v = view(f);
    assert.ok(v.includes('questionFor('), `${f} renders question headings`);
    assert.ok(v.includes('원문 조항'), `${f} keeps the verbatim title visible`);
  }
});

t.finish();
