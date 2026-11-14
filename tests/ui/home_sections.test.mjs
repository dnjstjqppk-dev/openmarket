// tests/ui/home_sections.test.mjs
// Work order 3-1: home zones, request budget, infinite grid.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Home sections (3-1)');
const read = (p) => readFileSync(p, 'utf8');
const home = () => read('apps/storefront/src/views/HomeView.vue');

await t.test('H31 carousel has counter, pause and dots with 360px/16:9 sizing', async () => {
  const v = home();
  assert.ok(v.includes('OmCarousel'), 'shared carousel reused');
  assert.ok(v.includes('bannerIdx + 1'), 'N / M counter overlaid');
  assert.ok(v.includes('aspect-video') && v.includes('sm:h-[360px]'), '16:9 mobile, 360px desktop');
});

await t.test('H32 shortcuts take 10 stocked roots in 5/10 columns with 56px circles', async () => {
  const v = home();
  assert.ok(v.includes('slice(0, 10)'), 'ten shortcuts');
  assert.ok(v.includes('grid-cols-5') && v.includes('sm:grid-cols-10'), '5 mobile, 10 desktop');
  assert.ok(v.includes('h-14 w-14'), '56px circles');
});

await t.test('H33 deals scroll sideways with measured bars and a live countdown', async () => {
  const v = home();
  assert.ok(v.includes('overflow-x-auto') && v.includes('snap-start'), 'sideways snap strip');
  assert.ok(v.includes('OmProgress'), 'measured sell-through bar');
  assert.ok(v.includes('allocated_stock') && v.includes('남음'), 'remaining only with allocation');
  assert.ok(v.includes('OmCountdown'), 'live countdown reused');
});

await t.test('H34 ranking tabs lazy-load server top-10s with ranks', async () => {
  const v = home();
  assert.ok(v.includes('ALL'), 'all tab present');
  assert.ok(v.includes('slice(0, 6)'), 'six root tabs max');
  assert.ok(v.includes('sort=popular&per_page=10'), 'server top-10 per tab');
  assert.ok(v.includes(':rank="i + 1"'), 'ranks passed to cards');
});

await t.test('H35 exhibitions and for-you hide when empty or anonymous', async () => {
  const v = home();
  assert.ok(v.includes('ex.products.slice(0, 8)'), 'lineup capped at 8');
  assert.ok(v.includes('auth.isAuthenticated && forYou.length'), 'for-you signed-in only');
});

await t.test('H36 grid pages 40 at a time with no client fetch-all sort', async () => {
  const v = home();
  assert.ok(v.includes('per_page=${PAGE_SIZE}') && v.includes('PAGE_SIZE = 40'), '40 per page');
  assert.ok(v.includes('IntersectionObserver'), 'infinite scroll observer');
  assert.ok(!v.includes('.sort((a, b)'), 'no client-side catalogue sort');
  const endpoints = new Set([...v.matchAll(/getJson\(`?(\/api\/v1\/[a-z-]+)/g)].map((m) => m[1]));
  assert.ok(endpoints.size <= 6, `first-screen endpoints within budget (${[...endpoints].join(', ')})`);
});

t.finish();
