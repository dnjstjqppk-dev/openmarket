// tests/ui/my_sections.test.mjs
// Work order 3-9: /my routes plus settings rewrite, layout frame, shortcut
// counts, review/qna/recent/credit/store sections, postcode search attach and
// the orders ?tab= deep link.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('My sections (3-9)');
const read = (p) => readFileSync(p, 'utf8');
const my = (f) => read(`apps/storefront/src/views/my/${f}`);

await t.test('M1 seven /my routes exist and /profile redirects to settings', async () => {
  const r = read('apps/storefront/src/router/index.ts');
  for (const p of ['my', 'my/reviews', 'my/qna', 'my/recent', 'my/credits', 'my/stores', 'my/settings']) {
    assert.ok(r.includes(`path: '${p}'`), `/${p} routed`);
  }
  for (const p of ['my', 'my/reviews', 'my/qna', 'my/recent', 'my/credits', 'my/stores', 'my/settings']) {
    const line = r.split('\n').find((l) => l.includes(`path: '${p}'`));
    assert.ok(line && line.includes('requiresAuth: true'), `/${p} needs login`);
  }
  const profileLine = r.split('\n').find((l) => l.includes("path: 'profile'"));
  assert.ok(profileLine && profileLine.includes('/my/settings'), '/profile redirects to /my/settings');
});

await t.test('M2 desktop shows a 200px my menu beside the content', async () => {
  const v = my('MyLayout.vue');
  assert.ok(v.includes('w-[200px]'), 'menu is 200px');
  assert.ok(v.includes('hidden') && v.includes('md:block'), 'menu hides on mobile');
  for (const to of ['/my', '/orders', '/my/reviews', '/my/qna', '/my/recent', '/my/credits', '/my/stores', '/coupons', '/wishlist', '/addresses', '/my/settings']) {
    assert.ok(v.includes(to), `menu links ${to}`);
  }
  assert.ok(v.includes('<slot'), 'content renders beside the menu');
});

await t.test('M3 my home stacks summary, pipeline and nine counted shortcuts', async () => {
  const v = my('MyHomeView.vue');
  const order = [v.indexOf('회원 요약'), v.indexOf('/orders?tab='), v.indexOf('바로가기')];
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], 'summary, then pipeline, then shortcuts');
  assert.ok(v.includes('/orders?tab=upcoming') && v.includes('/orders?tab=purchasing') && v.includes('/orders?tab=completed'), 'pipeline deep-links each phase');
  assert.ok(v.includes('/api/v1/me/order-summary'), 'pipeline counts come from the server');
  for (const s of ['쿠폰 {{ couponCount }}장', "적립금 {{ creditBalance.toLocaleString('ko-KR') }}원", '찜 {{ wishlist.ids.size }}', '쓸 수 있는 리뷰 {{ reviewableCount }}건']) {
    assert.ok(v.includes(s), `shortcut shows ${s}`);
  }
  for (const to of ['/coupons', '/my/credits', '/wishlist', '/my/recent', '/my/stores', '/my/reviews', '/my/qna', '/addresses', '/my/settings']) {
    assert.ok(v.includes(`to="${to}"`), `shortcut links ${to}`);
  }
});

await t.test('M4 reviews split into reviewable and written tabs', async () => {
  const v = my('MyReviewsView.vue');
  assert.ok(v.includes('쓸 수 있는 리뷰') && v.includes('작성한 리뷰'), 'both tabs labelled');
  assert.ok(v.includes('/api/v1/me/reviewable') && v.includes('/api/v1/me/reviews'), 'both lists come from the server');
  assert.ok(v.includes('리뷰 쓰기') && v.includes('/product/${r.product_id}'), 'reviewable rows link to the write form');
  assert.ok(v.includes('판매자 답글'), 'seller replies shown');
});

await t.test('M5 recent list deletes loudly with a retry', async () => {
  const v = my('RecentlyViewedView.vue');
  assert.ok(v.includes('/api/v1/me/recently-viewed?limit=50'), 'server history read');
  assert.ok(v.includes("method: 'DELETE'") && v.includes('/api/v1/me/recently-viewed/${productId}'), 'per-item delete');
  assert.ok(v.includes('actionError') && v.includes('다시 시도'), 'failures surface with a retry');
});

await t.test('M6 credits show the server balance and ledger', async () => {
  const v = my('CreditsView.vue');
  assert.ok(v.includes('/api/v1/credits'), 'ledger comes from the server');
  assert.ok(v.includes("balance.toLocaleString('ko-KR')"), 'balance rendered');
  assert.ok(v.includes('h.reason') && v.includes('amount_delta'), 'rows show reason and signed amount');
});

await t.test('M7 followed stores link out and unfollow loudly', async () => {
  const v = my('FollowedStoresView.vue');
  assert.ok(v.includes('/api/v1/me/followed-stores'), 'follows come from the server');
  assert.ok(v.includes('/store/${s.partner_id}'), 'store links out');
  assert.ok(v.includes("method: 'DELETE'") && v.includes('/api/v1/stores/${partnerId}/follow'), 'unfollow hits the toggle');
});

await t.test('M8 settings keep every account behavior inside the my frame', async () => {
  const v = read('apps/storefront/src/views/ProfileView.vue');
  assert.ok(v.includes('MyLayout'), 'settings use the my frame');
  for (const e of ['/api/v1/auth/profile', '/api/v1/auth/privacy/export', '/api/v1/auth/withdraw/precheck', '/api/v1/auth/withdraw']) {
    assert.ok(v.includes(e), `settings still call ${e}`);
  }
  assert.ok(v.includes('내 정보 내려받기'), 'export entry kept');
  assert.ok(v.includes('data-testid="withdraw-panel"'), 'withdraw panel kept');
});

await t.test('M9 address form mounts the shared postcode search', async () => {
  const v = read('apps/storefront/src/views/AddressesView.vue');
  assert.ok(v.includes('OmAddressSearch'), 'shared search mounted');
  assert.ok(v.includes('v-model:zip="form.postal_code"'), 'zip binds the postal field');
  assert.ok(v.includes('v-model:address="form.address_line1"'), 'address binds the road field');
  assert.ok(v.includes(':required="true"'), 'postcode stays required');
  assert.ok(v.includes('@pick="onPostalPick"'), 'provider picks fill the form');
  assert.ok(v.includes('\\d{5}'), '5-digit validation kept');
});

await t.test('M10 orders honor the ?tab= deep link', async () => {
  const v = read('apps/storefront/src/views/OrdersView.vue');
  assert.ok(v.includes('route.query.tab'), 'tab reads the query');
  assert.ok(v.includes('upcoming') && v.includes('completed'), 'known tabs accepted');
  assert.ok(v.includes("? 'purchasing'") || v.includes(': \'purchasing\''), 'unknown values fall back to purchasing');
});

await t.test('M11 shell points at /my and tabs recent fifth', async () => {
  const app = read('apps/storefront/src/App.vue');
  assert.ok(!app.includes('/profile'), 'no /profile links left in the shell');
  assert.ok(app.includes("to: auth.isAuthenticated ? '/my' : '/login'"), 'my tab points at /my');
  const nav = app.slice(app.indexOf('const bottomNav'), app.indexOf('const footerColumns'));
  assert.ok(nav.includes("label: '최근 본'") && nav.includes('/my/recent'), 'recent tab present');
  assert.ok(nav.indexOf('/my/recent') > nav.indexOf("label: auth.isAuthenticated ? '마이' : '로그인'"), 'recent tabs after my');
});

await t.test('M12 new my views carry no native dialogs', async () => {
  for (const f of ['MyLayout.vue', 'MyHomeView.vue', 'MyReviewsView.vue', 'MyQnaView.vue', 'RecentlyViewedView.vue', 'CreditsView.vue', 'FollowedStoresView.vue']) {
    assert.ok(!/\b(?:window\.)?(?:alert|confirm)\s*\(\s*['"`]/.test(my(f)), `${f} has no native dialog`);
  }
});

t.finish();
