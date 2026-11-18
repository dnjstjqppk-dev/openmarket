// tests/ui/card_sections.test.mjs
// Work order 3-3: product card, quick actions, option sheet.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Card sections (3-3)');
const read = (p) => readFileSync(p, 'utf8');
const card = () => read('packages/ui/src/components/OmProductCard.vue');

await t.test('C31 square zoom thumbnail with sold-out scrim', async () => {
  const v = card();
  assert.ok(v.includes('aspect-square'), '1:1 thumbnail');
  assert.ok(v.includes('group-hover:scale-105') && v.includes('duration-slow'), 'hover zoom 1.05x in 0.3s');
  assert.ok(v.includes('bg-surface/70') && v.includes('품절'), 'sold-out scrim (theme-aware white)');
});

await t.test('C32 corner shows rank, live deal or direct in that order', async () => {
  const v = card();
  const rankAt = v.indexOf('v-if="rank"');
  const dealAt = v.indexOf('v-else-if="isDeal"');
  const directAt = v.indexOf('v-else-if="isDirect"');
  assert.ok(rankAt > 0 && dealAt > rankAt && directAt > dealAt, 'rank > deal > direct precedence');
  assert.ok(v.includes("kind=\"deal\"") && v.includes("kind=\"direct\""), 'deal and direct badges');
});

await t.test('C33 round wish and quick-add buttons with heart pop', async () => {
  const v = card();
  assert.ok(v.includes('data-testid="wish-toggle"') && v.includes('data-testid="quick-add"'), 'stable selectors');
  assert.ok(v.includes('rounded-full'), 'round buttons');
  assert.ok(v.includes('scale-125') && v.includes('duration'), 'heart pop effect');
  assert.ok(v.includes("emit('wish')") && v.includes("emit('add')"), 'actions emitted to the wrapper');
  assert.ok(v.includes(':disabled="soldOut"'), 'quick-add disabled when sold out');
});

await t.test('C34 text stack ends in stars plus honest 30-day sales', async () => {
  const v = card();
  const order = ['text-xs text-ink-muted', 'line-clamp-2', 'OmPrice', 'OmCommerceBadge', '최근 30일'];
  let at = -1;
  for (const s of order) {
    const i = v.indexOf(s, at + 1);
    assert.ok(i > at, `${s} follows in stack order`);
    at = i;
  }
  assert.ok(v.includes("'1천+'"), 'thousands capped at 1천+');
  assert.ok(v.includes('n < 10'), 'under-10 hidden');
});

await t.test('C35 badges follow the 3-3 conditions', async () => {
  const v = card();
  assert.ok(v.includes('sale.value >= Number(threshold)'), 'free means free for a single unit');
  assert.ok(v.includes('today_cutoff') && v.includes('getHours'), 'today checks the cutoff clock');
  assert.ok(v.includes('has_tomorrow') && v.includes('tomorrowDispatch'), 'tomorrow needs the server flag');
  assert.ok(v.includes('v-else-if="tomorrowDispatch"') && v.includes('kind="tomorrow"'), 'tomorrow badge exclusive with today');
  assert.ok(v.includes('has_coupon'), 'coupon needs a claimable offer');
  assert.ok(v.includes('earn_bps'), 'earn needs the policy rate');
});

await t.test('C36 quick sheet adapts to viewport and adds through the cart store', async () => {
  const v = read('apps/storefront/src/components/QuickOptionSheet.vue');
  assert.ok(v.includes('OmModal') && v.includes('OmBottomSheet'), 'modal on desktop, sheet on mobile');
  assert.ok(v.includes('isDesktop'), 'viewport switch');
  assert.ok(v.includes('data-testid="quick-sheet"') && v.includes('data-testid="quick-confirm"'), 'stable selectors');
  assert.ok(v.includes('cart.addItem'), 'adds through the cart store');
  const w = read('apps/storefront/src/components/ProductCard.vue');
  assert.ok(w.includes('skus.length === 1'), 'single option adds directly');
});

await t.test('C37 wishlist store loads once and toggles server-side', async () => {
  const v = read('apps/storefront/src/stores/wishlist.ts');
  assert.ok(v.includes('/api/v1/wishlist'), 'server wishlist used');
  assert.ok(v.includes('inflight'), 'single load shared');
});

t.finish();
